import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:8000';
const previewMode = process.env.BASE44_PREVIEW_MODE === '1';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
    // The preview is served over https through a proxy, so the HMR socket must
    // follow that origin. Only applied inside the sandbox preview.
    ...(previewMode ? { hmr: { protocol: 'wss', clientPort: 443 } } : {}),
  },
});
