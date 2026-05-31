# 🤖 MP Telegram Bot — Backend de Assinaturas

Backend Node.js para gerenciar assinaturas pagas via **Mercado Pago Checkout Pro**, ativadas automaticamente por um **Bot do Telegram**.

---

## 📁 Estrutura de Arquivos

```
mp-telegram-bot/
│
├── server.js                  ← Servidor principal (único arquivo de lógica)
├── package.json               ← Dependências e scripts npm
├── .env                       ← Variáveis secretas (NÃO versionar)
├── .env.example               ← Modelo de variáveis (versionar)
├── .gitignore                 ← Arquivos ignorados pelo Git
├── README.md                  ← Esta documentação
│
├── public/                    ← Páginas HTML estáticas (servidas pelo Express)
│   ├── sucesso.html           ← Exibida após pagamento aprovado
│   ├── falha.html             ← Exibida após pagamento recusado
│   └── pendente.html          ← Exibida para pagamentos em análise (ex: boleto)
│
└── scripts/                   ← Utilitários de desenvolvimento
    ├── test-checkout.js       ← Testa o endpoint /api/v1/checkout
    └── db-admin.js            ← Inspeciona e administra o banco SQLite
```

---

## ✅ Pré-requisitos

- **Node.js** v18 ou superior
- **npm** v9 ou superior
- Conta no **Mercado Pago** com Access Token de produção
- **Bot do Telegram** criado via [@BotFather](https://t.me/BotFather)
- URL pública HTTPS (obrigatório para o Webhook do MP)

---

## 🚀 Instalação e Configuração

### 1. Clonar e instalar dependências

```bash
# Clone o repositório (ou extraia o ZIP)
git clone https://github.com/seu-usuario/mp-telegram-bot.git
cd mp-telegram-bot

# Instale todas as dependências
npm install
```

### 2. Configurar variáveis de ambiente

```bash
# Copie o arquivo de exemplo
cp .env.example .env

# Edite com suas credenciais reais
nano .env
```

| Variável            | Descrição                                              | Exemplo                          |
|---------------------|--------------------------------------------------------|----------------------------------|
| `PORT`              | Porta do servidor                                      | `3000`                           |
| `NODE_ENV`          | Ambiente (`development` ou `production`)               | `production`                     |
| `MP_ACCESS_TOKEN`   | Access Token do Mercado Pago (começa com `APP_USR-`)   | `APP_USR-xxx...`                 |
| `TELEGRAM_BOT_TOKEN`| Token do bot obtido no @BotFather                      | `123456:ABC...`                  |
| `BASE_URL`          | URL pública **HTTPS** deste backend                    | `https://api.meusite.com`        |
| `FRONTEND_URL`      | URL do frontend (para CORS e back_urls do MP)          | `https://meusite.com`            |
| `DB_PATH`           | Caminho do arquivo SQLite                              | `./payments.db`                  |

> ⚠️ **Nunca** commite o arquivo `.env`. Ele já está no `.gitignore`.

### 3. Iniciar o servidor

```bash
# Produção
npm start

# Desenvolvimento (com hot-reload nativo — Node.js 18+)
npm run dev
```

Saída esperada:
```
[DB] Banco de dados SQLite conectado em: ./payments.db
[DB] Estrutura de tabelas verificada/criada com sucesso.
═══════════════════════════════════════════════════════
  🚀  Servidor iniciado na porta 3000
  🌍  Ambiente  : production
  🔗  Frontend  : https://meusite.com
  📡  Webhook   : https://api.meusite.com/api/v1/webhook
═══════════════════════════════════════════════════════
```

---

## 📡 API — Endpoints

### `POST /api/v1/checkout`

Cria uma preferência de pagamento e retorna o link do Checkout Pro.

**Body (JSON):**
```json
{
  "userId": "123456789",
  "plano": 30
}
```

**Resposta de sucesso (`201`):**
```json
{
  "success": true,
  "payment_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "init_point": "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=..."
}
```

**Planos disponíveis (preços fixados no servidor):**

| `plano` | Duração | Preço   |
|---------|---------|---------|
| `7`     | 7 dias  | R$ 30   |
| `14`    | 14 dias | R$ 50   |
| `30`    | 30 dias | R$ 100  |

---

### `POST /api/v1/webhook`

Recebe notificações IPN do Mercado Pago. **Não chamar manualmente.**

O Mercado Pago envia automaticamente ao receber um pagamento.  
O servidor responde `200` imediatamente e processa de forma assíncrona.

**Fluxo interno ao receber `status: approved`:**
1. Consulta os dados reais na API do MP (nunca confia no payload)
2. Extrai `user_id`, `plano_dias` e `internal_id` do `metadata`
3. Atualiza o registro no SQLite para `approved`
4. Envia mensagem de confirmação via Telegram

---

### `GET /health`

Health check do servidor.

```json
{ "status": "ok", "env": "production", "timestamp": "2024-01-15T10:30:00.000Z" }
```

---

## 🔐 Segurança

- **Preços nunca vêm do cliente.** O `PLAN_CATALOG` é `Object.freeze()` e definido exclusivamente no servidor.
- **Webhook server-to-server.** Ao receber a notificação, o servidor consulta a API do MP com o token secreto para obter os dados reais.
- **Idempotência dupla.** O `UPDATE` só executa se o status atual não for `approved`, e a consulta prévia (`dbGet`) detecta duplicatas antes.
- **Falha rápida.** Credenciais ausentes encerram o processo imediatamente na inicialização.
- **WAL mode.** SQLite configurado com `journal_mode = WAL` para consistência em escritas concorrentes.

---

## 🛠️ Scripts de Desenvolvimento

### Testar o endpoint de checkout

```bash
# Sintaxe: node scripts/test-checkout.js [userId] [plano]
node scripts/test-checkout.js 987654321 30
```

### Administrar o banco de dados

```bash
# Listar todos os pagamentos
node scripts/db-admin.js list

# Filtrar por status
node scripts/db-admin.js list pending
node scripts/db-admin.js list approved

# Ver detalhes de um pagamento específico
node scripts/db-admin.js show f47ac10b-58cc-4372-a567-0e02b2c3d479

# Ver estatísticas
node scripts/db-admin.js stats

# Limpar banco (CUIDADO!)
node scripts/db-admin.js reset -- --confirm
```

### Expor o servidor localmente via ngrok (desenvolvimento)

```bash
# Instale o ngrok: https://ngrok.com
npx ngrok http 3000

# Copie a URL HTTPS gerada e coloque em BASE_URL no .env
# Exemplo: https://abc123.ngrok-free.app
```

---

## ☁️ Deploy em Produção

### Opção A — VPS com PM2 (recomendado)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar com PM2
pm2 start server.js --name mp-telegram-bot

# Salvar para sobreviver a reinicializações
pm2 save
pm2 startup

# Ver logs em tempo real
pm2 logs mp-telegram-bot
```

### Opção B — Railway / Render / Fly.io

1. Faça push do código para um repositório Git
2. Conecte ao serviço de hospedagem
3. Configure as variáveis de ambiente no painel
4. O serviço detecta automaticamente `npm start`

> **Importante:** O `payments.db` é criado localmente. Em plataformas com filesystem efêmero (Railway, Render free tier), o banco é resetado a cada deploy. Use um volume persistente ou migre para PostgreSQL/MySQL nesses casos.

---

## 📝 Tabela `payments` (SQLite)

| Coluna          | Tipo    | Descrição                              |
|-----------------|---------|----------------------------------------|
| `id`            | TEXT PK | UUID gerado pelo servidor              |
| `user_id`       | TEXT    | ID do usuário no Telegram              |
| `plano`         | INTEGER | Duração em dias (7, 14 ou 30)          |
| `status`        | TEXT    | `pending` → `approved`                |
| `mp_payment_id` | TEXT    | ID do pagamento no Mercado Pago        |
| `created_at`    | TEXT    | ISO 8601 — data de criação             |
| `updated_at`    | TEXT    | ISO 8601 — última atualização          |

---

## 📦 Dependências

| Pacote          | Versão    | Uso                                   |
|-----------------|-----------|---------------------------------------|
| `express`       | ^4.19     | Framework HTTP                        |
| `cors`          | ^2.8      | Middleware de CORS                    |
| `dotenv`        | ^16.4     | Variáveis de ambiente                 |
| `sqlite3`       | ^5.1      | Driver SQLite nativo                  |
| `mercadopago`   | ^2.2      | SDK oficial do Mercado Pago (v2)      |
| `uuid`          | ^10.0     | Geração de IDs únicos (UUIDv4)        |
| `axios`         | ^1.7      | Cliente HTTP (Telegram API)           |

---

## 📜 Licença

MIT — use à vontade.
