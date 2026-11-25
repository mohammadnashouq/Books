#!/bin/sh
# Replace the running Books container with the image just built
# (books-web:latest) and wait until it is healthy. TeamCity runs this after
# `docker build`; it lives in the repo so deploy changes are reviewed with the
# code that needs them.
#
#   PORT_ON_HOST  host port, bound to 127.0.0.1 only (default 3110). The host's
#                 nginx is the only way in, which is what makes TRUST_PROXY=1 safe.
#   DATA_VOLUME   named volume holding the SQLite file (default books-data).
set -eu

name=books-web
port="${PORT_ON_HOST:-3110}"
volume="${DATA_VOLUME:-books-data}"

docker volume create "$volume" >/dev/null
docker rm -f "$name" >/dev/null 2>&1 || true

# Read-only root file system: the app writes only to /data (the volume).
docker run -d --name "$name" \
  -p "127.0.0.1:$port:3001" \
  -v "$volume:/data" \
  -e TRUST_PROXY=1 \
  --read-only --tmpfs /tmp \
  --restart unless-stopped \
  books-web:latest >/dev/null

status=starting
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$status" = healthy ] && break
  sleep 2
done
echo "$name: $status"
if [ "$status" != healthy ]; then
  docker logs --tail 40 "$name"
  exit 1
fi
