import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { FomaPayError, FomaPayServer } from '../dist/server.js';

const secret = 'whsec_test_secret';
const server = new FomaPayServer({ secretKey: 'sk_test_ABCD_xxxxxxxx', webhookSecret: secret });
const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', data: { amount: 25 } });
const sign = (raw, t = Math.floor(Date.now() / 1000), key = secret) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`;

test('accepte une signature valide (string et Buffer)', () => {
  assert.equal(server.webhooks.verify(body, sign(body)), true);
  assert.equal(server.webhooks.verify(Buffer.from(body), sign(body)), true);
});

test('rejette un corps modifié, un mauvais secret et une signature absente', () => {
  assert.equal(server.webhooks.verify(body.replace('25', '9999'), sign(body)), false);
  assert.equal(server.webhooks.verify(body, sign(body, undefined, 'whsec_autre')), false);
  assert.equal(server.webhooks.verify(body, undefined), false);
});

test('rejette un événement rejoué trop tard', () => {
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(server.webhooks.verify(body, sign(body, old)), false);
});

test('constructEvent renvoie l’événement ou lève ERROR_INVALID_SIGNATURE', () => {
  assert.equal(server.webhooks.constructEvent(body, sign(body)).type, 'payment.succeeded');
  assert.throws(() => server.webhooks.constructEvent(body, 't=1,v1=00'), (e) => e instanceof FomaPayError && e.code === 'ERROR_INVALID_SIGNATURE');
});

test('refuse une clé publique à la place de la clé secrète', () => {
  assert.throws(() => new FomaPayServer({ secretKey: 'pk_test_ABCD_x' }), (e) => e.code === 'ERROR_INVALID_API_KEY');
});
