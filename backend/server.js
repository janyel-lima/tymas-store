'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  server.js — Backend de Assinaturas: Mercado Pago Checkout Pro + Telegram Bot
//  Stack: Node.js, Express, SQLite (sqlite3), Mercado Pago SDK v2, Axios
//  Integração: Notifica o bot via API interna (POST /activate) ao aprovar pagamento
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const sqlite3    = require('sqlite3').verbose();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');
const axios      = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 1 — VARIÁVEIS DE AMBIENTE & VALIDAÇÃO NA INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const {
  PORT              = 3000,
  MP_ACCESS_TOKEN,
  TELEGRAM_BOT_TOKEN,
  FRONTEND_URL      = 'http://localhost:5173',
  BASE_URL          = 'http://localhost:3000',
  DB_PATH           = './data/payments.db',
  NODE_ENV          = 'development',
  // URL interna do bot (dentro da rede Docker: http://bot:3001)
  // Em dev local sem Docker: http://localhost:3001
  BOT_INTERNAL_URL  = 'http://localhost:3001',
  API_SECRET        = '',
} = process.env;

if (!MP_ACCESS_TOKEN) {
  console.error('[FATAL] Variável de ambiente MP_ACCESS_TOKEN não definida.');
  process.exit(1);
}

// Aviso se TELEGRAM_BOT_TOKEN não estiver definido (ainda funciona, mas sem fallback Telegram direto)
if (!TELEGRAM_BOT_TOKEN) {
  console.warn('[WARN] TELEGRAM_BOT_TOKEN não definida. Notificações diretas via Telegram desativadas.');
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 2 — MAPA DE PLANOS (única fonte de verdade de preços — server-side)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Record<number, { price: number, label: string }>} */
const PLAN_CATALOG = Object.freeze({
  7:  { price: 30.0,  label: '7 Dias'  },
  14: { price: 50.0,  label: '14 Dias' },
  30: { price: 100.0, label: '30 Dias' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 3 — CLIENTE MERCADO PAGO (SDK v2)
// ─────────────────────────────────────────────────────────────────────────────

const mpConfig = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 8000, idempotencyKey: undefined },
});

const mpPreference = new Preference(mpConfig);
const mpPayment    = new Payment(mpConfig);

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 4 — BANCO DE DADOS SQLITE (wrappers assíncronos)
// ─────────────────────────────────────────────────────────────────────────────

// Garante que o diretório de dados existe
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB][FATAL] Falha ao abrir o banco SQLite:', err.message);
    process.exit(1);
  }
  console.log(`[DB] Banco de dados SQLite conectado em: ${DB_PATH}`);
});

db.run('PRAGMA journal_mode = WAL;');

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const initDatabase = async () => {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS payments (
      id            TEXT PRIMARY KEY,
      user_id       TEXT    NOT NULL,
      plano         INTEGER NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending',
      mp_payment_id TEXT,
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    )
  `);

  await dbRun(`
    CREATE INDEX IF NOT EXISTS idx_payments_user_id
    ON payments (user_id)
  `);

  console.log('[DB] Estrutura de tabelas verificada/criada com sucesso.');
};

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 5 — HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notifica o Bot via API interna para ativar a assinatura do usuário.
 * Essa é a integração principal backend → bot.
 */
const notifyBotActivation = async ({ userId, planDays, amount, paymentRef }) => {
  const url = `${BOT_INTERNAL_URL}/activate`;

  const payload = {
    userId:     Number(userId),
    planDays:   Number(planDays),
    amount:     Number(amount) || 0,
    paymentRef: String(paymentRef),
  };

  const headers = {
    'Content-Type': 'application/json',
    ...(API_SECRET ? { 'X-Api-Secret': API_SECRET } : {}),
  };

  const response = await axios.post(url, payload, {
    timeout: 8000,
    headers,
  });

  if (!response.data?.success) {
    throw new Error(`Bot retornou sucesso=false: ${JSON.stringify(response.data)}`);
  }

  console.log(`[BOT-NOTIFY] Assinatura ativada via bot → userId=${userId} | plano=${planDays}d`);
  return response.data;
};

/**
 * Fallback: envia mensagem direta via Telegram API caso o bot esteja offline.
 * Garante que o usuário seja notificado mesmo em falha do bot.
 */
const sendTelegramFallback = async (chatId, plano_dias) => {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[TELEGRAM-FALLBACK] BOT_TOKEN não configurado. Pulando fallback.');
    return;
  }

  const plan = PLAN_CATALOG[parseInt(plano_dias, 10)];
  const label = plan ? plan.label : `${plano_dias} dias`;

  const text =
    `✅ <b>Pagamento Aprovado!</b>\n\n` +
    `Seu plano <b>${label}</b> foi ativado com sucesso!\n\n` +
    `🔓 <b>Acesso liberado imediatamente.</b>\n` +
    `📅 Duração: <b>${plano_dias} dias</b>\n\n` +
    `Obrigado pela sua assinatura. Aproveite! 🚀`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  await axios.post(url, {
    chat_id:    String(chatId),
    text,
    parse_mode: 'HTML',
  }, { timeout: 6000 });

  console.log(`[TELEGRAM-FALLBACK] Mensagem direta enviada → chat_id=${chatId}`);
};

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 6 — EXPRESS APP & MIDDLEWARES
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Serve páginas estáticas de /public (sucesso, falha, pendente)
app.use(express.static(path.join(__dirname, 'public')));

// CORS — permite o frontend declarado no .env + localhost em dev
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (ex: curl, Postman, webhooks do MP)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS bloqueado para origem: ${origin}`));
  },
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use((req, _res, next) => {
  console.log(
    `[REQ] ${new Date().toISOString()} | ${req.method} ${req.originalUrl} | IP: ${req.ip}`
  );
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 7 — ROTAS
// ─────────────────────────────────────────────────────────────────────────────

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status:    'ok',
    env:       NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── POST /api/v1/checkout ─────────────────────────────────────────────────────
app.post('/api/v1/checkout', async (req, res) => {
  const { userId, plano } = req.body;

  if (!userId || String(userId).trim() === '') {
    return res.status(400).json({ error: 'O campo "userId" é obrigatório.' });
  }

  const planoInt  = parseInt(plano, 10);
  const planEntry = PLAN_CATALOG[planoInt];

  if (!planEntry) {
    return res.status(400).json({
      error: 'Plano inválido. Os valores aceitos são: 7, 14 ou 30.',
    });
  }

  const safeUserId = String(userId).trim();
  const id         = uuidv4();
  const now        = new Date().toISOString();

  try {
    await dbRun(
      `INSERT INTO payments (id, user_id, plano, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [id, safeUserId, planoInt, now, now]
    );

    console.log(`[CHECKOUT] Registro criado → id=${id} | userId=${safeUserId} | plano=${planoInt}d`);

    // Monta back_urls apontando para o frontend
    const preferenceBody = {
      items: [
        {
          id:          id,
          title:       `Assinatura ${planEntry.label}`,
          description: `Acesso premium por ${planoInt} dias via Telegram`,
          quantity:    1,
          unit_price:  planEntry.price,
          currency_id: 'BRL',
        },
      ],
      metadata: {
        user_id:     safeUserId,
        plano_dias:  planoInt,
        internal_id: id,
      },
      back_urls: {
        success: `${FRONTEND_URL}/sucesso?userId=${safeUserId}&plano=${planoInt}`,
        failure: `${FRONTEND_URL}/falha`,
        pending: `${FRONTEND_URL}/pendente`,
      },
      auto_return:          'approved',
      external_reference:   id,
      notification_url:     `${BASE_URL}/api/v1/webhook`,
      statement_descriptor: 'ASSINATURA BOT',
    };

    const preference = await mpPreference.create({ body: preferenceBody });

    console.log(`[CHECKOUT] Preferência MP criada → prefId=${preference.id}`);

    return res.status(201).json({
      success:    true,
      payment_id: id,
      init_point: preference.init_point,
    });

  } catch (err) {
    const mpError = err?.cause?.message || err?.message || 'Erro desconhecido';
    console.error(`[CHECKOUT][ERROR] id=${id} | Erro: ${mpError}`);

    try {
      await dbRun(`DELETE FROM payments WHERE id = ? AND status = 'pending'`, [id]);
    } catch (dbErr) {
      console.error('[CHECKOUT][DB] Falha ao remover registro órfão:', dbErr.message);
    }

    return res.status(502).json({
      error: 'Falha ao criar preferência de pagamento. Tente novamente.',
    });
  }
});

// ── POST /api/v1/webhook ──────────────────────────────────────────────────────
app.post('/api/v1/webhook', async (req, res) => {
  const body = req.body;

  console.log(
    `[WEBHOOK] Notificação recebida → type=${body?.type} | data.id=${body?.data?.id}`
  );

  // Resposta imediata ao MP (evita timeout e retry)
  res.status(200).json({ received: true });

  if (body?.type !== 'payment' || !body?.data?.id) {
    console.log(`[WEBHOOK] Evento ignorado (type="${body?.type}").`);
    return;
  }

  const mpPaymentId = String(body.data.id);

  try {
    console.log(`[WEBHOOK] Consultando pagamento na API do MP → id=${mpPaymentId}`);
    const paymentData = await mpPayment.get({ id: mpPaymentId });

    console.log(
      `[WEBHOOK] Dados MP → id=${mpPaymentId} | status=${paymentData.status}`
    );

    if (paymentData.status !== 'approved') {
      console.log(`[WEBHOOK] Status "${paymentData.status}" — sem ação.`);
      return;
    }

    const metadata    = paymentData.metadata || {};
    const user_id     = metadata.user_id;
    const plano_dias  = metadata.plano_dias;
    const internal_id = metadata.internal_id;

    if (!user_id || !plano_dias || !internal_id) {
      console.error(`[WEBHOOK][ERROR] Metadata incompleto:`, JSON.stringify(metadata));
      return;
    }

    // Idempotência
    const existing = await dbGet(
      `SELECT id, status FROM payments WHERE id = ?`, [internal_id]
    );

    if (!existing) {
      console.error(`[WEBHOOK][ERROR] internal_id="${internal_id}" não encontrado no banco.`);
      return;
    }

    if (existing.status === 'approved') {
      console.warn(`[WEBHOOK] Notificação duplicada ignorada → internal_id="${internal_id}"`);
      return;
    }

    // Atualiza status no banco
    const updatedAt = new Date().toISOString();
    const result    = await dbRun(
      `UPDATE payments
          SET status        = 'approved',
              mp_payment_id = ?,
              updated_at    = ?
        WHERE id = ?
          AND status != 'approved'`,
      [mpPaymentId, updatedAt, internal_id]
    );

    if (result.changes === 0) {
      console.warn(`[WEBHOOK] UPDATE sem alteração → internal_id="${internal_id}"`);
      return;
    }

    console.log(`[WEBHOOK] Pagamento aprovado → internal_id=${internal_id}`);

    // ── Notifica o bot para ativar a assinatura ───────────────────────────
    try {
      await notifyBotActivation({
        userId:     user_id,
        planDays:   plano_dias,
        amount:     paymentData.transaction_amount,
        paymentRef: mpPaymentId,
      });
    } catch (botErr) {
      // Bot offline? Usa fallback direto via Telegram API
      console.warn(
        `[WEBHOOK] Bot inacessível (${botErr.message}). Usando fallback direto.`
      );
      try {
        await sendTelegramFallback(user_id, plano_dias);
      } catch (fbErr) {
        console.error('[WEBHOOK] Fallback Telegram também falhou:', fbErr.message);
      }
    }

    console.log(`[WEBHOOK] Fluxo concluído → internal_id=${internal_id} | user_id=${user_id}`);

  } catch (err) {
    console.error(
      `[WEBHOOK][ERROR] Falha ao processar pagamento ${mpPaymentId}: `,
      err?.response?.data || err?.message || err
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 8 — HANDLERS DE ERRO GLOBAIS
// ─────────────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR] Exceção não capturada no Express:', err.stack || err.message);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 9 — BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

const bootstrap = async () => {
  try {
    await initDatabase();

    const server = app.listen(PORT, () => {
      console.log('═══════════════════════════════════════════════════════');
      console.log(`  🚀  Servidor iniciado na porta ${PORT}`);
      console.log(`  🌍  Ambiente  : ${NODE_ENV}`);
      console.log(`  🔗  Frontend  : ${FRONTEND_URL}`);
      console.log(`  📡  Webhook   : ${BASE_URL}/api/v1/webhook`);
      console.log(`  🤖  Bot URL   : ${BOT_INTERNAL_URL}`);
      console.log('═══════════════════════════════════════════════════════');
    });

    const shutdown = (signal) => {
      console.log(`\n[SERVER] Sinal ${signal} recebido. Encerrando...`);
      server.close(() => {
        db.close((err) => {
          if (err) console.error('[DB] Erro ao fechar banco:', err.message);
          else     console.log('[DB] Banco de dados fechado com segurança.');
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[FATAL] Falha durante a inicialização do servidor:', err.message);
    process.exit(1);
  }
};

bootstrap();
