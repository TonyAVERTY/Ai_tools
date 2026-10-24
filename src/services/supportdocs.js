// Documentation d'AiTools lue par Claude dans le mode « Support » de la page IA.
// Deux sources :
//  - docs/support/*.md : la documentation écrite à la main (parcours, boutons, règles) ; chaque fichier commence par « # Titre » puis une ligne « Résumé : … » ;
//  - des fichiers GÉNÉRÉS depuis le code (offres et plafonds, modèles, consignes IA) : ils ne peuvent pas être périmés.
// Le tout est écrit dans `dataDir/support-docs/` avec un INDEX.md : c'est ce dossier, en lecture seule, que Claude reçoit comme dossier de travail.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_LIMITS, PLAN_LABELS, PLAN_PRICES, ANNUAL_FREE_MONTHS } from '../limits.js';
import { RECOMMENDED, OTHERS, DEFAULT_MODEL } from './models.js';
import { PROMPT_DEFS } from './prompts.js';
import { PROMO, FORMATS } from './promovideo.js';

export const STATIC_DOCS_DIR = fileURLToPath(new URL('../../docs/support/', import.meta.url));

const mo = (n) => `${Math.round(n / 1048576)} Mo`;
const lim = (v) => (v == null ? 'illimité' : String(v));

/** Fichiers générés depuis le code. `facts` : { chat, files } (limites de la page IA et des pièces jointes, fournies par chat.js / chatfiles.js). */
export function generatedDocs(facts = {}) {
  const out = [];
  const plans = Object.keys(PLAN_LIMITS).filter((p) => p !== 'admin');
  const rows = plans.map((p) => {
    const l = PLAN_LIMITS[p];
    const price = PLAN_PRICES[p] ? `${PLAN_PRICES[p]} €/mois (${PLAN_PRICES[p] * (12 - ANNUAL_FREE_MONTHS)} €/an, ${ANNUAL_FREE_MONTHS} mois offerts)` : p === 'free' ? 'gratuit' : 'sur demande';
    return `| ${PLAN_LABELS[p] || p} | ${price} | ${lim(l.projects)} | ${lim(l.prospects)} | ${lim(l.mails)} | ${lim(l.aiJobs)} | ${lim(l.seats)} |`;
  });
  const { chat = {}, files = {} } = facts;
  out.push({
    name: 'plans-et-limites.md',
    content: `# Offres, plafonds et limites
Résumé : prix des offres, plafonds mensuels (projets, prospects, mails, jobs IA, places d'équipe) et limites techniques (page IA, pièces jointes, vidéos de promotion). Fichier généré depuis le code : toujours à jour.

## Offres
Les plafonds se renouvellent le 1er de chaque mois (heure de Paris). Quand un plafond est atteint, rien n'est perdu : l'action est refusée avec un message clair et reprend le mois suivant ou après un changement d'offre. La page « Mon compte » et le tableau de bord montrent l'usage du mois (« Usage du mois »).

| Offre | Prix | Projets | Prospects | Mails par mois | Jobs IA par mois | Places d'équipe |
|---|---|---|---|---|---|---|
${rows.join('\n')}

Les offres se voient aussi sur la page publique « Tarifs ». Un administrateur d'AiTools peut attribuer une offre à un compte. Le prix de l'abonnement Claude ou de la clé API Anthropic est à part : il se paie directement à Anthropic.

## Page IA (Claude et Support)
- ${chat.perDay ?? '—'} réponses au plus par 24 h glissantes et par compte ; ${chat.maxConversations ?? '—'} conversations au plus (la plus ancienne est supprimée quand une nouvelle dépasse la limite).
- Une seule réponse à la fois par compte. Si le serveur est très sollicité, un message demande de réessayer dans un instant.
- Modèle par défaut : « Sonnet ». Le choix du modèle se fait dans la liste en haut de la conversation.

## Pièces jointes de la page IA
- ${files.perMessage ?? '—'} pièces jointes au plus par message.
- Taille maximale : image ${mo(files.maxBytes?.image ?? 0)}, PDF ${mo(files.maxBytes?.pdf ?? 0)}, fichier texte ${mo(files.maxBytes?.text ?? 0)}, vidéo ${mo(files.maxBytes?.video ?? 0)}. Espace total par compte : ${mo(files.perUser ?? 0)}.
- Une pièce jointe ajoutée mais jamais envoyée est supprimée au bout de ${files.pendingHours ?? 24} heures.

## Vidéos de promotion (onglet « Promotion » d'un projet)
- Images par seconde : de ${PROMO.fps.min} à ${PROMO.fps.max} (${PROMO.fps.def} par défaut). Durée : de ${PROMO.seconds.min} à ${PROMO.seconds.max} secondes (${PROMO.seconds.def} par défaut).
- Nombre d'images au plus : ${PROMO.maxFrames} (images par seconde × durée). Au-delà, le formulaire bloque le bouton et l'explique.
- Formats : ${Object.values(FORMATS).map((f) => f.label).join(' ; ')}.
- ${PROMO.maxVideos} vidéos au plus par compte : supprime-en une pour en produire une nouvelle.
`,
  });

  const rec = RECOMMENDED.map((m) => `- **${m.label}** (${m.tier}, ${m.cost}) : ${m.note}`).join('\n');
  out.push({
    name: 'modeles-claude.md',
    content: `# Modèles Claude proposés
Résumé : liste des modèles Claude que l'on peut choisir (recommandés avec estimation de coût, autres modèles), modèle par défaut et où le choisir. Fichier généré depuis le code.

## Choisir un modèle
- Dans **Réglages → Budget et modèles IA** : un modèle par tâche (prospection, analyse de projet, rédaction des mails et posts, page IA). Le choix s'enregistre avec le bouton « Enregistrer ».
- Dans la page IA : la liste déroulante en haut de la conversation change le modèle de cette conversation (et devient le modèle par défaut de la page IA).
- Modèle par défaut des tâches : « ${DEFAULT_MODEL} » (Haiku).

## Recommandés (alias stables : toujours la dernière version de la gamme)
${rec}

Les estimations (économe, intermédiaire, plus cher) sont relatives. Avec un abonnement Claude, elles se voient dans le quota Claude affiché en haut de l'écran ; avec une clé API, dans le prix facturé par Anthropic.

## Autres modèles (identifiant exact, sans estimation de coût)
${OTHERS.map((m) => `- ${m.label}`).join('\n')}

Chaque gamme (Haiku, Sonnet, Opus, Fable) a ses propres consignes par défaut, modifiables dans Réglages → Prompts IA.
`,
  });

  const defs = Object.entries(PROMPT_DEFS).map(([key, d]) => `### ${d.label}
- Identifiant technique : \`${key}\`.
- Ce qui reste automatique et ne peut pas être cassé par une modification : ${d.fixed}
${d.vars.length ? `- Valeurs insérées automatiquement dans le texte : ${d.vars.map((v) => `[[${v}]]`).join(', ')}.` : '- Aucune valeur insérée automatiquement.'}`).join('\n\n');
  out.push({
    name: 'taches-ia-et-prompts.md',
    content: `# Tâches IA et consignes (prompts) modifiables
Résumé : la liste des tâches que Claude exécute pour l'utilisateur et, pour chacune, ce qui est modifiable dans Réglages → Prompts IA. Fichier généré depuis le code.

## Comment modifier une consigne
1. Ouvre **Réglages**, section **Prompts IA**.
2. Choisis l'onglet « Tous les modèles » (s'applique à toutes les gammes qui n'ont pas la leur) ou une gamme : Haiku, Sonnet, Opus, Fable.
3. Modifie le texte de la tâche voulue, puis clique « Enregistrer les réglages ».
4. « Revenir au texte par défaut » rétablit la consigne d'origine (un champ vide revient aussi au défaut).
Le contexte du projet et le format de réponse sont ajoutés automatiquement : une consigne modifiée ne peut pas casser la lecture de la réponse de Claude.

## Les tâches
${defs}
`,
  });
  return out;
}

/** Titre (« # … ») et résumé (« Résumé : … ») d'un fichier de documentation. */
export function docMeta(content) {
  const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? '';
  const summary = /^Résumé\s*:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? '';
  return { title, summary };
}

/** Tous les fichiers de documentation : écrits à la main (docs/support) puis générés, triés par nom. */
export function collectDocs(facts = {}) {
  const manual = readdirSync(STATIC_DOCS_DIR).filter((f) => f.endsWith('.md')).sort().map((name) => ({ name, content: readFileSync(join(STATIC_DOCS_DIR, name), 'utf8') }));
  return [...manual, ...generatedDocs(facts)];
}

/** INDEX.md : la carte de la documentation (quel fichier répond à quoi). Aussi donnée à Claude dans ses consignes. */
export function buildIndex(files) {
  const lines = files.map((f) => { const m = docMeta(f.content); return `- ${f.name} : ${m.title}${m.summary ? ` — ${m.summary}` : ''}`; });
  return `# Index de la documentation d'AiTools\nRésumé : liste de tous les documents, à lire en premier pour trouver le bon fichier.\n\n${lines.join('\n')}\n`;
}

/**
 * Écrit la documentation dans `dataDir/support-docs/` (une seule fois tant que son contenu ne change pas) et renvoie { dir, index, files }.
 * L'écriture passe par un dossier temporaire puis un renommage : une lecture en cours ne voit jamais un dossier à moitié écrit.
 */
export function ensureSupportDocs(cfg, facts = {}) {
  const files = collectDocs(facts);
  const index = buildIndex(files);
  const all = [...files, { name: 'INDEX.md', content: index }];
  const hash = createHash('sha256').update(JSON.stringify(all)).digest('hex');
  const dir = join(cfg.dataDir, 'support-docs');
  let current = null;
  try { current = readFileSync(join(dir, '.hash'), 'utf8'); } catch { /* première écriture */ }
  if (current !== hash || !existsSync(join(dir, 'INDEX.md'))) {
    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const f of all) writeFileSync(join(tmp, f.name), f.content);
    writeFileSync(join(tmp, '.hash'), hash);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  }
  return { dir, index, files };
}
