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
// Le secret de l'utilisateur fuit dans stderr : l'application ne doit jamais le répercuter
if (prompt.includes('LEAK')) { process.stderr.write('echec avec ' + (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || '') + ' fin'); process.exit(3); }
// Jeton d'abonnement refusé par Claude
if ((process.env.CLAUDE_CODE_OAUTH_TOKEN || '').includes('REVOKED')) {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid bearer token · Please run /login', total_cost_usd: 0, num_turns: 0, usage: {} });
  process.exit(1);
}
const profile = { resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', fonctionnalites: ['tampons'], stack: 'node', modele_eco: 'abonnement', cible: { description: 'commerces de proximité', secteurs: ['boulangerie'], zone: 'Bretagne', taille: 'TPE', decideur: 'gérant', requetes: ['boulangerie rennes'] }, arguments: ['simple'], ton: 'direct' };
// Post LinkedIn : reprend la direction donnée (si elle existe) ; un 2e passage (brouillons déjà produits) donne un autre texte
const liDirection = /Direction donnée par l'auteur \(le sujet du post\) : « (.*?) »/s.exec(prompt)?.[1];
const liPost = () => JSON.stringify({ post: `${prompt.includes('Brouillons déjà produits') ? 'Autre angle' : 'Premier angle'} : ${liDirection ? `sur ${liDirection}` : 'sujet choisi par Claude'}. ${'Un texte de post assez long pour passer le contrôle de taille. '.repeat(2)}` });
const lines = prompt.includes('UN post LinkedIn') ? [liPost()]
  : prompt.includes('Audite ce projet') ? ['## Résumé\nCode correct.\n## Constats\n**[FAIBLE]** Pas de tests — `src/a.js:1` — manque de couverture.']
  : prompt.includes('UNE accroche personnalisée') ? ['{"hook":"Boulangerie Le Fournil : des fournées de qualité à Rennes.","city":"Rennes","sector":"boulangerie"}']
  : prompt.includes('ENVDUMP') ? ['```json\n' + JSON.stringify({ env: process.env, cwd: process.cwd() }) + '\n```']
  : prompt.includes('fiche commerciale') ? ['```json\n' + JSON.stringify(profile) + '\n```']
  : prompt.includes('mail de RELANCE') ? ['{"body":"Petite relance : toujours partant, {{entreprise}} ?"}']
  : prompt.includes('email de prospection') ? ['{"subject":"Idée pour {{entreprise}}","body":"{{accroche}}\\n\\nBonjour {{entreprise}} à {{ville}}.\\n\\n{{expediteur}}"}']
  : prompt.includes('évolutions') ? ['### 1. Export CSV\n- **Pourquoi** : pratique']
  : prompt.includes('prospects')
  ? ['Je cherche...', 'PROSPECT {"company":"Boulangerie Le Fournil","email":"contact@fournil.fr","website":"https://fournil.fr","city":"Rennes","sector":"boulangerie","hook":"Votre fidélité client mérite mieux que le carton.","source":"https://fournil.fr/contact","score":8}',
     'PROSPECT {"company":"Bad","email":"pas-un-email","score":5}',
     'PROSPECT {"company":"Coiffure Zen","email":"Hello@Zen.fr","website":"https://zen.fr","city":"Vern","score":6,"source":"https://zen.fr"}']
  : ['```json\n{"ok":true,"args":' + JSON.stringify(process.argv.slice(2)) + '}\n```'];
for (const t of lines) out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
// Quota du compte (session 5h + semaine), remonté par la vraie CLI à chaque appel.
// Surchargeable par les tests qui veulent simuler un quota serré (FAKE_FIVE_HOUR / FAKE_SEVEN_DAY).
out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: {
  five_hour: { utilization: Number(process.env.FAKE_FIVE_HOUR ?? ((process.env.CLAUDE_CODE_OAUTH_TOKEN || '').includes('HOT') ? 0.9 : 0.33)), resetsAt: 4_000_000_000 },
  seven_day: { utilization: Number(process.env.FAKE_SEVEN_DAY ?? 0.5), resetsAt: 4_000_300_000 },
} } });
await trace('end');
out({ type: 'result', subtype: 'success', is_error: false, result: lines[lines.length - 1], total_cost_usd: 0.0123, num_turns: 2, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } });
