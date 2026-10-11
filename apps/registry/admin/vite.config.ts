import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Served by Axum at /rgad/ (embedded admin/dist).
export default defineConfig({
  plugins: [preact()],
  base: '/rgad/',
  server: {
    proxy: {
      '/v1': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
