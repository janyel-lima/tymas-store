/**
 * bot.js
 * Cria e configura a instância do Telegraf.
 */

const { Telegraf } = require('telegraf');
const { handleStart } = require('./handlers/startHandler');
const { handleCallback } = require('./handlers/callbackHandler');
const { getSubscription } = require('./database');

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN não encontrado. Defina-o no arquivo .env');
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─────────────────────────────────────────────
// Mapa de entradas pendentes de confirmação
// userId → { expiresAt, planDays, confirmedAt }
// ─────────────────────────────────────────────
const pendingConfirmations = new Map();

/**
 * Registra um userId como aguardando entrada no canal.
 * Chamado pelo /activate após gerar o link.
 */
function registerPendingEntry(userId, { expiresAt, planDays }) {
  pendingConfirmations.set(Number(userId), {
    expiresAt,
    planDays,
    registeredAt: new Date(),
  });

  // Remove da lista após 30 minutos se o usuário não entrar
  setTimeout(
    () => {
      if (pendingConfirmations.has(Number(userId))) {
        pendingConfirmations.delete(Number(userId));
        console.log(`[BOT] ⏰ Confirmação pendente expirou → userId=${userId}`);
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
  console.log(`[BOT] ${type} de ${from} processado em ${Date.now() - t0}ms`);
});

// ─────────────────────────────────────────────
// Comandos
// ─────────────────────────────────────────────

bot.start(handleStart);

// ─────────────────────────────────────────────
// Callback queries
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

  console.log(`[BOT] 👤 Entrada no canal detectada → userId=${userId}`);

  // ── Valida se é o usuário esperado ──────────────────────
  const pending = pendingConfirmations.get(Number(userId));

  if (!pending) {
    // Entrou sem ser esperado — pode ser acesso indevido
    console.warn(`[BOT] ⚠️ Entrada não esperada → userId=${userId}. Removendo do canal.`);
    try {
      await ctx.telegram.banChatMember(GROUP_ID, userId);
      await ctx.telegram.unbanChatMember(GROUP_ID, userId);
    } catch (err) {
      console.warn(`[BOT] Falha ao remover entrada indevida:`, err.message);
    }
    return;
  }

  // ── Valida assinatura no banco ───────────────────────────
  const sub = getSubscription(userId);

  if (!sub || sub.status !== 'active') {
    console.warn(`[BOT] ⚠️ Usuário sem assinatura ativa entrou → userId=${userId}. Removendo.`);
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

  const expiresFmt = pending.expiresAt.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  console.log(
    `[BOT] ✅ Entrada confirmada → userId=${userId} | expira=${pending.expiresAt.toISOString()}`
  );

  try {
    await ctx.telegram.sendMessage(
      userId,
      [
        '✅ *Acesso confirmado\\!*',
        '',
        `Bem\\-vindo\\(a\\) ao canal, ${escapedName}\\!`,
        '',
        `*📅 Seu acesso é válido até:* ${expiresFmt.replace(/\//g, '\\/')}`,
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
  console.error(`[BOT] ❌ Erro no update "${ctx.updateType}":`, err.message ?? err);
});

module.exports = { bot, registerPendingEntry };
