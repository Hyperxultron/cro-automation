
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      'raid-immune-verification-seed.trycloudflare.com',
       'epson-citizenship-priced-deviation.trycloudflare.com',
       'wheels-uni-alphabetical-margin.trycloudflare.com',
       'fifty-wifi-louis-examining.trycloudflare.com'
       
    ],
  },
})
