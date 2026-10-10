import {
  CreatePaymentParams, Currency, DEFAULT_API_URL, FomaPayError, HttpClient, MobileOperator, Payment, StoreInfo, assertKey,
} from './core';
import { Customization, openCheckout } from './modal';

export { FomaPayError, formatAmount } from './core';
export type * from './core';
export type { Customization } from './modal';

export interface FomaPayOptions {
  /** Clé publique de la boutique (pk_test_… ou pk_live_…). */
  publicKey: string;
  /** Optionnel : sert uniquement à détecter une clé qui ne correspond pas à l'environnement voulu. */
  environment?: 'live' | 'sandbox' | 'test';
  /** À surcharger pour pointer vers une gateway locale en développement. */
  apiUrl?: string;
}

export interface CheckoutParams extends CreatePaymentParams {
  customization?: Customization;
}

export interface CheckoutResult extends Payment {
  /** Alias de `id`, pour la lisibilité côté intégrateur. */
  transactionId: string;
}

/** SDK navigateur FomaPay. N'utilise que la clé publique : aucun secret dans la page. */
export class FomaPay {
  private readonly http: HttpClient;
  private storeInfo?: Promise<StoreInfo>;

  constructor(options: FomaPayOptions) {
    assertKey(options?.publicKey, 'pk', options.environment);
    this.http = new HttpClient(options.publicKey, options.apiUrl ?? DEFAULT_API_URL);
  }

  /** Boutique liée à la clé, avec les modes de paiement que son niveau KYC autorise. */
  store(): Promise<StoreInfo> {
    return (this.storeInfo ??= this.http.request<StoreInfo>('GET', '/v1/store'));
  }

  /**
   * Ouvre la fenêtre de paiement. La promesse est résolue quand le paiement est confirmé,
   * rejetée (FomaPayError) si le client ferme la fenêtre ou si la création échoue.
   * Confirmez toujours la commande côté serveur (webhook ou `payments.retrieve`).
   */
  async checkout({ customization, ...params }: CheckoutParams): Promise<CheckoutResult> {
    if (typeof document === 'undefined') {
      throw new FomaPayError('ERROR_BROWSER_ONLY', 'checkout() ne fonctionne que dans un navigateur. Côté serveur, utilisez @fomapay/sdk-js/server.');
    }
    const [store, payment] = await Promise.all([this.store(), this.createPayment(params)]);
    const result = await openCheckout(this.http, store, payment, customization);
    return { ...result, transactionId: result.id };
  }

  // ───────── API bas niveau, pour construire sa propre interface ─────────

  createPayment({ idempotencyKey, ...params }: CreatePaymentParams): Promise<Payment> {
    return this.http.request('POST', '/v1/payments', params, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {});
  }

  getPayment(id: string): Promise<Payment> {
    return this.http.request('GET', `/v1/payments/${encodeURIComponent(id)}`);
  }

  payWithMobileMoney(id: string, operator: MobileOperator, phone: string): Promise<Payment> {
    return this.http.request('POST', `/v1/payments/${encodeURIComponent(id)}/mobile-money`, { operator, phone });
  }

  /** Attend l'issue d'un paiement (succès, échec ou expiration). */
  async waitForPayment(id: string, { intervalMs = 2500, timeoutMs = 10 * 60_000 } = {}): Promise<Payment> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const payment = await this.getPayment(id);
      if (payment.status !== 'pending' && payment.status !== 'processing') return payment;
      if (Date.now() > deadline) throw new FomaPayError('ERROR_TIMEOUT', "Le paiement n'a pas été confirmé à temps.");
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

// ───────── Web Component : <fomapay-button amount="10" currency="USD" public-key="pk_…"> ─────────

function defineButton(): void {
  if (typeof customElements === 'undefined' || customElements.get('fomapay-button')) return;

  class FomaPayButton extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      const amount = Number(this.getAttribute('amount'));
      const currency = (this.getAttribute('currency') ?? 'USD').toUpperCase() as Currency;
      const label = this.getAttribute('label') ?? 'Payer avec FomaPay';
      root.innerHTML = `<style>
          button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; padding: 13px 22px;
            border-radius: 14px; font: 700 15px "Plus Jakarta Sans", system-ui, sans-serif; color: #fff;
            background: linear-gradient(135deg, #032b56, #06407c); transition: transform .12s, box-shadow .18s; }
          button:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -8px rgba(3,43,86,.6); }
          button:focus-visible { outline: 3px solid #00c4b4; outline-offset: 2px; }
          button[disabled] { opacity: .6; cursor: progress; }
          i { width: 9px; height: 9px; border-radius: 50%; background: #00c4b4; box-shadow: 0 0 0 4px rgba(0,196,180,.25); }
        </style><button type="button"><i></i><span></span></button>`;
      const button = root.querySelector('button')!;
      root.querySelector('span')!.textContent = label;

      button.addEventListener('click', async () => {
        button.setAttribute('disabled', '');
        try {
          const fomapay = new FomaPay({
            publicKey: this.getAttribute('public-key') ?? '',
            apiUrl: this.getAttribute('api-url') ?? undefined,
          });
          const payment = await fomapay.checkout({
            amount,
            currency,
            orderId: this.getAttribute('order-id') ?? undefined,
            description: this.getAttribute('description') ?? undefined,
          });
          this.dispatchEvent(new CustomEvent('fomapay:success', { detail: payment, bubbles: true }));
        } catch (error) {
          this.dispatchEvent(new CustomEvent('fomapay:error', { detail: error, bubbles: true }));
        } finally {
          button.removeAttribute('disabled');
        }
      });
    }
  }
  customElements.define('fomapay-button', FomaPayButton);
}

defineButton();

export { DEFAULT_API_URL };
export default FomaPay;
