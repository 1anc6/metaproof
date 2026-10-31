import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

type VercelConfig = { headers: { source: string; headers: { key: string; value: string }[] }[] }

/** The headers vercel.json sends with every page, Content-Security-Policy among them. `vite
 *  preview` sends them too, so the browser tests run the production build under the same policy. */
function productionHeaders(): Record<string, string> {
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf-8')) as VercelConfig
  const all = vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? []
  return Object.fromEntries(all.map((h) => [h.key, h.value]))
}

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
    preview: { headers: productionHeaders() },
  }
})
