import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// The built bundle uses relative asset URLs so one build serves under any ADMIN_PATH: the
// registry rewrites index.html with a <base href> and the mount path at request time.
// `npm run dev` serves under the default /admin/ and proxies the API to a local registry.
export default defineConfig(({ command }) => ({
  plugins: [preact()],
  base: command === 'serve' ? '/admin/' : './',
  server: {
    proxy: {
      '/admin/api': 'http://127.0.0.1:8787',
      '/v1': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))
