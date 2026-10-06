FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# build output (incl. the GPL Stockfish lite files copied by scripts/copy-engine.mjs) + a data dir the unprivileged user owns
RUN npm run build && mkdir -p /data && chown -R node:node /data
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/boardverse.db NODE_NO_WARNINGS=1
# Mount a persistent volume at /data or accounts/ratings/unfinished games are lost when the container is replaced.
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://localhost:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--import","tsx","server/index.ts"]
