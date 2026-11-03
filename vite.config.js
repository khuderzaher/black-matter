import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this project from /black-matter/.
  // Local development and preview remain rooted at /.
  base: process.env.GITHUB_ACTIONS ? '/black-matter/' : '/',
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 4096
  }
});