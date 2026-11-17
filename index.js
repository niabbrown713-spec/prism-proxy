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
      proxyReq: (proxyReq, req) => {
        // Request uncompressed content so responseInterceptor can read it
        proxyReq.setHeader('accept-encoding', 'identity');
        
        // Send a realistic browser User-Agent so sites don't block you as a bot
        proxyReq.setHeader(
          'user-agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );

        // Forward cookies and headers cleanly instead of stripping them completely
        if (req.headers.cookie) {
          proxyReq.setHeader('cookie', req.headers.cookie);
        }
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        // Remove frame-blocking headers so sites can load inside your proxy iframe
        const blockedHeaders = [
          'x-frame-options',
          'content-security-policy',
          'content-security-policy-report-only',
          'content-encoding',
          'cross-origin-opener-policy',
          'cross-origin-embedder-policy',
          'cross-origin-resource-policy'
        ];

        blockedHeaders.forEach((header) => {
          delete proxyRes.headers[header];
          res.removeHeader(header);
        });

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf8');

          // Remove HTML <meta> CSP/frame tags
          html = html.replace(/<meta[^>]*http-equiv=["']?(Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, '');

          // Rewrite protocol-relative URLs
          html = html.replace(/(href|src)=["']\/\/([^"']+)["']/gi, (match, attr, rest) => {
            const fullUrl = `${parsed.protocol}//${rest}`;
            return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });

          // Rewrite root-relative assets
          html = html.replace(/(href|src)=["']\/([^/"'][^"']*)["']/gi, (match, attr, relPath) => {
            const fullAssetUrl = `${parsed.origin}/${relPath}`;
            return `${attr}="/proxy?url=${encodeURIComponent(fullAssetUrl)}"`;
          });

          // Rewrite absolute URLs
          html = html.replace(/(href|src)=["'](https?:\/\/[^"']+)["']/gi, (match, attr, fullUrl) => {
            return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });

          // Inject <base> tag
          const baseTag = `<base href="${parsed.origin}/">`;
          if (html.match(/<head[^>]*>/i)) {
            html = html.replace(/<head[^>]*>/i, (match) => `${match}${baseTag}`);
          } else {
            html = baseTag + html;
          }

          // Inject Floating AI Button & Drawer
          const aiWidgetHtml = `
            <style>
              #prism-ai-float-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999999;
                background: linear-gradient(135deg, #d2b5ff, #b9b4ff);
                color: #241a35;
                border: none;
                border-radius: 50px;
                padding: 10px 18px;
                font-family: system-ui, sans-serif;
                font-weight: 600;
                font-size: 13px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
              }
              #prism-ai-float-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 25px rgba(210,181,255,0.4);
              }
              #prism-ai-drawer {
                position: fixed;
                bottom: 75px;
                right: 20px;
                width: 340px;
                height: 480px;
                max-height: 80vh;
                background: #19161f;
                border: 1px solid rgba(216,194,255,0.2);
                border-radius: 20px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                z-index: 999998;
                display: none;
                flex-direction: column;
                overflow: hidden;
                font-family: system-ui, sans-serif;
              }
              #prism-ai-drawer.open {
                display: flex;
              }
              #prism-ai-header {
                padding: 12px 16px;
                background: #25212d;
                color: #f2edf9;
                font-weight: 600;
                font-size: 13px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255,255,255,0.05);
              }
              #prism-ai-close {
                background: transparent;
                border: none;
                color: #938ba4;
                font-size: 16px;
                cursor: pointer;
              }
              #prism-ai-body {
                flex: 1;
                border: none;
                width: 100%;
                height: 100%;
                background: transparent;
              }
            </style>

            <button id="prism-ai-float-btn" onclick="togglePrismAI()">
              <span>✦</span> justniaa AI
            </button>

            <div id="prism-ai-drawer">
              <div id="prism-ai-header">
                <span>justniaa’s Gemini Proxy Assistant</span>
                <button id="prism-ai-close" onclick="togglePrismAI()">✕</button>
              </div>
              <iframe id="prism-ai-body" src="/"></iframe>
            </div>

            <script>
              function togglePrismAI() {
                const drawer = document.getElementById('prism-ai-drawer');
                drawer.classList.toggle('open');
              }
            </script>
          `;

          if (html.includes('</body>')) {
            html = html.replace('</body>', `${aiWidgetHtml}</body>`);
          } else {
            html += aiWidgetHtml;
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
