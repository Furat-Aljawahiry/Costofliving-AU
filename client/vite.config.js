import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy: /api -> the API server, so the client can call /api/* directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
