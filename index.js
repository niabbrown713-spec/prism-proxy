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
    selfHandleResponse: true,
    pathRewrite: () => parsed.pathname + parsed.search,
    on: {
      proxyReq: (proxyReq) => {
        // Request uncompressed HTML so responseInterceptor never reads raw Brotli/Zstd bytes
        proxyReq.setHeader('accept-encoding', 'identity');
      },
            proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        // Remove frame-blocking headers from BOTH proxyRes and the outgoing Express response (res)
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
        delete proxyRes.headers['content-encoding'];

        res.removeHeader('x-frame-options');
        res.removeHeader('content-security-policy');
        res.removeHeader('content-security-policy-report-only');
        res.removeHeader('content-encoding');

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf8');

          // Remove HTML <meta> CSP tags that block framing or scripts
          html = html.replace(/<meta[^>]*http-equiv=["']?(Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, '');

          // Rewrite root-relative src="/..." and href="/..."
          html = html.replace(/(href|src)=["']\/([^/"'][^"']*)["']/gi, (match, attr, relPath) => {
            const fullAssetUrl = `${parsed.origin}/${relPath}`;
            return `${attr}="/proxy?url=${encodeURIComponent(fullAssetUrl)}"`;
          });

          // Rewrite full http(s) URLs to stay inside the proxy
          html = html.replace(/(href|src)=["'](https?:\/\/[^"']+)["']/gi, (match, attr, fullUrl) => {
            return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });

          // Inject <base> tag for remaining relative paths
          const baseTag = `<base href="${parsed.origin}/">`;
          if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${baseTag}`);
          } else {
            html = baseTag + html;
          }

          return html;
        }

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
