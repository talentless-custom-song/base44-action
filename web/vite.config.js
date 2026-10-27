import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:8000';
const previewMode = process.env.BASE44_PREVIEW_MODE === '1';

export default defineConfig({
  plugins: [react()],
  // noVNC (the remote-desktop client) uses top-level await, which needs a modern target.
  build: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      // ws: the remote-desktop VNC session is proxied through the API on /api/remote/socket.
      '/api': { target: apiTarget, changeOrigin: true, ws: true },
    },
    // The preview is served over https through a proxy, so the HMR socket must
    // follow that origin. Only applied inside the sandbox preview.
    ...(previewMode ? { hmr: { protocol: 'wss', clientPort: 443 } } : {}),
  },
});
