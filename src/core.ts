export type Currency = 'USD' | 'CDF';
export type PaymentMode = 'fomapay_direct' | 'mobile_money';
export type MobileOperator = 'mpesa' | 'orange_money' | 'airtel_money';
export type PaymentStatus = 'pending' | 'processing' | 'success' | 'failed' | 'expired';

export interface Customer {
  name?: string;
  phone?: string;
  email?: string;
}

export interface Payment {
  id: string;
  object: string;
  reference: string;
  status: PaymentStatus;
  amount: number;
  fee: number;
  net: number;
  currency: Currency;
  channel: string | null;
  orderId: string | null;
  description: string | null;
  customer: Customer | null;
  metadata: Record<string, unknown> | null;
  paymentModes: PaymentMode[];
  qrCode: string | null;
  livemode: boolean;
  storeId: string;
  failureCode: string | null;
  failureReason: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface StoreInfo {
  id: string;
  name: string;
  shortCode: string;
  logoUrl: string | null;
  livemode: boolean;
  kycLevel: number;
  paymentModes: PaymentMode[];
}

export interface CreatePaymentParams {
  amount: number;
  currency: Currency;
  orderId?: string;
  description?: string;
  customer?: Customer;
  metadata?: Record<string, unknown>;
  paymentModes?: PaymentMode[];
  /** Rend la création rejouable sans risque de doublon (ex. : identifiant de commande). */
  idempotencyKey?: string;
}

/**
 * Erreur FomaPay : `code` est stable et exploitable par le code
 * (ex. ERROR_LEVEL_0_LIMIT_REACHED), `message` est lisible par un humain.
 */
export class FomaPayError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 0, details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = 'FomaPayError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const DEFAULT_API_URL = 'https://api.fomapay.cd';

/** Client HTTP minimal partagé par le SDK navigateur et le SDK serveur. */
export class HttpClient {
  constructor(
    private readonly key: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
  ) {}

  get baseUrl(): string {
    return this.apiUrl.replace(/\/+$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new FomaPayError('ERROR_NETWORK', 'Impossible de joindre FomaPay. Vérifiez votre connexion Internet.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new FomaPayError(err.code ?? 'ERROR_UNKNOWN', err.message ?? `Erreur HTTP ${res.status}`, res.status, err.details);
    }
    return data as T;
  }
}

export function assertKey(key: string | undefined, kind: 'pk' | 'sk', environment?: 'live' | 'sandbox' | 'test'): void {
  const label = kind === 'pk' ? 'publique (pk_…)' : 'secrète (sk_…)';
  if (!key || !new RegExp(`^${kind}_(test|live)_`).test(key)) {
    throw new FomaPayError(
      'ERROR_INVALID_API_KEY',
      `Clé ${label} absente ou mal formée. Générez vos clés dans FomaPay Business › Développeurs.`,
    );
  }
  const isLive = key.startsWith(`${kind}_live_`);
  if (environment && (environment === 'live') !== isLive) {
    throw new FomaPayError(
      'ERROR_ENVIRONMENT_MISMATCH',
      `L'environnement « ${environment} » ne correspond pas à la clé fournie (${isLive ? 'live' : 'test'}).`,
    );
  }
}

export const formatAmount = (amount: number, currency: Currency): string =>
  new Intl.NumberFormat('fr-CD', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'CDF' ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
