// Shared access-code gate for the Personal Advisory Board.
// Set BOARD_ACCESS_CODE in the environment (Vercel dashboard or .env) to
// require the code on every /api request. Leave it unset to run open
// (local development). The frontend stores the code in localStorage and
// sends it as the x-board-code header.

function requireAuth(req, res) {
  const code = process.env.BOARD_ACCESS_CODE;
  if (!code) return true;
  // Header for fetch() calls; query param for <audio src> streaming, which
  // cannot set headers.
  const provided = req.headers['x-board-code'] || (req.query && req.query.code);
  if (provided && provided === code) return true;
  res.status(401).json({ error: 'Access code required' });
  return false;
}

module.exports = { requireAuth };
