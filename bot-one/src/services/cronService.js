/**
 * services/cronService.js
 * Rotina agendada (cron) que:
 *  1. Roda diariamente à meia-noite (fuso America/Sao_Paulo)
 *  2. Encontra assinaturas com status 'active' e expires_at vencido
 *  3. Marca cada uma como 'expired' no banco
 *  4. Envia mensagem privada ao usuário notificando o vencimento
 */

const cron = require('node-cron');
const { getExpiredSubscriptions, expireSubscription } = require('../database');
const { getRenewKeyboard } = require('../keyboards');

/**
 * Inicializa o cron job de expiração de assinaturas.
 * @param {import('telegraf').Telegraf} bot — instância do bot para envio de mensagens
 */
function startCronJob(bot) {
  // Expressão cron: "0 0 * * *" → toda meia-noite
  const task = cron.schedule(
    '0 0 * * *',
    async () => runExpirationCheck(bot),
    { timezone: 'America/Sao_Paulo' }
  );

  console.log('✅ Cron de expiração agendado: todo dia às 00:00 (America/Sao_Paulo)');

  // Executa imediatamente na inicialização para cobrir qualquer gap
  runExpirationCheck(bot);

  return task;
}

/**
 * Lógica principal da verificação — também exportada para testes ou
 * chamadas manuais via endpoint de admin.
 * @param {import('telegraf').Telegraf} bot
 */
async function runExpirationCheck(bot) {
  const timestamp = new Date().toISOString();
  console.log(`[CRON] ${timestamp} — Iniciando verificação de assinaturas expiradas...`);

  let expired;
  try {
    expired = getExpiredSubscriptions();
  } catch (err) {
    console.error('[CRON] Erro ao consultar assinaturas expiradas:', err.message);
    return;
  }

  if (expired.length === 0) {
    console.log('[CRON] Nenhuma assinatura expirada encontrada.');
    return;
  }

  console.log(`[CRON] ${expired.length} assinatura(s) a processar.`);

  const expirationMessage = [
    '⚠️ *Sua assinatura expirou\\!*',
    '',
    'Para continuar utilizando nossos serviços, renove',
    'seu plano usando uma das opções abaixo\\:',
  ].join('\n');

  for (const sub of expired) {
    try {
      // 1. Atualiza status no banco ANTES de notificar (evita re-notificação em falha)
      expireSubscription(sub.user_id);

      // 2. Envia mensagem privada ao usuário
      await bot.telegram.sendMessage(
        sub.user_id,
        expirationMessage,
        {
          parse_mode:  'MarkdownV2',
          ...getRenewKeyboard(),
        }
      );

      console.log(`[CRON] Usuário ${sub.user_id} notificado. Status → expired.`);

    } catch (err) {
      // Erros comuns: usuário bloqueou o bot (403), chat não encontrado (400).
      // Não reverter o status — assinatura continua expirada mesmo sem notificação.
      console.warn(
        `[CRON] Não foi possível notificar usuário ${sub.user_id}:`,
        err.message
      );
    }
  }

  console.log(`[CRON] Verificação concluída. Processados: ${expired.length} usuário(s).`);
}

module.exports = { startCronJob, runExpirationCheck };
