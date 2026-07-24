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
- Node runtime: `22.x`

Required Vercel environment variable:

```txt
DATABASE_URL=postgresql://...
```

Set `DATABASE_URL` to the Neon pooled connection string. When it is present, generated audio is stored in Neon in the `audio_blobs` table. Without it, local development uses the workspace `data/` directory.

Provider keys should be configured as Vercel environment variables whenever possible. The browser receives only a `serverConfigured` status flag, never the secret value.

```txt
DASHSCOPE_API_KEY=
MINIMAX_API_KEY=
GOOGLE_TTS_API_KEY=
GEMINI_API_KEY=
VOLCENGINE_APP_ID=
VOLCENGINE_ACCESS_TOKEN=
VOLCENGINE_CLUSTER=
XFYUN_APP_ID=
XFYUN_API_KEY=
XFYUN_API_SECRET=
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_REGION=
OPENAI_API_KEY=
```

If a server key is unavailable, a teacher can enter a temporary key in the app. Temporary keys use browser session storage and are cleared when the tab is closed. On first load, the app also migrates and removes provider secrets left in local storage by older versions.

## Verification

```sh
npm test
npm run lint
npm run build
```

The tests cover source-faithful script parsing, server-side credential resolution, and the MiniMax T2A v2 request contract.

## Data flow

Code changes are committed and pushed to GitHub. Vercel watches the GitHub repository and deploys automatically. Runtime audio data is stored in Neon, not GitHub, because generated binary audio should not be committed to the repository.
