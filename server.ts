import express from 'express';
import { registerApiRoutes } from './src/server/api.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // ==========================================
  // BACKEND API
  // ==========================================
  registerApiRoutes(app);

  // ==========================================
  // VITE FRONTEND
  // Frontend находится прямо в /home/container
  // ==========================================
  try {
    const { createServer: createViteServer } = await import('vite');

    const vite = await createViteServer({
      root: '/home/container',

      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        hmr: false,

        // Разрешаем внешний домен H1Cloud
        allowedHosts: ['de-bots.h1cloud.net'],
      },

      appType: 'spa',
    });

    app.use(vite.middlewares);

    console.log(
      '[SpindBet] Vite frontend mounted from /home/container'
    );
  } catch (err) {
    console.error(
      '[SpindBet] Failed to start Vite:',
      err
    );

    app.get('*', (_req, res) => {
      res
        .status(500)
        .send('Frontend failed to start');
    });
  }

  // ==========================================
  // START SERVER
  // ==========================================
  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[SpindBet] Mini App running on http://0.0.0.0:${PORT}`
    );
  });
}

startServer();


