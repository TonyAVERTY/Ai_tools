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

// Promesses qu'un mail commercial fait souvent sans que le produit les tienne : signalées quand la fiche du projet n'en parle pas.
const PROMISES = [
  [/\bd[ée]mo(nstrations?)?\b/i, 'une démonstration'],
  [/\bessais?\b|\bgratuit(e|s|ement)?\b/i, 'un essai ou une offre gratuite'],
  [/rendez-vous|\brdv\b|\bvisio\b|\bappel\b|vous appeler|je vous rappelle/i, 'un appel ou un rendez-vous'],
  [/\bdevis\b/i, 'un devis'],
  [/brochure|catalogue|livre blanc/i, 'un document à envoyer'],
  [/garanti|remboursé|sans engagement/i, 'une garantie ou une absence d\'engagement'],
];

const ANSWER_WORDS = /\b(oui|non|peut-être|plus tard|pas du tout|maintenant|jamais|pas maintenant|pas encore|bientôt)\b/gi;

/**
 * Le texte offre-t-il des réponses toutes faites à choisir ? « Oui, non ou plus tard ? », « maintenant, plus tard ou pas du tout ? », « oui / non ? »,
 * « répondez par 1 ou 2 » : une personne écrit sa réponse, elle ne coche pas une case. Une question qui contient deux mots de réponse énumérés est signalée ;
 * une seule (« Préférez-vous que je repasse plus tard ? ») ne l'est pas.
 */
export function readyMadeAnswers(text) {
  const t = String(text ?? '');
  if (/\brépon(?:ds|dez)\s+par\s+(?:1|un)\b|vous pouvez répondre\s+(?:oui|non|par)\b/i.test(t)) return true;
  for (const q of t.match(/[^.?!\n]*\?/g) || []) {
    const found = new Set((q.match(ANSWER_WORDS) || []).map((w) => w.toLowerCase()));
    if (found.size >= 2 && /,|\bou\b|\//.test(q)) return true;
  }
  return false;
}

/**
 * Défauts de FORME d'un mail (jamais bloquants, le ton reste au choix de la personne) : pas d'appel, appel adressé à l'entreprise, pas de politesse avant la
 * signature, réponses toutes faites. Une seule source : l'aperçu les signale, et la génération d'un modèle les fait corriger par l'IA (handlers.js).
 */
export function styleProblems(body = '') {
  const out = [];
  const filled = String(body).split('\n').map((l) => l.trim()).filter(Boolean);
  if (filled.length) {
    if (!/^(bonjour|bonsoir|madame|monsieur|cher|chère|hello|salut)\b/i.test(filled[0])) out.push("Le mail ne commence pas par une formule d'appel (« Bonjour, »).");
    if (/^(bonjour|bonsoir|hello|salut)[ \t,]*\{\{\s*entreprise\s*\}\}/i.test(filled[0])) out.push("« Bonjour {{entreprise}}, » salue une entreprise comme une personne (« Bonjour Une Bonne Bouteille, ») : écris « Bonjour, » tout court.");
    if (!/cordialement|bien à vous|bonne journée|bonne soirée|bonne continuation|à bientôt|salutations|sincèrement|respectueusement|merci/i.test(filled.slice(-4).join(' '))) out.push('Aucune formule de politesse avant la signature (« Bien cordialement, »).');
  }
  if (readyMadeAnswers(body)) out.push('Le mail propose des réponses toutes faites (« oui, non ou plus tard », « maintenant, plus tard ou pas du tout ») : pose plutôt une question simple, à laquelle on répond avec ses mots.');
  return out;
}

/**
 * Contrôle d'un modèle : `errors` bloquent la validation, `warnings` informent (aperçu).
 * `facts` : texte de la fiche du projet ; une promesse du mail dont la fiche ne parle pas est signalée (le mail ne doit proposer que ce qui existe).
 */
export function reviewMail({ subject = '', body = '', facts = '' } = {}) {
  const errors = [];
  const warnings = [];
  for (const k of new Set([...countVars(`${subject}\n${body}`).keys()])) if (!KNOWN_VARS.includes(k)) errors.push(`La variable {{${k}}} n'existe pas (variables : ${KNOWN_VARS.map((v) => `{{${v}}}`).join(' ')}).`);
  const lines = String(body).split('\n');
  const orphan = lines.findIndex((l) => /^[ \t]*[,;]/.test(l));
  if (orphan >= 0) errors.push(`La ligne ${orphan + 1} commence par une virgule ou un point-virgule : « ${lines[orphan].trim().slice(0, 40)} ». Corrige-la.`);
  if (/\{\{[^}]*$|^[^{]*\}\}/m.test(body) || /\[\[|\]\]/.test(body)) errors.push('Une variable est mal fermée ou un crochet [[ ]] est resté dans le texte.');
  if (/\s{2,}[,.;]|,,|\.\.(?!\.)|!!/.test(body)) warnings.push('Ponctuation à revoir : virgules ou points doublés, espace avant une virgule.');
  if (lines.some((l) => /\{\{expediteur\}\}[ \t]*,/.test(l))) warnings.push("La signature « {{expediteur}}, … » sera incomplète si le nom d'expéditeur n'est pas réglé : mets le nom du produit sur une autre ligne.");
  if (facts) {
    for (const [re, label] of PROMISES) {
      const hit = re.exec(`${subject}\n${body}`);
      if (hit && !re.test(facts)) warnings.push(`Le mail parle de ${label} (« ${hit[0]} ») alors que la fiche du projet n'en parle pas : retire-le si ce n'est pas disponible.`);
    }
  }
  warnings.push(...styleProblems(body));
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
  const sameVars = (a, b) => { const x = countVars(a); const y = countVars(b); return x.size === y.size && [...x].every(([k, v]) => y.get(k) === v); };
  if (!sameVars(`${original.subject}\n${original.subjectB || ''}\n${original.body}`, `${fixed.subject}\n${fixed.subject_b || ''}\n${fixed.body}`)) return false;
  if (!!original.subjectB !== !!(fixed.subject_b || '').trim()) return false; // l'objet B n'apparaît ni ne disparaît
  const urls = (t) => (String(t).match(/https?:\/\/\S+/g) || []).sort().join('|');
  if (urls(original.body) !== urls(fixed.body)) return false;
  const a = words(original.body);
  const b = words(fixed.body);
  if (!fixed.subject.trim() || !fixed.body.trim() || b < a * 0.6 || b > a * 1.4) return false;
  if (fixed.body.split('\n').some((l) => /^[ \t]*[,;]/.test(l))) return false;
  return true;
}
