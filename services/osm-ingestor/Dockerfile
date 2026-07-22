FROM node:26.5.0-bookworm-slim

ENV NODE_ENV=production \
    TZ=Europe/Oslo \
    OSM_PLANET_FILE_PATH=/data/norway-latest.osm.pbf

RUN npm install --global pnpm@11.15.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY services/osm-ingestor/package.json services/osm-ingestor/package.json

RUN pnpm install --frozen-lockfile --prod --filter osm-ingestor

COPY services/osm-ingestor services/osm-ingestor

RUN mkdir -p /data && chown -R node:node /app /data

USER node

VOLUME ["/data"]

CMD ["pnpm", "--filter", "osm-ingestor", "start"]
