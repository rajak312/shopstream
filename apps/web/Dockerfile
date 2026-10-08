# Next.js storefront as a standalone server (used by docker compose and Kubernetes;
# the public demo is deployed to Vercel instead).
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_GATEWAY_URL=http://localhost:4700/graphql .
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
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
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:4700/graphql
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3700
ENV NEXT_PUBLIC_GATEWAY_URL=${NEXT_PUBLIC_GATEWAY_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @shopstream/contracts && npm run build -w @shopstream/web

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
