import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any GitHub Pages sub-path
export default defineConfig({
  base: './',
  plugins: [react()],
  // IPv4 bind: default 'localhost' binds only [::1] on Windows, so 127.0.0.1:5173 refused connections
  server: { port: 5173, host: '127.0.0.1' },
});
