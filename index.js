const express = require('express');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing ?url= parameter');
  }

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
    selfHandleResponse: true, // Required so we can rewrite HTML links & stylesheets
    pathRewrite: () => parsed.pathname + parsed.search,
    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        // Strip headers that block iframes
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf8');

          // Rewrite root-relative src="/..." and href="/..." to go through /proxy?url=
          html = html.replace(/(href|src)=["']\/([^/"'][^"']*)["']/gi, (match, attr, relPath) => {
            const fullAssetUrl = `${parsed.origin}/${relPath}`;
            return `${attr}="/proxy?url=${encodeURIComponent(fullAssetUrl)}"`;
          });

          // Rewrite full http(s) links/scripts/stylesheets to also stay inside the proxy
          html = html.replace(/(href|src)=["'](https?:\/\/[^"']+)["']/gi, (match, attr, fullUrl) => {
            return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });

          // Inject <base> tag for any remaining relative paths (like "css/style.css")
          const baseTag = `<base href="${parsed.origin}/">`;
          if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${baseTag}`);
          } else {
            html = baseTag + html;
          }

          return html;
        }

        // Return CSS, JS, images, and fonts untouched
        return responseBuffer;
      }),
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) {
          res.status(502).send('Could not load site: ' + err.message);
        }
      }
    }
  })(req, res, next);
});

const server = app.listen(PORT, () => {
  console.log(`Prism running on port ${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
