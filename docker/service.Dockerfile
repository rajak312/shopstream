# One multi-stage Dockerfile for every backend service:
#   docker build -f docker/service.Dockerfile --build-arg SERVICE=orders -t shopstream-orders .
# Stages: deps (full install, cached) -> build (tsc) -> prod-deps (only this service's
# production dependencies) -> runtime (non-root, no build tooling, ~read-only friendly).
ARG NODE_IMAGE=node:24-alpine

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

FROM manifests AS deps
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG SERVICE
COPY tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY services ./services
RUN test -n "$SERVICE" || (echo "SERVICE build-arg is required" && exit 1)
RUN npm run prisma:generate && npx tsc -b services/${SERVICE}
# Assemble only what the runtime needs.
RUN set -eux; \
    mkdir -p /out/services/${SERVICE}; \
    cp -r services/${SERVICE}/dist services/${SERVICE}/package.json /out/services/${SERVICE}/; \
    if [ -d services/${SERVICE}/prisma ]; then cp -r services/${SERVICE}/prisma services/${SERVICE}/prisma.config.ts /out/services/${SERVICE}/; fi; \
    for p in contracts platform; do mkdir -p /out/packages/$p && cp -r packages/$p/dist packages/$p/package.json /out/packages/$p/; done; \
    find /out -name '*.tsbuildinfo' -delete; \
    printf "require('./services/%s/dist/main.js');\n" "${SERVICE}" > /out/server.js

FROM manifests AS prod-deps
ARG SERVICE
COPY docker/prune-node-modules.sh /tmp/prune.sh
RUN \
    npm ci --omit=dev --no-audit --no-fund --workspace @shopstream/${SERVICE} \
    && sh /tmp/prune.sh

FROM ${NODE_IMAGE} AS runtime
ARG SERVICE
ARG APP_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/lalitkumarrajak/shopstream" \
      org.opencontainers.image.description="ShopStream ${SERVICE} service" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=192"
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=build /out/ ./
# Run as the unprivileged `node` user (uid 1000); the filesystem stays root-owned => read-only at runtime.
USER node
EXPOSE 4000
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
