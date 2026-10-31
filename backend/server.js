const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const { registerMarketingRoutes } = require('./marketing');
const { registerCustomerAuth } = require('./customer-auth');
const { isAllowedOrigin } = require('./request-origin');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const landingPath = path.join(__dirname, '..', 'lading-page', 'public');
const marketingPath = path.join(__dirname, '..', 'control-marketing');
const serveFrontend = process.env.SERVE_FRONTEND !== 'false';

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && isAllowedOrigin(req, origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.vary('Origin');
  }
  if (req.method === 'OPTIONS') {
    return origin && isAllowedOrigin(req, origin) ? res.sendStatus(204) : res.sendStatus(403);
  }
  next();
});
if (serveFrontend) app.use(express.static(landingPath));
registerMarketingRoutes(app, pool);
registerCustomerAuth(app, pool);
if (serveFrontend) app.use('/marketing', express.static(marketingPath));

const clean = (value, max = 160) => String(value || '').trim().slice(0, max);

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch (_error) { res.status(503).json({ ok: false, database: 'unavailable' }); }
});

app.post('/api/events', async (req, res) => {
  const body = req.body || {};
  const sessionId = clean(body.sessionId, 80);
  const eventName = clean(body.eventName, 60);
  const allowed = new Set(['page_view', 'plan_selected', 'checkout_started', 'checkout_abandoned', 'subscription_confirmed', 'lead_captured', 'session_end']);
  if (!sessionId || !allowed.has(eventName)) return res.status(400).json({ error: 'Evento no válido.' });
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? { ...body.metadata }
    : {};
  if (eventName === 'session_end') {
    const durationSeconds = Number(metadata.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      return res.status(400).json({ error: 'La duración de sesión no es válida.' });
    }
    metadata.durationSeconds = Math.min(86400, Math.floor(durationSeconds));
  }
  try {
    await pool.query(
      `INSERT INTO events (session_id,event_name,page_path,plan_id,source,medium,campaign,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [sessionId, eventName, clean(body.pagePath, 300), clean(body.planId, 40), clean(body.source, 120), clean(body.medium, 120), clean(body.campaign, 160), JSON.stringify({ ...metadata, gclid: clean(body.gclid, 200), fbclid: clean(body.fbclid, 200) })]
    );
    res.status(201).json({ ok: true });
  } catch (error) { console.error('event insert failed:', error.message); res.status(500).json({ error: 'No se pudo registrar el evento.' }); }
});

if (serveFrontend) {
  app.get('*', (_req, res) => res.sendFile(path.join(landingPath, 'index.html')));
}

app.listen(PORT, () => console.log(`Café Aurora disponible en http://localhost:${PORT}`));
