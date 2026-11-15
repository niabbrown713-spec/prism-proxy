const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing ?url= parameter');

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return res.status(400).send('Invalid URL');
  }

  return createProxyMiddleware({
    target: parsed.origin,
    changeOrigin: true,
    followRedirects: true,
    pathRewrite: () => parsed.pathname + parsed.search,
    on: {
      proxyRes: (proxyRes) => {
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
      },
      error: (err, req, res) => {
        res.status(502).send('Proxy error: ' + err.message);
      }
    }
  })(req, res, next);
});

app.listen(PORT, () => {
  console.log(`Prism running on port ${PORT}`);
});
