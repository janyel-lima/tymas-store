/**
 * handlers/callbackHandler.js
 * Gerencia todos os callbacks de botões inline do bot:
 *  - Seleção de plano (plan_7 | plan_14 | plan_30)
 *  - Verificação de status (check_status)
 *  - Retorno ao menu principal (back_menu)
 */

const { getSubscription } = require('../database');
const { PLANS, getMainMenuKeyboard, getPaymentKeyboard } = require('../keyboards');
const { escape } = require('../utils/markdown');

/**
 * Handler principal de callback_query.
 * @param {import('telegraf').Context} ctx
 */
async function handleCallback(ctx) {
  // Encerra o estado "carregando" no botão do Telegram
  await ctx.answerCbQuery().catch(() => {});

  const data   = ctx.callbackQuery?.data;
  const userId = ctx.from.id;

  if (!data) return;

  if (data === 'check_status') return handleStatusCheck(ctx, userId);
  if (data === 'back_menu')    return handleBackMenu(ctx);

  const plan = PLANS.find((p) => p.callbackData === data);
  if (plan) return handlePlanSelection(ctx, userId, plan);
}

// ─────────────────────────────────────────────
// Handlers internos
// ─────────────────────────────────────────────

/**
 * Exibe os detalhes do plano selecionado e o link de pagamento.
 */
async function handlePlanSelection(ctx, userId, plan) {
  const text = [
    `📦 *Plano Selecionado: ${escape(plan.label)}*`,
    '',
    `Você escolheu o plano de *${plan.days} dias*\\.`,
    'Clique no botão abaixo para ser redirecionado à nossa',
    'página de pagamento segura\\.',
    '',
    '_✅ Após a confirmação do pagamento, seu acesso_',
    '_será ativado automaticamente\\._',
  ].join('\n');

  await safeEditMessage(ctx, text, getPaymentKeyboard(userId, plan.days));
}

/**
 * Verifica o status da assinatura do usuário no banco e exibe.
 */
async function handleStatusCheck(ctx, userId) {
  const sub = getSubscription(userId);

  // Sem assinatura ativa
  if (!sub || sub.status !== 'active') {
    const text = [
      '⛔ *Nenhum Plano Ativo*',
      '',
      'Você ainda não possui uma assinatura ativa\\.',
      'Escolha um dos planos abaixo para liberar seu acesso\\:',
    ].join('\n');

    return safeEditMessage(ctx, text, getMainMenuKeyboard());
  }

  // Calcula dias restantes
  const expiresAt  = new Date(sub.expires_at);
  const now        = new Date();
  const diffMs     = expiresAt - now;
  const diffDays   = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const expiresFmt = expiresAt.toLocaleDateString('pt-BR', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });

  const diasLabel = diffDays === 1 ? 'dia' : 'dias';

  const text = [
    '✅ *Assinatura Ativa*',
    '',
    `*📦 Plano:*          ${escape(sub.plan_days)} dias`,
    `*📅 Expira em:*      ${escape(expiresFmt)}`,
    `*⏳ Dias restantes:* ${escape(diffDays)} ${diasLabel}`,
    '',
    '_Para renovar seu plano antes do vencimento,_',
    '_use /start e selecione um novo plano\\._',
  ].join('\n');

  await safeEditMessage(ctx, text);
}

/**
 * Retorna ao menu principal.
 */
async function handleBackMenu(ctx) {
  const text = [
    '✨ *Menu Principal* ✨',
    '',
    'Selecione um plano ou verifique sua assinatura\\:',
  ].join('\n');

  await safeEditMessage(ctx, text, getMainMenuKeyboard());
}

// ─────────────────────────────────────────────
// Utilitário interno
// ─────────────────────────────────────────────

/**
 * Edita a mensagem atual com tratamento de erros do Telegram.
 * Ignora o erro "message is not modified" (conteúdo idêntico).
 */
async function safeEditMessage(ctx, text, keyboard = null) {
  try {
    const opts = { parse_mode: 'MarkdownV2' };
    if (keyboard) Object.assign(opts, keyboard);
    await ctx.editMessageText(text, opts);
  } catch (err) {
    // Telegram retorna este erro quando o conteúdo não muda — ignorar.
    if (err.message?.includes('message is not modified')) return;
    // Se a mensagem original não puder ser editada, envia uma nova.
    if (err.message?.includes('message to edit not found')) {
      const opts = { parse_mode: 'MarkdownV2' };
      if (keyboard) Object.assign(opts, keyboard);
      await ctx.reply(text, opts);
      return;
    }
    throw err;
  }
}

module.exports = { handleCallback };
