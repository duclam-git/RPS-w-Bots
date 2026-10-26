# OTTv2 Code Arena - container image.
# NOT built or run in the development environment this file was written in (no Docker there): treat it as a
# reviewed starting point and test `docker compose up --build` before relying on it. See docs/DEPLOY.md.
FROM node:22-bookworm-slim

# python3 + g++ run/compile bots, bubblewrap confines them, tini reaps zombie bot processes, util-linux has prlimit
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 g++ bubblewrap tini util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data temp_bots && chown -R node:node /app

USER node
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/ott.db
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
