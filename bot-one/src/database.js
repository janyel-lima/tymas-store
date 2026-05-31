/**
 * database.js
 * Módulo responsável pela conexão e todas as operações
 * com o banco de dados SQLite via better-sqlite3 (síncrono).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'subscriptions.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

/**
 * Retorna a instância singleton do banco de dados.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// ─────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────

function initDatabase() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users_subscriptions (
      user_id    INTEGER PRIMARY KEY,
      username   TEXT,
      full_name  TEXT,
      status     TEXT    NOT NULL DEFAULT 'inactive'
                         CHECK(status IN ('active', 'expired', 'inactive')),
      plan_days  INTEGER,
      expires_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id          INTEGER  PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER  NOT NULL,
      plan_days   INTEGER  NOT NULL,
      amount      REAL     NOT NULL,
      status      TEXT     NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending', 'approved', 'rejected')),
      payment_ref TEXT     UNIQUE,
      created_at  DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users_subscriptions(user_id)
    );

    CREATE TRIGGER IF NOT EXISTS trg_update_subscription_timestamp
    AFTER UPDATE ON users_subscriptions
    BEGIN
      UPDATE users_subscriptions
        SET updated_at = datetime('now')
        WHERE user_id = NEW.user_id;
    END;
  `);
}

// ─────────────────────────────────────────────
// OPERAÇÕES — users_subscriptions
// ─────────────────────────────────────────────

function getSubscription(userId) {
  return getDb().prepare('SELECT * FROM users_subscriptions WHERE user_id = ?').get(userId);
}

function upsertUser(userId, username, fullName) {
  getDb()
    .prepare(
      `
      INSERT INTO users_subscriptions (user_id, username, full_name)
        VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username  = excluded.username,
        full_name = excluded.full_name
    `
    )
    .run(userId, username ?? null, fullName ?? null);
}

function activateSubscription(userId, planDays) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parseInt(planDays, 10));

  getDb()
    .prepare(
      `
      INSERT INTO users_subscriptions (user_id, status, plan_days, expires_at)
        VALUES (?, 'active', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status     = 'active',
        plan_days  = excluded.plan_days,
        expires_at = excluded.expires_at
    `
    )
    .run(userId, planDays, expiresAt.toISOString());

  return expiresAt;
}

function getExpiredSubscriptions() {
  return getDb()
    .prepare(
      `
      SELECT * FROM users_subscriptions
       WHERE status = 'active'
         AND expires_at <= datetime('now')
    `
    )
    .all();
}

function expireSubscription(userId) {
  getDb()
    .prepare("UPDATE users_subscriptions SET status = 'expired' WHERE user_id = ?")
    .run(userId);
}

// ─────────────────────────────────────────────
// OPERAÇÕES — payments
// ─────────────────────────────────────────────

/**
 * Registra um pagamento no histórico.
 * FIX: adicionado parâmetro `status` com default 'pending'.
 *      O endpoint /activate agora chama com status='approved' diretamente,
 *      evitando a necessidade de dois updates (insert pending + approve).
 *
 * @param {number} userId
 * @param {number} planDays
 * @param {number} amount
 * @param {string} paymentRef — ID único do pagamento no gateway (UNIQUE constraint)
 * @param {string} [status='pending'] — 'pending' | 'approved' | 'rejected'
 */
function createPaymentRecord(userId, planDays, amount, paymentRef, status = 'pending') {
  getDb()
    .prepare(
      `
      INSERT INTO payments (user_id, plan_days, amount, payment_ref, status)
        VALUES (?, ?, ?, ?, ?)
    `
    )
    .run(userId, planDays, amount, paymentRef, status);
}

function approvePayment(paymentRef) {
  const database = getDb();
  database.prepare("UPDATE payments SET status = 'approved' WHERE payment_ref = ?").run(paymentRef);

  return database.prepare('SELECT * FROM payments WHERE payment_ref = ?').get(paymentRef);
}

module.exports = {
  initDatabase,
  getSubscription,
  upsertUser,
  activateSubscription,
  getExpiredSubscriptions,
  expireSubscription,
  createPaymentRecord,
  approvePayment,
};
