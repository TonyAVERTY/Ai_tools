// Réponses des prospects : texte lu dans la boîte (IMAP), classement par intention, brouillon de réponse.
// Tout est local et instantané (aucun appel à Claude) : le classement est une lecture de mots-clés, l'utilisateur garde la main.

export const INTENTS = {
  interested: 'Intéressé',
  question: 'Question',
  later: 'Plus tard',
  refused: 'Refus',
  other: 'Autre',
};

const MAX_TEXT = 3000;

// ---------- Lecture d'un mail brut (MIME), sans dépendance ----------

function splitMessage(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: '' };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function header(head, name) {
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const m = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded);
  return m ? m[1].trim() : '';
}

function decodeBody(body, encoding, charset) {
  let buf;
  const enc = encoding.toLowerCase();
  if (enc === 'base64') buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (enc === 'quoted-printable') {
    const s = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    buf = Buffer.from(s, 'latin1');
  } else buf = Buffer.from(body, 'latin1');
  try { return new TextDecoder(charset || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

const stripHtml = (h) => h
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Texte d'une partie : text/plain de préférence, sinon text/html aplati ; les multiparts sont parcourus (profondeur bornée)
function partText(raw, depth = 0) {
  const { head, body } = splitMessage(raw);
  const type = header(head, 'content-type').toLowerCase() || 'text/plain';
  const boundary = /boundary="?([^";\s]+)"?/i.exec(header(head, 'content-type'))?.[1];
  if (type.startsWith('multipart/') && boundary && depth < 4) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--')).map((p) => p.replace(/^\r?\n/, ''));
    const texts = parts.map((p) => ({ type: header(splitMessage(p).head, 'content-type').toLowerCase(), text: partText(p, depth + 1) }));
    return (texts.find((t) => t.type.startsWith('text/plain') && t.text.trim()) || texts.find((t) => t.text.trim()))?.text || '';
  }
  if (type.startsWith('message/') || (!type.startsWith('text/') && !type.startsWith('multipart/'))) return '';
  const charset = /charset="?([^";\s]+)"?/i.exec(type)?.[1];
  const text = decodeBody(body, header(head, 'content-transfer-encoding') || '7bit', charset);
  return type.startsWith('text/html') ? stripHtml(text) : text;
}

// On garde ce que la personne a écrit : on coupe les citations (« > … ») et l'historique du fil
const QUOTE_START = /^(le .{5,120}(a écrit|écrit)\s*:|on .{5,120}wrote\s*:|-{2,}\s*(original message|message d'origine|forwarded)|de\s*:\s.+|from\s*:\s.+|envoyé de mon )/i;

export function extractReplyText(source) {
  const text = partText((Buffer.isBuffer(source) ? source : Buffer.from(String(source || ''), 'utf8')).toString('latin1')) // octets conservés : chaque partie est décodée selon son propre charset
    .replace(/\r\n?/g, '\n');
  const kept = [];
  for (const line of text.split('\n')) {
    if (QUOTE_START.test(line.trim())) break;
    if (line.trim().startsWith('>')) continue;
    kept.push(line.trimEnd());
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

// ---------- Intention ----------

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const RULES = [
  // Un refus passe devant tout : « pas intéressé » contient « intéressé »
  ['refused', /(ne plus (me )?(contacter|solliciter|ecrire|envoyer)|desinscri|desabonn|unsubscribe|retirez? (moi|mon (adresse|mail|email))|supprimez? (moi|mon (adresse|mail|email|compte))|pas interesse|non merci|aucun interet|pas concerne|ne (nous )?interesse pas|veuillez cesser|stop\b|rgpd|opposition)/],
  ['later', /(plus tard|pas le moment|pas (en ce moment|pour l'instant|pour le moment)|recontactez[- ]?(moi|nous)|revenez (vers|me voir)|dans (quelques|[0-9]+) (semaines|mois)|prochain (trimestre|semestre)|apres (l'ete|les vacances|la rentree)|en septembre|en janvier|l'annee prochaine)/],
  ['interested', /(interesse|interessant|ca m'interesse|ca nous interesse|rendez[- ]?vous|\brdv\b|appel|telephone|visio|echanger|discuter|parlons|devis|tarifs?|combien|disponible|dispo\b|envoyez[- ]?moi|plus d'(infos|informations)|presentation|demo|oui\b|volontiers|avec plaisir|pourquoi pas)/],
];

/**
 * @returns {'interested'|'question'|'later'|'refused'|'other'}
 */
export function classifyIntent(subject, body) {
  // Le corps seul : l'objet d'une réponse (« Re: <notre objet> ») reprend nos propres mots
  const raw = String(body || '').trim() || String(subject || '');
  const text = norm(raw);
  for (const [intent, re] of RULES) if (re.test(text)) return intent;
  return /\?/.test(raw) ? 'question' : 'other';
}

// ---------- Brouillon de réponse ----------

const DRAFTS = {
  interested: ({ company, name }) => `Bonjour,\n\nMerci beaucoup pour votre retour ! Je serais ravi d'échanger avec vous${company ? ` au sujet de ${company}` : ''}.\n\nJe vous propose un appel de 15 minutes cette semaine ou la suivante : quels créneaux vous conviendraient ?\n\nBien cordialement,\n${name}`,
  question: ({ name }) => `Bonjour,\n\nMerci pour votre message et votre question. [Votre réponse ici]\n\nSi c'est plus simple, je reste disponible pour en discuter de vive voix quand cela vous arrange.\n\nBien cordialement,\n${name}`,
  later: ({ name }) => `Bonjour,\n\nMerci pour votre réponse, c'est tout à fait compréhensible. Je reviendrai vers vous dans quelques mois, sauf si vous préférez que je vous recontacte à une date précise.\n\nBien cordialement,\n${name}`,
  refused: ({ name }) => `Bonjour,\n\nMerci pour votre réponse. Votre adresse a été retirée de ma liste : vous ne recevrez plus de message de ma part.\n\nBonne continuation,\n${name}`,
  other: ({ name }) => `Bonjour,\n\nMerci pour votre message. [Votre réponse ici]\n\nBien cordialement,\n${name}`,
};

/** Réponse toute rédigée, à relire et à envoyer depuis sa propre messagerie. */
export function draftReply(intent, { company = '', senderName = '' } = {}) {
  const make = DRAFTS[intent] || DRAFTS.other;
  return make({ company: String(company || '').trim(), name: String(senderName || '').trim() || '[Votre nom]' });
}
