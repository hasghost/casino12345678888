import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': import.meta.dirname || path.resolve('.'),
      },
    },

    server: {
      port: 3000,
      host: '0.0.0.0',

      // Разрешаем домен H1Cloud
      allowedHosts: ['spindbet.ru', 'de-bots.h1cloud.net'],

      // HMR отключаем — для production-like запуска через Express
      hmr: false,

      watch: process.env.DISABLE_HMR === 'true'
        ? null
        : {},
    },
  };
});

