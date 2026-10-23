// Gabarits HTML des mails. Styles inline + tableaux : c'est ce que Gmail, Outlook et Apple Mail rendent pareil.
// Chaque mail garde aussi sa version texte (lisible partout, et meilleure délivrabilité).
import { esc } from '../http.js';
import { renderMarkdown, inlineMd, parseEvolutions, EFFORTS } from './markdown.js';

// Palette du design (public/tokens.css, thème clair : les clients mail ne suivent pas le thème sombre du système).
// Pas de variables CSS dans un mail : les valeurs sont recopiées ici, et le texte du bouton à dégradé est toujours #081022.
const C = {
  bg: '#f4f7fc', card: '#ffffff', text: '#0e1535', muted: '#55638a', line: '#d8e0ef',
  indigo: '#1e296a', accent: '#1288b7', accent2: '#0db8c5', accentSoft: '#e1f1f8', link: '#0b6f96', ok: '#0e6b43', onGrad: '#081022', headText: '#e1e9f6',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const MD_STYLES = {
  p: `margin:0 0 12px;font-size:15px;line-height:1.6;color:${C.text}`,
  ul: 'margin:0 0 12px;padding-left:20px',
  ol: 'margin:0 0 12px;padding-left:20px',
  li: `margin:0 0 6px;font-size:15px;line-height:1.55;color:${C.text}`,
  strong: `color:${C.text};font-weight:600`,
  code: `font-family:SFMono-Regular,Consolas,monospace;font-size:13px;background:${C.bg};border:1px solid ${C.line};border-radius:4px;padding:1px 5px`,
  pre: `margin:0 0 12px;padding:12px;background:${C.bg};border-radius:8px;font-size:13px;white-space:pre-wrap`,
  a: `color:${C.link}`,
  h1: `margin:18px 0 8px;font-size:20px;color:${C.text}`,
  h2: `margin:18px 0 8px;font-size:18px;color:${C.text}`,
  h3: `margin:16px 0 8px;font-size:16px;color:${C.text}`,
  h4: `margin:14px 0 6px;font-size:15px;color:${C.text}`,
  blockquote: `margin:0 0 12px;padding:4px 12px;border-left:3px solid ${C.accent};color:${C.muted}`,
  hr: `border:0;border-top:1px solid ${C.line};margin:16px 0`,
};
const md = (s) => renderMarkdown(s, { styles: MD_STYLES });
const st = (tag) => (MD_STYLES[tag] ? ` style="${MD_STYLES[tag]}"` : '');

const EFFORT_COLORS = {
  S: ['#0e6b43', '#e2f4ea'], M: ['#8a5200', '#fdf0d8'], L: ['#b4233a', '#fde7eb'],
};

/** Bouton du design : dégradé bleu-cyan, texte #081022 (repli en aplat pour les clients qui ignorent le dégradé). */
export const mailButton = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td bgcolor="${C.accent}" style="background:${C.accent};background-image:linear-gradient(135deg,${C.accent},${C.accent2});border-radius:12px;">
  <a href="${esc(href)}" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:700;color:${C.onGrad};text-decoration:none;border-radius:12px;">${esc(label)}</a>
</td></tr></table>`;

/** Mise en page commune des mails envoyés par AiTools (évolutions, rapport hebdo, invitation d'équipe, avertissement d'inactivité). */
export function mailLayout({ title, subtitle = '', preheader = '', content, appUrl = '', cta = '', footer = 'Message automatique envoyé par AiTools.' }) {
  const base = appUrl ? String(appUrl).replace(/\/$/, '') : '';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;font-family:${FONT};">
    <tr><td bgcolor="${C.indigo}" style="background:${C.indigo};border-radius:14px 14px 0 0;padding:22px 24px 20px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:-.02em;color:${C.headText};">
        ${base ? `<img src="${esc(base)}/static/img/logo-mark-dark.png" width="39" height="32" alt="" style="display:inline-block;vertical-align:middle;margin-right:10px;border:0;">` : ''}<span style="vertical-align:middle;">AiTools</span>
      </div>
      <div style="margin-top:18px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.02em;color:#ffffff;">${esc(title)}</div>
      ${subtitle ? `<div style="margin-top:6px;font-size:14px;color:${C.headText};">${esc(subtitle)}</div>` : ''}
    </td></tr>
    <tr><td height="4" bgcolor="${C.accent}" style="height:4px;line-height:4px;font-size:0;background:${C.accent};background-image:linear-gradient(90deg,${C.accent},${C.accent2});">&nbsp;</td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 14px 14px;padding:24px;">
      ${content}
      ${cta && appUrl ? mailButton(appUrl, cta) : ''}
    </td></tr>
    <tr><td style="padding:16px 4px;font-size:12px;color:${C.muted};text-align:center;">${esc(footer)}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const p = (html) => `<p style="${MD_STYLES.p}">${html}</p>`;
const roleName = { member: 'membre', admin: 'administrateur' };

/** Invitation à une équipe : le lien n'est dans aucun autre endroit que ce mail (envoyé à la personne invitée seulement). */
export function inviteMail({ teamName, ownerEmail, role, email, url, appUrl }) {
  const content = `${p(`<strong>${esc(ownerEmail)}</strong> t'invite à rejoindre l'équipe <strong>« ${esc(teamName)} »</strong> sur AiTools, en tant que <strong>${esc(roleName[role] || role)}</strong>.`)}
    ${p(`Tu travailleras sur les projets qu'il partage, avec son offre, son SMTP et son accès Claude : pas besoin d'abonnement de ton côté.`)}
    ${p(`Pour accepter, connecte-toi avec cette adresse (<strong>${esc(email)}</strong>), puis ouvre l'invitation :`)}
    ${mailButton(url, "Rejoindre l'équipe")}
    <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${C.muted};">Le bouton ne marche pas ? Copie ce lien dans ton navigateur :<br><a href="${esc(url)}" style="color:${C.link};word-break:break-all;">${esc(url)}</a></p>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${C.muted};">Le lien est valable 7 jours, ne sert qu'une fois et ne marche qu'avec ${esc(email)}. Si tu ne connais pas ${esc(ownerEmail)}, ignore simplement ce message.</p>`;
  return mailLayout({
    title: `Invitation à l'équipe « ${teamName} »`, subtitle: `de la part de ${ownerEmail}`,
    preheader: `${ownerEmail} t'invite à rejoindre « ${teamName} » sur AiTools.`, content, appUrl,
  });
}

/** Avertissement avant suppression d'un compte inactif. */
export function inactivityMail({ email, deleteDate, loginUrl, appUrl, contact }) {
  const content = `${p(`Ton compte AiTools (<strong>${esc(email)}</strong>) n'a pas servi depuis longtemps. Conformément à la politique de confidentialité, il sera supprimé avec toutes ses données (projets, prospects, modèles, réglages) à partir du <strong>${esc(deleteDate)}</strong>.`)}
    ${p('Pour le garder, il suffit de te connecter avant cette date.')}
    ${mailButton(loginUrl, 'Me connecter')}
    <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${C.muted};">Pour récupérer tes prospects avant, exporte-les en CSV depuis le tableau de bord. Une question ? ${esc(contact)}</p>`;
  return mailLayout({
    title: 'Ton compte sera supprimé pour inactivité', preheader: `Connecte-toi avant le ${deleteDate} pour garder ton compte.`,
    content, appUrl, footer: 'Message automatique, envoyé une seule fois.',
  });
}

/** Mail « Évolutions » : une carte par idée, avec le niveau d'effort en pastille. */
export function evolutionMail({ markdown, projectName, count, appUrl }) {
  const items = parseEvolutions(markdown);
  const content = items.length ? items.map((e) => {
    const [fg, bg] = EFFORT_COLORS[e.effort] || [C.muted, C.bg];
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid ${C.line};border-radius:12px;">
  <tr><td style="padding:16px 18px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="36" valign="top"><div style="width:28px;height:28px;line-height:28px;border-radius:8px;background:${C.accentSoft};color:${C.link};font-weight:700;font-size:14px;text-align:center;">${e.n}</div></td>
      <td valign="middle" style="font-size:16px;font-weight:700;color:${C.text};line-height:1.35;">${inlineMd(e.title, st)}</td>
      ${e.effort ? `<td align="right" valign="middle" style="white-space:nowrap;padding-left:8px;"><span style="display:inline-block;padding:3px 10px;border-radius:99px;background:${bg};color:${fg};font-size:12px;font-weight:600;">${e.effort} · ${EFFORTS[e.effort]}</span></td>` : ''}
    </tr></table>
  </td></tr>
  <tr><td style="padding:4px 18px 8px 54px;">${md(e.body)}</td></tr>
</table>`;
  }).join('') : md(markdown);
  return mailLayout({
    title: `${count} évolution${count > 1 ? 's' : ''} pour ${projectName}`,
    subtitle: 'Classées de la plus rentable à la moins rentable',
    preheader: items.slice(0, 3).map((e) => e.title).join(' · '),
    content, appUrl, cta: 'Ouvrir le panel',
  });
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '–');

// Tuiles par 2 : tient sur un écran de téléphone sans défilement horizontal
function kpiCells(cells) {
  const tile = ([label, value, sub]) => `<td width="50%" valign="top" style="padding:4px;">
  <div style="border:1px solid ${C.line};border-radius:10px;padding:12px 12px 10px;">
    <div style="font-size:12px;color:${C.muted};">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;color:${C.text};line-height:1.3;white-space:nowrap;">${esc(value)}</div>
    ${sub ? `<div style="font-size:12px;color:${C.muted};">${esc(sub)}</div>` : ''}
  </div></td>`;
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells.slice(i, i + 2).map(tile).join('')}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows.join('')}</table>`;
}

/** Rapport hebdo : totaux en tuiles, puis un tableau par projet actif. */
export function weeklyMail(st, { period, appUrl }) {
  const t = st.totals;
  const usd = (n) => `${n.toFixed(2)} $`;
  const active = st.projects.filter((p) => p.found || p.sent || p.followups || p.replies || p.cost);
  const quiet = st.projects.filter((p) => !active.includes(p));
  const row = (label, value, strong = false) => `<tr>
    <td style="padding:7px 0;border-top:1px solid ${C.line};font-size:14px;color:${C.muted};">${esc(label)}</td>
    <td align="right" style="padding:7px 0;border-top:1px solid ${C.line};font-size:14px;color:${C.text};${strong ? 'font-weight:700;' : ''}">${esc(value)}</td></tr>`;
  const projects = active.map((p) => `<div style="margin:0 0 18px;">
  <div style="font-size:16px;font-weight:700;color:${C.text};margin:0 0 4px;">${esc(p.name)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${row('Prospects trouvés', String(p.found))}
    ${row('Mails envoyés', `${p.sent}${p.followups ? ` + ${p.followups} relance(s)` : ''}`)}
    ${row('Réponses', `${p.replies} (${pct(p.replies, p.sent)})`, true)}
    ${row('Clients (total)', String(p.clients))}
    ${p.bounces ? row('Adresses invalides', String(p.bounces)) : ''}
    ${p.bestSubject ? row('Test A/B', `objet ${p.bestSubject.variant} gagnant (${pct(p.bestSubject.replied, p.bestSubject.sent)})`) : ''}
    ${row('Coût IA', usd(p.cost))}
  </table></div>`).join('');
  const content = `${kpiCells([
    ['Prospects', String(t.found), 'trouvés'],
    ['Mails', String(t.sent), t.followups ? `+ ${t.followups} relance(s)` : 'envoyés'],
    ['Réponses', String(t.replies), pct(t.replies, t.sent)],
    ['Coût IA', usd(t.cost), 'équivalent API'],
  ])}
  ${projects || `<p style="${MD_STYLES.p}">Aucune activité cette semaine.</p>`}
  ${quiet.length ? `<p style="margin:0 0 16px;font-size:13px;color:${C.muted};">Sans activité : ${quiet.map((p) => esc(p.name)).join(', ')}.</p>` : ''}`;
  return mailLayout({
    title: 'Rapport hebdo', subtitle: period,
    preheader: `${t.sent} mails, ${t.replies} réponses (${pct(t.replies, t.sent)}), ${t.found} prospects trouvés`,
    content, appUrl, cta: 'Ouvrir le panel',
  });
}

const linkify = (escaped) => escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#0b6f96;">${u}</a>`);

/**
 * Mail de prospection : volontairement sobre, comme un mail écrit à la main
 * (pas de bannière ni d'images : c'est ce qui passe le mieux les filtres anti-spam).
 */
export function prospectHtml({ body, notice, unsubUrl }) {
  const paras = String(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:600px;margin:0 auto;padding:20px 18px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1f2328;">
${paras}
<div style="margin-top:28px;padding-top:12px;border-top:1px solid #eceef1;font-size:12px;line-height:1.5;color:#8a9099;">
${esc(notice)}<br><a href="${esc(unsubUrl)}" style="color:#8a9099;">Ne plus recevoir de messages</a>
</div>
</div>
</body></html>`;
}
