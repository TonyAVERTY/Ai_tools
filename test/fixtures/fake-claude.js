#!/usr/bin/env node
// Faux `claude -p` : émet un flux stream-json réaliste. Le prompt pilote le scénario.
const prompt = process.argv[process.argv.indexOf('-p') + 1] || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', args: process.argv.slice(2) });
if (prompt.includes('CRASH')) process.exit(3);
const profile = { resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', fonctionnalites: ['tampons'], stack: 'node', modele_eco: 'abonnement', cible: { description: 'commerces de proximité', secteurs: ['boulangerie'], zone: 'Bretagne', taille: 'TPE', decideur: 'gérant', requetes: ['boulangerie rennes'] }, arguments: ['simple'], ton: 'direct' };
const lines = prompt.includes('fiche commerciale') ? ['```json\n' + JSON.stringify(profile) + '\n```']
  : prompt.includes('email de prospection') ? ['{"subject":"Idée pour {{entreprise}}","body":"{{accroche}}\\n\\nBonjour {{entreprise}} à {{ville}}.\\n\\n{{expediteur}}"}']
  : prompt.includes('évolutions') ? ['### 1. Export CSV\n- **Pourquoi** : pratique']
  : prompt.includes('prospects')
  ? ['Je cherche...', 'PROSPECT {"company":"Boulangerie Le Fournil","email":"contact@fournil.fr","website":"https://fournil.fr","city":"Rennes","sector":"boulangerie","hook":"Votre fidélité client mérite mieux que le carton.","source":"https://fournil.fr/contact","score":8}',
     'PROSPECT {"company":"Bad","email":"pas-un-email","score":5}',
     'PROSPECT {"company":"Coiffure Zen","email":"Hello@Zen.fr","website":"https://zen.fr","city":"Vern","score":6,"source":"https://zen.fr"}']
  : ['```json\n{"ok":true,"args":' + JSON.stringify(process.argv.slice(2)) + '}\n```'];
for (const t of lines) out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: lines[lines.length - 1], total_cost_usd: 0.0123, num_turns: 2, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } });
