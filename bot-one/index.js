/**
 * index.js — Ponto de entrada da aplicação
 *
 * Ordem de inicialização:
 *  1. Carrega variáveis de ambiente (.env)
 *  2. Inicializa banco de dados SQLite (cria tabelas se necessário)
 *  3. Inicia servidor HTTP interno (recebe ativações do backend)
 *  4. Inicia cron job de verificação de assinaturas expiradas
 *  5. Inicia o bot no modo long-polling
 */

require('dotenv').config();

const { bot } = require('./src/bot');
const { initDatabase } = require('./src/database');
const { startCronJob } = require('./src/services/cronService');
const { startApiServer } = require('./src/api/server');

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  🤖  BOT DE ASSINATURAS — Iniciando   ');
  console.log('═══════════════════════════════════════');

  // 1. Banco de dados
  initDatabase();
  console.log('✅ Banco de dados SQLite pronto.');

  // 2. Servidor HTTP interno
  startApiServer(bot);

  // 3. Cron de expiração
  startCronJob(bot);

  // 4. Bot (long-polling)
  await bot.launch({
    allowedUpdates: ['message', 'callback_query', 'chat_member'],
  });

  console.log('✅ Bot do Telegram online. Aguardando mensagens...');
  console.log('═══════════════════════════════════════\n');

  process.once('SIGINT', () => {
    console.log('\n⏹  Recebido SIGINT. Encerrando bot...');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log('\n⏹  Recebido SIGTERM. Encerrando bot...');
    bot.stop('SIGTERM');
  });
}

main().catch(err => {
  console.error('❌ Erro fatal na inicialização:', err);
  process.exit(1);
});
