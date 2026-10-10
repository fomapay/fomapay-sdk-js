import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FomaPayApiError, FomaPayNetworkError, FomaPayServer } from '../dist/server.js';

const PAYMENT = { id: 'pay_1', reference: 'FP-1', status: 'pending', amount: 25, currency: 'USD' };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const failure = (status, code, headers) => json(status, { error: { code, message: 'oups', details: { champ: 'amount' } } }, headers);

/** Client branché sur un faux fetch ; `waits` reçoit les attentes entre deux tentatives. */
function makeServer(handler, options = {}) {
  const calls = [];
  const waits = [];
  const server = new FomaPayServer({
    secretKey: 'sk_test_unit',
    apiUrl: 'https://api.test/',
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return handler(calls.length, { url, ...init });
    },
    ...options,
  });
  server.http.sleep = async (ms) => void waits.push(ms);
  return { server, calls, waits };
}

test('create envoie le format standard et une clé d’idempotence', async () => {
  const { server, calls } = makeServer(() => json(201, PAYMENT));
  const payment = await server.transactions.create({
    amount: 25,
    currency: 'USD',
    orderId: 'CMD-1',
    customer: { name: 'Jean Marc', phone: '+243810000000' },
    paymentModes: ['fomapay_direct', 'mobile_money'],
    callbackUrl: 'https://marchand.cd/api/callback',
    metadata: { custom_field: 'valeur' },
  });

  assert.equal(payment.id, 'pay_1');
  assert.equal(calls[0].url, 'https://api.test/v1/payments');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk_test_unit');
  assert.match(calls[0].headers['Idempotency-Key'], /^js-/);
  assert.deepEqual(JSON.parse(calls[0].body), {
    amount: 25,
    currency: 'USD',
    orderId: 'CMD-1',
    customer: { name: 'Jean Marc', phone: '+243810000000' },
    paymentModes: ['fomapay_direct', 'mobile_money'],
    callbackUrl: 'https://marchand.cd/api/callback',
    metadata: { custom_field: 'valeur' },
  });
});

test('rejoue les erreurs serveur avec la même clé d’idempotence', async () => {
  const { server, calls, waits } = makeServer((n) => (n < 3 ? failure(503, 'ERROR_UNAVAILABLE') : json(201, PAYMENT)));
  await server.payments.create({ amount: 25, currency: 'USD' });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((c) => c.headers['Idempotency-Key'])).size, 1);
  assert.ok(waits[0] >= 250 && waits[0] <= 500 && waits[1] >= 500 && waits[1] <= 1000, String(waits));
});

test('abandonne après maxRetries et ne rejoue pas les erreurs 4xx', async () => {
  const down = makeServer(() => failure(500, 'ERROR_INTERNAL'), { maxRetries: 1 });
  await assert.rejects(down.server.payments.retrieve('FP-1'), (e) => e instanceof FomaPayApiError && e.status === 500);
  assert.equal(down.calls.length, 2);

  const refused = makeServer(() => failure(403, 'ERROR_LEVEL_0_LIMIT_REACHED'));
  await assert.rejects(
    refused.server.payments.create({ amount: 900, currency: 'USD' }),
    (e) => e.code === 'ERROR_LEVEL_0_LIMIT_REACHED' && e.details.champ === 'amount',
  );
  assert.equal(refused.calls.length, 1);
});

test('un retrait n’est jamais rejoué, sauf sur un 429', async () => {
  const payout = { amount: 10, currency: 'USD', operator: 'mpesa', phone: '+243810000000' };

  const broken = makeServer(() => failure(502, 'ERROR_BAD_GATEWAY'));
  await assert.rejects(broken.server.payouts.create(payout), FomaPayApiError);
  assert.equal(broken.calls.length, 1);
  assert.equal(broken.calls[0].headers['Idempotency-Key'], undefined);

  const offline = makeServer(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(offline.server.payouts.create(payout), (e) => e instanceof FomaPayNetworkError && e.code === 'ERROR_NETWORK');
  assert.equal(offline.calls.length, 1);

  const limited = makeServer((n) => (n === 1 ? failure(429, 'ERROR_RATE_LIMITED', { 'Retry-After': '2' }) : json(201, PAYMENT)));
  await limited.server.payouts.create(payout);
  assert.deepEqual([limited.calls.length, limited.waits], [2, [2000]]);
});

test('le délai dépassé donne ERROR_TIMEOUT', async () => {
  const hang = (_n, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const { server, calls } = makeServer(hang, { timeoutMs: 20, maxRetries: 1 });
  await assert.rejects(server.balance.retrieve(), (e) => e instanceof FomaPayNetworkError && e.code === 'ERROR_TIMEOUT');
  assert.equal(calls.length, 2);
});

test('autres ressources', async () => {
  const { server, calls } = makeServer((_n, { url }) => {
    if (url.endsWith('/v1/payments?limit=5&status=success')) return json(200, { data: [PAYMENT] });
    if (url.endsWith('/v1/balance')) return json(200, { data: [{ currency: 'USD', available: 12.5 }] });
    return json(200, { ...PAYMENT, status: 'success' });
  });
  assert.equal((await server.payments.list({ limit: 5, status: 'success' })).length, 1);
  assert.equal((await server.balance.retrieve())[0].available, 12.5);
  await server.payments.payWithMobileMoney('FP/1', { operator: 'airtel_money', phone: '+243970000000' });
  await server.payments.simulate('pay_1');
  assert.equal(calls[2].url, 'https://api.test/v1/payments/FP%2F1/mobile-money');
  assert.deepEqual(JSON.parse(calls[3].body), { outcome: 'success' });
});
