import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerApiRoutes } from './src/server/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findDistPath(): string | null {
  const possiblePaths = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, 'dist'),
    path.resolve(__dirname, '../dist'),
    path.resolve(__dirname, '../../dist'),
    path.resolve(process.cwd(), 'build'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
      return p;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Register all backend API endpoints
  registerApiRoutes(app);

  const distPath = findDistPath();

  if (distPath) {
    console.log(`[SpindBet] Serving production frontend from: ${distPath}`);
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // If dist is not found (e.g. running in dev mode or forgot npm run build),
    // use Vite middleware to serve the app on-the-fly without crashing.
    console.log('[SpindBet] Production dist/index.html not found, starting Vite middleware...');
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('[SpindBet] Vite dynamic middleware successfully mounted.');
    } catch (err: any) {
      console.error('[SpindBet] Could not start Vite fallback:', err);
      app.get('*', (_req, res) => {
        res.status(500).send(`
          <div style="font-family:system-ui,sans-serif;background:#0d121f;color:#e2e8f0;padding:40px;min-height:100vh;">
            <h2 style="color:#f59e0b;">Файлы сборки не найдены (dist/index.html)</h2>
            <p>Вы запустили сервер, но папка <code>dist</code> не собрана.</p>
            <p><strong>Решение:</strong> выполните в консоли команду <code>npm run build</code> и перезапустите сервер.</p>
          </div>
        `);
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpindBet Mini App running on http://localhost:${PORT}`);
  });
}

startServer();
