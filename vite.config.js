import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // On GitHub Pages the site may live at /<repo-name>/ — the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
  },
});
