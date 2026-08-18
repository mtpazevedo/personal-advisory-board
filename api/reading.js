const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../lib/auth');

const READING_FILE = path.join(process.cwd(), 'reading.json');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;
  try {
    res.json(JSON.parse(fs.readFileSync(READING_FILE, 'utf8')));
  } catch {
    res.json({ updatedAt: null, items: [] });
  }
};
