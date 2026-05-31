#!/usr/bin/env node
/**
 * scripts/db-admin.js
 * ─────────────────────────────────────────────────────────────
 * Utilitário de administração do banco de dados SQLite.
 *
 * Comandos disponíveis:
 *   node scripts/db-admin.js list              → lista todos os pagamentos
 *   node scripts/db-admin.js list pending      → filtra por status
 *   node scripts/db-admin.js show <id>         → detalhes de um pagamento
 *   node scripts/db-admin.js reset             → remove TODOS os registros
 *   node scripts/db-admin.js stats             → resumo estatístico
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../payments.db');
const [,, command, arg] = process.argv;

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('❌ Banco não encontrado em:', DB_PATH);
    console.error('   Inicie o servidor ao menos uma vez para criar o banco.');
    process.exit(1);
  }
});

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
  });

const close = () => db.close();

// ─── Separador visual ──────────────────────────────────────────────────────
const hr = () => console.log('─'.repeat(72));

const printTable = (rows) => {
  if (!rows.length) {
    console.log('  (sem registros)\n');
    return;
  }
  const cols = ['id', 'user_id', 'plano', 'status', 'mp_payment_id', 'created_at'];
  // Cabeçalho
  console.log(
    cols.map(c => c.toUpperCase().padEnd(c === 'id' ? 38 : c === 'created_at' ? 26 : 18)).join(' | ')
  );
  hr();
  rows.forEach(r => {
    console.log([
      (r.id           || '').padEnd(38),
      (r.user_id      || '').padEnd(18),
      String(r.plano  || '').padEnd(18),
      (r.status       || '').padEnd(18),
      (r.mp_payment_id || '-').padEnd(18),
      (r.created_at   || '').padEnd(26),
    ].join(' | '));
  });
  console.log(`\n  Total: ${rows.length} registro(s)`);
};

(async () => {
  try {
    console.log('\n📦 DB Admin — mp-telegram-bot');
    console.log(`📁 Banco: ${DB_PATH}\n`);

    switch (command) {

      case 'list': {
        const filter = arg ? `WHERE status = '${arg}'` : '';
        const rows = await all(`SELECT * FROM payments ${filter} ORDER BY created_at DESC`);
        console.log(`📋 Pagamentos${arg ? ` [${arg}]` : ''}:\n`);
        hr();
        printTable(rows);
        break;
      }

      case 'show': {
        if (!arg) { console.error('❌ Informe um ID. Exemplo: node scripts/db-admin.js show <uuid>'); break; }
        const row = await new Promise((resolve, reject) =>
          db.get('SELECT * FROM payments WHERE id = ?', [arg], (err, r) => err ? reject(err) : resolve(r))
        );
        if (!row) { console.log(`❌ Pagamento "${arg}" não encontrado.`); break; }
        console.log('🔍 Detalhes:\n');
        Object.entries(row).forEach(([k, v]) => console.log(`  ${k.padEnd(18)}: ${v ?? '-'}`));
        break;
      }

      case 'stats': {
        const rows = await all('SELECT status, plano, COUNT(*) as total FROM payments GROUP BY status, plano ORDER BY status, plano');
        const total = await all('SELECT COUNT(*) as n FROM payments');
        console.log('📊 Estatísticas:\n');
        hr();
        rows.forEach(r => console.log(`  Status: ${r.status.padEnd(12)} | Plano: ${r.plano}d | Total: ${r.total}`));
        hr();
        console.log(`  Total geral: ${total[0].n} registro(s)`);
        break;
      }

      case 'reset': {
        const confirm = process.argv[4];
        if (confirm !== '--confirm') {
          console.warn('⚠️  ATENÇÃO: isso remove TODOS os registros!');
          console.warn('   Re-execute com a flag: node scripts/db-admin.js reset -- --confirm');
          break;
        }
        const result = await run('DELETE FROM payments');
        console.log(`🗑️  ${result.changes} registro(s) removidos.`);
        break;
      }

      default:
        console.log('Comandos disponíveis:\n');
        console.log('  list [status]   → lista pagamentos (opcional: pending | approved)');
        console.log('  show <id>       → detalha um pagamento pelo UUID');
        console.log('  stats           → resumo por status e plano');
        console.log('  reset           → remove todos os registros (use --confirm)');
    }

  } catch (err) {
    console.error('❌ Erro:', err.message);
  } finally {
    close();
  }
})();
