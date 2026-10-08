# "All-in-one" image for the free-tier live demo (Render, 512 MB):
# an embedded nats-server (JetStream) + every ShopStream service in ONE Node.js
# process (see deploy/allinone). MongoDB (Atlas) and PostgreSQL (Neon) are external.
#
#   docker build -f deploy/render/Dockerfile -t shopstream-allinone .
#   docker run --rm -p 4700:10000 -m 512m -e PORT=10000 -e DATABASE_URL=... -e MONGODB_URI=... -e JWT_SECRET=... shopstream-allinone
ARG NODE_IMAGE=node:24-alpine
ARG NATS_IMAGE=nats:2.12-alpine

FROM ${NATS_IMAGE} AS nats

FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/platform/package.json packages/platform/
COPY services/catalog/package.json services/catalog/
COPY services/orders/package.json services/orders/
COPY services/payments/package.json services/payments/
COPY services/notifications/package.json services/notifications/
COPY services/gateway/package.json services/gateway/
COPY deploy/allinone/package.json deploy/allinone/
COPY tests/e2e/package.json tests/e2e/
COPY apps/web/package.json apps/web/

FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY services ./services
COPY deploy/allinone ./deploy/allinone
RUN npm run build:services
RUN set -eux; mkdir -p /out; \
    for d in packages/contracts packages/platform services/catalog services/orders services/payments services/notifications services/gateway deploy/allinone; do \
      mkdir -p /out/$d && cp -r $d/dist $d/package.json /out/$d/; \
    done; \
    cp -r services/orders/prisma services/orders/prisma.config.ts /out/services/orders/; \
    find /out -name '*.tsbuildinfo' -delete

FROM manifests AS prod-deps
COPY docker/prune-node-modules.sh /tmp/prune.sh
RUN npm ci --omit=dev --no-audit --no-fund --workspace @shopstream/allinone && sh /tmp/prune.sh

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/rajak312/shopstream" \
      org.opencontainers.image.description="ShopStream all-in-one demo (gateway + subgraphs + embedded NATS)" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=10000 \
    NATS_SERVER_BIN=/usr/local/bin/nats-server \
    NATS_DATA_DIR=/tmp/nats \
    NATS_STREAM_STORAGE=file \
    NATS_STREAM_MAX_MB=128 \
    DB_POOL_SIZE=5 \
    SUPERGRAPH_POLL_MS=0 \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=320"
WORKDIR /app
COPY --from=nats /usr/local/bin/nats-server /usr/local/bin/nats-server
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=build /out/ ./
USER node
EXPOSE 10000
STOPSIGNAL SIGTERM
CMD ["node", "deploy/allinone/dist/main.js"]
