# Books: one container serving the API and the built app, with the SQLite
# database on the /data volume.
#
# The build stage runs `npm run check` (lint, tests, build), so an image is
# only made from code that passes. Node 24 as in .nvmrc: the server uses the
# built-in node:sqlite, which Node 22's toolchain can't load in the tests.
#
#   docker build -t books-web .
#   docker run -d --name books-web -p 127.0.0.1:3110:3001 \
#     -v books-data:/data -e TRUST_PROXY=1 books-web

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run check && npm prune --omit=dev


FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/books.sqlite
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/data ./src/data
COPY --from=build /app/package.json ./

# The SQLite file lives on a volume so it survives redeploys. Create and chown
# it before declaring the volume (changes after VOLUME can be discarded).
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3001
# Listing the books reads the database, so healthy means the API and the
# SQLite file both work. The slim image has no curl, so use Node's fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/books').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server/index.js"]
