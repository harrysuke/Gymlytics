import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

// The web app calls a same-origin `/v1` path in local development, so the
// browser never needs CORS — this behaves identically from localhost,
// 127.0.0.1 and the desktop preview proxy. VITE_API_URL only retargets the
// dev proxy (e.g. at a remote API); it is read from the workspace root .env.
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, 'VITE_');
  const target = env.VITE_API_URL || 'http://localhost:3000';
  const proxy = {
    '/v1': { target, changeOrigin: true },
    '/health': { target, changeOrigin: true },
  };

  return {
    plugins: [vue()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: { target: 'es2022' },
    // sqlite-wasm ships a worker; keep it out of the Vue transform pipeline.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  };
});
