import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Read .env the way the API server does, so a custom PORT or HB_ALLOWED_HOSTS applies to both.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const extraHosts = (env.HB_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Vite already allows localhost and IP addresses; also allow phone access by mDNS name (my-mac.local).
      allowedHosts: ['.local', ...extraHosts],
      proxy: { '/api': `http://127.0.0.1:${env.PORT || 8787}` },
    },
  };
});
