FROM node:26.5.0-bookworm-slim

ENV NODE_ENV=production \
    TZ=Europe/Oslo

RUN npm install --global pnpm@11.15.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/osm-sdk/package.json packages/osm-sdk/package.json
COPY services/aed-reconciler/package.json services/aed-reconciler/package.json

RUN pnpm install --frozen-lockfile --prod --filter aed-reconciler...

COPY packages/osm-sdk packages/osm-sdk
COPY services/aed-reconciler services/aed-reconciler

RUN chown -R node:node /app

USER node
WORKDIR /app/services/aed-reconciler

# Run node as PID 1 so SIGTERM/SIGINT reach the app for graceful shutdown.
CMD ["node", "src/index.ts"]
