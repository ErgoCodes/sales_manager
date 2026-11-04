# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t monaco-api .
# Docker Hub rate-limits anonymous pulls; override the base image if needed:
#   --build-arg NODE_IMAGE=node:24-alpine
ARG NODE_IMAGE=mirror.gcr.io/library/node:24-alpine

# ---- build: install the workspace slice the API needs, compile, prune ----
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV HUSKY=0 \
    CI=true
RUN corepack enable

# Manifests first so the dependency layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN pnpm install --frozen-lockfile --filter "api..."

COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter api build \
 && pnpm --filter api deploy --legacy --prod /out

# ---- runtime: production deps + compiled output only, non-root ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
