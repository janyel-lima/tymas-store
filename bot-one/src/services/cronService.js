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
  const task = cron.schedule('0 0 * * *', async () => runExpirationCheck(bot), {
    timezone: 'America/Sao_Paulo',
  });

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
      // 1. Atualiza status no banco
      expireSubscription(sub.user_id);

      // 2. Remove do canal
      const GROUP_ID = process.env.GROUP_ID;
      if (GROUP_ID) {
        try {
          await bot.telegram.banChatMember(GROUP_ID, sub.user_id);
          await bot.telegram.unbanChatMember(GROUP_ID, sub.user_id);
          console.log(`[CRON] Usuário ${sub.user_id} removido do canal.`);
        } catch (removeErr) {
          console.warn(
            `[CRON] Não foi possível remover ${sub.user_id} do canal:`,
            removeErr.message
          );
        }
      }

      // 3. Notifica o usuário
      await bot.telegram.sendMessage(
        sub.user_id,
        [
          '⚠️ *Sua assinatura expirou\\!*',
          '',
          'Você foi removido do canal\\.',
          'Renove seu plano para recuperar o acesso\\:',
        ].join('\n'),
        {
          parse_mode: 'MarkdownV2',
          ...getRenewKeyboard(),
        }
      );

      console.log(`[CRON] Usuário ${sub.user_id} notificado. Status → expired.`);
    } catch (err) {
      console.warn(`[CRON] Não foi possível notificar usuário ${sub.user_id}:`, err.message);
    }
  }

  console.log(`[CRON] Verificação concluída. Processados: ${expired.length} usuário(s).`);
}

module.exports = { startCronJob, runExpirationCheck };
