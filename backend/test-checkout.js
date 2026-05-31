#!/usr/bin/env node
/**
 * scripts/test-checkout.js
 * ─────────────────────────────────────────────────────────────
 * Script de teste manual para o endpoint POST /api/v1/checkout.
 * Uso: node scripts/test-checkout.js [userId] [plano]
 * Exemplo: node scripts/test-checkout.js 987654321 30
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const userId = process.argv[2] || '123456789';
const plano = parseInt(process.argv[3] || '30', 10);

const payload = JSON.stringify({ userId, plano });
const url = new URL('/api/v1/checkout', BASE_URL);
const isHttps = url.protocol === 'https:';

const options = {
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 80),
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
};

console.log('╔══════════════════════════════════════════╗');
console.log('║       TESTE DE CHECKOUT — MP + BOT       ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`→ URL    : ${url.toString()}`);
console.log(`→ userId : ${userId}`);
console.log(`→ plano  : ${plano} dias`);
console.log('─'.repeat(46));

const transport = isHttps ? https : http;

const req = transport.request(options, res => {
  let data = '';
  res.on('data', chunk => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(`✅ Status HTTP : ${res.statusCode}`);
      console.log('📦 Resposta   :', JSON.stringify(json, null, 2));
      if (json.init_point) {
        console.log('\n🔗 Link de pagamento:');
        console.log(`   ${json.init_point}`);
      }
    } catch {
      console.error('❌ Resposta não é JSON válido:', data);
    }
  });
});

req.on('error', err => {
  console.error('❌ Erro na requisição:', err.message);
  console.error('   Certifique-se de que o servidor está rodando.');
  process.exit(1);
});

req.write(payload);
req.end();
