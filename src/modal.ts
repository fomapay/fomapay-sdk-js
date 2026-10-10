import { FomaPayError, HttpClient, MobileOperator, Payment, StoreInfo, formatAmount } from './core';

export interface Customization {
  title?: string;
  description?: string;
  logoUrl?: string;
}

const OPERATORS: { id: MobileOperator; name: string; color: string }[] = [
  { id: 'mpesa', name: 'M-Pesa', color: '#E60000' },
  { id: 'orange_money', name: 'Orange Money', color: '#FF7900' },
  { id: 'airtel_money', name: 'Airtel Money', color: '#ED1C24' },
];

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.overlay { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px;
  background: rgba(3, 20, 43, .62); backdrop-filter: blur(6px); animation: fade .2s ease-out; }
.sheet { width: 100%; max-width: 408px; max-height: calc(100dvh - 32px); overflow: auto; border-radius: 24px; background: #fff; color: #0f172a;
  box-shadow: 0 32px 80px -16px rgba(3, 43, 86, .55); animation: rise .34s cubic-bezier(.2, .9, .25, 1.05); }
.head { position: relative; padding: 22px 24px 26px; color: #fff; border-radius: 24px 24px 0 0;
  background: radial-gradient(120% 140% at 100% 0%, #00a896 0%, transparent 55%), linear-gradient(135deg, #032b56, #06407c); }
.brand { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; opacity: .92; }
.logo { width: 30px; height: 30px; border-radius: 9px; object-fit: cover; background: rgba(255,255,255,.14); display: grid; place-items: center; font-weight: 800; font-size: 13px; }
.amount { margin-top: 16px; font-size: 34px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.desc { margin-top: 4px; font-size: 13px; opacity: .78; }
.close { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border: 0; border-radius: 50%; cursor: pointer;
  color: #fff; background: rgba(255,255,255,.14); font-size: 18px; line-height: 1; transition: background .15s; }
.close:hover { background: rgba(255,255,255,.26); }
.test { display: inline-block; margin-left: auto; margin-right: 40px; padding: 3px 9px; border-radius: 99px; font-size: 10.5px; font-weight: 700;
  letter-spacing: .08em; background: #fbbf24; color: #422006; }
.body { padding: 20px 24px 22px; }
.tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: #f1f5f9; }
.tab { padding: 10px 8px; border: 0; border-radius: 10px; background: transparent; color: #64748b; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: all .18s; }
.tab[aria-selected="true"] { background: #fff; color: #032b56; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
.panel { margin-top: 18px; animation: fade .22s ease-out; }
.qr { display: grid; place-items: center; gap: 12px; text-align: center; }
.qr img { width: 196px; height: 196px; padding: 10px; border-radius: 18px; border: 1px solid #e2e8f0; background: #fff; }
.ref { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 10px; background: #f1f5f9;
  font: 600 13px ui-monospace, "JetBrains Mono", Menlo, monospace; color: #032b56; letter-spacing: .04em; }
.hint { font-size: 13px; line-height: 1.5; color: #64748b; }
.ops { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.op { padding: 12px 6px; border: 1.5px solid #e2e8f0; border-radius: 14px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 600; color: #334155;
  display: grid; justify-items: center; gap: 8px; transition: all .16s; }
.op i { width: 26px; height: 26px; border-radius: 50%; }
.op[aria-pressed="true"] { border-color: #00a896; background: #f0fdfa; color: #032b56; box-shadow: 0 0 0 3px rgba(0,196,180,.16); }
label { display: block; margin: 16px 0 6px; font-size: 12.5px; font-weight: 600; color: #475569; }
input { width: 100%; padding: 13px 14px; border: 1.5px solid #e2e8f0; border-radius: 14px; font-size: 16px; color: #0f172a; outline: none;
  font-variant-numeric: tabular-nums; transition: border-color .15s, box-shadow .15s; }
input:focus { border-color: #00a896; box-shadow: 0 0 0 3px rgba(0,196,180,.18); }
.btn { width: 100%; margin-top: 16px; padding: 14px; border: 0; border-radius: 14px; cursor: pointer; font-size: 15px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #032b56, #06407c); transition: transform .12s, box-shadow .18s, opacity .15s; }
.btn:hover:not(:disabled) { box-shadow: 0 10px 24px -8px rgba(3,43,86,.6); transform: translateY(-1px); }
.btn:active:not(:disabled) { transform: translateY(0); }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn.ghost { margin-top: 8px; background: #f1f5f9; color: #334155; }
.sim { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0; }
.sim button { padding: 9px; border-radius: 10px; border: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; font-weight: 600; cursor: pointer; }
.error { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: #fef2f2; color: #b91c1c; font-size: 13px; line-height: 1.45; }
.state { display: grid; justify-items: center; gap: 12px; padding: 18px 0 6px; text-align: center; }
.state h3 { font-size: 19px; font-weight: 800; color: #032b56; }
.spinner { width: 54px; height: 54px; border-radius: 50%; border: 4px solid #e2e8f0; border-top-color: #00a896; animation: spin .8s linear infinite; }
.badge { width: 68px; height: 68px; border-radius: 50%; display: grid; place-items: center; animation: pop .45s cubic-bezier(.2, 1.4, .4, 1); }
.badge.ok { background: #00c4b4; box-shadow: 0 0 0 10px rgba(0,196,180,.16); }
.badge.ko { background: #ef4444; box-shadow: 0 0 0 10px rgba(239,68,68,.14); }
.badge svg { width: 32px; height: 32px; stroke: #fff; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 48; stroke-dashoffset: 48; animation: draw .4s .2s ease-out forwards; }
.foot { padding: 0 24px 18px; text-align: center; font-size: 11.5px; color: #94a3b8; }
.foot b { color: #032b56; }
@keyframes fade { from { opacity: 0 } }
@keyframes rise { from { opacity: 0; transform: translateY(24px) scale(.97) } }
@keyframes spin { to { transform: rotate(360deg) } }
@keyframes pop { from { transform: scale(.4); opacity: 0 } }
@keyframes draw { to { stroke-dashoffset: 0 } }
@media (max-width: 480px) {
  .overlay { padding: 0; place-items: end center; }
  .sheet { max-width: none; border-radius: 24px 24px 0 0; animation-name: slide; }
  @keyframes slide { from { transform: translateY(100%) } }
}
@media (prefers-reduced-motion: reduce) { *, .sheet { animation: none !important; transition: none !important; } }
`;

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Seules les images http(s) sont acceptées comme logo. */
const safeUrl = (url?: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/**
 * Fenêtre de paiement FomaPay, isolée dans un Shadow DOM
 * pour ne jamais entrer en conflit avec les styles du site marchand.
 */
export function openCheckout(
  http: HttpClient,
  store: StoreInfo,
  initial: Payment,
  customization: Customization = {},
): Promise<Payment> {
  return new Promise((resolve, reject) => {
    let payment = initial;
    let mode = payment.paymentModes[0];
    let operator: MobileOperator = 'mpesa';
    let phone = payment.customer?.phone ?? '';
    let error = '';
    let busy = false;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const host = document.createElement('div');
    host.setAttribute('data-fomapay-checkout', '');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const mount = document.createElement('div');
    root.append(style, mount);
    document.body.appendChild(host);
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    const finish = (result: () => void) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      host.remove();
      previousFocus?.focus?.();
      result();
    };
    const cancel = () => {
      if (payment.status === 'success') return finish(() => resolve(payment));
      finish(() => reject(new FomaPayError('ERROR_CHECKOUT_CLOSED', 'Le paiement a été annulé par le client.')));
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    document.addEventListener('keydown', onKey);

    // Suivi du statut : le serveur FomaPay reste la seule source de vérité.
    const poll = async () => {
      if (closed) return;
      try {
        const next = await http.request<Payment>('GET', `/v1/payments/${payment.id}`);
        const changed = next.status !== payment.status;
        payment = next;
        if (changed) render();
      } catch {
        /* coupure réseau passagère : on réessaie au prochain tour */
      }
      if (!closed && (payment.status === 'pending' || payment.status === 'processing')) timer = setTimeout(poll, 2500);
    };

    const act = async (fn: () => Promise<Payment>) => {
      if (busy) return;
      busy = true;
      error = '';
      render();
      try {
        payment = await fn();
      } catch (e) {
        error = e instanceof FomaPayError ? e.message.replace(/^[A-Z0-9_]+: /, '') : 'Une erreur est survenue. Réessayez.';
      }
      busy = false;
      render();
    };

    const header = () => {
      const logo = safeUrl(customization.logoUrl) ?? safeUrl(store.logoUrl);
      const title = customization.title ?? store.name;
      return `
        <div class="head">
          <div class="brand">
            ${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : `<span class="logo">${esc(title.slice(0, 1).toUpperCase())}</span>`}
            <span>${esc(title)}</span>
            ${payment.livemode ? '' : '<span class="test">MODE TEST</span>'}
          </div>
          <div class="amount">${esc(formatAmount(payment.amount, payment.currency))}</div>
          <div class="desc">${esc(customization.description ?? payment.description ?? '')}</div>
          <button class="close" data-act="close" aria-label="Fermer">×</button>
        </div>`;
    };

    const body = () => {
      if (payment.status === 'success') {
        return `<div class="state" role="status">
          <div class="badge ok"><svg viewBox="0 0 32 32"><path d="M8 16.5l5.5 5.5L24 11"/></svg></div>
          <h3>Paiement réussi</h3>
          <p class="hint">${esc(formatAmount(payment.amount, payment.currency))} payés à ${esc(store.name)}.</p>
          <span class="ref">${esc(payment.reference)}</span>
          <button class="btn" data-act="done">Terminer</button>
        </div>`;
      }
      if (payment.status === 'failed' || payment.status === 'expired') {
        return `<div class="state" role="alert">
          <div class="badge ko"><svg viewBox="0 0 32 32"><path d="M10 10l12 12M22 10L10 22"/></svg></div>
          <h3>${payment.status === 'expired' ? 'Délai dépassé' : 'Paiement non abouti'}</h3>
          <p class="hint">${esc(payment.failureReason ?? "Le paiement n'a pas pu être finalisé.")}</p>
          <button class="btn ghost" data-act="close">Fermer</button>
        </div>`;
      }
      if (payment.status === 'processing') {
        return `<div class="state" role="status">
          <div class="spinner"></div>
          <h3>Validez sur votre téléphone</h3>
          <p class="hint">Une demande a été envoyée au <b>${esc(phone)}</b>.<br>Saisissez votre code PIN Mobile Money pour confirmer.</p>
        </div>`;
      }

      const tabs = payment.paymentModes.length > 1
        ? `<div class="tabs" role="tablist">
            ${payment.paymentModes.map((m) => `<button class="tab" role="tab" data-mode="${m}" aria-selected="${m === mode}">
              ${m === 'fomapay_direct' ? 'FomaPay' : 'Mobile Money'}</button>`).join('')}
          </div>`
        : '';

      const direct = `<div class="panel qr">
          <img alt="QR code de paiement" src="${esc(`${http.baseUrl}/qr?size=392&data=${encodeURIComponent(payment.qrCode ?? payment.reference)}`)}">
          <span class="ref">${esc(payment.reference)}</span>
          <p class="hint">Scannez ce code avec l'application <b>FomaPay</b>,<br>ou saisissez la référence dans « Payer ».</p>
        </div>`;

      const mobile = `<div class="panel">
          <div class="ops">
            ${OPERATORS.map((o) => `<button class="op" data-op="${o.id}" aria-pressed="${o.id === operator}">
              <i style="background:${o.color}"></i>${o.name}</button>`).join('')}
          </div>
          <label for="fp-phone">Numéro Mobile Money</label>
          <input id="fp-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+243 81 000 0000" value="${esc(phone)}">
          <button class="btn" data-act="pay" ${busy ? 'disabled' : ''}>${busy ? 'Envoi de la demande…' : `Payer ${esc(formatAmount(payment.amount, payment.currency))}`}</button>
        </div>`;

      const simulate = payment.livemode ? '' : `<div class="sim">
          <button data-sim="success">Simuler un succès</button>
          <button data-sim="failed">Simuler un échec</button>
        </div>`;

      return `${tabs}${mode === 'fomapay_direct' ? direct : mobile}${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}${simulate}`;
    };

    function render() {
      const focusedPhone = (root.activeElement as HTMLElement | null)?.id === 'fp-phone';
      mount.innerHTML = `<div class="overlay" data-act="backdrop">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Paiement FomaPay">
          ${header()}<div class="body">${body()}</div>
          <div class="foot">Paiement sécurisé par <b>FomaPay</b></div>
        </div></div>`;
      const input = root.getElementById('fp-phone') as HTMLInputElement | null;
      input?.addEventListener('input', () => (phone = input.value));
      if (focusedPhone && input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    mount.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const target = el.closest<HTMLElement>('[data-act],[data-mode],[data-op],[data-sim]');
      if (!target) return;
      const { act: action, mode: nextMode, op, sim } = target.dataset;
      if (action === 'backdrop' && el !== target) return; // clic à l'intérieur de la fenêtre
      if (action === 'close' || action === 'backdrop') return cancel();
      if (action === 'done') return finish(() => resolve(payment));
      if (nextMode) { mode = nextMode as typeof mode; error = ''; return render(); }
      if (op) { operator = op as MobileOperator; return render(); }
      if (sim) return void act(() => http.request('POST', `/v1/payments/${payment.id}/simulate`, { outcome: sim }));
      if (action === 'pay') {
        return void act(async () => {
          const next = await http.request<Payment>('POST', `/v1/payments/${payment.id}/mobile-money`, { operator, phone });
          clearTimeout(timer);
          timer = setTimeout(poll, 2000);
          return next;
        });
      }
    });

    render();
    timer = setTimeout(poll, 2500);
  });
}
