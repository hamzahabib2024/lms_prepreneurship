# syntax=docker/dockerfile:1
#
# Two images from one file: the API and the web application.
#
# NOT YET RUN. Docker was not available on the machine this was written on, so
# unlike everything else in this repository it has not been executed. Every
# command inside it has been run by hand on the host, and every path it copies
# has been checked to exist — but the first person to run `docker compose up`
# should expect to fix something, and should read this file before doing so.

# ---------------------------------------------------------------- build ----
# Debian rather than Alpine, deliberately. Prisma's query engine links against
# OpenSSL, and the musl builds are a recurring source of "engine not found" at
# runtime. The saved image size is not worth an evening.
FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# The lockfile first, so a dependency install is cached across code changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .

# Generated against THIS image, so the engine matches the platform it will run
# on. Generating on the host and copying it in is the other recurring cause of
# "engine not found".
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build

# ------------------------------------------------------------ api image ----
FROM node:20-slim AS api
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# The FULL node_modules, devDependencies included. Do not "optimise" this with
# `npm prune --production`: the entrypoint runs `prisma migrate deploy`, and
# the prisma CLI is a devDependency. Pruning it produces an image that builds
# cleanly and then cannot start.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/

# The schema, its migrations, and the SQL Prisma cannot express. All three are
# needed at START-UP, not only at build: the entrypoint applies them.
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/scripts ./scripts

COPY docker/api-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Runs as an unprivileged user. The keys and backups directories are volumes
# and must be writable by it.
RUN mkdir -p /app/keys /app/backups /app/storage     && chown -R node:node /app/keys /app/backups /app/storage
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]

# ------------------------------------------------------------ web image ----
# The built application is static files. nginx serves them and proxies /api to
# the API container, so the browser sees ONE origin — the same arrangement the
# Vite dev server creates, which is why CORS behaves identically in both.
FROM nginx:1.27-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
