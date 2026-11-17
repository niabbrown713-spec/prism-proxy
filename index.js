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
    secure: false,
    followRedirects: true,
    selfHandleResponse: true,
    pathRewrite: () => parsed.pathname + parsed.search,
    on: {
      proxyReq: (proxyReq) => {
        // Request uncompressed HTML so responseInterceptor never reads raw Brotli/Zstd bytes
        proxyReq.setHeader('accept-encoding', 'identity');
        // Provide a standard browser User-Agent so sites don't block or misroute the request
        proxyReq.setHeader(
          'user-agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );
        // Strip local cookies/headers that can bloat upstream requests
        proxyReq.removeHeader('cookie');
        proxyReq.removeHeader('referer');
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        // Remove frame-blocking & oversized headers from BOTH proxyRes and outgoing Express res
        const blockedHeaders = [
          'x-frame-options',
          'content-security-policy',
          'content-security-policy-report-only',
          'content-encoding',
          'strict-transport-security',
          'cross-origin-opener-policy',
          'cross-origin-embedder-policy',
          'cross-origin-resource-policy'
        ];

        blockedHeaders.forEach((header) => {
          delete proxyRes.headers[header];
          res.removeHeader(header);
        });

        // Prevent oversized Set-Cookie headers from overflowing or breaking iframe sessions
        if (proxyRes.headers['set-cookie']) {
          delete proxyRes.headers['set-cookie'];
          res.removeHeader('set-cookie');
        }

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf8');

          // Remove HTML <meta> CSP/frame tags
          html = html.replace(/<meta[^>]*http-equiv=["']?(Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, '');

          // 1. Rewrite protocol-relative URLs (e.g. src="//cdn.site.com/app.js")
          html = html.replace(/(href|src)=["']\/\/([^"']+)["']/gi, (match, attr, rest) => {
            const fullUrl = `${parsed.protocol}//${rest}`;
            return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });

          // 2. Rewrite root-relative src="/..." and href="/..."
          html = html.replace(/(href|src)=["']\/([^/"'][^"']*)["']/gi, (match, attr, relPath) => {
            const fullAssetUrl = `${parsed.origin}/${relPath}`;
            return `${attr}="/proxy?url=${encodeURIComponent(fullAssetUrl)}"`;
          });

          // 3. Rewrite full http(s) URLs to stay inside the proxy
          html = html.replace(/(href|src)=["'](https?:\/\/[^"']+)["']/gi, (match, attr, fullUrl) => {
            return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });

          // Inject <base> tag so any remaining relative assets resolve against the origin
          const baseTag = `<base href="${parsed.origin}/">`;
          if (html.match(/<head[^>]*>/i)) {
            html = html.replace(/<head[^>]*>/i, (match) => `${match}${baseTag}`);
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
