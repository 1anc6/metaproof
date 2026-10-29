# MetaProof web

React + TypeScript + Vite + Tailwind CSS v4. "Soft studio" interface in light and dark (frosted
glass panels over drifting colour glows, gradient cards; ink, champagne gold and warm greys; tokens in `src/index.css`),
responsive from
phone to desktop.

Whatever MetaProof is busy with shows as a [Thinking Orb](https://libraries.dev/orbs) (`thinking-orbs`, MIT):
each analysis step has its own, hashing draws MetaProof's own fingerprint frame (`src/lib/orbs.ts`), and the
playground in Settings tunes every orb at once (speed, colour, dots, engine knobs, cursor gravity).

```bash
npm install
npm run dev        # http://localhost:5173, forwards /api to the local backend on :8000
```

Use the live API instead of a local backend:

```bash
API_PROXY=https://metaproof.onrender.com npm run dev
```

Production builds read `VITE_API_URL` (set in Vercel). See `.env.example`.
