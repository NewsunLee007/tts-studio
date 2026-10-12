FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace server --include-workspace-root=false
COPY server/ server/
RUN npm -w server run build
RUN npm prune --omit=dev --workspace server --include-workspace-root=false

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080 FFMPEG_PATH=/usr/bin/ffmpeg REQUIRE_DURABLE_STORAGE=true
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
EXPOSE 8080
USER node
CMD ["node", "server/dist/index.js"]
