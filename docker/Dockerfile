# ── Build stage ────────────────────────────────────────────
FROM node:20-slim AS build

# Install build dependencies for native modules (canvas)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg62-turbo-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Runtime stage ─────────────────────────────────────────
FROM node:20-slim

# Install runtime libraries for native modules + utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Force IPv4 DNS resolution
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Copy dependencies from build stage
COPY --from=build /app/node_modules ./node_modules

# Copy application source
COPY . .

# Pre-create writable auth dir owned by node user. Hybrid auth state
# (src/whatsapp/mongoAuthState.js) persists session-* / sender-key-*
# libsignal keys to filesystem under ${WA_AUTH_DIR:-/app/data/auth}/<botId>/
# for sub-ms writes (avoiding the Mongo+AES bottleneck that 408'd 1k-member
# group sends). docker-compose should mount a named volume here so sessions
# survive container restarts.
RUN mkdir -p /app/data/auth && chown -R node:node /app/data

# Run as non-root
USER node

# Ensure Docker sends SIGTERM for graceful shutdown
STOPSIGNAL SIGTERM

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
