FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=optional
COPY server ./server
RUN mkdir /data /backups && chown node:node /data /backups
USER node
ENV HOST=0.0.0.0 PORT=3001 YAGE_SAVE_DIR=/data
EXPOSE 3001
VOLUME ["/data", "/backups"]
CMD ["node", "server/saves/run.mjs"]
