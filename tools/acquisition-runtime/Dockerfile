# Deployable CPU runtime; model files are initialized in the persistent /models mount.
FROM node:22-bookworm-slim AS node-runtime
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY tools/acquisition-runtime/requirements.txt /tmp/recognition-requirements.txt
RUN pip install --no-cache-dir -r /tmp/recognition-requirements.txt
# Paddle writes disposable scratch files here; verified weights stay in /models.
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PADDLE_PDX_CACHE_HOME=/tmp/mtg-acquisition-native/paddle PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
WORKDIR /app
COPY package.json package-lock.json ./
RUN node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci
COPY prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY lib ./lib
COPY scripts ./scripts
COPY tools/acquisition-runtime ./tools/acquisition-runtime
COPY tools/acquisition-eval/baseline.py /eval/baseline.py
ENV HOME=/tmp/mtg-acquisition-native
ENTRYPOINT ["node", "node_modules/tsx/dist/cli.mjs", "scripts/acquisition-recognition-worker.ts"]
