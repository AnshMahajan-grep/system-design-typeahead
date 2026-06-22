import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api/* to the backend. Doing the proxy here (instead
// of calling the backend directly from the browser) means the browser only
// ever talks to one origin, so there are no CORS surprises. Inside docker,
// BACKEND_URL resolves to http://backend:8080 over the compose network.
const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        // strip the /api prefix: /api/suggest -> /suggest
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
