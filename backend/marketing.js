const crypto = require('crypto');
const express = require('express');
const { isAllowedOrigin } = require('./request-origin');

const SESSION_HOURS = 8;
const ROLE_PERMISSIONS = {
  admin: ['dashboard', 'campaigns', 'leads', 'events', 'subscriptions', 'reports'],
  analyst: ['dashboard', 'campaigns', 'events'],
  sales: ['leads', 'subscriptions']
};
const LOGIN_ATTEMPTS = new Map();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) return reject(error);
      resolve(`scrypt$${salt}$${key.toString('hex')}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, keyHex] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/i.test(keyHex || '')) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) return reject(error);
      resolve(crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex')));
    });
  });
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieOptions(maxAge = 28800) {
  const options = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === 'production') options.push('Secure');
  return options.join('; ');
}

function getCookie(req, name) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvResponse(res, filename, columns, rows) {
  const csv = [
    columns.map(column => csvCell(column.label)).join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column.key])).join(','))
  ].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csv}`);
}

function dateFilters(req) {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    const error = new Error('El rango de fechas no es válido.');
    error.status = 400;
    throw error;
  }
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const resolvedFrom = from || defaultFrom;
  const resolvedTo = to || today;
  if ((Date.parse(`${resolvedTo}T00:00:00.000Z`) - Date.parse(`${resolvedFrom}T00:00:00.000Z`)) / 86400000 > 365) {
    const error = new Error('El rango de fechas no puede superar 366 días.');
    error.status = 400;
    throw error;
  }
  return { from: resolvedFrom, to: resolvedTo };
}

function textFilter(value, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function addDimensionFilters(values, { source = '', medium = '', campaign = '' }, prefix = '') {
  let sql = '';
  for (const [column, value] of [['source', source], ['medium', medium], ['campaign', campaign]]) {
    if (value) {
      values.push(value);
      sql += ` AND ${prefix ? `${prefix}.` : ''}${column} = $${values.length}`;
    }
  }
  return sql;
}

function registerMarketingRoutes(app, pool) {
  const router = express.Router();
  const sessionCookie = 'aurora_admin_session';
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function fail(res, error, message) {
    console.error(`marketing API failed: ${error.message}`);
    res.status(error.status || 503).json({ error: error.status ? error.message : message });
  }

  function requireSameOrigin(req, res, next) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const candidate = origin || referer;
    if (!candidate || !isAllowedOrigin(req, candidate)) return res.status(403).json({ error: 'Solicitud de origen no válido.' });
    next();
  }

  async function requireUser(req, res, next) {
    const token = getCookie(req, sessionCookie);
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.role_id, r.display_name
         FROM marketing_admin_sessions s
         JOIN marketing_admin_users u ON u.id = s.user_id AND u.active = TRUE
         JOIN marketing_roles r ON r.id = u.role_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [tokenDigest(token)]
      );
      if (!result.rowCount) return res.status(401).json({ error: 'La sesión expiró. Inicia sesión nuevamente.' });
      req.admin = result.rows[0];
      next();
    } catch (error) {
      fail(res, error, 'No se pudo validar la sesión.');
    }
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      if (!ROLE_PERMISSIONS[req.admin.role_id]?.includes(permission)) {
        return res.status(403).json({ error: 'Tu rol no tiene permiso para consultar esta sección.' });
      }
      next();
    };
  }

  function asyncRoute(handler) {
    return (req, res) => {
      Promise.resolve(handler(req, res)).catch(error => fail(res, error, 'No fue posible consultar la información.'));
    };
  }

  async function audit(req, action, details = {}) {
    await pool.query(
      'INSERT INTO marketing_admin_audit (user_id, action, details) VALUES ($1, $2, $3::jsonb)',
      [req.admin?.id || null, action, JSON.stringify(details)]
    );
  }

  router.post('/login', requireSameOrigin, asyncRoute(async (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    for (const [address, attempt] of LOGIN_ATTEMPTS) {
      if (now - attempt.startedAt >= 15 * 60 * 1000) LOGIN_ATTEMPTS.delete(address);
    }
    const attempts = LOGIN_ATTEMPTS.get(ip);
    if (attempts && attempts.count >= 8 && now - attempts.startedAt < 15 * 60 * 1000) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.' });
    }
    const email = textFilter(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.role_id, r.display_name
       FROM marketing_admin_users u JOIN marketing_roles r ON r.id = u.role_id
       WHERE u.email = $1 AND u.active = TRUE`,
      [email]
    );
    const user = userResult.rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) {
      const current = LOGIN_ATTEMPTS.get(ip);
      LOGIN_ATTEMPTS.set(ip, current && now - current.startedAt < 15 * 60 * 1000
        ? { startedAt: current.startedAt, count: current.count + 1 }
        : { startedAt: now, count: 1 });
      await audit({ admin: null }, 'login_failed');
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    LOGIN_ATTEMPTS.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const previousToken = getCookie(req, sessionCookie);
    if (/^[a-f0-9]{64}$/i.test(previousToken)) {
      await pool.query('DELETE FROM marketing_admin_sessions WHERE token_hash = $1', [tokenDigest(previousToken)]);
    }
    await pool.query('DELETE FROM marketing_admin_sessions WHERE expires_at <= NOW()');
    await pool.query(
      `INSERT INTO marketing_admin_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 hour'))`,
      [tokenDigest(token), user.id, SESSION_HOURS]
    );
    req.admin = user;
    await audit(req, 'login');
    res.set('Set-Cookie', `${sessionCookie}=${token}; ${cookieOptions()}`);
    res.json({
      user: { email: user.email, role: user.role_id, roleName: user.display_name, permissions: ROLE_PERMISSIONS[user.role_id] || [] }
    });
  }));

  router.get('/session', requireUser, (req, res) => {
    res.json({
      user: {
        email: req.admin.email,
        role: req.admin.role_id,
        roleName: req.admin.display_name,
        permissions: ROLE_PERMISSIONS[req.admin.role_id] || []
      }
    });
  });

  router.post('/logout', requireSameOrigin, requireUser, asyncRoute(async (req, res) => {
    const token = getCookie(req, sessionCookie);
    await pool.query('DELETE FROM marketing_admin_sessions WHERE token_hash = $1', [tokenDigest(token)]);
    await audit(req, 'logout');
    res.set('Set-Cookie', `${sessionCookie}=; ${cookieOptions(0)}`);
    res.json({ ok: true });
  }));

  router.get('/dashboard', requireUser, requirePermission('dashboard'), asyncRoute(async (req, res) => {
    const { from, to } = dateFilters(req);
    const source = textFilter(req.query.source, 120);
    const medium = textFilter(req.query.medium, 120);
    const campaign = textFilter(req.query.campaign, 160);
    const filters = [from, to];
    const filterSql = addDimensionFilters(filters, { source, medium, campaign });
    const eventWhere = `created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${filterSql}`;
    const subscriptionFilters = [from, to];
    const subscriptionFilterSql = addDimensionFilters(subscriptionFilters, { source, medium, campaign });

    const [metricsResult, sessionMetricsResult, daysResult, sourcesResult, plansResult, funnelResult, optionsResult] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE event_name = 'page_view') AS visits,
          COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'page_view') AS visitors,
          COUNT(*) FILTER (WHERE event_name = 'plan_selected') AS cta_clicks,
          COUNT(*) FILTER (WHERE event_name = 'checkout_started') AS checkout_starts,
          COUNT(*) FILTER (WHERE event_name = 'checkout_abandoned') AS abandonments
         FROM events WHERE ${eventWhere}`,
        filters
      ),
      pool.query(
        `WITH sessions AS (
           SELECT session_id,
             COUNT(*) FILTER (WHERE event_name = 'page_view') AS page_views,
             COUNT(DISTINCT NULLIF(page_path, '')) FILTER (WHERE event_name = 'page_view') AS pages_visited,
             MAX(
               CASE WHEN event_name = 'session_end'
                 AND metadata->>'durationSeconds' ~ '^[0-9]+$'
               THEN LEAST((metadata->>'durationSeconds')::integer, 86400)
               END
             ) AS duration_seconds
           FROM events
           WHERE ${eventWhere}
           GROUP BY session_id
         )
         SELECT
           COUNT(*) FILTER (WHERE page_views > 0) AS sessions,
           COALESCE(AVG(pages_visited::numeric) FILTER (WHERE page_views > 0), 0) AS pages_per_session,
           COALESCE(AVG(duration_seconds::numeric) FILTER (WHERE page_views > 0 AND duration_seconds IS NOT NULL), 0) AS avg_duration_seconds,
           COUNT(*) FILTER (WHERE page_views > 0 AND duration_seconds IS NOT NULL) AS measured_sessions
         FROM sessions`,
        filters
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
         ), visits AS (
           SELECT created_at::date AS day, COUNT(*) AS total FROM events
           WHERE event_name = 'page_view' AND ${eventWhere} GROUP BY created_at::date
         ), conversions AS (
           SELECT created_at::date AS day, COUNT(*) AS total FROM subscriptions
           WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${subscriptionFilterSql}
           GROUP BY created_at::date
         )
         SELECT days.day, COALESCE(visits.total, 0) AS visits, COALESCE(conversions.total, 0) AS subscriptions
         FROM days LEFT JOIN visits USING (day) LEFT JOIN conversions USING (day) ORDER BY days.day`,
        subscriptionFilters
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(source, ''), 'directo') AS source, COUNT(*) AS visits
         FROM events WHERE event_name = 'page_view' AND ${eventWhere}
         GROUP BY 1 ORDER BY visits DESC LIMIT 10`,
        filters
      ),
      pool.query(
        `SELECT plan_id, COUNT(*) AS selections FROM events
         WHERE event_name = 'plan_selected' AND ${eventWhere}
         GROUP BY plan_id ORDER BY selections DESC`,
        filters
      ),
      pool.query(`SELECT event_name, COUNT(*) AS total FROM events WHERE ${eventWhere} GROUP BY event_name`, filters),
      pool.query(
        `SELECT bag_size, frequency_days, COUNT(*) AS total FROM subscriptions
         WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
         ${subscriptionFilterSql.replace(/^ AND/, 'AND')}
         GROUP BY bag_size, frequency_days ORDER BY total DESC`,
        subscriptionFilters
      ),
    ]);

    const leadsFilters = [from, to];
    const leadsFilterSql = addDimensionFilters(leadsFilters, { source, medium, campaign });
    const [leadsResult, subscriptionsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total FROM leads
         WHERE consent = TRUE
           AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
         ${leadsFilterSql}`,
        leadsFilters
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE LOWER(BTRIM(status)) IN ('cancelada', 'cancelled', 'canceled')) AS canceled
         FROM subscriptions
         WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
         ${subscriptionFilterSql.replace(/^ AND/, 'AND')}`,
        subscriptionFilters
      )
    ]);
    const metric = metricsResult.rows[0];
    const sessionMetrics = sessionMetricsResult.rows[0];
    const visits = Number(metric.visits);
    const checkoutStarts = Number(metric.checkout_starts);
    const subscriptions = Number(subscriptionsResult.rows[0].total);
    const canceledSubscriptions = Number(subscriptionsResult.rows[0].canceled);
    const eventCounts = Object.fromEntries(funnelResult.rows.map(row => [row.event_name, Number(row.total)]));
    const leads = Number(leadsResult.rows[0].total);
    const convertedFilters = [from, to];
    let convertedFilterSql = '';
    for (const [column, value] of [['source', source], ['medium', medium], ['campaign', campaign]]) {
      if (value) {
        convertedFilters.push(value);
        convertedFilterSql += ` AND l.${column} = $${convertedFilters.length} AND s.${column} = $${convertedFilters.length}`;
      }
    }
    const convertedLeads = await pool.query(
      `SELECT COUNT(DISTINCT l.user_id) AS total
       FROM leads l JOIN subscriptions s ON s.user_id = l.user_id
       WHERE l.consent = TRUE AND l.created_at >= $1::date AND l.created_at < ($2::date + INTERVAL '1 day')
         AND l.user_id IS NOT NULL
         AND LOWER(BTRIM(s.status)) IN ('simulada', 'activa', 'active')
         AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')${convertedFilterSql}`,
      convertedFilters
    );
    await audit(req, 'dashboard_view', { from, to, source, medium, campaign });
    res.json({
      range: { from, to },
      metrics: {
        visits,
        visitors: Number(metric.visitors),
        avgDurationSeconds: Number(sessionMetrics.avg_duration_seconds),
        measuredSessions: Number(sessionMetrics.measured_sessions),
        pagesPerSession: Number(sessionMetrics.pages_per_session),
        leads,
        ctaClicks: Number(metric.cta_clicks),
        checkoutStarts,
        subscriptions,
        conversionRate: visits ? subscriptions / visits * 100 : 0,
        abandonmentRate: checkoutStarts ? Number(metric.abandonments) / checkoutStarts * 100 : 0,
        canceledSubscriptions,
        notCanceledSubscriptions: subscriptions - canceledSubscriptions,
        cancellationRate: subscriptions ? canceledSubscriptions / subscriptions * 100 : 0,
        ctaRate: visits ? Number(metric.cta_clicks) / visits * 100 : 0,
        abandonments: Number(metric.abandonments),
        leadConversionRate: leads ? Number(convertedLeads.rows[0].total) / leads * 100 : 0
      },
      timeseries: daysResult.rows.map(row => ({ day: row.day, visits: Number(row.visits), subscriptions: Number(row.subscriptions) })),
      sources: sourcesResult.rows.map(row => ({ source: row.source, visits: Number(row.visits) })),
      plans: plansResult.rows.map(row => ({ planId: row.plan_id || 'sin_plan', selections: Number(row.selections) })),
      funnel: [
        { step: 'Visitas', total: visits },
        { step: 'Clics en planes', total: Number(metric.cta_clicks) },
        { step: 'Inicio de suscripción', total: checkoutStarts },
        { step: 'Suscripciones registradas', total: subscriptions }
      ],
      eventCounts,
      options: optionsResult.rows.map(row => ({ bagSize: row.bag_size, frequencyDays: row.frequency_days, total: Number(row.total) }))
    });
  }));

  router.get('/campaigns', requireUser, requirePermission('campaigns'), asyncRoute(async (req, res) => {
    const filters = dateFilters(req);
    const dimensions = {
      source: textFilter(req.query.source, 120),
      medium: textFilter(req.query.medium, 120),
      campaign: textFilter(req.query.campaign, 160)
    };
    const result = await campaignRows(pool, { ...filters, ...dimensions });
    await audit(req, 'campaigns_view', { ...filters, ...dimensions });
    res.json({ campaigns: result.rows.map(row => ({
      source: row.source || 'sin fuente',
      medium: row.medium || 'sin medio',
      campaign: row.campaign || 'sin campaña',
      visits: Number(row.visits),
      subscriptions: Number(row.subscriptions)
    })) });
  }));

  router.get('/leads', requireUser, requirePermission('leads'), asyncRoute(async (req, res) => {
    const { from, to } = dateFilters(req);
    const search = textFilter(req.query.search, 160);
    const dimensions = {
      source: textFilter(req.query.source, 120),
      medium: textFilter(req.query.medium, 120),
      campaign: textFilter(req.query.campaign, 160)
    };
    const values = [from, to];
    const filters = ['l.consent = TRUE', 'l.created_at >= $1::date', "l.created_at < ($2::date + INTERVAL '1 day')"];
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(l.email ILIKE $${values.length} OR u.full_name ILIKE $${values.length})`);
    }
    const dimensionSql = addDimensionFilters(values, dimensions, 'l').replace(/^ AND/, '');
    if (dimensionSql) filters.push(dimensionSql);
    values.push(Math.min(500, Math.max(1, Number(req.query.limit) || 100)));
    const result = await pool.query(
      `SELECT l.id, l.user_id, u.full_name AS name, l.email, s.phone, l.source, l.medium, l.campaign,
              l.gclid, l.fbclid, l.created_at,
              EXISTS (
                SELECT 1 FROM subscriptions sub
                WHERE sub.user_id = l.user_id
                  AND LOWER(BTRIM(sub.status)) IN ('simulada', 'activa', 'active')
              ) AS converted
       FROM leads l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN LATERAL (
         SELECT phone FROM subscriptions
         WHERE user_id = l.user_id ORDER BY created_at DESC LIMIT 1
       ) s ON l.user_id IS NOT NULL
       WHERE ${filters.join(' AND ')}
       ORDER BY l.created_at DESC LIMIT $${values.length}`,
      values
    );
    await audit(req, 'leads_view', { from, to, search, ...dimensions });
    res.json({ leads: result.rows });
  }));

  router.get('/events', requireUser, requirePermission('events'), asyncRoute(async (req, res) => {
    const { from, to } = dateFilters(req);
    const eventName = textFilter(req.query.event, 60);
    const dimensions = {
      source: textFilter(req.query.source, 120),
      medium: textFilter(req.query.medium, 120),
      campaign: textFilter(req.query.campaign, 160)
    };
    const values = [from, to];
    const filters = ["created_at >= $1::date", "created_at < ($2::date + INTERVAL '1 day')"];
    if (eventName) { values.push(eventName); filters.push(`event_name = $${values.length}`); }
    const dimensionSql = addDimensionFilters(values, dimensions).replace(/^ AND/, '');
    if (dimensionSql) filters.push(dimensionSql);
    values.push(Math.min(500, Math.max(1, Number(req.query.limit) || 100)));
    const result = await pool.query(
      `SELECT event_name, session_id, page_path, plan_id, source, medium, campaign,
              metadata->>'gclid' AS gclid, metadata->>'fbclid' AS fbclid,
              metadata->>'email' AS email, metadata->>'userId' AS user_id,
              metadata->>'planName' AS plan_name,
              metadata->>'bagSize' AS bag_size,
              metadata->>'frequencyDays' AS frequency_days,
              metadata->>'previousPlanId' AS previous_plan_id,
              metadata->>'previousPlanName' AS previous_plan_name,
              metadata->>'previousBagSize' AS previous_bag_size,
              metadata->>'previousFrequencyDays' AS previous_frequency_days,
              metadata->>'newPlanId' AS new_plan_id,
              metadata->>'newPlanName' AS new_plan_name,
              metadata->>'newBagSize' AS new_bag_size,
              metadata->>'newFrequencyDays' AS new_frequency_days,
              metadata->>'subscriptionId' AS subscription_id,
              metadata->>'durationSeconds' AS duration_seconds,
              created_at
       FROM events WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values
    );
    await audit(req, 'events_view', { from, to, type: eventName, ...dimensions });
    res.json({ events: result.rows });
  }));

  router.get('/subscriptions', requireUser, requirePermission('subscriptions'), asyncRoute(async (req, res) => {
    const { from, to } = dateFilters(req);
    const plan = textFilter(req.query.plan, 40);
    const dimensions = {
      source: textFilter(req.query.source, 120),
      medium: textFilter(req.query.medium, 120),
      campaign: textFilter(req.query.campaign, 160)
    };
    const values = [from, to];
    const filters = ["created_at >= $1::date", "created_at < ($2::date + INTERVAL '1 day')"];
    if (plan) { values.push(plan); filters.push(`plan_id = $${values.length}`); }
    const dimensionSql = addDimensionFilters(values, dimensions).replace(/^ AND/, '');
    if (dimensionSql) filters.push(dimensionSql);
    values.push(Math.min(500, Math.max(1, Number(req.query.limit) || 100)));
    const result = await pool.query(
      `SELECT id, user_id, customer_name, email, phone, plan_id, plan_name, bag_size, frequency_days,
              price_cop, status, source, medium, campaign, gclid, fbclid, created_at
       FROM subscriptions WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values
    );
    await audit(req, 'subscriptions_view', { from, to, plan, ...dimensions });
    res.json({ subscriptions: result.rows });
  }));

  router.get('/export', requireUser, requirePermission('reports'), asyncRoute(async (req, res) => {
    const { from, to } = dateFilters(req);
    const type = textFilter(req.query.type, 30);
    const dimensions = {
      source: textFilter(req.query.source, 120),
      medium: textFilter(req.query.medium, 120),
      campaign: textFilter(req.query.campaign, 160)
    };
    let rows;
    let columns;
    if (type === 'leads') {
      const values = [from, to];
      const search = textFilter(req.query.search, 160);
      let searchSql = '';
      if (search) {
        values.push(`%${search}%`);
        searchSql = ` AND (l.email ILIKE $${values.length} OR u.full_name ILIKE $${values.length})`;
      }
      const dimensionSql = addDimensionFilters(values, dimensions, 'l');
      const result = await pool.query(
        `SELECT l.user_id, u.full_name AS customer_name, l.email, s.phone, l.source, l.medium, l.campaign,
                l.gclid, l.fbclid, l.created_at
         FROM leads l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN LATERAL (
           SELECT phone FROM subscriptions
           WHERE user_id = l.user_id ORDER BY created_at DESC LIMIT 1
         ) s ON l.user_id IS NOT NULL
         WHERE l.consent = TRUE AND l.created_at >= $1::date AND l.created_at < ($2::date + INTERVAL '1 day')${searchSql}${dimensionSql}
         ORDER BY l.created_at DESC LIMIT 10000`,
        values
      );
      rows = result.rows;
      columns = ['user_id', 'customer_name', 'email', 'phone', 'source', 'medium', 'campaign', 'gclid', 'fbclid', 'created_at'].map(key => ({ key, label: key }));
    } else if (type === 'events') {
      const values = [from, to];
      const eventName = textFilter(req.query.event, 60);
      let eventFilterSql = '';
      if (eventName) {
        values.push(eventName);
        eventFilterSql = ` AND event_name = $${values.length}`;
      }
      const dimensionSql = addDimensionFilters(values, dimensions);
      const result = await pool.query(
        `SELECT event_name, session_id, page_path, plan_id, source, medium, campaign,
                metadata->>'gclid' AS gclid, metadata->>'fbclid' AS fbclid,
                metadata->>'email' AS email, metadata->>'userId' AS user_id,
                metadata->>'planName' AS plan_name,
                metadata->>'bagSize' AS bag_size,
                metadata->>'frequencyDays' AS frequency_days,
                metadata->>'previousPlanId' AS previous_plan_id,
                metadata->>'previousPlanName' AS previous_plan_name,
                metadata->>'previousBagSize' AS previous_bag_size,
                metadata->>'previousFrequencyDays' AS previous_frequency_days,
                metadata->>'newPlanId' AS new_plan_id,
                metadata->>'newPlanName' AS new_plan_name,
                metadata->>'newBagSize' AS new_bag_size,
                metadata->>'newFrequencyDays' AS new_frequency_days,
                metadata->>'durationSeconds' AS duration_seconds,
                metadata->>'subscriptionId' AS subscription_id, created_at
         FROM events WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${eventFilterSql}${dimensionSql}
         ORDER BY created_at DESC LIMIT 10000`,
        values
      );
      rows = result.rows;
      columns = ['event_name', 'session_id', 'page_path', 'plan_id', 'user_id', 'email', 'plan_name', 'bag_size', 'frequency_days', 'previous_plan_name', 'previous_bag_size', 'previous_frequency_days', 'new_plan_name', 'new_bag_size', 'new_frequency_days', 'subscription_id', 'duration_seconds', 'source', 'medium', 'campaign', 'gclid', 'fbclid', 'created_at'].map(key => ({ key, label: key }));
    } else if (type === 'subscriptions') {
      const values = [from, to];
      const plan = textFilter(req.query.plan, 40);
      let planFilterSql = '';
      if (plan) {
        values.push(plan);
        planFilterSql = ` AND plan_id = $${values.length}`;
      }
      const dimensionSql = addDimensionFilters(values, dimensions);
      const result = await pool.query(
        `SELECT user_id, customer_name, email, phone, plan_name, bag_size, frequency_days, price_cop, status, source, medium, campaign, created_at
         FROM subscriptions WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${planFilterSql}${dimensionSql}
         ORDER BY created_at DESC LIMIT 10000`,
        values
      );
      rows = result.rows;
      columns = ['user_id', 'customer_name', 'email', 'phone', 'plan_name', 'bag_size', 'frequency_days', 'price_cop', 'status', 'source', 'medium', 'campaign', 'created_at'].map(key => ({ key, label: key }));
    } else if (type === 'campaigns') {
      const result = await campaignRows(pool, { from, to, ...dimensions });
      rows = result.rows;
      columns = ['source', 'medium', 'campaign', 'visits', 'subscriptions'].map(key => ({ key, label: key }));
    } else if (type === 'dashboard') {
      const visitValues = [from, to];
      const visitDimensions = addDimensionFilters(visitValues, dimensions);
      const leadValues = [from, to];
      const leadDimensions = addDimensionFilters(leadValues, dimensions);
      const subscriptionValues = [from, to];
      const subscriptionDimensions = addDimensionFilters(subscriptionValues, dimensions);
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM events WHERE event_name = 'page_view' AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${visitDimensions}) AS visits,
          (SELECT COUNT(*) FROM leads WHERE consent = TRUE AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${leadDimensions}) AS leads,
          (SELECT COUNT(*) FROM subscriptions WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${subscriptionDimensions}) AS subscriptions,
          (SELECT COUNT(*) FROM subscriptions WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${subscriptionDimensions}
             AND LOWER(BTRIM(status)) IN ('cancelada', 'cancelled', 'canceled')) AS canceled_subscriptions,
          (SELECT COALESCE(AVG(duration_seconds), 0) FROM (
             SELECT MAX(CASE WHEN metadata->>'durationSeconds' ~ '^[0-9]+$'
               THEN LEAST((metadata->>'durationSeconds')::integer, 86400) END) AS duration_seconds
             FROM events WHERE event_name = 'session_end'
               AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${visitDimensions}
             GROUP BY session_id
           ) sessions WHERE duration_seconds IS NOT NULL) AS avg_duration_seconds,
          (SELECT COALESCE(AVG(pages_visited), 0) FROM (
             SELECT session_id, COUNT(DISTINCT NULLIF(page_path, '')) AS pages_visited
             FROM events WHERE event_name = 'page_view'
               AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${visitDimensions}
             GROUP BY session_id
           ) sessions) AS pages_per_session`,
        visitValues
      );
      const metrics = result.rows[0];
      const subscriptions = Number(metrics.subscriptions);
      const canceledSubscriptions = Number(metrics.canceled_subscriptions);
      rows = [{
        from,
        to,
        ...metrics,
        not_canceled_subscriptions: subscriptions - canceledSubscriptions,
        cancellation_rate: subscriptions ? canceledSubscriptions / subscriptions * 100 : 0
      }];
      columns = ['from', 'to', 'visits', 'leads', 'subscriptions', 'avg_duration_seconds', 'pages_per_session', 'canceled_subscriptions', 'not_canceled_subscriptions', 'cancellation_rate'].map(key => ({ key, label: key }));
    } else {
      const error = new Error('Tipo de exportación no válido.');
      error.status = 400;
      throw error;
    }
    await audit(req, 'export', { type, from, to, rows: rows.length });
    csvResponse(res, `cafe-aurora-${type}-${from}-${to}.csv`, columns, rows);
  }));

  router.use((_req, res) => res.status(404).json({ error: 'Ruta del panel no encontrada.' }));
  app.use('/api/marketing', router);
}

async function campaignRows(pool, { from, to, source = '', medium = '', campaign = '' }) {
  const filters = [from, to];
  const filterParts = [];
  for (const [column, value] of [['source', source], ['medium', medium], ['campaign', campaign]]) {
    if (value) {
      filters.push(value);
      filterParts.push(` AND ${column} = $${filters.length}`);
    }
  }
  const filterSql = filterParts.join('');
  return pool.query(
    `WITH ev AS (
       SELECT source, medium, campaign, COUNT(*) AS visits FROM events
       WHERE event_name = 'page_view' AND created_at >= $1::date
         AND created_at < ($2::date + INTERVAL '1 day')${filterSql}
       GROUP BY source, medium, campaign
     ), subs AS (
       SELECT source, medium, campaign, COUNT(*) AS subscriptions FROM subscriptions
       WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')${filterSql}
       GROUP BY source, medium, campaign
     )
     SELECT COALESCE(ev.source, subs.source) AS source,
            COALESCE(ev.medium, subs.medium) AS medium,
            COALESCE(ev.campaign, subs.campaign) AS campaign,
            COALESCE(ev.visits, 0) AS visits, COALESCE(subs.subscriptions, 0) AS subscriptions
     FROM ev FULL OUTER JOIN subs
       ON COALESCE(ev.source, '') = COALESCE(subs.source, '')
       AND COALESCE(ev.medium, '') = COALESCE(subs.medium, '')
       AND COALESCE(ev.campaign, '') = COALESCE(subs.campaign, '')
     ORDER BY visits DESC, subscriptions DESC LIMIT 500`,
    filters
  );
}

module.exports = { registerMarketingRoutes, hashPassword };
