# @fomapay/sdk-js

SDK officiel FomaPay pour JavaScript / TypeScript : React, Next.js, Vue, JS vanilla, Node.js, Electron, Tauri.
Zéro dépendance, entièrement typé, deux modes de paiement :

- **FomaPay Direct** — le client paie depuis son portefeuille FomaPay (QR code). Disponible dès le **Niveau 0**, sans aucun document.
- **Mobile Money** — M-Pesa, Orange Money, Airtel Money. Réservé aux comptes vérifiés (**Niveau 1+**).

```bash
npm install @fomapay/sdk-js
```

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

## Sandbox

Utilisez vos clés `pk_test_…` / `sk_test_…` : aucune somme réelle n'est déplacée et la fenêtre de paiement propose
« Simuler un succès / un échec ». Numéros Mobile Money de test :

| Numéro finissant par | Résultat |
| --- | --- |
| `0001` | Refus (solde insuffisant) |
| `0002` | Le client ne valide jamais → expiration |
| tout autre | Succès après ~3 s |

## Erreurs

Chaque erreur est une `FomaPayError` avec un `code` stable et un `message` lisible :

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
npm test
```

Licence MIT.
