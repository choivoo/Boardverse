FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/boardverse.db NODE_NO_WARNINGS=1
# Mount a persistent volume at /data or accounts/ratings are lost when the container is replaced.
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://localhost:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm","start"]
