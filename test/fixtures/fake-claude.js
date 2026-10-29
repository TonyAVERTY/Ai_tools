#!/usr/bin/env node
// Faux `claude -p` : émet un flux stream-json réaliste. Le prompt pilote le scénario.
const prompt = process.argv[process.argv.indexOf('-p') + 1] || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', args: process.argv.slice(2) });
// Concurrence : FAKE_LOG = fichier où noter début et fin (clé de l'utilisateur), FAKE_DELAY_MS = durée simulée du travail
const who = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || '').slice(-4);
const trace = async (what) => { if (process.env.FAKE_LOG) (await import('node:fs')).appendFileSync(process.env.FAKE_LOG, what + ' ' + who + ' ' + Date.now() + String.fromCharCode(10)); };
await trace('start');
if (process.env.FAKE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS)));
if (prompt.includes('CRASH')) process.exit(3);
// Quota Claude atteint : réponse en erreur, comme la vraie CLI
if (prompt.includes('QUOTAERR')) { out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached', total_cost_usd: 0, num_turns: 0, usage: {} }); process.exit(1); }
// Le secret de l'utilisateur fuit dans stderr : l'application ne doit jamais le répercuter
if (prompt.includes('LEAK')) { process.stderr.write('echec avec ' + (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || '') + ' fin'); process.exit(3); }
// Jeton d'abonnement refusé par Claude
if ((process.env.CLAUDE_CODE_OAUTH_TOKEN || '').includes('REVOKED')) {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid bearer token · Please run /login', total_cost_usd: 0, num_turns: 0, usage: {} });
  process.exit(1);
}
const profile = { resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', fonctionnalites: ['tampons'], stack: 'node', modele_eco: 'abonnement', cible: { description: 'commerces de proximité', secteurs: ['boulangerie'], zone: 'Bretagne', taille: 'TPE', decideur: 'gérant', requetes: ['boulangerie rennes'] }, arguments: ['simple'], ton: 'direct', facturation: { legal_name: 'Atelier Averty', siret: '123 456 789 00012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', email: 'contact@atelier.fr', phone: null, website: 'javascript:x', activity_label: 'Développement web', pricing_notes: 'Forfait dès 900 €', vat_number: 'null' } };
// Post LinkedIn : reprend la direction donnée (si elle existe) ; un 2e passage (brouillons déjà produits) donne un autre texte
const liDirection = /Direction donnée par l'auteur \(le sujet du post\) : « (.*?) »/s.exec(prompt)?.[1];
const liPost = () => JSON.stringify({ post: `${prompt.includes('Brouillons déjà produits') ? 'Autre angle' : 'Premier angle'} : ${liDirection ? `sur ${liDirection}` : 'sujet choisi par Claude'}. ${'Un texte de post assez long pour passer le contrôle de taille. '.repeat(2)}` });
// Vidéo de promotion : une scène HTML. SCENEBAD (dans le sujet) = scène sans renderFrame au premier essai, bonne après la demande de correction ;
// SCENEFOREVER = toujours fautive.
const promoSubject = /Sujet demandé : « (.*?) »/s.exec(prompt)?.[1] || 'présentation';
const promoScene = () => {
  const fixed = prompt.includes('Ta version précédente a été refusée au rendu');
  if (prompt.includes('SCENEFOREVER') || (prompt.includes('SCENEBAD') && !fixed)) return '<!doctype html><html><body>rien</body></html>';
  return '```html\n<!doctype html><html><head><style>body{margin:0;background:#0b1020;overflow:hidden}#t{position:absolute;top:40%;left:10%;font:700 40px sans-serif;color:#fff}</style></head><body><div id="t"></div><script>'
    + 'var S=' + JSON.stringify(promoSubject) + ';window.renderFrame=function(t){var e=document.getElementById("t");e.textContent=S;e.style.opacity=Math.min(1,t);e.style.left=(10+t*10)+"%";};</script></body></html>\n```';
};
// Facturation : trois exemples de devis, affinage d'un document, quatre modèles de documents (BILLBAD = réponse inutilisable)
const billLine = (label, price, qty = 1, unit = 'forfait') => ({ label, description: `${label} (description)`, qty, unit, unit_price: price });
const billOpt = (layout, tagline, lines) => ({ layout, tagline, title: 'Devis', intro: 'Merci de votre confiance.', lines, conditions: 'Deux retouches incluses.', payment: '30 % à la commande, le solde à la livraison.', closing: 'Cordialement.' });
const billQuotes = () => (prompt.includes('BILLBAD') ? 'pas du json' : JSON.stringify({ options: [
  billOpt('classique', 'Forfait clair', [billLine('Application web', 1200)]),
  billOpt('moderne', 'Détail par étape', [billLine('Cadrage', 300), billLine('Réalisation', 900, 3, 'jour')]),
  billOpt('epure', 'Mise en place + abonnement', [billLine('Mise en place', 600), billLine('Abonnement', 29, 12, 'mois')]),
] }));
const billRefine = () => {
  const cur = JSON.parse(/Document actuel \(JSON\) :\n(.*)\n/.exec(prompt)[1]);
  const request = /Demande de l'entrepreneur[^«]*« (.*?) »/s.exec(prompt)?.[1] || '';
  return JSON.stringify({ ...cur, intro: `Affiné : ${request}`, lines: cur.lines.map((l, i) => (i === 0 && /remise/i.test(request) ? { ...l, unit_price: Math.round(l.unit_price * 0.9) } : l)) });
};
const billDocs = () => {
  const q = JSON.parse(/Devis validé \(JSON\) :\n(.*)\n/.exec(prompt)[1]);
  const base = (title, extra = {}) => ({ layout: q.layout, title, intro: `Introduction ${title}.`, lines: q.lines, conditions: 'Conditions.', payment: 'Paiement par virement.', closing: 'Merci.', ...extra });
  return JSON.stringify({ devis: base('Devis'), acompte: base("Facture d'acompte", { deposit_percent: 30, lines: [] }), facture: base('Facture', { deposit_percent: 30 }), avoir: base('Avoir', { reason: 'Remboursement partiel', lines: [q.lines[0]] }) });
};
// Page IA : « ECHO » renvoie le dernier message de l'utilisateur (la conversation envoyée contient les précédents)
const lines = prompt.includes('proposer TROIS exemples de devis') ? [billQuotes()]
  : prompt.includes('Affine ce document') ? [billRefine()]
  : prompt.includes('QUATRE modèles de documents') ? [billDocs()]
  : prompt.includes('ECHO') ? ['Écho : ' + prompt.split('Utilisateur : ').pop().trim()]
  : prompt.includes('UN post LinkedIn') ? [liPost()]
  : prompt.includes('window.renderFrame') ? [promoScene()]
  : prompt.includes('Audite ce projet') ? ['## Résumé\nCode correct.\n## Constats\n**[FAIBLE]** Pas de tests — `src/a.js:1` — manque de couverture.']
  : prompt.includes('UNE accroche personnalisée') ? ['{"hook":"Boulangerie Le Fournil : des fournées de qualité à Rennes.","city":"Rennes","sector":"boulangerie"}']
  : prompt.includes('ENVDUMP') ? ['```json\n' + JSON.stringify({ env: process.env, cwd: process.cwd() }) + '\n```']
  : prompt.includes('fiche commerciale') ? ['```json\n' + JSON.stringify(profile) + '\n```']
  : prompt.includes('mail de RELANCE') ? ['{"body":"Petite relance : toujours partant, {{entreprise}} ?"}']
  : prompt.includes('RELECTURE DU MAIL') ? [JSON.stringify({ subject: 'Idée pour {{entreprise}}', ...(prompt.includes('Objet B :') ? { subject_b: 'Une carte de fidélité pour {{entreprise}} ?' } : {}), body: '{{accroche}}\n\nBonjour {{entreprise}} à {{ville}}.\n\n{{expediteur}}', corrections: ['signature sans virgule'] })]
  : prompt.includes('email de prospection') ? [JSON.stringify({ subject: 'Idée pour {{entreprise}}', subject_b: prompt.includes('SAMEB') ? 'idée pour {{entreprise}}' : 'Une carte de fidélité pour {{entreprise}} ?', body: '{{accroche}}\n\nBonjour {{entreprise}} à {{ville}}.\n\n{{expediteur}}' })]
  : prompt.includes('évolutions') ? ['### 1. Export CSV\n- **Pourquoi** : pratique']
  : prompt.includes('prospects')
  ? ['Je cherche...', 'PROSPECT {"company":"Boulangerie Le Fournil","email":"contact@fournil.fr","website":"https://fournil.fr","city":"Rennes","sector":"boulangerie","hook":"Votre fidélité client mérite mieux que le carton.","source":"https://fournil.fr/contact","score":8}',
     'PROSPECT {"company":"Bad","email":"pas-un-email","score":5}',
     'PROSPECT {"company":"Coiffure Zen","email":"Hello@Zen.fr","website":"https://zen.fr","city":"Vern","score":6,"source":"https://zen.fr"}']
  : ['```json\n{"ok":true,"args":' + JSON.stringify(process.argv.slice(2)) + '}\n```'];
// --include-partial-messages : le texte arrive d'abord en morceaux (stream_event), puis en message complet
if (process.argv.includes('--include-partial-messages')) {
  for (const t of lines) { const h = Math.ceil(t.length / 2); for (const piece of [t.slice(0, h), t.slice(h)]) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } }); }
}
for (const t of lines) out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
// Quota du compte (session 5h + semaine), remonté par la vraie CLI à chaque appel.
// Surchargeable par les tests qui veulent simuler un quota serré (FAKE_FIVE_HOUR / FAKE_SEVEN_DAY).
out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: {
  five_hour: { utilization: Number(process.env.FAKE_FIVE_HOUR ?? ((process.env.CLAUDE_CODE_OAUTH_TOKEN || '').includes('HOT') ? 0.9 : 0.33)), resetsAt: 4_000_000_000 },
  seven_day: { utilization: Number(process.env.FAKE_SEVEN_DAY ?? 0.5), resetsAt: 4_000_300_000 },
} } });
await trace('end');
out({ type: 'result', subtype: 'success', is_error: false, result: lines[lines.length - 1], total_cost_usd: 0.0123, num_turns: 2, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } });
