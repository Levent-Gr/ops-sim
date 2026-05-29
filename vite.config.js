import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  },
  server: {
    port: 5173,
    open: true
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js']
  }
});
