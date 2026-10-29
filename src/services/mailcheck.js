// Relecture d'un mail de prospection : remplissage des variables sans laisser de reste (virgule orpheline, « Pour voir : » sans adresse),
// contrôle du modèle avant validation, et acceptation (ou refus) d'une relecture faite par Claude.
export const KNOWN_VARS = ['entreprise', 'ville', 'accroche', 'expediteur', 'site'];
const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;
const SPAM_WORDS = /\b(gratuit|gratuite|offre|urgent|urgence|promo|promotion|garanti|garantie)\b/i;

/**
 * Remplace les variables ligne par ligne. Une ligne dont une variable est vide est nettoyée : séparateur resté en tête (« , MonProduit »),
 * espace avant une virgule, ligne qui finit par « : » sans rien derrière, ou ligne vide de texte. Ces lignes disparaissent plutôt que de partir cassées.
 */
export function fillBody(text, vars) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    let emptied = false;
    let l = line.replace(VAR_RE, (_, k) => { const v = vars[k] ?? ''; if (!v) emptied = true; return v; });
    if (emptied) {
      l = l.replace(/^[ \t]*[,;]+[ \t]*/, '').replace(/[ \t]+([,;.])/g, '$1').replace(/[ \t]{2,}/g, ' ');
      if (!/[\p{L}\p{N}]/u.test(l) || /[:：][ \t]*$/.test(l)) continue;
    }
    out.push(l);
  }
  return out.join('\n');
}

/** Objet : variables remplacées, séparateurs orphelins retirés. */
export function fillSubject(text, vars) {
  return String(text ?? '').replace(VAR_RE, (_, k) => vars[k] ?? '').replace(/^[\s,;:.\-–—]+/, '').replace(/[ \t]+([,;.])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

const countVars = (t) => { const m = new Map(); for (const [, k] of String(t ?? '').matchAll(VAR_RE)) m.set(k, (m.get(k) || 0) + 1); return m; };
const words = (t) => (String(t ?? '').match(/\S+/g) || []).length;

/** Texte du modèle : retire les séparateurs restés en tête de ligne (« , MonProduit ») et les espaces avant une virgule. */
export function tidyTemplateText(text) {
  return String(text ?? '').split('\n').map((l) => l.replace(/^[ \t]*[,;]+[ \t]*/, '').replace(/[ \t]+,/g, ',').replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Contrôle d'un modèle : `errors` bloquent la validation, `warnings` informent (aperçu). */
export function reviewMail({ subject = '', body = '' } = {}) {
  const errors = [];
  const warnings = [];
  for (const k of new Set([...countVars(`${subject}\n${body}`).keys()])) if (!KNOWN_VARS.includes(k)) errors.push(`La variable {{${k}}} n'existe pas (variables : ${KNOWN_VARS.map((v) => `{{${v}}}`).join(' ')}).`);
  const lines = String(body).split('\n');
  const orphan = lines.findIndex((l) => /^[ \t]*[,;]/.test(l));
  if (orphan >= 0) errors.push(`La ligne ${orphan + 1} commence par une virgule ou un point-virgule : « ${lines[orphan].trim().slice(0, 40)} ». Corrige-la.`);
  if (/\{\{[^}]*$|^[^{]*\}\}/m.test(body) || /\[\[|\]\]/.test(body)) errors.push('Une variable est mal fermée ou un crochet [[ ]] est resté dans le texte.');
  if (/\s{2,}[,.;]|,,|\.\.(?!\.)|!!/.test(body)) warnings.push('Ponctuation à revoir : virgules ou points doublés, espace avant une virgule.');
  if (lines.some((l) => /\{\{expediteur\}\}[ \t]*,/.test(l))) warnings.push("La signature « {{expediteur}}, … » sera incomplète si le nom d'expéditeur n'est pas réglé : mets le nom du produit sur une autre ligne.");
  const n = words(body);
  if (n > 220) warnings.push(`Le mail fait ${n} mots : au-delà de 200 mots, la réponse devient plus rare.`);
  if (SPAM_WORDS.test(subject)) warnings.push("L'objet contient un mot que les filtres anti-spam repèrent (gratuit, offre, urgent, promo, garanti).");
  if (String(subject).length > 70) warnings.push("L'objet dépasse 70 caractères : il sera coupé sur mobile.");
  return { errors, warnings };
}

/**
 * Une relecture de Claude n'est retenue que si elle ne change pas le fond : mêmes variables, mêmes adresses web, longueur voisine,
 * aucune ligne commençant par une virgule. Sinon on garde le texte d'origine.
 */
export function acceptReview(original, fixed) {
  if (!fixed || typeof fixed.subject !== 'string' || typeof fixed.body !== 'string') return false;
  const same = (a, b) => { const x = countVars(a); const y = countVars(b); return x.size === y.size && [...x].every(([k, v]) => y.get(k) === v); };
  if (!same(`${original.subject}\n${original.body}`, `${fixed.subject}\n${fixed.body}`)) return false;
  const urls = (t) => (String(t).match(/https?:\/\/\S+/g) || []).sort().join('|');
  if (urls(original.body) !== urls(fixed.body)) return false;
  const a = words(original.body);
  const b = words(fixed.body);
  if (!fixed.subject.trim() || !fixed.body.trim() || b < a * 0.6 || b > a * 1.4) return false;
  if (fixed.body.split('\n').some((l) => /^[ \t]*[,;]/.test(l))) return false;
  return true;
}
