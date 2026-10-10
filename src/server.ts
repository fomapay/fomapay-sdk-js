import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CreatePaymentParams, Currency, DEFAULT_API_URL, FomaPayError, HttpClient, MobileOperator, Payment, StoreInfo, assertKey,
} from './core';

export { FomaPayError } from './core';
export type * from './core';

export interface FomaPayServerOptions {
  /** Clé secrète de la boutique. Ne doit jamais quitter votre serveur. */
  secretKey: string;
  /** Secret de signature du webhook (whsec_…), affiché à la création de l'endpoint. */
  webhookSecret?: string;
  apiUrl?: string;
}

export interface WebhookEvent<T = Payment> {
  id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.expired' | 'payout.succeeded' | 'payout.failed' | 'webhook.test';
  created: string;
  livemode: boolean;
  data: T;
}

/** SDK serveur (Node.js ≥ 18) : paiements, retraits, solde et vérification des webhooks. */
export class FomaPayServer {
  private readonly http: HttpClient;
  private readonly webhookSecret?: string;

  constructor(options: FomaPayServerOptions) {
    assertKey(options?.secretKey, 'sk');
    this.http = new HttpClient(options.secretKey, options.apiUrl ?? DEFAULT_API_URL);
    this.webhookSecret = options.webhookSecret;
  }

  readonly payments = {
    create: ({ idempotencyKey, ...params }: CreatePaymentParams): Promise<Payment> =>
      this.http.request('POST', '/v1/payments', params, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    /** Accepte l'identifiant ou la référence (FP-…). Source de vérité avant de livrer une commande. */
    retrieve: (id: string): Promise<Payment> => this.http.request('GET', `/v1/payments/${encodeURIComponent(id)}`),
    list: async (params: { limit?: number; status?: string } = {}): Promise<Payment[]> => {
      const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      return (await this.http.request<{ data: Payment[] }>('GET', `/v1/payments?${query}`)).data;
    },
  };

  readonly payouts = {
    /** Retrait du solde de la boutique vers un compte Mobile Money. */
    create: (params: { amount: number; currency: Currency; operator: MobileOperator; phone: string; description?: string }): Promise<Payment> =>
      this.http.request('POST', '/v1/payouts', params),
  };

  readonly balance = {
    retrieve: async (): Promise<{ currency: Currency; available: number }[]> =>
      (await this.http.request<{ data: { currency: Currency; available: number }[] }>('GET', '/v1/balance')).data,
  };

  readonly store = {
    retrieve: (): Promise<StoreInfo> => this.http.request('GET', '/v1/store'),
  };

  readonly webhooks = {
    /**
     * Vérifie la signature `X-FomaPay-Signature` d'un webhook.
     * Passez de préférence le corps BRUT de la requête (string ou Buffer) :
     * un objet déjà parsé est re-sérialisé, ce qui ne fonctionne que si l'ordre des clés est intact.
     */
    verify: (
      payload: string | Uint8Array | object,
      signature: string | string[] | undefined,
      options: { secret?: string; toleranceSeconds?: number } = {},
    ): boolean => {
      const secret = options.secret ?? this.webhookSecret;
      if (!secret) {
        throw new FomaPayError('ERROR_WEBHOOK_SECRET_MISSING', 'Renseignez `webhookSecret` (whsec_…) pour vérifier les webhooks.');
      }
      const header = Array.isArray(signature) ? signature[0] : signature;
      if (!header) return false;
      const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
      const timestamp = Number(parts.t);
      if (!timestamp || !parts.v1) return false;

      // Anti-rejeu : un événement trop ancien est refusé même si sa signature est valide.
      const tolerance = options.toleranceSeconds ?? 300;
      if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) return false;

      const raw =
        typeof payload === 'string' ? payload
        : payload instanceof Uint8Array ? Buffer.from(payload).toString('utf8')
        : JSON.stringify(payload);
      const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex'));
      const given = Buffer.from(parts.v1);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },

    /** Vérifie puis renvoie l'événement typé ; lève une erreur si la signature est invalide. */
    constructEvent: <T = Payment>(
      payload: string | Uint8Array,
      signature: string | string[] | undefined,
      options?: { secret?: string; toleranceSeconds?: number },
    ): WebhookEvent<T> => {
      if (!this.webhooks.verify(payload, signature, options)) {
        throw new FomaPayError('ERROR_INVALID_SIGNATURE', 'Signature de webhook invalide ou expirée.', 400);
      }
      return JSON.parse(typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8'));
    },
  };
}
