import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any GitHub Pages sub-path
export default defineConfig({
  base: './',
  plugins: [react()],
  // IPv4 bind: default 'localhost' binds only [::1] on Windows, so 127.0.0.1 refused connections
  // port above 15000: Windows dynamic range here is 1024-15000, so outbound sockets can grab lower ports (EACCES)
  server: { port: 15173, host: '127.0.0.1' },
});
