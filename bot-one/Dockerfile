# ════════════════════════════════════════════════════════
#  Dockerfile — Bot de Assinaturas Telegram
#  Node 20 Alpine + better-sqlite3 (módulo nativo)
# ════════════════════════════════════════════════════════

# ── Stage 1: Dependências ────────────────────────────────
FROM node:20-alpine AS deps

# Ferramentas de compilação necessárias para better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

# Instala TODAS as dependências (incluindo dev) para compilar módulos nativos
RUN npm ci

# ── Stage 2: Runtime ─────────────────────────────────────
FROM node:20-alpine AS runtime

# Runtime mínimo para better-sqlite3 (sem as ferramentas de build)
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copia somente o necessário do stage anterior
COPY --from=deps /app/node_modules ./node_modules

# Copia o código-fonte
COPY . .

# Cria diretório de dados e ajusta permissões para o usuário 'node'
RUN mkdir -p data && chown -R node:node /app

# Roda como usuário não-root (segurança)
USER node

# Porta da API interna
EXPOSE 3001

# Health check (depende do servidor Express estar rodando)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "index.js"]
