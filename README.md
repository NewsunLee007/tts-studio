# TTS Studio

Text-to-speech workspace with a Vite React frontend, an Express API, and Vercel serverless deployment support.

## Local development

```sh
npm install
npm run dev
```

The frontend runs through Vite and proxies `/api`, `/audio`, and `/exports` to the local Express server.

## Production build

```sh
npm run build
```

The root build checks the server TypeScript project first, then builds the frontend into `web/dist`.

## Vercel deployment

This repository is ready for GitHub -> Vercel deployment:

- GitHub remote: `https://github.com/NewsunLee007/tts-studio.git`
- Vercel build command: `npm run build`
- Vercel output directory: `web/dist`
- Serverless API entry: `api/index.ts`

Required Vercel environment variable:

```txt
DATABASE_URL=postgresql://...
```

Set `DATABASE_URL` to the Neon pooled connection string. When it is present, generated audio is stored in Neon in the `audio_blobs` table. Without it, local development uses the workspace `data/` directory.

Optional provider keys can still be entered in the app UI per request. If you want server-side provider secrets later, add them as Vercel environment variables and wire them into the provider request layer.

## Data flow

Code changes are committed and pushed to GitHub. Vercel watches the GitHub repository and deploys automatically. Runtime audio data is stored in Neon, not GitHub, because generated binary audio should not be committed to the repository.
