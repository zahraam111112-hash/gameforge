# Navara game studio — one image, two roles (site+game server, and the harness loop).
# Everything the loop needs (node, vite build, git push, bot simulation) lives in here,
# so the host filesystem is only ever touched through the bind mount.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl tini openssh-client && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first. node_modules itself is a named volume (see compose),
# so the image seeds it and the harness gets its own copy per container.
# Playwright's postinstall pulls a ~150MB Chromium that no gate needs — the
# harness verifies with the headless bot simulation and the vite build. Without
# this the install hangs for many minutes and the image balloons.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_GC=1

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
