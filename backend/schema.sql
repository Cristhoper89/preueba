CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(180) NOT NULL,
  phone VARCHAR(30),
  city VARCHAR(100),
  address VARCHAR(220),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address VARCHAR(220);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  customer_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  address VARCHAR(220) NOT NULL,
  city VARCHAR(100) NOT NULL,
  plan_id VARCHAR(40) NOT NULL,
  plan_name VARCHAR(100) NOT NULL,
  bag_size VARCHAR(30) NOT NULL,
  frequency_days INTEGER NOT NULL CHECK (frequency_days IN (15, 30)),
  price_cop INTEGER NOT NULL CHECK (price_cop > 0),
  status VARCHAR(30) NOT NULL DEFAULT 'simulada',
  source VARCHAR(120),
  medium VARCHAR(120),
  campaign VARCHAR(160),
  gclid VARCHAR(200),
  fbclid VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

WITH latest_subscription AS (
  SELECT DISTINCT ON (user_id) user_id, phone, city, address
  FROM subscriptions
  WHERE user_id IS NOT NULL
  ORDER BY user_id, created_at DESC, id DESC
)
UPDATE users u
SET phone = COALESCE(u.phone, s.phone),
    city = COALESCE(u.city, s.city),
    address = COALESCE(u.address, s.address)
FROM latest_subscription s
WHERE s.user_id = u.id
  AND (u.phone IS NULL OR u.city IS NULL OR u.address IS NULL);

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(254) NOT NULL,
  offer VARCHAR(100) NOT NULL DEFAULT 'guia-preparacion',
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(120),
  medium VARCHAR(120),
  campaign VARCHAR(160),
  gclid VARCHAR(200),
  fbclid VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(80) NOT NULL,
  event_name VARCHAR(60) NOT NULL,
  page_path VARCHAR(300),
  plan_id VARCHAR(40),
  source VARCHAR(120),
  medium VARCHAR(120),
  campaign VARCHAR(160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gclid VARCHAR(200);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS fbclid VARCHAR(200);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gclid VARCHAR(200);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fbclid VARCHAR(200);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_normalized_email_status
  ON subscriptions(LOWER(BTRIM(email)), LOWER(BTRIM(status)));
CREATE INDEX IF NOT EXISTS idx_subscriptions_campaign ON subscriptions(campaign);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created ON subscriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_user_unique ON leads(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_user_created ON leads(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_roles (
  id VARCHAR(30) PRIMARY KEY,
  display_name VARCHAR(80) NOT NULL
);

INSERT INTO marketing_roles (id, display_name) VALUES
  ('admin', 'Administrador'),
  ('analyst', 'Analista de marketing'),
  ('sales', 'Equipo comercial')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS marketing_admin_users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(180) NOT NULL,
  role_id VARCHAR(30) NOT NULL REFERENCES marketing_roles(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES marketing_admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_admin_sessions_expiry ON marketing_admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS marketing_admin_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES marketing_admin_users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_admin_audit_created ON marketing_admin_audit(created_at DESC);
