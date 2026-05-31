'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  server.js — Backend de Assinaturas: Mercado Pago Checkout Pro + Telegram Bot
//  Stack: Node.js, Express, SQLite (sqlite3), Mercado Pago SDK v2, Axios
//  Melhorias: rate limiting, helmet, validação de assinatura MP, timezone SP,
//             sanitização de userId, logs com timestamp SP
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { formatInTimeZone } = require('date-fns-tz');

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 1 — CONSTANTES GLOBAIS
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'America/Sao_Paulo';

/** Retorna timestamp atual no fuso de SP (para logs e registros). */
const nowSP = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssxxx");

/** Formata uma Date para exibição no fuso de SP. */
const dateSP = date => formatInTimeZone(new Date(date), TZ, 'dd/MM/yyyy HH:mm');

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 2 — VARIÁVEIS DE AMBIENTE & VALIDAÇÃO NA INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const DB_PATH = process.env.DB_PATH || './data/payments.db';
const NODE_ENV = process.env.NODE_ENV || 'development';
const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://localhost:3001';
const API_SECRET = process.env.API_SECRET || '';

if (!MP_ACCESS_TOKEN) {
  console.error('[FATAL] Variável de ambiente MP_ACCESS_TOKEN não definida.');
  process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN) {
  console.warn('[WARN] TELEGRAM_BOT_TOKEN não definida. Fallback Telegram direto desativado.');
}

if (!MP_WEBHOOK_SECRET) {
  console.warn(
    '[WARN] MP_WEBHOOK_SECRET não definida. Validação de assinatura do webhook desativada.'
  );
}

if (!API_SECRET) {
  console.warn('[WARN] API_SECRET não definida. Comunicação com o bot sem autenticação!');
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 3 — MAPA DE PLANOS (única fonte de verdade de preços — server-side)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Record<number, { price: number, label: string }>} */
const PLAN_CATALOG = Object.freeze({
  7: { price: 30.0, label: '7 Dias' },
  14: { price: 50.0, label: '14 Dias' },
  30: { price: 100.0, label: '30 Dias' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 4 — CLIENTE MERCADO PAGO (SDK v2)
// ─────────────────────────────────────────────────────────────────────────────

const mpConfig = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 8000, idempotencyKey: undefined },
});

const mpPreference = new Preference(mpConfig);
const mpPayment = new Payment(mpConfig);

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 5 — BANCO DE DADOS SQLITE (wrappers assíncronos)
// ─────────────────────────────────────────────────────────────────────────────

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, err => {
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
//  SEÇÃO 6 — HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida a assinatura HMAC-SHA256 enviada pelo Mercado Pago no header x-signature.
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 *
 * @param {import('express').Request} req
 * @returns {boolean} true se válida (ou se MP_WEBHOOK_SECRET não está configurada)
 */
const validateMpSignature = req => {
  if (!MP_WEBHOOK_SECRET) return true; // validação desativada, aviso já emitido no boot

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature) {
    console.warn('[WEBHOOK] Header x-signature ausente.');
    return false;
  }

  // Formato: "ts=<timestamp>,v1=<hash>"
  const parts = Object.fromEntries(
    xSignature.split(',').map(part => part.split('=').map(s => s.trim()))
  );

  const ts = parts['ts'];
  const v1 = parts['v1'];

  if (!ts || !v1) {
    console.warn('[WEBHOOK] Header x-signature mal formatado.');
    return false;
  }

  const dataId = req.body?.data?.id ?? '';
  const manifest = `id:${dataId};request-id:${xRequestId ?? ''};ts:${ts};`;

  const expected = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  const valid = crypto.timingSafeEqual(Buffer.from(v1, 'utf8'), Buffer.from(expected, 'utf8'));

  if (!valid) {
    console.warn('[WEBHOOK] ⚠️  Assinatura inválida — possível requisição forjada.');
  }

  return valid;
};

/**
 * Sanitiza e valida o userId recebido do frontend.
 * IDs do Telegram são inteiros positivos de 5 a 15 dígitos.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
const sanitizeUserId = raw => {
  const str = String(raw ?? '')
    .trim()
    .replace(/\D/g, '');
  if (!str) return { ok: false, error: 'O campo "userId" é obrigatório.' };
  if (str.length < 5)
    return { ok: false, error: 'userId muito curto. Verifique seu ID do Telegram.' };
  if (str.length > 15)
    return { ok: false, error: 'userId muito longo. Verifique seu ID do Telegram.' };
  return { ok: true, value: str };
};

/**
 * Notifica o Bot via API interna para ativar a assinatura do usuário.
 */
const notifyBotActivation = async ({ userId, planDays, amount, paymentRef }) => {
  const url = `${BOT_INTERNAL_URL}/activate`;

  const payload = {
    userId: Number(userId),
    planDays: Number(planDays),
    amount: Number(amount) || 0,
    paymentRef: String(paymentRef),
  };

  const headers = {
    'Content-Type': 'application/json',
    ...(API_SECRET ? { 'X-Api-Secret': API_SECRET } : {}),
  };

  const response = await axios.post(url, payload, { timeout: 8000, headers });

  if (!response.data?.success) {
    throw new Error(`Bot retornou sucesso=false: ${JSON.stringify(response.data)}`);
  }

  console.log(`[BOT-NOTIFY] Assinatura ativada via bot → userId=${userId} | plano=${planDays}d`);
  return response.data;
};

/**
 * Fallback: envia mensagem direta via Telegram API caso o bot esteja offline.
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

  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    { chat_id: String(chatId), text, parse_mode: 'HTML' },
    { timeout: 6000 }
  );

  console.log(`[TELEGRAM-FALLBACK] Mensagem direta enviada → chat_id=${chatId}`);
};

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 7 — EXPRESS APP & MIDDLEWARES
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// ── Segurança: headers HTTP ───────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── Arquivos estáticos (sucesso/falha/pendente) ───────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'].filter(
  Boolean
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS bloqueado para origem: ${origin}`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200,
  })
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ── Rate Limiters ─────────────────────────────────────────────────────────────

// Checkout: 5 tentativas por IP a cada 15 minutos
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de checkout. Aguarde 15 minutos e tente novamente.' },
  skip: req => NODE_ENV === 'development', // desativa em dev para não atrapalhar testes
});

// Webhook: 120 por minuto (MP pode reenviar várias vezes)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit excedido no webhook.' },
});

// ── Log de requisições com timezone SP ───────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[REQ] ${nowSP()} | ${req.method} ${req.originalUrl} | IP: ${req.ip}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEÇÃO 8 — ROTAS
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    env: NODE_ENV,
    timestamp: nowSP(),
    timezone: TZ,
  });
});

// ── POST /api/v1/checkout ─────────────────────────────────────────────────────
app.post('/api/v1/checkout', checkoutLimiter, async (req, res) => {
  const { userId, plano } = req.body;

  // Sanitiza e valida userId
  const userIdResult = sanitizeUserId(userId);
  if (!userIdResult.ok) {
    return res.status(400).json({ error: userIdResult.error });
  }
  const safeUserId = userIdResult.value;

  // Valida plano
  const planoInt = parseInt(plano, 10);
  const planEntry = PLAN_CATALOG[planoInt];
  if (!planEntry) {
    return res.status(400).json({
      error: 'Plano inválido. Os valores aceitos são: 7, 14 ou 30.',
    });
  }

  const id = uuidv4();
  const now = nowSP();

  try {
    await dbRun(
      `INSERT INTO payments (id, user_id, plano, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [id, safeUserId, planoInt, now, now]
    );

    console.log(
      `[CHECKOUT] Registro criado → id=${id} | userId=${safeUserId} | plano=${planoInt}d`
    );

    const preferenceBody = {
      items: [
        {
          id,
          title: `Assinatura ${planEntry.label}`,
          description: `Acesso premium por ${planoInt} dias via Telegram`,
          quantity: 1,
          unit_price: planEntry.price,
          currency_id: 'BRL',
        },
      ],
      metadata: {
        user_id: safeUserId,
        plano_dias: planoInt,
        internal_id: id,
      },
      back_urls: {
        success: `${FRONTEND_URL}/sucesso?userId=${safeUserId}&plano=${planoInt}${TELEGRAM_BOT_USERNAME ? `&bot=${encodeURIComponent(TELEGRAM_BOT_USERNAME)}` : ''}`,
        failure: `${BACKEND_URL}/falha`,
        pending: `${BACKEND_URL}/pendente`,
      },
      auto_return: 'approved',
      external_reference: id,
      notification_url: `${BACKEND_URL}/api/v1/webhook`,
      statement_descriptor: 'ASSINATURA BOT',
    };

    const preference = await mpPreference.create({ body: preferenceBody });

    console.log(`[CHECKOUT] Preferência MP criada → prefId=${preference.id}`);

    return res.status(201).json({
      success: true,
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
app.post('/api/v1/webhook', webhookLimiter, async (req, res) => {
  const body = req.body;

  console.log(`[WEBHOOK] Notificação recebida → type=${body?.type} | data.id=${body?.data?.id}`);

  // Responde 200 imediatamente (exigência do MP — timeout de 5s)
  res.status(200).json({ received: true });

  // Valida assinatura HMAC do Mercado Pago
  if (!validateMpSignature(req)) {
    console.warn('[WEBHOOK] Requisição rejeitada por assinatura inválida.');
    return;
  }

  if (body?.type !== 'payment' || !body?.data?.id) {
    console.log(`[WEBHOOK] Evento ignorado (type="${body?.type}").`);
    return;
  }

  const mpPaymentId = String(body.data.id);

  try {
    console.log(`[WEBHOOK] Consultando pagamento na API do MP → id=${mpPaymentId}`);
    const paymentData = await mpPayment.get({ id: mpPaymentId });

    console.log(`[WEBHOOK] Dados MP → id=${mpPaymentId} | status=${paymentData.status}`);

    if (paymentData.status !== 'approved') {
      console.log(`[WEBHOOK] Status "${paymentData.status}" — sem ação.`);
      return;
    }

    const metadata = paymentData.metadata || {};
    const user_id = metadata.user_id;
    const plano_dias = metadata.plano_dias;
    const internal_id = metadata.internal_id;

    if (!user_id || !plano_dias || !internal_id) {
      console.error(`[WEBHOOK][ERROR] Metadata incompleto:`, JSON.stringify(metadata));
      return;
    }

    const existing = await dbGet(`SELECT id, status FROM payments WHERE id = ?`, [internal_id]);

    if (!existing) {
      console.error(`[WEBHOOK][ERROR] internal_id="${internal_id}" não encontrado no banco.`);
      return;
    }

    if (existing.status === 'approved') {
      console.warn(`[WEBHOOK] Notificação duplicada ignorada → internal_id="${internal_id}"`);
      return;
    }

    const updatedAt = nowSP();
    const result = await dbRun(
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

    console.log(`[WEBHOOK] Pagamento aprovado → internal_id=${internal_id} | ${nowSP()}`);

    try {
      await notifyBotActivation({
        userId: user_id,
        planDays: plano_dias,
        amount: paymentData.transaction_amount,
        paymentRef: mpPaymentId,
      });
    } catch (botErr) {
      console.warn(`[WEBHOOK] Bot inacessível (${botErr.message}). Usando fallback direto.`);
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
//  SEÇÃO 9 — HANDLERS DE ERRO GLOBAIS
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
//  SEÇÃO 10 — BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

const bootstrap = async () => {
  try {
    await initDatabase();

    const server = app.listen(PORT, () => {
      console.log('═══════════════════════════════════════════════════════');
      console.log(`  🚀  Servidor iniciado na porta ${PORT}`);
      console.log(`  🌍  Ambiente   : ${NODE_ENV}`);
      console.log(`  🕐  Timezone   : ${TZ}`);
      console.log(`  🕐  Hora SP    : ${nowSP()}`);
      console.log(`  🔗  Frontend   : ${FRONTEND_URL}`);
      console.log(`  📡  Webhook    : ${BACKEND_URL}/api/v1/webhook`);
      console.log(`  🤖  Bot URL    : ${BOT_INTERNAL_URL}`);
      console.log(`  🆔  Bot User   : ${TELEGRAM_BOT_USERNAME || '(não configurado)'}`);
      console.log(`  🔐  MP Sig     : ${MP_WEBHOOK_SECRET ? '✅ ativa' : '⚠️  desativada'}`);
      console.log('═══════════════════════════════════════════════════════');
    });

    const shutdown = signal => {
      console.log(`\n[SERVER] Sinal ${signal} recebido. Encerrando...`);
      server.close(() => {
        db.close(err => {
          if (err) console.error('[DB] Erro ao fechar banco:', err.message);
          else console.log('[DB] Banco de dados fechado com segurança.');
          process.exit(0);
        });
      });

      // Força encerramento após 10s se algo travar
      setTimeout(() => {
        console.error('[SERVER] Forçando encerramento após timeout.');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[FATAL] Falha durante a inicialização do servidor:', err.message);
    process.exit(1);
  }
};

bootstrap();
