# Local CPU runtime; rebuild the two checked-in evaluator images first.
FROM node:22-bookworm-slim AS node-runtime
FROM mtg-acquisition-paddle-eval:local
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
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
ENTRYPOINT ["node", "node_modules/tsx/dist/cli.mjs", "scripts/acquisition-recognition-worker.ts"]
