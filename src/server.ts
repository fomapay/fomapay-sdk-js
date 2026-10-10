import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CreatePaymentParams, Currency, DEFAULT_API_URL, FomaPayError, FomaPaySignatureError, HttpClient, HttpOptions, MobileOperator,
  Payment, StoreInfo, assertKey, newIdempotencyKey,
} from './core';

export { FomaPayApiError, FomaPayError, FomaPayNetworkError, FomaPaySignatureError } from './core';
export type * from './core';

export interface FomaPayServerOptions extends HttpOptions {
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

export interface VerifyOptions {
  /** Âge maximal accepté pour un événement, en secondes (300 par défaut). */
  toleranceSeconds?: number;
}

type RawBody = string | Uint8Array;

const toText = (payload: RawBody): string => (typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8'));

/** Vérification des webhooks, utilisable sans instancier de client. */
export const Webhook = {
  /** En-tête HTTP qui porte la signature. */
  SIGNATURE_HEADER: 'X-FomaPay-Signature',

  /**
   * Indique si la signature `X-FomaPay-Signature` est valide pour ce corps.
   * Passez le corps BRUT de la requête (string ou Buffer), tel que reçu.
   */
  verify(payload: RawBody, signature: string | string[] | undefined, secret: string, options: VerifyOptions = {}): boolean {
    if (!secret) {
      throw new FomaPayError('ERROR_WEBHOOK_SECRET_MISSING', 'Renseignez le secret de signature du webhook (whsec_…).');
    }
    const header = Array.isArray(signature) ? signature[0] : signature;
    if (!header) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
    if (!/^\d+$/.test(parts.t ?? '') || !parts.v1) return false;

    const expected = Buffer.from(createHmac('sha256', secret).update(`${parts.t}.`).update(payload).digest('hex'));
    const given = Buffer.from(parts.v1.toLowerCase());
    // Comparaison en temps constant.
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

    // Anti-rejeu : un événement trop ancien est refusé même si sa signature est valide.
    return Math.abs(Date.now() / 1000 - Number(parts.t)) <= (options.toleranceSeconds ?? 300);
  },

  /** Vérifie puis renvoie l'événement typé ; lève FomaPaySignatureError si la signature est invalide. */
  constructEvent<T = Payment>(payload: RawBody, signature: string | string[] | undefined, secret: string, options?: VerifyOptions): WebhookEvent<T> {
    if (!Webhook.verify(payload, signature, secret, options)) {
      throw new FomaPaySignatureError('Signature de webhook invalide ou expirée.');
    }
    return JSON.parse(toText(payload));
  },
};

/** SDK serveur (Node.js ≥ 18) : paiements, retraits, solde et vérification des webhooks. */
export class FomaPayServer {
  private readonly http: HttpClient;
  private readonly webhookSecret?: string;

  constructor(options: FomaPayServerOptions) {
    assertKey(options?.secretKey, 'sk');
    this.http = new HttpClient(options.secretKey, options.apiUrl ?? DEFAULT_API_URL, options);
    this.webhookSecret = options.webhookSecret;
  }

  readonly payments = {
    /** Porte toujours un en-tête Idempotency-Key : la création est rejouable sans doublon. */
    create: ({ idempotencyKey, ...params }: CreatePaymentParams): Promise<Payment> =>
      this.http.request('POST', '/v1/payments', params, { 'Idempotency-Key': idempotencyKey ?? newIdempotencyKey() }),
    /** Accepte l'identifiant ou la référence (FP-…). Source de vérité avant de livrer une commande. */
    retrieve: (id: string): Promise<Payment> => this.http.request('GET', `/v1/payments/${encodeURIComponent(id)}`),
    list: async (params: { limit?: number; status?: string } = {}): Promise<Payment[]> => {
      const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      return (await this.http.request<{ data: Payment[] }>('GET', `/v1/payments?${query}`)).data;
    },
    /** Envoie la demande de débit (push USSD) sur le téléphone du client. */
    payWithMobileMoney: (id: string, params: { operator: MobileOperator; phone: string }): Promise<Payment> =>
      this.http.request('POST', `/v1/payments/${encodeURIComponent(id)}/mobile-money`, params),
    /** Force l'issue d'un paiement. Sandbox uniquement. */
    simulate: (id: string, outcome: 'success' | 'failed' = 'success'): Promise<Payment> =>
      this.http.request('POST', `/v1/payments/${encodeURIComponent(id)}/simulate`, { outcome }),
  };

  /** Alias de `payments`. */
  readonly transactions = this.payments;

  readonly payouts = {
    /**
     * Retrait du solde de la boutique vers un compte Mobile Money.
     * Jamais rejoué automatiquement après une erreur réseau : un retrait ne doit pas partir deux fois.
     */
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

  /** Même vérification que `Webhook`, avec le `webhookSecret` du client par défaut. */
  readonly webhooks = {
    verify: (payload: RawBody, signature: string | string[] | undefined, options: VerifyOptions & { secret?: string } = {}): boolean =>
      Webhook.verify(payload, signature, options.secret ?? this.webhookSecret ?? '', options),

    constructEvent: <T = Payment>(
      payload: RawBody,
      signature: string | string[] | undefined,
      options: VerifyOptions & { secret?: string } = {},
    ): WebhookEvent<T> => Webhook.constructEvent<T>(payload, signature, options.secret ?? this.webhookSecret ?? '', options),
  };
}

export default FomaPayServer;
