# Books: production image.
#
# Stage 1 installs from the lockfile and runs `npm run check` (lint, tests,
# build), so an image is only made from code that passes. Stage 2 is plain
# nginx serving the static `dist/` folder as an unprivileged user on port 8080.
#
#   docker build -t books-web .
#   docker run -d -p 127.0.0.1:3110:8080 --name books-web books-web
#
# The app has no server and no secrets: every book lives in the reader's
# browser (localStorage), so the container keeps no data and needs no volume.

# Node 22, as in .nvmrc (the tests need 22.22 or newer).
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run check


FROM nginxinc/nginx-unprivileged:1.29-alpine AS web

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
