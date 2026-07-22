FROM node:26.5.0-bookworm-slim

ENV NODE_ENV=production \
    TZ=Europe/Oslo

RUN npm install --global pnpm@11.15.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/hjertestarterregister-sdk/package.json packages/hjertestarterregister-sdk/package.json
COPY services/aed-registry-ingestor/package.json services/aed-registry-ingestor/package.json

RUN pnpm install --frozen-lockfile --prod --no-optional --filter aed-registry-ingestor...

COPY packages/hjertestarterregister-sdk packages/hjertestarterregister-sdk
COPY services/aed-registry-ingestor services/aed-registry-ingestor

RUN chown -R node:node /app

USER node

CMD ["pnpm", "--filter", "aed-registry-ingestor", "start"]
