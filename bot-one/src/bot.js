/**
 * bot.js
 * Cria e configura a instância do Telegraf.
 * Registra middlewares, handlers de comandos e callbacks.
 * Exporta `bot` como singleton para uso em todo o projeto.
 */

const { Telegraf } = require('telegraf');
const { formatInTimeZone } = require('date-fns-tz');
const { handleStart } = require('./handlers/startHandler');
const { handleCallback } = require('./handlers/callbackHandler');
const { getSubscription } = require('./database');

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN não encontrado. Defina-o no arquivo .env');
}

const TZ = 'America/Sao_Paulo';
const nowSP = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssxxx");
const dateSP = date => formatInTimeZone(new Date(date), TZ, 'dd/MM/yyyy HH:mm');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─────────────────────────────────────────────
// Mapa de entradas pendentes de confirmação
// userId → { expiresAt, planDays, registeredAt }
// ─────────────────────────────────────────────
const pendingConfirmations = new Map();

/**
 * Registra um userId como aguardando entrada no canal.
 * Chamado pelo /activate após gerar o link.
 * @param {number|string} userId
 * @param {{ expiresAt: Date, planDays: number }} param1
 */
function registerPendingEntry(userId, { expiresAt, planDays }) {
  pendingConfirmations.set(Number(userId), {
    expiresAt,
    planDays,
    registeredAt: new Date(),
  });

  console.log(
    `[BOT] ⏳ Entrada pendente registrada → userId=${userId} | expira=${dateSP(expiresAt)}`
  );

  // Remove da lista após 30 minutos se o usuário não entrar
  setTimeout(
    () => {
      if (pendingConfirmations.has(Number(userId))) {
        pendingConfirmations.delete(Number(userId));
        console.log(
          `[BOT] ⏰ Confirmação pendente expirou (30min) → userId=${userId} | ${nowSP()}`
        );
      }
    },
    30 * 60 * 1000
  );
}

// ─────────────────────────────────────────────
// Middlewares globais
// ─────────────────────────────────────────────

bot.use(async (ctx, next) => {
  const t0 = Date.now();
  const type = ctx.updateType ?? 'unknown';
  const from = ctx.from ? `@${ctx.from.username ?? ctx.from.id}` : 'unknown';

  await next();

  console.log(`[BOT] ${nowSP()} | ${type} de ${from} processado em ${Date.now() - t0}ms`);
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
// Detecta entrada no canal e valida o usuário
// ─────────────────────────────────────────────

bot.on('chat_member', async ctx => {
  const update = ctx.update.chat_member;
  const GROUP_ID = process.env.GROUP_ID;

  if (!GROUP_ID || String(update.chat.id) !== String(GROUP_ID)) return;

  const newMember = update.new_chat_member;
  const oldMember = update.old_chat_member;

  const entrou = oldMember.status === 'left' || oldMember.status === 'kicked';
  const agora = newMember.status === 'member';

  if (!entrou || !agora) return;

  const userId = newMember.user.id;
  const firstName = newMember.user.first_name ?? 'usuário';
  const escapedName = firstName.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

  console.log(`[BOT] 👤 Entrada no canal detectada → userId=${userId} | ${nowSP()}`);

  // ── Valida se é o usuário esperado ──────────────────────
  const pending = pendingConfirmations.get(Number(userId));

  if (!pending) {
    console.warn(`[BOT] ⚠️ Entrada não esperada → userId=${userId}. Removendo do canal.`);
    try {
      await ctx.telegram.banChatMember(GROUP_ID, userId);
      await ctx.telegram.unbanChatMember(GROUP_ID, userId);
      console.log(`[BOT] ⛔ userId=${userId} removido (entrada sem pagamento).`);
    } catch (err) {
      console.warn(`[BOT] Falha ao remover entrada indevida:`, err.message);
    }
    return;
  }

  // ── Valida assinatura ativa no banco ─────────────────────
  const sub = getSubscription(userId);

  if (!sub || sub.status !== 'active') {
    console.warn(`[BOT] ⚠️ Usuário sem assinatura ativa → userId=${userId}. Removendo.`);
    try {
      await ctx.telegram.banChatMember(GROUP_ID, userId);
      await ctx.telegram.unbanChatMember(GROUP_ID, userId);
    } catch (err) {
      console.warn(`[BOT] Falha ao remover:`, err.message);
    }
    pendingConfirmations.delete(Number(userId));
    return;
  }

  // ── Tudo certo — confirma entrada ───────────────────────
  pendingConfirmations.delete(Number(userId));

  const expiresFmt = dateSP(pending.expiresAt).replace(/\//g, '\\/').replace(':', '\\:');

  console.log(
    `[BOT] ✅ Entrada confirmada → userId=${userId} | expira=${dateSP(pending.expiresAt)}`
  );

  try {
    await ctx.telegram.sendMessage(
      userId,
      [
        '✅ *Acesso confirmado\\!*',
        '',
        `Bem\\-vindo\\(a\\) ao canal, ${escapedName}\\!`,
        '',
        `*📅 Seu acesso é válido até:* ${expiresFmt}`,
        '',
        '_Quando sua assinatura expirar, você será removido_',
        '_automaticamente e notificado aqui\\._',
      ].join('\n'),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (err) {
    console.warn(`[BOT] Falha ao enviar confirmação para ${userId}:`, err.message);
  }
});

// ─────────────────────────────────────────────
// Tratamento global de erros
// ─────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[BOT] ❌ ${nowSP()} | Erro no update "${ctx.updateType}":`, err.message ?? err);
});

module.exports = { bot, registerPendingEntry };
