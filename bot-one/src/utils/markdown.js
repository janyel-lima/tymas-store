/**
 * Escapa caracteres especiais para o modo MarkdownV2 do Telegram.
 * Obrigatório para todo conteúdo dinâmico (nomes, datas, etc).
 * @param {string|number} text
 * @returns {string}
 */
function escape(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

module.exports = { escape };
