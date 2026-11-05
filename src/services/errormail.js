// Erreurs de l'application (toute réponse d'erreur sauf 404, tâche en échec, arrêt du processus) envoyées par mail en HTML à l'adresse du
// développeur (ERROR_ALERT_TO, contact@tony-averty.dev par défaut), via le SMTP du serveur (SYSTEM_SMTP_*).
// Jamais bloquant : l'envoi part en arrière-plan et ses propres erreurs sont avalées. Le mail ne contient ni cookie, ni en-tête,
// ni corps de requête, ni paramètres d'URL ; les jetons et secrets reconnaissables sont masqués ; la requête SQL n'est pas jointe.
import { esc } from '../http.js';
import { createTransport } from './mailer.js';
import { mailLayout } from './mailhtml.js';
import { pinSmtp } from '../netguard.js';

const SAME_ERROR_MS = 30 * 60_000; // la même erreur ne repart pas avant 30 minutes (elle est comptée dans le mail suivant)
// Deux budgets par heure : une rafale d'erreurs de requête (robots, sessions expirées, saisies refusées) ne doit jamais masquer une vraie panne
const MAX_PER_HOUR = { server: 20, request: 6 };
const HOUR_MS = 3_600_000;

/** Masque ce qui ressemble à un secret : jetons iaboss_ ou aitk_, « Bearer … », mots de passe d'URL, longues chaînes hexadécimales ou base64. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(iaboss|aitk)_[A-Za-z0-9_-]+/g, '$1_[masqué]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [masqué]')
    .replace(/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, '$1[masqué]@')
    .replace(/\b(password|passwd|pass|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[masqué]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[masqué]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[masqué]');
}

/** Numéros d'une adresse (/projects/12/…) remplacés : la même erreur sur deux projets est la même erreur. */
const route = (path) => String(path).split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:n');
const signature = (e, { status, method, path } = {}) => (status && status < 500
  ? `${status}|${method}|${route(path)}|${String(e?.message).slice(0, 160)}`
  : `${e?.name}|${e?.code ?? ''}|${String(e?.message).slice(0, 160)}|${String(e?.stack ?? '').split('\n')[1] ?? ''}`).trim();

/** Nature de l'erreur, pour le titre et le sujet du mail. */
const kindOf = ({ status, method }) => (method === 'JOB' ? 'Tâche en échec' : method === 'process' ? 'Arrêt du processus' : status && status < 500 ? 'Erreur de requête' : 'Erreur serveur');

/** Contenu du mail : titre, circonstances, détail technique. */
export function errorMail({ error, method, path, userId, at, repeats, appUrl, status = null }) {
  const e = error instanceof Error ? error : new Error(String(error));
  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;font-size:14px;color:#55638a;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:4px 0;font-size:14px;color:#0e1535;">${v}</td></tr>`;
  const mono = (s) => `<code style="font-family:SFMono-Regular,Consolas,monospace;font-size:13px;">${esc(s)}</code>`;
  const stack = redact(String(e.stack || '').split('\n').slice(0, 14).join('\n'));
  const extra = [
    e.code ? row('Code', mono(e.code)) : '',
    e.sqlMessage ? row('Base de données', esc(redact(e.sqlMessage).slice(0, 300))) : '',
  ].join('');
  const content = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
    ${row('Date', esc(at))}
    ${row('Type', esc(kindOf({ status, method })))}
    ${status ? row('Statut HTTP', mono(status)) : ''}
    ${row(method === 'JOB' ? 'Tâche' : 'Requête', mono(method === 'JOB' ? path : `${method} ${path}`))}
    ${row('Compte', userId ? `n° ${esc(userId)}` : 'visiteur ou API')}
    ${row('Erreur', `<strong>${esc(redact(e.name))}</strong> : ${esc(redact(e.message).slice(0, 400))}`)}
    ${extra}
    ${repeats ? row('Répétitions', `${esc(repeats)} fois depuis le dernier mail`) : ''}
  </table>
  <div style="margin:0 0 6px;font-size:13px;font-weight:600;color:#55638a;">Trace</div>
  <pre style="margin:0;padding:12px;background:#f4f7fc;border:1px solid #d8e0ef;border-radius:8px;font-family:SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5;color:#0e1535;white-space:pre-wrap;word-break:break-word;">${esc(stack)}</pre>
  <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#55638a;">Les logs complets sont dans la sortie du processus (<code>pm2 logs</code>). Aucun cookie, en-tête, corps de requête ni paramètre d'URL n'est joint à ce mail.</p>`;
  return mailLayout({
    title: kindOf({ status, method }), subtitle: method === 'JOB' ? `Tâche ${path}` : `${status ? `${status} · ` : ''}${method} ${path}`, preheader: `${e.name} : ${redact(e.message).slice(0, 90)}`,
    content, appUrl, footer: 'Alerte automatique iaboss, envoyée à l\'adresse du développeur.',
  });
}

/**
 * À appeler pour toute erreur sauf un 404 : réponse d'erreur (`status`), tâche en échec (`method: 'JOB'`), arrêt du processus (`method: 'process'`).
 * Ne lève jamais, ne retarde jamais la réponse.
 * @returns {Promise<{sent: boolean, reason?: string}>} (résultat utile aux tests ; l'appelant n'a pas à l'attendre)
 */
export async function reportError(app, error, { method = '?', path = '?', userId = null, status = error?.status ?? null } = {}) {
  try {
    const smtp = app.cfg.errorSmtp || app.cfg.systemSmtp; // boîte erreur@ si elle est configurée
    const to = app.cfg.errorAlertTo ?? app.cfg.adminEmails ?? [];
    if (!smtp || !to.length) return { sent: false, reason: 'smtp-ou-admin-absent' };
    if (status === 404) return { sent: false, reason: 'introuvable' }; // une page qui n'existe pas n'est pas une erreur de l'application
    const st = (app.errorMail ??= { seen: new Map(), sent: {} });
    const nowMs = Date.now();
    const key = signature(error, { status, method, path });
    const prev = st.seen.get(key);
    if (prev && nowMs - prev.at < SAME_ERROR_MS) { prev.repeats++; return { sent: false, reason: 'deja-signalee' }; }
    const budget = status && status < 500 && method !== 'JOB' ? 'request' : 'server';
    const sent = (st.sent[budget] = (st.sent[budget] || []).filter((t) => nowMs - t < HOUR_MS));
    if (sent.length >= MAX_PER_HOUR[budget]) return { sent: false, reason: 'limite-horaire' };
    sent.push(nowMs);
    st.seen.set(key, { at: nowMs, repeats: 0 });
    for (const [k, v] of st.seen) if (nowMs - v.at > SAME_ERROR_MS) st.seen.delete(k); // la table ne grossit pas
    const repeats = prev?.repeats || 0;
    const at = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date(nowMs));
    const safePath = String(path).split('?')[0].slice(0, 200);
    const e = error instanceof Error ? error : new Error(String(error));
    const kind = kindOf({ status, method });
    const what = method === 'JOB' ? `tâche ${safePath}` : `${method} ${safePath}`;
    const text = [`${kind} : ${what}${status ? ` (HTTP ${status})` : ''}`, `Date : ${at}`, `${e.name} : ${redact(e.message).slice(0, 400)}`, '', redact(String(e.stack || '').split('\n').slice(0, 14).join('\n'))].join('\n');
    const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
    try {
      await transport.sendMail({
        from: smtp.fromEmail, to: to.join(', '), subject: `[iaboss] ${kind}${status ? ` ${status}` : ''} · ${what}`, text,
        html: errorMail({ error: e, method, path: safePath, userId, at, repeats, appUrl: app.cfg.appUrl, status }),
      });
    } finally { transport.close?.(); }
    return { sent: true };
  } catch (err) {
    console.error('[alerte-erreur] envoi impossible :', err.message);
    return { sent: false, reason: 'envoi-impossible' };
  }
}
