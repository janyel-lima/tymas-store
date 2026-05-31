/**
 * handlers/startHandler.js
 * Responsável pelo comando /start:
 * - Registra/atualiza o usuário no banco
 * - Envia mensagem de boas-vindas elegante com o menu de planos
 */

const { upsertUser } = require('../database');
const { getMainMenuKeyboard } = require('../keyboards');
const { escape } = require('../utils/markdown');

/**
 * Handler do comando /start.
 * @param {import('telegraf').Context} ctx
 */
async function handleStart(ctx) {
  const { id: userId, username, first_name, last_name } = ctx.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');

  // Persiste / atualiza o usuário no banco (idempotente)
  upsertUser(userId, username ?? null, fullName);

  const firstName = escape(first_name);

  const welcomeText = [
    `✨ *Bem\\-vindo\\(a\\), ${firstName}\\!* ✨`,
    '',
    'Olá\\! Você chegou ao painel de assinaturas\\.',
    'Aqui você pode adquirir ou gerenciar o seu acesso à nossa plataforma\\.',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '*🚀 Planos Disponíveis:*',
    '',
    '🟢 *7 dias*  — Ideal para experimentar',
    '🔵 *14 dias* — Acesso estendido',
    '🟣 *30 dias* — Melhor custo\\-benefício',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '_Selecione uma opção abaixo para começar:_',
  ].join('\n');

  await ctx.replyWithMarkdownV2(welcomeText, getMainMenuKeyboard());
}

module.exports = { handleStart };
