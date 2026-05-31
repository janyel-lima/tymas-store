# ════════════════════════════════════════════════════════
#  bot-one/Dockerfile — Telegram Bot (Telegraf + better-sqlite3)
#  Node 20 Alpine — já existente no projeto, revisado para compose
# ════════════════════════════════════════════════════════

# ── Stage 1: Build (compila better-sqlite3) ──────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

# ── Stage 2: Runtime ─────────────────────────────────────
FROM node:20-alpine AS runtime

# Runtime mínimo para better-sqlite3
RUN apk add --no-cache libstdc++

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Cria diretório de dados e ajusta permissões
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production
ENV DB_PATH=/app/data/subscriptions.db

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "index.js"]
