import { execSync } from 'child_process'
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

let commitHash = 'dev'
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  // no git / no commits yet — fall back to 'dev'
}

export default defineConfig({
  base: '/',
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Yak',
        short_name: 'Yak',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0ea5e9',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        // The Swedish seed (~2.1MB) is precached so the app works fully offline (SPEC §13).
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
})
