'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  server.js — Backend de Assinaturas: Mercado Pago Checkout Pro + Telegram Bot
//  Stack: Node.js, Express, SQLite (sqlite3), Mercado Pago SDK v2, Axios
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
  FRONTEND_URL      = 'https://seu-frontend.com',
  BASE_URL          = 'https://seu-backend.com',
  DB_PATH           = './payments.db',
  NODE_ENV          = 'development',
} = process.env;

// Falha rápida: sem credenciais, sem serviço.
if (!MP_ACCESS_TOKEN) {
  console.error('[FATAL] Variável de ambiente MP_ACCESS_TOKEN não definida.');
  process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN) {
  console.error('[FATAL] Variável de ambiente TELEGRAM_BOT_TOKEN não definida.');
  process.exit(1);
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

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB][FATAL] Falha ao abrir o banco SQLite:', err.message);
    process.exit(1);
  }
  console.log(`[DB] Banco de dados SQLite conectado em: ${DB_PATH}`);
});

// WAL mode — melhor performance para múltiplas gravações
db.run('PRAGMA journal_mode = WAL;');

/**
 * Executa uma instrução SQL de escrita (INSERT, UPDATE, DELETE, CREATE).
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<sqlite3.RunResult>}
 */
const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) return reject(err);
      resolve(this); // `this` contém lastID e changes
    });
  });

/**
 * Retorna uma única linha do banco de dados.
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<object | undefined>}
 */
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

/**
 * Cria as tabelas necessárias caso ainda não existam.
 */
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

  // Índice para acelerar buscas por user_id no futuro
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
 * Envia uma mensagem de texto para um usuário via Telegram Bot API.
 * @param {string|number} chatId  — ID do chat / user_id do Telegram
 * @param {string}        text    — Mensagem em HTML
 */
const sendTelegramMessage = async (chatId, text) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id:    String(chatId),
    text,
    parse_mode: 'HTML',
  };

  const response = await axios.post(url, payload, {
    timeout: 6000,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.data?.ok) {
    throw new Error(`Telegram retornou ok=false: ${JSON.stringify(response.data)}`);
  }

  console.log(`[TELEGRAM] Mensagem enviada com sucesso → chat_id=${chatId}`);
  return response.data;
};

/**
 * Formata a mensagem de confirmação de pagamento ao usuário.
 * @param {string|number} plano_dias
 */
const buildApprovalMessage = (plano_dias) => {
  const plan = PLAN_CATALOG[parseInt(plano_dias, 10)];
  const label = plan ? plan.label : `${plano_dias} dias`;

  return (
    `✅ <b>Pagamento Aprovado!</b>\n\n` +
    `Seu plano <b>${label}</b> foi ativado com sucesso!\n\n` +
    `🔓 <b>Acesso liberado imediatamente.</b>\n` +
    `📅 Duração: <b>${plano_dias} dias</b>\n\n` +
    `Obrigado pela sua assinatura. Aproveite ao máximo! 🚀`
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 6 — EXPRESS APP & MIDDLEWARES
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Serve páginas estáticas de /public (sucesso, falha, pendente)
app.use(express.static(path.join(__dirname, 'public')));

// CORS — permite apenas o frontend declarado no .env
app.use(cors({
  origin:         FRONTEND_URL,
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200,
}));

// Parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Logger de requisições
app.use((req, _res, next) => {
  console.log(
    `[REQ] ${new Date().toISOString()} | ${req.method} ${req.originalUrl} | ` +
    `IP: ${req.ip}`
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
/**
 * Cria uma preferência de pagamento no Mercado Pago e retorna o link do checkout.
 *
 * Body esperado: { "userId": "123456789", "plano": 30 }
 */
app.post('/api/v1/checkout', async (req, res) => {
  const { userId, plano } = req.body;

  // ── Validação de entrada ──────────────────────────────────────────────────

  if (!userId || String(userId).trim() === '') {
    console.warn('[CHECKOUT] Requisição sem userId.');
    return res.status(400).json({ error: 'O campo "userId" é obrigatório.' });
  }

  const planoInt  = parseInt(plano, 10);
  const planEntry = PLAN_CATALOG[planoInt];

  if (!planEntry) {
    console.warn(`[CHECKOUT] Plano inválido recebido: "${plano}". userId=${userId}`);
    return res.status(400).json({
      error: 'Plano inválido. Os valores aceitos são: 7, 14 ou 30.',
    });
  }

  const safeUserId = String(userId).trim();
  const id         = uuidv4();
  const now        = new Date().toISOString();

  try {
    // ── 1. Persistir no banco com status 'pending' ────────────────────────

    await dbRun(
      `INSERT INTO payments (id, user_id, plano, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [id, safeUserId, planoInt, now, now]
    );

    console.log(
      `[CHECKOUT] Registro criado → id=${id} | userId=${safeUserId} | ` +
      `plano=${planoInt}d | valor=R$${planEntry.price}`
    );

    // ── 2. Montar e enviar preferência ao Mercado Pago ────────────────────

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
      // Metadados injetados pelo backend — NUNCA pelo cliente
      metadata: {
        user_id:     safeUserId,
        plano_dias:  planoInt,
        internal_id: id,
      },
      back_urls: {
        success: `${FRONTEND_URL}/sucesso`,
        failure: `${FRONTEND_URL}/falha`,
        pending: `${FRONTEND_URL}/pendente`,
      },
      auto_return:       'approved',
      external_reference: id,
      // URL de notificação registrada diretamente na preferência
      notification_url:  `${BASE_URL}/api/v1/webhook`,
      statement_descriptor: 'ASSINATURA BOT',
    };

    const preference = await mpPreference.create({ body: preferenceBody });

    console.log(
      `[CHECKOUT] Preferência MP criada → prefId=${preference.id} | ` +
      `init_point=${preference.init_point}`
    );

    // ── 3. Retornar link do checkout ──────────────────────────────────────

    return res.status(201).json({
      success:    true,
      payment_id: id,
      init_point: preference.init_point,
    });

  } catch (err) {
    // Distingue erros do MP de erros internos no log
    const mpError = err?.cause?.message || err?.message || 'Erro desconhecido';
    console.error(`[CHECKOUT][ERROR] id=${id} | Erro: ${mpError}`);

    // Remove registro órfão em caso de falha do MP
    try {
      await dbRun(`DELETE FROM payments WHERE id = ? AND status = 'pending'`, [id]);
      console.warn(`[CHECKOUT] Registro órfão id=${id} removido do banco.`);
    } catch (dbErr) {
      console.error('[CHECKOUT][DB] Falha ao remover registro órfão:', dbErr.message);
    }

    return res.status(502).json({
      error: 'Falha ao criar preferência de pagamento. Tente novamente.',
    });
  }
});

// ── POST /api/v1/webhook ──────────────────────────────────────────────────────
/**
 * Recebe notificações IPN do Mercado Pago.
 * Responde 200 imediatamente e processa de forma assíncrona para
 * evitar retentativas desnecessárias por parte do MP.
 */
app.post('/api/v1/webhook', async (req, res) => {
  const body = req.body;

  console.log(
    `[WEBHOOK] Notificação recebida → type=${body?.type} | ` +
    `data.id=${body?.data?.id} | action=${body?.action}`
  );

  // ── Resposta imediata ao Mercado Pago (evita timeout e retry) ─────────
  res.status(200).json({ received: true });

  // ── Filtra apenas eventos de pagamento com ID válido ──────────────────
  if (body?.type !== 'payment' || !body?.data?.id) {
    console.log(`[WEBHOOK] Evento ignorado (type="${body?.type}"). Nenhuma ação necessária.`);
    return;
  }

  const mpPaymentId = String(body.data.id);

  try {
    // ── 1. Consulta segura na API do Mercado Pago (server-to-server) ──────
    //    NUNCA confie nos dados da notificação — sempre busque na API.

    console.log(`[WEBHOOK] Consultando pagamento na API do MP → id=${mpPaymentId}`);
    const paymentData = await mpPayment.get({ id: mpPaymentId });

    console.log(
      `[WEBHOOK] Dados retornados pelo MP → id=${mpPaymentId} | ` +
      `status=${paymentData.status} | amount=${paymentData.transaction_amount}`
    );

    // ── 2. Processa apenas pagamentos 'approved' ──────────────────────────

    if (paymentData.status !== 'approved') {
      console.log(
        `[WEBHOOK] Pagamento ${mpPaymentId} com status="${paymentData.status}". ` +
        `Nenhuma ação tomada.`
      );
      return;
    }

    // ── 3. Extrai e valida metadata injetado pelo nosso backend ───────────

    const metadata    = paymentData.metadata || {};
    // O MP converte camelCase para snake_case automaticamente
    const user_id     = metadata.user_id;
    const plano_dias  = metadata.plano_dias;
    const internal_id = metadata.internal_id;

    if (!user_id || !plano_dias || !internal_id) {
      console.error(
        `[WEBHOOK][ERROR] Metadata incompleto no pagamento ${mpPaymentId}:`,
        JSON.stringify(metadata)
      );
      return;
    }

    console.log(
      `[WEBHOOK] Metadata extraído → internal_id=${internal_id} | ` +
      `user_id=${user_id} | plano_dias=${plano_dias}`
    );

    // ── 4. Guarda de idempotência — evita processar o mesmo pagamento 2x ──

    const existing = await dbGet(
      `SELECT id, status FROM payments WHERE id = ?`,
      [internal_id]
    );

    if (!existing) {
      console.error(
        `[WEBHOOK][ERROR] internal_id="${internal_id}" não encontrado no banco. ` +
        `Possível pagamento fora do fluxo normal.`
      );
      return;
    }

    if (existing.status === 'approved') {
      console.warn(
        `[WEBHOOK] Pagamento internal_id="${internal_id}" já estava aprovado. ` +
        `Notificação duplicada ignorada.`
      );
      return;
    }

    // ── 5. Atualiza status no SQLite ──────────────────────────────────────

    const updatedAt = new Date().toISOString();
    const result    = await dbRun(
      `UPDATE payments
          SET status        = 'approved',
              mp_payment_id = ?,
              updated_at    = ?
        WHERE id = ?
          AND status != 'approved'`,  // cláusula extra de segurança
      [mpPaymentId, updatedAt, internal_id]
    );

    if (result.changes === 0) {
      console.warn(
        `[WEBHOOK] UPDATE não afetou linhas para internal_id="${internal_id}". ` +
        `Pode ser concorrência — ignorando.`
      );
      return;
    }

    console.log(
      `[WEBHOOK] Banco atualizado → internal_id=${internal_id} | ` +
      `status=approved | mp_payment_id=${mpPaymentId}`
    );

    // ── 6. Notifica o usuário via Telegram ────────────────────────────────

    const message = buildApprovalMessage(plano_dias);
    await sendTelegramMessage(user_id, message);

    console.log(
      `[WEBHOOK] Fluxo concluído com sucesso → ` +
      `internal_id=${internal_id} | user_id=${user_id}`
    );

  } catch (err) {
    // Erro não crítico após o 200 já ter sido enviado — apenas loga.
    console.error(
      `[WEBHOOK][ERROR] Falha ao processar pagamento ${mpPaymentId}: `,
      err?.response?.data || err?.message || err
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 8 — HANDLERS DE ERRO GLOBAIS
// ─────────────────────────────────────────────────────────────────────────────

// 404 — Rota não encontrada
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// 500 — Erro não tratado em middlewares
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
      console.log('═══════════════════════════════════════════════════════');
    });

    // Graceful shutdown
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
