// Tests d'intégration contre le sandbox FomaPay. Ils ne s'exécutent que si
// FOMAPAY_TEST_SECRET_KEY (sk_test_…) est définie ; FOMAPAY_API_URL cible un backend local.
//
//   FOMAPAY_API_URL=http://localhost:8080 FOMAPAY_TEST_SECRET_KEY=sk_test_… FOMAPAY_TEST_PUBLIC_KEY=pk_test_… npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FomaPay } from '../dist/index.js';
import { FomaPayServer } from '../dist/server.js';

const { FOMAPAY_TEST_SECRET_KEY: secretKey, FOMAPAY_TEST_PUBLIC_KEY: publicKey, FOMAPAY_API_URL: apiUrl } = process.env;
const pending = (p) => p.status === 'pending' || p.status === 'processing';

test('sandbox : clé secrète (serveur)', { skip: !secretKey && 'FOMAPAY_TEST_SECRET_KEY non définie' }, async () => {
  const server = new FomaPayServer({ secretKey, apiUrl });

  const store = await server.store.retrieve();
  assert.equal(store.livemode, false);
  assert.equal(store.paymentModes.length, 2);

  // Format standard d'une transaction, dans les deux modes.
  const payment = await server.payments.create({
    amount: 1000,
    currency: 'CDF',
    orderId: 'CMD-2026-001',
    customer: { name: 'Jean Marc', phone: '+243810000000', email: 'jean@example.com' },
    paymentModes: ['fomapay_direct', 'mobile_money'],
    callbackUrl: 'https://marchand.cd/api/callback',
    metadata: { custom_field: 'valeur' },
  });
  assert.equal(payment.status, 'pending');
  assert.equal(payment.callbackUrl, 'https://marchand.cd/api/callback');
  assert.ok(payment.qrCode);

  // Mode Mobile Money : l'opérateur simulé confirme après ~3 s.
  let final = await server.payments.payWithMobileMoney(payment.id, { operator: 'airtel_money', phone: '+243970000000' });
  assert.equal(final.status, 'processing');
  for (const deadline = Date.now() + 10_000; pending(final); ) {
    assert.ok(Date.now() < deadline, "le paiement Mobile Money n'a pas été confirmé à temps");
    await new Promise((r) => setTimeout(r, 1000));
    final = await server.payments.retrieve(payment.reference);
  }
  assert.deepEqual([final.status, final.channel], ['success', 'airtel_money']);

  // Mode FomaPay Direct : issue forcée en sandbox.
  const direct = await server.payments.create({ amount: 12.5, currency: 'USD', paymentModes: ['fomapay_direct'] });
  assert.equal((await server.payments.simulate(direct.id, 'success')).status, 'success');

  // Idempotence : la même clé renvoie le même paiement.
  const idempotencyKey = `js-it-${payment.id}`;
  const first = await server.payments.create({ amount: 3, currency: 'USD', idempotencyKey });
  const again = await server.payments.create({ amount: 3, currency: 'USD', idempotencyKey });
  assert.equal(first.id, again.id);

  assert.ok((await server.payments.list({ limit: 5, status: 'success' })).length > 0);
  assert.ok((await server.balance.retrieve()).length > 0);

  await assert.rejects(server.payments.create({ amount: -1, currency: 'USD' }), (e) => e.code === 'ERROR_VALIDATION');
  await assert.rejects(server.payments.retrieve('FP-INEXISTANT'), (e) => e.code === 'ERROR_NOT_FOUND' && e.status === 404);
});

test('sandbox : clé publique (navigateur)', { skip: !publicKey && 'FOMAPAY_TEST_PUBLIC_KEY non définie' }, async () => {
  const fomapay = new FomaPay({ publicKey, apiUrl, environment: 'sandbox' });
  assert.ok((await fomapay.store()).name);

  const payment = await fomapay.createPayment({ amount: 5, currency: 'USD', orderId: 'CMD-PK' });
  await fomapay.payWithMobileMoney(payment.id, 'mpesa', '+243810000001'); // …0001 : refusé par le client
  const final = await fomapay.waitForPayment(payment.id, { intervalMs: 1000, timeoutMs: 15_000 });
  assert.equal(final.status, 'failed');
});
