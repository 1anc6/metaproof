# MetaProof web

React + TypeScript + Vite + Tailwind CSS v4. "Soft studio" interface in light and dark (frosted
glass panels over drifting colour glows, gradient cards, a lime accent; tokens in `src/index.css`),
responsive from
phone to desktop.

```bash
npm install
npm run dev        # http://localhost:5173, forwards /api to the local backend on :8000
```

Use the live API instead of a local backend:

```bash
API_PROXY=https://metaproof.onrender.com npm run dev
```

Production builds read `VITE_API_URL` (set in Vercel). See `.env.example`.
