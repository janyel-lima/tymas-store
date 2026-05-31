/**
 * bot.js
 * Cria e configura a instância do Telegraf.
 * Registra middlewares, handlers de comandos e callbacks.
 * Exporta `bot` como singleton para uso em todo o projeto.
 */

const { Telegraf } = require('telegraf');
const { handleStart } = require('./handlers/startHandler');
const { handleCallback } = require('./handlers/callbackHandler');

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN não encontrado. Defina-o no arquivo .env');
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─────────────────────────────────────────────
// Middlewares globais
// ─────────────────────────────────────────────

/** Log de cada update recebido (desativável em produção via LOG_LEVEL) */
bot.use(async (ctx, next) => {
  const t0 = Date.now();
  const type = ctx.updateType ?? 'unknown';
  const from = ctx.from ? `@${ctx.from.username ?? ctx.from.id}` : 'unknown';

  await next();

  console.log(`[BOT] ${type} de ${from} processado em ${Date.now() - t0}ms`);
});

// ─────────────────────────────────────────────
// Comandos
// ─────────────────────────────────────────────

bot.start(handleStart);

// ─────────────────────────────────────────────
// Callback queries (botões inline)
// ─────────────────────────────────────────────

bot.on('callback_query', handleCallback);

// ─────────────────────────────────────────────
// Tratamento global de erros
// ─────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[BOT] ❌ Erro no update "${ctx.updateType}":`, err.message ?? err);
});

module.exports = { bot };
