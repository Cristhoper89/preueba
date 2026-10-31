const crypto = require('crypto');

const SESSION_DAYS = 30;
const LOGIN_ATTEMPTS = new Map();
const PLANS = {
  esencial: { name: 'Aurora Esencial', price: 39900, baseSize: '250 g' },
  explorador: { name: 'Dúo Explorador', price: 69900, baseSize: '500 g' },
  reserva: { name: 'Reserva de la Casa', price: 109900, baseSize: '1 kg' }
};
const SIZE_FACTORS = { '250 g': 1, '500 g': 1.7, '1 kg': 2.8 };

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

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeEmail(value) {
  return clean(value, 254).toLowerCase();
}

function getCookie(req, name) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}

function setSessionCookie(res, token) {
  const parts = [`aurora_customer_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_DAYS * 86400}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.set('Set-Cookie', parts.join('; '));
}

function requireSameOrigin(req, res, next) {
  const candidate = req.get('origin') || req.get('referer');
  if (!candidate) return res.status(403).json({ error: 'Solicitud de origen no válido.' });
  try {
    if (new URL(candidate).host !== req.get('host')) {
      return res.status(403).json({ error: 'Solicitud de origen no válido.' });
    }
  } catch (_error) {
    return res.status(403).json({ error: 'Solicitud de origen no válido.' });
  }
  next();
}

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch(error => {
      console.error(`customer account API failed: ${error.message}`);
      res.status(error.status || 503).json({
        error: error.status ? error.message : 'No se pudo completar la solicitud. Inténtalo nuevamente.'
      });
    });
  };
}

async function findCustomer(pool, req) {
  const token = getCookie(req, 'aurora_customer_session');
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.city, u.address,
            (u.phone IS NOT NULL AND u.city IS NOT NULL AND u.address IS NOT NULL) AS profile_complete
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [digest(token)]
  );
  return result.rows[0] || null;
}

function validateOrder(body) {
  const order = {
    planId: clean(body.planId, 40),
    bagSize: clean(body.bagSize, 30),
    frequencyDays: Number(body.frequencyDays),
    source: clean(body.source, 120),
    medium: clean(body.medium, 120),
    campaign: clean(body.campaign, 160),
    gclid: clean(body.gclid, 200),
    fbclid: clean(body.fbclid, 200),
    termsAccepted: body.termsAccepted === true
  };
  if (
    !PLANS[order.planId] || !Object.hasOwn(SIZE_FACTORS, order.bagSize) ||
    ![15, 30].includes(order.frequencyDays) || !order.termsAccepted
  ) {
    const error = new Error('Revisa los datos obligatorios del formulario.');
    error.status = 400;
    throw error;
  }
  return order;
}

function orderPrice(order) {
  const plan = PLANS[order.planId];
  return Math.round((plan.price * SIZE_FACTORS[order.bagSize] / SIZE_FACTORS[plan.baseSize]) / 100) * 100;
}

async function getActiveSubscriptions(pool, email, lock = false) {
  const result = await pool.query(
    `SELECT id, plan_id, plan_name, bag_size, frequency_days, price_cop, status, source, medium,
            campaign, gclid, fbclid, created_at
     FROM subscriptions
     WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
       AND LOWER(BTRIM(status)) IN ('simulada', 'activa', 'active')
     ORDER BY created_at DESC, id DESC
     ${lock ? 'FOR UPDATE' : ''}`,
    [email]
  );
  return result.rows;
}

async function recordSubscriptionEvent(client, eventName, user, subscription, metadata) {
  await client.query(
    `INSERT INTO events
      (session_id, event_name, page_path, plan_id, source, medium, campaign, metadata)
     VALUES ($1, $2, '/', $3, $4, $5, $6, $7::jsonb)`,
    [
      `customer-${user.id}`,
      eventName,
      subscription.plan_id,
      subscription.source,
      subscription.medium,
      subscription.campaign,
      JSON.stringify({
        gclid: subscription.gclid || '',
        fbclid: subscription.fbclid || '',
        subscriptionId: subscription.id,
        userId: user.id,
        customerName: user.full_name,
        email: user.email,
        ...metadata
      })
    ]
  );
}

async function lockCustomer(client, userId) {
  const result = await client.query(
    `SELECT id, email, full_name, phone, city, address
     FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  return result.rows[0] || null;
}

function registerCustomerAuth(app, pool) {
  app.post('/api/auth/register', requireSameOrigin, asyncRoute(async (req, res) => {
    const fullName = clean(req.body?.name, 120);
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const passwordConfirmation = typeof req.body?.passwordConfirmation === 'string' ? req.body.passwordConfirmation : '';
    const phone = clean(req.body?.phone, 30);
    const city = clean(req.body?.city, 100);
    const address = clean(req.body?.address, 220);
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256 || password !== passwordConfirmation || !phone || !city || !address) {
      return res.status(400).json({ error: 'Ingresa nombre, correo, teléfono, ciudad, dirección y una contraseña válida que coincida con su confirmación.' });
    }
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    const token = crypto.randomBytes(32).toString('hex');
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users (full_name, email, password_hash, phone, city, address)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, email`,
        [fullName, email, passwordHash, phone, city, address]
      );
      const user = result.rows[0];
      await client.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
      await client.query(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
        [digest(token), user.id, SESSION_DAYS]
      );
      await client.query('COMMIT');
      setSessionCookie(res, token);
      res.status(201).json({ user: { id: user.id, name: user.full_name, email: user.email, profileComplete: true } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
      }
      throw error;
    } finally {
      client.release();
    }
  }));

  app.post('/api/auth/login', requireSameOrigin, asyncRoute(async (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    for (const [address, attempt] of LOGIN_ATTEMPTS) {
      if (now - attempt.startedAt >= 15 * 60 * 1000) LOGIN_ATTEMPTS.delete(address);
    }
    const attempts = LOGIN_ATTEMPTS.get(ip);
    if (attempts && attempts.count >= 8 && now - attempts.startedAt < 15 * 60 * 1000) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.' });
    }
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length > 256) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    const result = await pool.query(
      `SELECT id, full_name, email, password_hash,
              (phone IS NOT NULL AND city IS NOT NULL AND address IS NOT NULL) AS profile_complete
       FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      const current = LOGIN_ATTEMPTS.get(ip);
      LOGIN_ATTEMPTS.set(ip, current && now - current.startedAt < 15 * 60 * 1000
        ? { startedAt: current.startedAt, count: current.count + 1 }
        : { startedAt: now, count: 1 });
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    LOGIN_ATTEMPTS.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const previousToken = getCookie(req, 'aurora_customer_session');
    if (/^[a-f0-9]{64}$/i.test(previousToken)) {
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [digest(previousToken)]);
    }
    await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
    await pool.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
      [digest(token), user.id, SESSION_DAYS]
    );
    setSessionCookie(res, token);
    res.json({
      user: { id: user.id, name: user.full_name, email: user.email, profileComplete: user.profile_complete },
      activeSubscription: (await getActiveSubscriptions(pool, user.email))[0] || null
    });
  }));

  app.get('/api/auth/me', asyncRoute(async (req, res) => {
    const user = await findCustomer(pool, req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    res.set('Cache-Control', 'no-store');
    res.json({
      user: { id: user.id, name: user.full_name, email: user.email, profileComplete: user.profile_complete },
      activeSubscription: (await getActiveSubscriptions(pool, user.email))[0] || null
    });
  }));

  app.put('/api/auth/profile', requireSameOrigin, asyncRoute(async (req, res) => {
    const user = await findCustomer(pool, req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    const phone = clean(req.body?.phone, 30);
    const city = clean(req.body?.city, 100);
    const address = clean(req.body?.address, 220);
    if (!phone || !city || !address) {
      return res.status(400).json({ error: 'Ingresa teléfono, ciudad y dirección de entrega.' });
    }
    await pool.query(
      'UPDATE users SET phone = $1, city = $2, address = $3, updated_at = NOW() WHERE id = $4',
      [phone, city, address, user.id]
    );
    res.json({ ok: true, profileComplete: true });
  }));

  app.post('/api/auth/logout', requireSameOrigin, asyncRoute(async (req, res) => {
    const token = getCookie(req, 'aurora_customer_session');
    if (/^[a-f0-9]{64}$/i.test(token)) {
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [digest(token)]);
    }
    const parts = ['aurora_customer_session=', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    res.set('Set-Cookie', parts.join('; '));
    res.json({ ok: true });
  }));

  app.post('/api/leads', requireSameOrigin, asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || req.body?.consent !== true) {
      return res.status(400).json({ error: 'Ingresa un correo válido y autoriza el contacto.' });
    }
    const user = await findCustomer(pool, req);
    if (user && normalizeEmail(user.email) !== email) {
      return res.status(403).json({ error: 'El correo debe coincidir con la cuenta que inició sesión.' });
    }
    if (!user) {
      if ((await getActiveSubscriptions(pool, email)).length) {
        return res.json({ ok: true, captured: false, message: 'Este correo ya tiene una suscripción activa.' });
      }
      const account = await pool.query(
        'SELECT id FROM users WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))',
        [email]
      );
      if (account.rowCount) {
        return res.status(401).json({ error: 'Inicia sesión con tu cuenta para registrar este contacto.' });
      }
    }
    const values = [
      user?.id || null, email, clean(req.body?.offer, 100) || 'guia-preparacion',
      clean(req.body?.source, 120), clean(req.body?.medium, 120), clean(req.body?.campaign, 160),
      clean(req.body?.gclid, 200), clean(req.body?.fbclid, 200)
    ];
    if (!user) {
      const result = await pool.query(
        `INSERT INTO leads (user_id, email, offer, consent, source, medium, campaign, gclid, fbclid)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8) RETURNING id`,
        values
      );
      return res.status(201).json({ ok: true, captured: true, leadId: result.rows[0].id });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedUser = await lockCustomer(client, user.id);
      if (!lockedUser) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Inicia sesión para continuar.' });
      }
      if ((await getActiveSubscriptions(client, lockedUser.email, true)).length) {
        await client.query('COMMIT');
        return res.json({ ok: true, captured: false, message: 'Tu cuenta ya tiene una suscripción activa.' });
      }
      const result = await client.query(
        `INSERT INTO leads (user_id, email, offer, consent, source, medium, campaign, gclid, fbclid)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8)
         ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE
           SET email = EXCLUDED.email, offer = EXCLUDED.offer, consent = TRUE,
               source = EXCLUDED.source, medium = EXCLUDED.medium, campaign = EXCLUDED.campaign,
               gclid = EXCLUDED.gclid, fbclid = EXCLUDED.fbclid, created_at = NOW()
         RETURNING id`,
        values
      );
      await client.query('COMMIT');
      res.status(201).json({ ok: true, captured: true, leadId: result.rows[0].id });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.post('/api/subscriptions', requireSameOrigin, asyncRoute(async (req, res) => {
    const user = await findCustomer(pool, req);
    if (!user) return res.status(401).json({ error: 'Crea una cuenta o inicia sesión para confirmar.' });
    const order = validateOrder(req.body || {});
    const plan = PLANS[order.planId];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedUser = await lockCustomer(client, user.id);
      if (!lockedUser) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Inicia sesión para continuar.' });
      }
      if (!lockedUser.phone || !lockedUser.city || !lockedUser.address) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Completa los datos de entrega de tu perfil para continuar.' });
      }
      if ((await getActiveSubscriptions(client, lockedUser.email, true)).length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Ya tienes un plan activo. Usa “Actualizar plan” o “Cancelar plan”.' });
      }
      const result = await client.query(
        `INSERT INTO subscriptions
          (user_id, customer_name, email, phone, address, city, plan_id, plan_name,
           bag_size, frequency_days, price_cop, status, source, medium, campaign, gclid, fbclid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'simulada',$12,$13,$14,$15,$16)
         RETURNING id, plan_id, plan_name, bag_size, frequency_days, price_cop, status, created_at`,
        [lockedUser.id, lockedUser.full_name, lockedUser.email, lockedUser.phone, lockedUser.address, lockedUser.city,
          order.planId, plan.name, order.bagSize, order.frequencyDays, orderPrice(order),
          order.source, order.medium, order.campaign, order.gclid, order.fbclid]
      );
      await client.query('COMMIT');
      res.status(201).json({
        subscription: result.rows[0],
        customer: { id: lockedUser.id, name: lockedUser.full_name, email: lockedUser.email }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.put('/api/subscriptions/active', requireSameOrigin, asyncRoute(async (req, res) => {
    const user = await findCustomer(pool, req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para actualizar tu plan.' });
    const order = validateOrder(req.body || {});
    const plan = PLANS[order.planId];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedUser = await lockCustomer(client, user.id);
      if (!lockedUser) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Inicia sesión para continuar.' });
      }
      if (!lockedUser.phone || !lockedUser.city || !lockedUser.address) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Completa los datos de entrega de tu perfil para continuar.' });
      }
      const activeSubscriptions = await getActiveSubscriptions(client, lockedUser.email, true);
      if (!activeSubscriptions.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No tienes un plan activo para actualizar. Elige un plan.' });
      }
      const current = activeSubscriptions[0];
      if (activeSubscriptions.length > 1) {
        const duplicateIds = activeSubscriptions.slice(1).map(subscription => subscription.id);
        await client.query(
          `UPDATE subscriptions SET status = 'reemplazada'
           WHERE id = ANY($1::bigint[])`,
          [duplicateIds]
        );
      }
      const result = await client.query(
        `UPDATE subscriptions
         SET user_id = $1, customer_name = $2, email = $3, phone = $4, address = $5, city = $6,
             plan_id = $7, plan_name = $8, bag_size = $9, frequency_days = $10, price_cop = $11
         WHERE id = $12
         RETURNING id, plan_id, plan_name, bag_size, frequency_days, price_cop, status, created_at`,
        [lockedUser.id, lockedUser.full_name, lockedUser.email, lockedUser.phone, lockedUser.address, lockedUser.city,
          order.planId, plan.name, order.bagSize, order.frequencyDays, orderPrice(order), current.id]
      );
      await recordSubscriptionEvent(client, 'subscription_updated', lockedUser, current, {
        previousPlanId: current.plan_id,
        previousPlanName: current.plan_name,
        previousBagSize: current.bag_size,
        previousFrequencyDays: current.frequency_days,
        previousPriceCop: current.price_cop,
        newPlanId: result.rows[0].plan_id,
        newPlanName: result.rows[0].plan_name,
        newBagSize: result.rows[0].bag_size,
        newFrequencyDays: result.rows[0].frequency_days,
        newPriceCop: result.rows[0].price_cop
      });
      await client.query('COMMIT');
      res.json({
        subscription: result.rows[0],
        customer: { id: lockedUser.id, name: lockedUser.full_name, email: lockedUser.email }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.post('/api/subscriptions/active/cancel', requireSameOrigin, asyncRoute(async (req, res) => {
    const user = await findCustomer(pool, req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para cancelar tu plan.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedUser = await lockCustomer(client, user.id);
      if (!lockedUser) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Inicia sesión para continuar.' });
      }
      const activeSubscriptions = await getActiveSubscriptions(client, lockedUser.email, true);
      if (!activeSubscriptions.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No tienes un plan activo para cancelar.' });
      }
      const canceledIds = activeSubscriptions.map(subscription => subscription.id);
      await client.query(
        `UPDATE subscriptions SET status = 'cancelada'
         WHERE id = ANY($1::bigint[])`,
        [canceledIds]
      );
      const current = activeSubscriptions[0];
      await recordSubscriptionEvent(client, 'subscription_cancelled', lockedUser, current, {
        canceledSubscriptionIds: canceledIds,
        planName: current.plan_name,
        bagSize: current.bag_size,
        frequencyDays: current.frequency_days,
        priceCop: current.price_cop
      });
      await client.query('COMMIT');
      res.json({ ok: true, canceled: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));
}

module.exports = { registerCustomerAuth, hashPassword, verifyPassword };
