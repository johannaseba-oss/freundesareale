import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5190, host: true },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
