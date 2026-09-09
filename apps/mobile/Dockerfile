# The web build, served as static files. Build context is the repository root:
#   docker build -f apps/mobile/Dockerfile -t vst-web .
#
# The API URL is baked into the bundle at BUILD time — Expo inlines every
# EXPO_PUBLIC_* variable — so it cannot be changed by setting an environment
# variable on the running container. It is the address the BROWSER will use,
# not one container talking to another.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/mobile ./apps/mobile
RUN pnpm install --frozen-lockfile --filter @vst/mobile...
ARG EXPO_PUBLIC_API_URL=http://localhost:8080
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN pnpm --filter @vst/mobile run export:web

FROM node:24-alpine
WORKDIR /app
COPY --from=build /repo/apps/mobile/dist ./dist
COPY --from=build /repo/apps/mobile/scripts/serve-dist.mjs ./serve-dist.mjs
USER node
EXPOSE 8081
CMD ["node", "serve-dist.mjs", "dist", "8081"]
