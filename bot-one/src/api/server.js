/**
 * api/server.js
 * Servidor HTTP interno (Express) que recebe notificações do backend principal.
 *
 * Fluxo de integração:
 *   1. Usuário finaliza pagamento no frontend Vue 3
 *   2. Mercado Pago dispara webhook → backend (server.js)
 *   3. Backend confirma o pagamento e chama POST /activate neste servidor
 *   4. Este servidor ativa a assinatura no SQLite e notifica o usuário no Telegram
 *
 * Segurança: todas as rotas (exceto /health) exigem o header X-Api-Secret.
 */

const express = require('express');
const {
  activateSubscription,
  upsertUser,
  createPaymentRecord, // FIX: importado mas nunca usado — agora registra o pagamento
} = require('../database');

const API_PORT = parseInt(process.env.API_PORT ?? '3001', 10);
const API_SECRET = process.env.API_SECRET;

/**
 * Inicializa e inicia o servidor HTTP interno.
 * @param {import('telegraf').Telegraf} bot — instância do bot para notificações
 */
function startApiServer(bot) {
  const app = express();

  app.use(express.json());

  // ── Middleware de autenticação por secret ──────────────────
  app.use((req, res, next) => {
    if (req.path === '/health') return next();

    if (!API_SECRET) {
      console.warn('[API] ⚠️  API_SECRET não definida — endpoint exposto sem autenticação!');
      return next();
    }

    const provided = req.headers['x-api-secret'];
    if (provided !== API_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: X-Api-Secret inválido.' });
    }
    next();
  });

  // ── GET /health ────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── POST /activate ─────────────────────────────────────────
  /**
   * Ativa a assinatura de um usuário após pagamento aprovado.
   *
   * Body esperado (JSON):
   * {
   *   "userId":     123456789,  // ID do usuário no Telegram (obrigatório)
   *   "planDays":   30,         // Dias do plano contratado (obrigatório)
   *   "amount":     100.00,     // Valor pago em R$ (opcional)
   *   "username":   "joao123",  // Username do Telegram (opcional)
   *   "fullName":   "João",     // Nome completo (opcional)
   *   "paymentRef": "pay_abc"   // ID do pagamento no gateway (opcional)
   * }
   */
  app.post('/activate', async (req, res) => {
    const { userId, planDays, amount, username, fullName, paymentRef } = req.body ?? {};

    if (!userId || !planDays) {
      return res.status(400).json({
        error: 'Campos obrigatórios ausentes: userId, planDays.',
      });
    }
    if (isNaN(Number(userId)) || isNaN(Number(planDays))) {
      return res.status(400).json({ error: 'userId e planDays devem ser numéricos.' });
    }

    try {
      // 1. Garante registro do usuário no banco
      upsertUser(Number(userId), username ?? null, fullName ?? null);

      // 2. Ativa / renova a assinatura
      const expiresAt = activateSubscription(Number(userId), Number(planDays));

      // 3. FIX: registra o pagamento no histórico do bot com status 'approved'.
      //    Antes essa linha não existia — o histórico de pagamentos do bot
      //    ficava sempre vazio, impossibilitando auditoria e relatórios.
      if (paymentRef) {
        try {
          createPaymentRecord(
            Number(userId),
            Number(planDays),
            Number(amount) || 0,
            paymentRef,
            'approved'
          );
        } catch (dupErr) {
          // payment_ref tem constraint UNIQUE — ignora duplicata silenciosamente
          console.warn('[API] Registro de pagamento já existe (duplicata):', paymentRef);
        }
      }

      console.log(
        `[API] ✅ Assinatura ativada — userId=${userId} | plano=${planDays}d | ` +
          `expira=${expiresAt.toISOString()} | ref=${paymentRef ?? 'N/A'}`
      );

      // 4. Notifica o usuário no Telegram
      const expiresFmt = expiresAt.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      await bot.telegram.sendMessage(
        userId,
        [
          '🎉 *Pagamento Confirmado\\!*',
          '',
          'Sua assinatura foi ativada com sucesso\\.',
          '',
          `*📦 Plano:*       ${planDays} dias`,
          `*📅 Válido até:*  ${expiresFmt.replace(/\//g, '\\/')}`,
          '',
          '_Aproveite o acesso completo à plataforma\\._',
          '_Em caso de dúvidas, entre em contato com o suporte\\._',
        ].join('\n'),
        { parse_mode: 'MarkdownV2' }
      );

      return res.status(200).json({
        success: true,
        userId,
        planDays,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      // Erro do Telegram ao enviar mensagem não deve impedir a ativação
      if (err.message?.includes('TELEGRAM') || err.response?.error_code) {
        console.warn('[API] Assinatura ativada, mas falha ao notificar usuário:', err.message);
        return res.status(200).json({
          success: true,
          warning: 'Assinatura ativada, mas notificação Telegram falhou.',
          userId,
          planDays,
        });
      }

      console.error('[API] ❌ Erro ao ativar assinatura:', err);
      return res.status(500).json({ error: 'Erro interno ao ativar assinatura.' });
    }
  });

  // ── POST /run-expiration-check (admin manual) ──────────────
  app.post('/run-expiration-check', async (req, res) => {
    try {
      const { runExpirationCheck } = require('../services/cronService');
      await runExpirationCheck(bot);
      res.json({ success: true, message: 'Verificação executada.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 404 catch-all ──────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`✅ API interna rodando em http://0.0.0.0:${API_PORT}`);
  });

  return app;
}

module.exports = { startApiServer };
