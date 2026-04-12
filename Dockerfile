# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app

# Install dependencies with cache-friendly layering
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runtime dependency install only
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

# Copy production artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin

# Prepare writable app data dir for persisted session files
RUN mkdir -p /app/data \
  && chown -R node:node /app

USER node

# Default session location inside the container (can be overridden)
ENV PICNIC_SESSION_FILE=/app/data/picnic-session.json

ENTRYPOINT ["node", "bin/mcp-server.js"]
