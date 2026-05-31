/**
 * services/cronService.js
 * Rotina agendada (cron) que:
 *  1. Roda diariamente à meia-noite (fuso America/Sao_Paulo)
 *  2. Encontra assinaturas com status 'active' e expires_at vencido
 *  3. Marca cada uma como 'expired' no banco
 *  4. Remove o usuário do canal Telegram
 *  5. Envia mensagem privada ao usuário notificando o vencimento
 */

const cron = require('node-cron');
const { formatInTimeZone } = require('date-fns-tz');
const { getExpiredSubscriptions, expireSubscription } = require('../database');
const { getRenewKeyboard } = require('../keyboards');

const TZ = 'America/Sao_Paulo';
const nowSP = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssxxx");
const dateSP = date => formatInTimeZone(new Date(date), TZ, 'dd/MM/yyyy HH:mm');

/**
 * Inicializa o cron job de expiração de assinaturas.
 * @param {import('telegraf').Telegraf} bot — instância do bot para envio de mensagens
 */
function startCronJob(bot) {
  // Expressão cron: "0 0 * * *" → toda meia-noite no fuso de SP
  const task = cron.schedule('0 0 * * *', async () => runExpirationCheck(bot), { timezone: TZ });

  console.log(`✅ Cron de expiração agendado: todo dia às 00:00 (${TZ})`);

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
  console.log(`[CRON] ${nowSP()} — Iniciando verificação de assinaturas expiradas...`);

  let expired;
  try {
    expired = getExpiredSubscriptions();
  } catch (err) {
    console.error('[CRON] Erro ao consultar assinaturas expiradas:', err.message);
    return;
  }

  if (expired.length === 0) {
    console.log(`[CRON] Nenhuma assinatura expirada encontrada. (${nowSP()})`);
    return;
  }

  console.log(`[CRON] ${expired.length} assinatura(s) a processar.`);

  const GROUP_ID = process.env.GROUP_ID;

  for (const sub of expired) {
    const expiresFmt = dateSP(sub.expires_at).replace(/\//g, '\\/').replace(':', '\\:');

    try {
      // 1. Atualiza status no banco ANTES de notificar
      //    (evita re-notificação em caso de falha parcial)
      expireSubscription(sub.user_id);
      console.log(`[CRON] 🗄️  Status → expired | userId=${sub.user_id}`);

      // 2. Remove do canal
      if (GROUP_ID) {
        try {
          await bot.telegram.banChatMember(GROUP_ID, sub.user_id);
          await bot.telegram.unbanChatMember(GROUP_ID, sub.user_id);
          console.log(`[CRON] ⛔ Usuário ${sub.user_id} removido do canal.`);
        } catch (removeErr) {
          // Comum: usuário já saiu do canal manualmente (400/403)
          console.warn(
            `[CRON] Não foi possível remover userId=${sub.user_id} do canal:`,
            removeErr.message
          );
        }
      }

      // 3. Notifica o usuário com data de vencimento e botões de renovação
      await bot.telegram.sendMessage(
        sub.user_id,
        [
          '⚠️ *Sua assinatura expirou\\!*',
          '',
          `Seu plano de *${sub.plan_days} dias* venceu em ${expiresFmt}\\.`,
          '',
          'Você foi removido do canal\\.',
          'Renove seu plano para recuperar o acesso\\:',
        ].join('\n'),
        {
          parse_mode: 'MarkdownV2',
          ...getRenewKeyboard(),
        }
      );

      console.log(`[CRON] ✅ Usuário ${sub.user_id} notificado. Status → expired.`);
    } catch (err) {
      // Erros comuns: usuário bloqueou o bot (403), chat não encontrado (400).
      // Não reverte o status — assinatura permanece expirada mesmo sem notificação.
      console.warn(`[CRON] Não foi possível processar userId=${sub.user_id}:`, err.message);
    }
  }

  console.log(
    `[CRON] Verificação concluída em ${nowSP()}. ` + `Processados: ${expired.length} usuário(s).`
  );
}

module.exports = { startCronJob, runExpirationCheck };
