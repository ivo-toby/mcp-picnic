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
ARG APP_UID=1638

# Runtime dependency install only
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# Copy production artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin

# Prepare writable app data dir for persisted session files
RUN addgroup -S -g ${APP_UID} mcp \
  && adduser -S -D -H -u ${APP_UID} -G mcp mcp \
  && mkdir -p /app/data \
  && chown -R mcp:mcp /app

# Default session location inside the container (can be overridden)
ENV PICNIC_SESSION_FILE=/app/data/picnic-session.json

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER mcp

ENTRYPOINT ["node", "bin/mcp-server.js"]
