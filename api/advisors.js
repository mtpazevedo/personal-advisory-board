const fs = require('fs');
const path = require('path');

const ADVISORS_FILE = path.join(process.cwd(), 'advisors.json');

module.exports = function handler(req, res) {
  if (req.method === 'GET') {
    const data = JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
    return res.json(data);
  }
  if (req.method === 'PUT') {
    return res.status(403).json({ error: 'Editing not available in deployed mode' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};
