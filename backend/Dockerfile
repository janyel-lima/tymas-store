# ════════════════════════════════════════════════════════
#  backend/Dockerfile — Node.js 20 Alpine (Produção)
#  Express + SQLite (sqlite3 com módulo nativo)
# ════════════════════════════════════════════════════════

FROM node:20-alpine AS runtime

# Ferramentas de compilação para sqlite3 (módulo nativo via node-gyp)
RUN apk add --no-cache python3 make g++ && \
    ln -sf python3 /usr/bin/python

WORKDIR /app

# Copia manifests e instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev --frozen-lockfile && \
    # Remove ferramentas de build após instalação (reduz tamanho final)
    apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

# Copia o código-fonte
COPY . .

# Cria diretório de dados para o SQLite e ajusta permissões
RUN mkdir -p /app/data && chown -R node:node /app

# Define variáveis de ambiente de produção
ENV NODE_ENV=production
ENV DB_PATH=/app/data/payments.db

# Roda como usuário não-root (segurança)
USER node

EXPOSE 3000

# Health check via endpoint /health
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
