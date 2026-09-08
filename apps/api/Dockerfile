# Stateless API container (architecture.md §2). Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t vst-api .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @vst/api... && pnpm --filter @vst/api build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/api/dist/main.mjs ./main.mjs
COPY --from=build /repo/packages/persistence/migrations ./packages/persistence/migrations
USER node
EXPOSE 8080 9464
CMD ["node", "main.mjs"]
