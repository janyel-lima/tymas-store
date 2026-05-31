# 🤖 Bot de Assinaturas — Telegram

Bot do Telegram para **venda e controle de assinaturas**, integrado ao frontend Vue 3
via links dinâmicos de checkout e ao backend via API interna HTTP.

---

## 📁 Estrutura do Projeto

```
telegram-bot/
├── src/
│   ├── bot.js                   # Instância Telegraf + middlewares
│   ├── database.js              # SQLite (better-sqlite3) + todas as queries
│   ├── keyboards.js             # Builders de Inline Keyboards
│   ├── handlers/
│   │   ├── startHandler.js      # Comando /start
│   │   └── callbackHandler.js   # Callbacks dos botões inline
│   ├── services/
│   │   └── cronService.js       # Cron job de expiração diária
│   ├── api/
│   │   └── server.js            # API interna Express (recebe webhook do backend)
│   └── utils/
│       └── markdown.js          # Escape de MarkdownV2
├── data/                        # Banco SQLite (gerado automaticamente, no .gitignore)
├── index.js                     # Entry point
├── .env.example                 # Template de variáveis de ambiente
├── Dockerfile
└── docker-compose.yml
```

---

## ⚙️ Configuração

### 1. Clone e instale

```bash
git clone <seu-repositorio>
cd telegram-bot
npm install
```

### 2. Configure o `.env`

```bash
cp .env.example .env
```

Preencha os valores:

| Variável        | Descrição                                              |
|-----------------|--------------------------------------------------------|
| `BOT_TOKEN`     | Token do bot (obtenha com @BotFather)                  |
| `FRONTEND_URL`  | URL base do seu app Vue 3 (sem barra final)             |
| `DB_PATH`       | Caminho do arquivo SQLite (padrão: `./data/subs.db`)   |
| `API_PORT`      | Porta da API interna (padrão: `3001`)                  |
| `API_SECRET`    | Chave secreta compartilhada com o backend              |

### 3. Rode localmente

```bash
npm run dev        # desenvolvimento (nodemon)
npm start          # produção
```

---

## 🐳 Docker

```bash
# Build + start
docker compose up -d --build

# Logs em tempo real
docker compose logs -f telegram-bot

# Parar
docker compose down
```

O arquivo SQLite é persistido em `./data/subscriptions.db` no host.

---

## 🔗 Integração Backend → Bot (Ativar Assinatura)

Quando o pagamento for aprovado no seu backend, chame:

```
POST http://localhost:3001/activate
X-Api-Secret: <valor do API_SECRET no .env>
Content-Type: application/json

{
  "userId":     123456789,
  "planDays":   30,
  "amount":     100.00,
  "username":   "joao123",
  "fullName":   "João Silva",
  "paymentRef": "pay_gateway_abc123"
}
```

**Resposta de sucesso:**
```json
{
  "success":   true,
  "userId":    123456789,
  "planDays":  30,
  "expiresAt": "2025-08-30T00:00:00.000Z"
}
```

O bot **automaticamente notifica o usuário** no Telegram com a confirmação.

---

## 🗄️ Schema do Banco de Dados

### `users_subscriptions`

| Campo        | Tipo      | Descrição                              |
|--------------|-----------|----------------------------------------|
| `user_id`    | INTEGER PK| ID do usuário no Telegram              |
| `username`   | TEXT      | @username (pode ser null)              |
| `full_name`  | TEXT      | Nome completo                          |
| `status`     | TEXT      | `inactive` \| `active` \| `expired`   |
| `plan_days`  | INTEGER   | Dias do plano contratado               |
| `expires_at` | DATETIME  | Data/hora de expiração (UTC)           |
| `created_at` | DATETIME  | Criação do registro                    |
| `updated_at` | DATETIME  | Última atualização (via trigger)       |

### `payments`

| Campo        | Tipo      | Descrição                              |
|--------------|-----------|----------------------------------------|
| `id`         | INTEGER PK| ID auto-incrementado                   |
| `user_id`    | INTEGER   | FK → users_subscriptions               |
| `plan_days`  | INTEGER   | Dias do plano                          |
| `amount`     | REAL      | Valor pago                             |
| `status`     | TEXT      | `pending` \| `approved` \| `rejected`  |
| `payment_ref`| TEXT      | ID do pagamento no gateway (unique)    |
| `created_at` | DATETIME  | Data do pagamento                      |

---

## 🕐 Cron Job de Expiração

Executa **todo dia às 00:00 (America/Sao_Paulo)**:

1. Busca registros com `status = 'active'` e `expires_at <= NOW()`
2. Atualiza `status → 'expired'`
3. Envia mensagem privada ao usuário com os botões de renovação

Para forçar a verificação manualmente (admin):

```bash
curl -X POST http://localhost:3001/run-expiration-check \
  -H "X-Api-Secret: <API_SECRET>"
```

---

## 🔒 Segurança

- A API interna só é acessível via `127.0.0.1:3001` (não exposta publicamente no compose)
- Toda rota (exceto `/health`) exige o header `X-Api-Secret`
- O bot roda como usuário `node` (não-root) no container
- O arquivo `.env` está no `.gitignore`

Para expor a API interna para um backend em outro servidor, use Nginx ou SSH tunnel.
