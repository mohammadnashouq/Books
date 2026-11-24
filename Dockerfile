# Books: one container serving the API and the built app.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/books.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/data ./src/data
COPY --from=build /app/package.json ./
# The SQLite file lives on a volume so it survives redeploys. Create and
# chown it before declaring the volume (changes after VOLUME can be discarded).
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
