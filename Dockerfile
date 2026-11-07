# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
# Regenerate both Prisma clients on every start: the dev bind-mount (`volumes: - .:/app` in
# docker-compose*.yml) overlays whatever was baked into the image at build time with the host's
# copy of this directory, which may not have `src/generated/*` (it's gitignored and often
# excluded from rsync). Without this, a route that only touches one of the two datasources can
# silently work while the other fails at request time with "Module not found".
CMD ["sh", "-c", "pnpm db:generate && pnpm radius:generate && pnpm dev -H 0.0.0.0"]

FROM dev AS build
# Placeholders only so env validation (src/lib/env.ts) passes while building; real values come
# from the runtime environment.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    RADIUS_DATABASE_URL=mysql://build:build@localhost:3306/build \
    APP_BASE_URL=http://localhost:3000 \
    MPESA_ENV=sandbox \
    MPESA_CONSUMER_KEY=build \
    MPESA_CONSUMER_SECRET=build \
    MPESA_SHORTCODE=174379 \
    MPESA_PASSKEY=build \
    MPESA_CALLBACK_URL=http://localhost:3000/api/mpesa/callback \
    OPNSENSE_CAPTIVE_PORTAL_BASE_URL=https://localhost:8003 \
    OPNSENSE_DEFAULT_ZONE_ID=build \
    CRON_SECRET=build-time-placeholder-secret-0123456789 \
    ADMIN_PASSWORD=build-time-placeholder-password
# Explicit, not relying on `deps`' postinstall: that stage has no RADIUS_DATABASE_URL (no .env
# copied in yet at that point), so `prisma generate` for the radius schema can fail there without
# failing `pnpm install` itself — silently leaving `src/generated/radius-client` missing until
# Next's build tries to bundle it and fails. Regenerating here, with the placeholders above
# already in scope, guarantees both clients exist before `pnpm build` runs.
RUN pnpm db:generate && pnpm radius:generate
RUN pnpm build

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
