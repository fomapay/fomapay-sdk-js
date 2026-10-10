# @fomapay/sdk-js

SDK officiel FomaPay pour JavaScript / TypeScript : React, Next.js, Vue, JS vanilla, Node.js, Electron, Tauri.
Zéro dépendance, entièrement typé, deux modes de paiement :

- **FomaPay Direct** — le client paie depuis son portefeuille FomaPay (QR code). Disponible dès le **Niveau 0**, sans aucun document.
- **Mobile Money** — M-Pesa, Orange Money, Airtel Money. Réservé aux comptes vérifiés (**Niveau 1+**).

## Intégration en 3 étapes

1. **Installer** : `npm install @fomapay/sdk-js`
2. **Encaisser** dans la page avec votre clé publique `pk_…` : `fomapay.checkout({ amount, currency, orderId })`
3. **Confirmer** sur votre serveur avec la clé secrète `sk_…` : webhook `payment.succeeded` vérifié par `webhooks.constructEvent`

La clé publique ne sait que créer et suivre un paiement ; tout le reste (liste, solde, retraits) exige la clé secrète, qui ne quitte jamais votre serveur.

## Navigateur

```ts
import { FomaPay, FomaPayError } from '@fomapay/sdk-js';

const fomapay = new FomaPay({ publicKey: 'pk_live_000K_xxxxxxxxx' });

try {
  const payment = await fomapay.checkout({
    amount: 25.0,
    currency: 'USD', // USD ou CDF
    orderId: 'CMD-8921',
    customer: { name: 'John Doe', phone: '+243810000000' },
    paymentModes: ['fomapay_direct', 'mobile_money'],
    callbackUrl: 'https://dzoket.cd/commande/CMD-8921',
    metadata: { custom_field: 'valeur' },
    customization: { title: 'Dzoket Store', description: 'Commande #CMD-8921', logoUrl: 'https://dzoket.cd/logo.png' },
  });
  console.log('Transaction réussie :', payment.transactionId);
} catch (error) {
  if (error instanceof FomaPayError) console.error(error.code, error.message);
}
```

`checkout()` ouvre la fenêtre de paiement (isolée dans un Shadow DOM) et se résout quand le paiement est confirmé.
Pour une interface sur mesure : `createPayment`, `payWithMobileMoney`, `getPayment`, `waitForPayment`.

> La page du client n'est jamais une preuve de paiement : confirmez toujours la commande côté serveur
> (webhook `payment.succeeded` ou `payments.retrieve`).

## Sans bundler

```html
<script src="https://js.fomapay.cd/v1/fomapay.js"></script>

<fomapay-button public-key="pk_live_000K_xxxxxxxxx" amount="10" currency="USD" order-id="CMD-8921"></fomapay-button>

<script>
  document.addEventListener('fomapay:success', (e) => console.log('Payé :', e.detail.reference));
  document.addEventListener('fomapay:error', (e) => console.warn(e.detail.code));
</script>
```

Le script expose aussi `window.FomaPay`.

## Serveur (Node.js ≥ 18)

```ts
import express from 'express';
import { FomaPayServer } from '@fomapay/sdk-js/server';

const fomapay = new FomaPayServer({
  secretKey: process.env.FOMAPAY_SECRET_KEY!, // sk_live_… — ne quitte jamais votre serveur
  webhookSecret: process.env.FOMAPAY_WEBHOOK_SECRET, // whsec_…
});

// Le corps BRUT est indispensable à la vérification de signature.
app.post('/api/fomapay-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = fomapay.webhooks.constructEvent(req.body, req.headers['x-fomapay-signature']);
  if (event.type === 'payment.succeeded') {
    const { orderId, amount, storeId } = event.data;
    // Marquer la commande comme payée
  }
  res.json({ received: true });
});

await fomapay.payments.retrieve('FP-ABCDEFGHJK');
await fomapay.balance.retrieve();
await fomapay.payouts.create({ amount: 100, currency: 'USD', operator: 'mpesa', phone: '+243810000000' });
```

`webhooks.verify()` contrôle le HMAC-SHA256 en temps constant et rejette tout événement de plus de 5 minutes (anti-rejeu).
Sans client : `import { Webhook } from '@fomapay/sdk-js/server'` puis `Webhook.verify(corpsBrut, signature, 'whsec_…')`.

Autres appels : `payments.create`, `payments.list`, `payments.payWithMobileMoney(id, { operator, phone })`,
`payments.simulate(id, 'success' | 'failed')` (sandbox), `store.retrieve()`. `transactions` est un alias de `payments`.

## Fiabilité

```ts
new FomaPayServer({ secretKey, timeoutMs: 10_000, maxRetries: 3 }); // 30 s et 2 tentatives par défaut
```

- **Nouvelles tentatives** avec attente exponentielle (0,5 s, 1 s… plafonnée à 8 s). Ne sont rejouées que les requêtes sans
  risque : les lectures, et les créations de paiement, qui portent toujours un en-tête `Idempotency-Key`.
  Un `429` est toujours rejoué en respectant `Retry-After`.
- **Idempotence** : passez `idempotencyKey: 'CMD-8921'` pour qu'un appel répété par votre propre code renvoie le même paiement.
- **Retraits** : jamais rejoués automatiquement. Après une `FomaPayNetworkError`, vérifiez l'état avant de relancer.

## Sandbox

Utilisez vos clés `pk_test_…` / `sk_test_…` : aucune somme réelle n'est déplacée et la fenêtre de paiement propose
« Simuler un succès / un échec ». Numéros Mobile Money de test :

| Numéro finissant par | Résultat |
| --- | --- |
| `0001` | Refus (solde insuffisant) |
| `0002` | Le client ne valide jamais → expiration |
| tout autre | Succès après ~3 s |

## Erreurs

Chaque erreur est une `FomaPayError` avec un `code` stable et un `message` lisible. Trois sous-classes précisent l'origine :
`FomaPayApiError` (réponse de l'API), `FomaPayNetworkError` (`ERROR_NETWORK`, `ERROR_TIMEOUT`) et `FomaPaySignatureError` (webhook).

| Code | Signification |
| --- | --- |
| `ERROR_INVALID_API_KEY` | Clé absente, mal formée ou révoquée |
| `ERROR_LEVEL_0_LIMIT_REACHED` | Plafond mensuel du niveau KYC atteint — passez au niveau supérieur |
| `ERROR_MOBILE_MONEY_REQUIRES_VERIFICATION` | Mobile Money demandé par un compte Niveau 0 |
| `ERROR_CHECKOUT_CLOSED` | Le client a fermé la fenêtre de paiement |
| `ERROR_SECRET_KEY_REQUIRED` | Opération serveur appelée avec une clé publique |
| `ERROR_RATE_LIMITED` | Trop de requêtes — réessayez dans une minute |

## Développement

```bash
npm install
npm run build   # ESM + CJS + types, et dist/fomapay.js pour le CDN
npm test        # tests unitaires
```

Tests d'intégration contre le sandbox (ignorés si les variables sont absentes) :

```bash
FOMAPAY_API_URL=http://localhost:8080 FOMAPAY_TEST_SECRET_KEY=sk_test_… FOMAPAY_TEST_PUBLIC_KEY=pk_test_… npm test
```

Licence MIT.
