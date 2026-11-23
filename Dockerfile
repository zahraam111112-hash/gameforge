# Navara game studio — one image, two roles (site+game server, and the harness loop).
# Everything the loop needs (node, vite build, git push, bot simulation) lives in here,
# so the host filesystem is only ever touched through the bind mount.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first. node_modules itself is a named volume (see compose),
# so the image seeds it and the harness gets its own copy per container.
COPY package.json package-lock.json ./
COPY game/package.json game/
COPY server/package.json server/
COPY site/package.json site/
RUN npm ci --include=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.mjs"]
