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
const { formatInTimeZone } = require('date-fns-tz');

const { activateSubscription, upsertUser, createPaymentRecord, getDb } = require('../database');
const { registerPendingEntry } = require('../bot');

const API_PORT = parseInt(process.env.API_PORT ?? '3001', 10);
const API_SECRET = process.env.API_SECRET;
const TZ = 'America/Sao_Paulo';

/** Timestamp atual no fuso de SP. */
const nowSP = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssxxx");

/** Formata Date para exibição no fuso de SP. */
const dateSP = date => formatInTimeZone(new Date(date), TZ, 'dd/MM/yyyy HH:mm');

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
      console.warn(`[API] ⛔ Tentativa não autorizada → path=${req.path} | IP=${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized: X-Api-Secret inválido.' });
    }
    next();
  });

  // ── GET /health ────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: nowSP(),
      timezone: TZ,
    });
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
    if (Number(planDays) <= 0 || Number(planDays) > 365) {
      return res.status(400).json({ error: 'planDays deve ser entre 1 e 365.' });
    }

    try {
      // 1. Garante registro do usuário no banco
      upsertUser(Number(userId), username ?? null, fullName ?? null);

      // 2. Ativa / renova a assinatura
      const expiresAt = activateSubscription(Number(userId), Number(planDays));

      // 3. Registra o pagamento no histórico
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
          console.warn('[API] Registro de pagamento já existe (duplicata):', paymentRef);
        }
      }

      console.log(
        `[API] ✅ Assinatura ativada — userId=${userId} | plano=${planDays}d | ` +
          `expira=${dateSP(expiresAt)} | ref=${paymentRef ?? 'N/A'}`
      );

      // 4. Gera link de convite único para o canal
      const GROUP_ID = process.env.GROUP_ID;
      let inviteLink = null;

      if (GROUP_ID) {
        try {
          const expireUnix = Math.floor(expiresAt.getTime() / 1000);

          const linkResult = await bot.telegram.createChatInviteLink(GROUP_ID, {
            expire_date: expireUnix,
            member_limit: 1,
            name: `Sub_${userId}`,
          });

          inviteLink = linkResult.invite_link;
          console.log(`[API] 🔗 Link gerado → userId=${userId} | expira=${dateSP(expiresAt)}`);

          // Registra userId como aguardando entrada no canal
          registerPendingEntry(userId, {
            expiresAt,
            planDays: Number(planDays),
          });
        } catch (linkErr) {
          console.warn('[API] Falha ao gerar link de convite:', linkErr.message);
        }
      }

      // 5. Formata data de expiração no fuso de SP
      const expiresFmt = dateSP(expiresAt).replace(/\//g, '\\/').replace(':', '\\:');

      // 6. Monta e envia mensagem no Telegram
      const messageLines = [
        '🎉 *Pagamento Confirmado\\!*',
        '',
        'Sua assinatura foi ativada com sucesso\\.',
        '',
        `*📦 Plano:*       ${planDays} dias`,
        `*📅 Válido até:*  ${expiresFmt}`,
        '',
      ];

      if (inviteLink) {
        messageLines.push(`*🔗 Acesse o canal:* [Clique aqui para entrar](${inviteLink})`);
        messageLines.push('_⚠️ Link de uso único — não compartilhe\\._');
        messageLines.push('_O acesso é removido automaticamente ao expirar\\._');
      }

      await bot.telegram.sendMessage(userId, messageLines.join('\n'), {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      });

      return res.status(200).json({
        success: true,
        userId,
        planDays,
        expiresAt: expiresAt.toISOString(),
        expiresSP: dateSP(expiresAt),
        inviteLink,
      });
    } catch (err) {
      // Erro de notificação Telegram não deve impedir a ativação
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

  // ── GET /admin/stats ───────────────────────────────────────
  /**
   * Retorna estatísticas do banco: assinantes, receita, próximos a vencer.
   * Protegido por X-Api-Secret (middleware global já cobre).
   */
  app.get('/admin/stats', (req, res) => {
    try {
      const db = getDb();

      const total = db.prepare('SELECT COUNT(*) as n FROM users_subscriptions').get();
      const ativos = db
        .prepare("SELECT COUNT(*) as n FROM users_subscriptions WHERE status = 'active'")
        .get();
      const expirados = db
        .prepare("SELECT COUNT(*) as n FROM users_subscriptions WHERE status = 'expired'")
        .get();
      const inativos = db
        .prepare("SELECT COUNT(*) as n FROM users_subscriptions WHERE status = 'inactive'")
        .get();
      const receita = db
        .prepare("SELECT SUM(amount) as total FROM payments WHERE status = 'approved'")
        .get();

      const proximosVencer = db
        .prepare(
          `
        SELECT user_id, username, expires_at, plan_days
          FROM users_subscriptions
         WHERE status = 'active'
           AND expires_at <= datetime('now', '+3 days')
         ORDER BY expires_at ASC
      `
        )
        .all();

      const ultimosPagamentos = db
        .prepare(
          `
        SELECT user_id, plan_days, amount, payment_ref, created_at
          FROM payments
         WHERE status = 'approved'
         ORDER BY created_at DESC
         LIMIT 5
      `
        )
        .all();

      res.json({
        gerado_em: nowSP(),
        timezone: TZ,
        assinantes: {
          total: total.n,
          ativos: ativos.n,
          expirados: expirados.n,
          inativos: inativos.n,
        },
        receita_total: `R$ ${(receita.total || 0).toFixed(2)}`,
        proximos_a_vencer: proximosVencer.map(s => ({
          userId: s.user_id,
          username: s.username ?? 'sem username',
          expira: dateSP(s.expires_at),
          plano: `${s.plan_days} dias`,
        })),
        ultimos_pagamentos: ultimosPagamentos.map(p => ({
          userId: p.user_id,
          plano: `${p.plan_days} dias`,
          valor: `R$ ${Number(p.amount).toFixed(2)}`,
          ref: p.payment_ref,
          realizadoEm: dateSP(p.created_at),
        })),
      });
    } catch (err) {
      console.error('[API] Erro ao gerar stats:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /run-expiration-check (admin manual) ──────────────
  app.post('/run-expiration-check', async (req, res) => {
    try {
      const { runExpirationCheck } = require('../services/cronService');
      console.log(`[API] 🔧 Verificação manual de expirações disparada → ${nowSP()}`);
      await runExpirationCheck(bot);
      res.json({ success: true, message: 'Verificação executada.', executadoEm: nowSP() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 404 catch-all ──────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`✅ API interna rodando em http://0.0.0.0:${API_PORT} | TZ: ${TZ}`);
  });

  return app;
}

module.exports = { startApiServer };
