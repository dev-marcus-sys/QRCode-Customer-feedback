import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        id: '/admin/',
        name: '個案管理系統 · 後台',
        short_name: '後台',
        description: 'QRCode 客戶意見反饋系統管理後台',
        lang: 'zh-Hant',
        theme_color: '#1565C0',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'any',
        start_url: '/admin/login',
        scope: '/',
        icons: [
          { src: '/pwa-assets/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-assets/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-assets/maskable-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/pwa-assets/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/pwa-assets/apple-touch-icon-180x180.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          // 後台資料需即時：API 一律走網路，不預快取
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
