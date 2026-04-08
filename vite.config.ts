import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'dashboard/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/dashboard/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/artifacts': 'http://127.0.0.1:3000',
    },
  },
});
