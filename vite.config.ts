/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const cadenceApiOrigin = process.env.CADENCE_DEV_API_ORIGIN ?? 'http://127.0.0.1:3001'
const readingsOrigin = process.env.READINGS_DEV_ORIGIN ?? 'http://127.0.0.1:3110'

export default defineConfig({
  base: '/studio/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-editor': [
            '@tiptap/react',
            '@tiptap/starter-kit',
            '@tiptap/extension-placeholder',
            '@tiptap/markdown',
          ],
          'vendor-ui': ['radix-ui', 'cmdk'],
          'vendor-data': ['dexie', 'minisearch'],
          'vendor-reader': ['epubjs'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/studio/api': {
        target: cadenceApiOrigin,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/studio\/api/, '/api'),
      },
      '/api/catalog': readingsOrigin,
      '/api/profile': readingsOrigin,
      '/api/annotations': readingsOrigin,
      '/api/quotes': readingsOrigin,
      '/api/improvement-events': readingsOrigin,
      '/api/improvement-metrics': readingsOrigin,
      '/books': readingsOrigin,
      '/covers': readingsOrigin,
      '/api': cadenceApiOrigin,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
