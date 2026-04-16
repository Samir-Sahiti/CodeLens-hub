# ── Stage 1: build ────────────────────────────────────────────────────────────
# Needs build tools to compile tree-sitter native modules.
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Install ALL deps (including dev) for native compilation
RUN npm ci

COPY . .

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# tree-sitter .node bindings still need build tools at runtime.
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Install production deps only — native modules get recompiled here
RUN npm ci --omit=dev

# Copy application source from builder stage
COPY --from=builder /app/src ./src

# Run as a non-root unprivileged user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 3001

CMD ["node", "src/index.js"]
