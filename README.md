# 🤖 MP Telegram Bot — Stack Completa

Sistema completo de assinaturas pagas via **Mercado Pago Checkout Pro** com ativação automática via **Bot do Telegram**.

```
┌─────────────┐    checkout     ┌─────────────┐    webhook    ┌─────────────┐
│   Frontend  │ ──────────────► │   Backend   │ ◄──────────── │ Mercado Pago│
│  Vue 3+Vite │                 │ Express+SQLite│              └─────────────┘
│  (Nginx)    │                 │  porta 3000 │
└─────────────┘                 └──────┬──────┘
     porta 80                          │ POST /activate
                                        ▼
                                ┌─────────────┐
                                │  Telegram   │
                                │     Bot     │
                                │  porta 3001 │
                                └─────────────┘
```

---

## 📁 Estrutura do Projeto

```
mp-telegram-bot/
├── backend/                    ← API Express + SQLite
│   ├── server.js               ← Servidor principal (integrado ao bot)
│   ├── Dockerfile              ← Produção
│   ├── Dockerfile.dev          ← Desenvolvimento (hot-reload)
│   ├── data/                   ← SQLite persistente (gitignored)
│   └── public/                 ← Páginas de sucesso/falha/pendente
│
├── bot-one/                    ← Bot Telegram (Telegraf)
│   ├── index.js                ← Entry point
│   ├── src/
│   │   ├── api/server.js       ← API interna /activate
│   │   ├── bot.js              ← Instância Telegraf
│   │   ├── database.js         ← SQLite (better-sqlite3)
│   │   ├── handlers/           ← /start, callbacks
│   │   ├── keyboards.js        ← Inline keyboards
│   │   └── services/cronService.js ← Expiração de assinaturas
│   ├── Dockerfile              ← Produção
│   ├── Dockerfile.dev          ← Desenvolvimento
│   └── data/                   ← SQLite persistente (gitignored)
│
├── frontend/                   ← Vue 3 + Vite + Tailwind
│   ├── src/
│   │   ├── views/
│   │   │   ├── CheckoutView.vue
│   │   │   └── SuccessView.vue
│   │   ├── router/index.ts
│   │   ├── theme.ts
│   │   └── main.ts
│   ├── Dockerfile              ← Multi-stage: build + Nginx
│   ├── Dockerfile.dev          ← Vite dev server
│   ├── nginx.conf              ← Config Nginx (Vue Router history mode)
│   └── vite.config.ts          ← Com proxy para backend em dev
│
├── docker-compose.yml          ← Stack de produção
├── docker-compose.dev.yml      ← Stack de desenvolvimento
├── .env.example                ← Template de variáveis
├── .env.dev                    ← Variáveis de desenvolvimento (gitignored)
├── .devcontainer/              ← VS Code Dev Container
├── Makefile                    ← Comandos rápidos
└── .gitignore
```

---

## 🚀 Quick Start

### Desenvolvimento Local (sem Docker)

```bash
# 1. Clone e configure
git clone <repo>
cd mp-telegram-bot
make setup        # cria .env e diretórios

# 2. Edite as credenciais
nano .env.dev

# 3. Instale dependências em cada serviço
cd backend  && npm install && cd ..
cd bot-one  && npm install && cd ..
cd frontend && npm install && cd ..

# 4. Inicie cada serviço em terminais separados
cd backend  && node --watch server.js
cd bot-one  && npx nodemon index.js
cd frontend && npm run dev
```

Acesse: **http://localhost:5173**

---

### Desenvolvimento com Docker Compose

```bash
# Configure o .env.dev
cp .env.example .env.dev
nano .env.dev

# Suba a stack completa com hot-reload
make dev

# Ou em background:
make dev-d && make dev-logs
```

| Serviço   | URL                            |
|-----------|-------------------------------|
| Frontend  | http://localhost:5173          |
| Backend   | http://localhost:3000          |
| Bot API   | http://localhost:3001          |
| Health    | http://localhost:3000/health   |

---

### Produção (AWS EC2 / VPS)

```bash
# 1. Configure o .env com credenciais de produção
cp .env.example .env
nano .env

# Variáveis obrigatórias:
# MP_ACCESS_TOKEN=APP_USR-...
# TELEGRAM_BOT_TOKEN=123456:ABC...
# BACKEND_URL=https://api.seudominio.com
# FRONTEND_URL=https://seudominio.com
# API_SECRET=$(openssl rand -hex 32)

# 2. Suba a stack
make prod

# 3. Verifique os serviços
make ps
make logs
```

---

## 🔧 Variáveis de Ambiente

| Variável              | Descrição                                          | Exemplo                              |
|-----------------------|----------------------------------------------------|--------------------------------------|
| `MP_ACCESS_TOKEN`     | Token do Mercado Pago (produção: APP_USR-)         | `APP_USR-xxx`                        |
| `TELEGRAM_BOT_TOKEN`  | Token do bot (@BotFather)                          | `123456:ABC...`                      |
| `TELEGRAM_BOT_USERNAME` | Username do bot (sem @)                          | `meu_bot`                            |
| `BACKEND_URL`         | URL pública HTTPS do backend                       | `https://api.meusite.com`            |
| `FRONTEND_URL`        | URL pública do frontend                            | `https://meusite.com`                |
| `API_SECRET`          | Chave secreta backend ↔ bot                        | `$(openssl rand -hex 32)`            |
| `PORT`                | Porta do backend Express                           | `3000`                               |
| `API_PORT`            | Porta da API interna do bot                        | `3001`                               |
| `DB_PATH`             | Caminho do SQLite do backend                       | `/app/data/payments.db`              |

---

## 🔄 Fluxo de Pagamento

```
1. Usuário abre o frontend → /checkout?userId=123&plano=30
2. Frontend → POST /api/v1/checkout → backend cria preferência no MP
3. Backend retorna init_point → frontend redireciona para o MP
4. Usuário paga no Mercado Pago
5. MP dispara webhook → POST /api/v1/webhook no backend
6. Backend verifica pagamento na API do MP (server-to-server)
7. Backend atualiza SQLite → status='approved'
8. Backend → POST http://bot:3001/activate (rede Docker interna)
9. Bot ativa assinatura no SQLite do bot
10. Bot envia mensagem de confirmação ao usuário no Telegram
11. Usuário é redirecionado para /sucesso no frontend
```

---

## 🛡️ Segurança

- **Preços no servidor**: `PLAN_CATALOG` é `Object.freeze()`, nunca vem do cliente
- **Webhook server-to-server**: sempre re-consulta a API do MP, nunca confia no payload
- **Idempotência dupla**: verificação de status antes + cláusula `AND status != 'approved'`
- **API interna protegida**: `X-Api-Secret` header entre backend e bot
- **Rede Docker isolada**: bot API na porta 127.0.0.1:3001 (não exposta externamente)
- **Usuário não-root**: containers rodam como `USER node`
- **WAL mode SQLite**: consistência em escritas concorrentes

---

## 🛠️ Comandos Úteis

```bash
make help           # Lista todos os comandos
make dev            # Dev com hot-reload
make prod           # Produção
make logs           # Logs em tempo real
make db-admin       # Listar pagamentos
make db-stats       # Estatísticas
make ngrok          # Expor backend via ngrok (dev + webhooks)
make clean          # Limpa recursos Docker
```

---

## 📦 Limites de Memória (t3.micro — 1GB RAM)

| Serviço   | Limite | Reserva |
|-----------|--------|---------|
| Backend   | 250M   | 128M    |
| Bot        | 150M   | 64M     |
| Frontend  | 100M   | 32M     |
| **Total** | **500M** | **224M** |

Sobram ~500MB para o sistema operacional e Docker daemon.

---

## 📜 Licença

MIT
