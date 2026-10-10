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
  callbackUrl: string | null;
  payerPhone: string | null;
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
  /** Page de votre site vers laquelle renvoyer le client une fois le paiement terminé. */
  callbackUrl?: string;
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

/** L'API a répondu avec une erreur. */
export class FomaPayApiError extends FomaPayError {
  constructor(code: string, message: string, status = 0, details?: Record<string, unknown>) {
    super(code, message, status, details);
    this.name = 'FomaPayApiError';
  }
}

/** Aucune réponse : connexion impossible (ERROR_NETWORK) ou délai dépassé (ERROR_TIMEOUT). */
export class FomaPayNetworkError extends FomaPayError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'FomaPayNetworkError';
  }
}

/** Signature de webhook invalide ou expirée. */
export class FomaPaySignatureError extends FomaPayError {
  constructor(message: string) {
    super('ERROR_INVALID_SIGNATURE', message, 400);
    this.name = 'FomaPaySignatureError';
  }
}

export const DEFAULT_API_URL = 'https://api.fomapay.cd';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8_000;

export interface HttpOptions {
  /** Délai maximal d'une requête, en millisecondes (30 000 par défaut). */
  timeoutMs?: number;
  /** Nouvelles tentatives après un échec rejouable (2 par défaut). */
  maxRetries?: number;
  /** Implémentation de fetch à utiliser (tests, proxy…). */
  fetch?: typeof fetch;
}

/** Clé unique : rejouer la requête ne crée pas de doublon. */
export const newIdempotencyKey = (): string =>
  `js-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

/** 0,5 s, 1 s, 2 s… plafonné à 8 s, avec un aléa pour désynchroniser les clients. */
const backoff = (attempt: number): number => {
  const delay = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  return delay / 2 + Math.random() * (delay / 2);
};

interface Attempt<T> {
  data?: T;
  error?: FomaPayError;
  retry?: boolean;
  waitMs?: number;
}

/** Client HTTP minimal partagé par le SDK navigateur et le SDK serveur. */
export class HttpClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl?: typeof fetch;
  /** Remplaçable dans les tests. */
  sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  constructor(
    private readonly key: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
    options: HttpOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.fetchImpl = options.fetch;
  }

  get baseUrl(): string {
    return this.apiUrl.replace(/\/+$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    // Seules les requêtes sans risque de doublon sont rejouées : lectures et POST idempotents.
    const replayable = method === 'GET' || 'Idempotency-Key' in headers;
    for (let attempt = 0; ; attempt++) {
      const { data, error, retry, waitMs } = await this.attempt<T>(method, path, body, headers, replayable);
      if (!error) return data as T;
      if (!retry || attempt >= this.maxRetries) throw error;
      await this.sleep(waitMs ?? backoff(attempt));
    }
  }

  private async attempt<T>(
    method: string, path: string, body: unknown, headers: Record<string, string>, replayable: boolean,
  ): Promise<Attempt<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    let data: any;
    try {
      res = await (this.fetchImpl ?? fetch)(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      data = await res.json().catch(() => null);
    } catch {
      const error = controller.signal.aborted
        ? new FomaPayNetworkError('ERROR_TIMEOUT', "FomaPay n'a pas répondu dans le délai imparti.")
        : new FomaPayNetworkError('ERROR_NETWORK', 'Impossible de joindre FomaPay. Vérifiez votre connexion Internet.');
      return { error, retry: replayable };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return { data: data as T };

    const err = data?.error ?? {};
    const error = new FomaPayApiError(err.code ?? 'ERROR_UNKNOWN', err.message ?? `Erreur HTTP ${res.status}`, res.status, err.details);
    if (res.status === 429) {
      // La gateway a refusé la requête avant tout traitement : toujours rejouable.
      const retryAfter = Number(res.headers.get('Retry-After'));
      return { error, retry: true, waitMs: retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS) : undefined };
    }
    return { error, retry: res.status >= 500 && replayable };
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
