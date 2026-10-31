const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

function isAllowedOrigin(req, candidate) {
  try {
    const origin = new URL(candidate).origin;
    return new URL(candidate).host === req.get('host') || allowedOrigins.has(origin);
  } catch (_error) {
    return false;
  }
}

module.exports = { isAllowedOrigin };
