const allowedOrigins = new Set([
  'http://oowwgfyjnl5pnzscgekwkjdy.2.24.87.5.sslip.io',
  'https://oowwgfyjnl5pnzscgekwkjdy.2.24.87.5.sslip.io',
  'http://z3gy63fnzwpdzjx5aazxg7zm.2.24.87.5.sslip.io',
  'https://z3gy63fnzwpdzjx5aazxg7zm.2.24.87.5.sslip.io'
]);

for (const configuredOrigin of (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)) {
  try {
    const value = configuredOrigin.replace(/^["']+|["']+$/g, '');
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    allowedOrigins.add(url.origin);
  } catch (_error) {
    console.warn('Ignoring invalid CORS_ALLOWED_ORIGINS entry; use a hostname or HTTP(S) origin.');
  }
}

function isAllowedOrigin(req, candidate) {
  try {
    const origin = new URL(candidate).origin;
    return new URL(candidate).host === req.get('host') || allowedOrigins.has(origin);
  } catch (_error) {
    return false;
  }
}

module.exports = { isAllowedOrigin };
