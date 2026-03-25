import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Fake DEX API plugin — only active when VITE_MOCK_API=true in .env.development.
// Never set this in .env.production.
const mockApiPlugin = process.env.VITE_MOCK_API === 'true'
  ? [{
      name: 'fake-dex-api',
      configureServer(server: import('vite').ViteDevServer) {
        server.middlewares.use('/api/execute-trade', (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            setTimeout(() => {
              res.setHeader('Content-Type', 'application/json');
              if (Math.random() > 0.5) {
                res.statusCode = 400;
                res.end(JSON.stringify({
                  success: false,
                  status_code: 400,
                  error_code: 'INSUFFICIENT_LIQUIDITY',
                  message: 'Order failed due to insufficient liquidity at requested price.',
                  details: {source: 'matching_engine', requested_qty: 500, available_qty: 120},
                }));
              } else {
                res.statusCode = 200;
                res.end(JSON.stringify({success: true, status_code: 200, message: 'Trade executed successfully.'}));
              }
            }, 500);
          });
        });
      },
    }]
  : [];

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    ...mockApiPlugin,
  ],
})
