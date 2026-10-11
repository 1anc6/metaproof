import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // In development the UI calls /api on its own origin and Vite forwards it, so no CORS
      // setup is needed. Point API_PROXY at https://metaproof.onrender.com to use the live API.
      proxy: {
        '/api': { target: env.API_PROXY || 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
  }
})
