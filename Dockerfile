# syntax=docker/dockerfile:1.7

FROM node:22.18.0-bookworm-slim AS dependency-manifests
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/content-server/package.json apps/content-server/package.json
COPY apps/game-server/package.json apps/game-server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/board-renderer/package.json packages/board-renderer/package.json
COPY packages/content-tools/package.json packages/content-tools/package.json
COPY packages/game-ai/package.json packages/game-ai/package.json
COPY packages/game-content/package.json packages/game-content/package.json
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/game-protocol/package.json packages/game-protocol/package.json

FROM dependency-manifests AS build
RUN npm ci

COPY . .
RUN npm run build

FROM dependency-manifests AS game-production-dependencies
RUN npm ci --omit=dev --workspace @goose-chess/game-server

FROM dependency-manifests AS content-production-dependencies
RUN npm ci --omit=dev --workspace @goose-chess/content-server

FROM node:22.18.0-bookworm-slim AS game-server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=game-production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/game-server/package.json ./apps/game-server/package.json
COPY --from=build --chown=node:node /app/apps/game-server/dist ./apps/game-server/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "apps/game-server/dist/index.js"]

FROM node:22.18.0-bookworm-slim AS content-server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=content-production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/content-server/package.json ./apps/content-server/package.json
COPY --from=build --chown=node:node /app/apps/content-server/dist ./apps/content-server/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8788
CMD ["node", "apps/content-server/dist/index.js"]

FROM nginx:1.29-alpine AS web
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.29-alpine AS admin
COPY deploy/nginx/admin.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
