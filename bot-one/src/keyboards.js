/**
 * keyboards.js
 * Centraliza a criação de todos os Inline Keyboards do bot.
 * Separa a lógica de UI da lógica de negócio.
 */

const { Markup } = require('telegraf');

/** Definição dos planos disponíveis — fonte única de verdade. */
const PLANS = [
  { label: '🟢 7 dias — R$ 30',   days: 7,  callbackData: 'plan_7'  },
  { label: '🔵 14 dias — R$ 50',  days: 14, callbackData: 'plan_14' },
  { label: '🟣 30 dias — R$ 100', days: 30, callbackData: 'plan_30' },
];

/**
 * Menu principal: lista de planos + botão de status.
 * Usado no /start e ao voltar ao menu.
 */
function getMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    ...PLANS.map((p) => [Markup.button.callback(p.label, p.callbackData)]),
    [Markup.button.callback('ℹ️ Status da Minha Assinatura', 'check_status')],
  ]);
}

/**
 * Teclado de pagamento: botão de URL externo para o checkout + voltar.
 * @param {number} userId  — ID do usuário no Telegram
 * @param {number} planDays — Quantidade de dias do plano selecionado
 */
function getPaymentKeyboard(userId, planDays) {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) throw new Error('FRONTEND_URL não definida no .env');

  const checkoutUrl = `${frontendUrl}/checkout?userId=${userId}&plano=${planDays}`;

  return Markup.inlineKeyboard([
    [Markup.button.url('💳  Ir para o Pagamento Seguro', checkoutUrl)],
    [Markup.button.callback('↩️  Voltar ao Menu', 'back_menu')],
  ]);
}

/**
 * Apenas os botões de planos — usado na mensagem de assinatura expirada.
 * Sem o botão de status para evitar loop.
 */
function getRenewKeyboard() {
  return Markup.inlineKeyboard([
    ...PLANS.map((p) => [Markup.button.callback(p.label, p.callbackData)]),
  ]);
}

module.exports = {
  PLANS,
  getMainMenuKeyboard,
  getPaymentKeyboard,
  getRenewKeyboard,
};
