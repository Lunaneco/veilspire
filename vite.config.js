import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work both at a domain root and under a GitHub Pages
  // repository path such as https://example.github.io/veilspire/.
  base: './',
  build: {
    // Do not publish source maps by default.
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
