FROM node:22-alpine

ENV NODE_ENV=production \
    WORKER_TEMP_DIR=/tmp/omnitube-media

RUN apk add --no-cache ffmpeg tini \
    && mkdir -p /app /tmp/omnitube-media \
    && chown -R node:node /app /tmp/omnitube-media

WORKDIR /app
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --chown=node:node worker.mjs ./
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "worker.mjs"]
