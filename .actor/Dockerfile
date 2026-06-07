# Build stage: compile the TypeScript MCP server to dist/
FROM node:20-slim AS builder

WORKDIR /app

# Copy manifests first to leverage Docker layer caching.
COPY package*.json ./

# Install all dependencies (incl. dev) so we can run `tsc`.
RUN npm install --include=dev --audit=false

# Copy source and build dist/.
COPY . ./
RUN npm run build

# Final stage
FROM node:20-slim

WORKDIR /app

# Production dependencies only — keeps the image small.
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --audit=false \
    && rm -rf ~/.npm

# Copy the compiled server from the builder stage.
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

# Apify runs this Actor in Standby mode and injects ACTOR_STANDBY_PORT.
# The stdio MCP server (node dist/index.js) is bridged to a streamable
# HTTP endpoint at /mcp using supergateway (the upstream source the Apify
# `ts-actorized-mcp-stdio` template is derived from), which is fetched on
# demand via `npx` so it does not need to be a runtime dependency.
EXPOSE 3000
CMD ["sh", "-c", "npx -y supergateway --stdio 'node dist/index.js' --outputTransport streamableHttp --streamableHttpPath /mcp --port ${ACTOR_STANDBY_PORT:-3000} --healthEndpoint /"]
