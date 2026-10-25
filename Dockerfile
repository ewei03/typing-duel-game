# One image for the whole game: the server, serving the built client.

FROM node:20-alpine AS build
WORKDIR /app
# Lockfiles first so dependency installs are cached across code changes.
COPY server/package.json server/package-lock.json server/
COPY client/package.json client/package-lock.json client/
RUN npm ci --prefix server && npm ci --prefix client
COPY shared shared
COPY server server
COPY client client
RUN npm run build --prefix server && npm run build --prefix client

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    STATIC_DIR=/app/client/dist
COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix server --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1
CMD ["node", "server/dist/server/src/index.js"]
