import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // En dev, le front appelle /api sur sa propre origine ; Vite relaie vers Fastify.
    // Ne pas activer `changeOrigin` : l'API vérifie que l'en-tête Origin
    // correspond à Host (protection CSRF, voir server/src/plugins/security.ts).
    proxy: { '/api': { target: 'http://127.0.0.1:3000' } },
  },
});
