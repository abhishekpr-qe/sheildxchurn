const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT_FE || 3000;
const BACKEND_URL = process.env.BACKEND_URL || '';
const PUBLIC = path.join(__dirname, '..', 'public');
const htmlTemplate = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

function resolveApiBase(host) {
  // Via Cloudflare tunnel: swap -fe → -be in the hostname
  if (host && host.includes('-fe.')) {
    return 'https://' + host.replace('-fe.', '-be.');
  }
  // Local dev: use env var or same-origin fallback
  return BACKEND_URL;
}

app.get('/', (req, res) => {
  const apiBase = resolveApiBase(req.hostname);
  const tag = `<script>window.API_BASE='${apiBase}'</script>`;
  res.type('html').send(htmlTemplate.replace('</head>', tag + '</head>'));
});

app.use(express.static(PUBLIC, { etag: false, lastModified: false, maxAge: 0 }));

app.listen(PORT, () => {
  console.log(`[frontend] serving public/ on :${PORT} → BACKEND_URL=${BACKEND_URL || '(same-origin)'}`);
});
