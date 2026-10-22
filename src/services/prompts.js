// Prompts courts et cadrés : chaque token compte avec un abonnement Pro.

const SYSTEM_FR = 'Tu travailles pour un outil interne. Réponds en français. Sois bref. Pas de politesse, pas de récapitulatif.';

export function analyzePrompt(projectName) {
  return {
    system: SYSTEM_FR,
    prompt: `Analyse le projet "${projectName}" dans le dossier courant pour en faire une fiche commerciale.
Lis en priorité : README, manifestes (package.json, composer.json…), routes/pages principales, modèles de données.
Lis 15 fichiers au maximum, n'explore pas node_modules/vendor/dist.

Réponds UNIQUEMENT avec ce JSON :
{
 "resume": "2 phrases : ce que fait le produit",
 "proposition_valeur": "1 phrase orientée client",
 "fonctionnalites": ["5 à 8 fonctionnalités clés"],
 "stack": "techno principale",
 "modele_eco": "abonnement / commission / ... si détectable, sinon null",
 "cible": {
   "description": "qui achète, en 1 phrase",
   "secteurs": ["types d'entreprises à démarcher"],
   "zone": "zone géographique pertinente",
   "taille": "TPE / PME / indépendants...",
   "decideur": "qui contacter",
   "requetes": ["4 à 6 requêtes web pour trouver ces entreprises"]
 },
 "arguments": ["3 à 5 arguments de vente"],
 "ton": "ton recommandé pour les mails"
}`,
  };
}

export function prospectPrompt({ profile, target, count, exclude }) {
  return {
    system: `${SYSTEM_FR}
Règles strictes :
- Uniquement des emails PROFESSIONNELS publiés publiquement par l'entreprise (site, page contact, annuaire pro). Jamais inventés ni devinés.
- Pas de particuliers, pas d'emails personnels nominatifs devinés.
- Donne l'URL exacte où l'email apparaît (champ source).
- Une ligne par prospect, dès que tu le trouves, au format exact :
PROSPECT {"company":"","email":"","website":"","city":"","sector":"","hook":"","source":"","score":0}
- hook : 1 phrase d'accroche personnalisée basée sur ce que tu as vu sur leur site.
- score : pertinence de 1 à 10 pour ce produit.
- Arrête-toi dès que tu as ${count} prospects. Termine par DONE.`,
    prompt: `Produit : ${profile.resume}
Valeur : ${profile.proposition_valeur}
Cible : ${target.description} — secteurs : ${(target.secteurs || []).join(', ')} — zone : ${target.zone} — taille : ${target.taille}
Pistes de recherche : ${(target.requetes || []).join(' | ')}

Trouve ${count} prospects.${exclude.length ? `\nDéjà connus, à ignorer : ${exclude.join(', ')}` : ''}`,
  };
}

export function templatePrompt({ profile, target, senderName }) {
  return {
    system: SYSTEM_FR,
    prompt: `Rédige un email de prospection B2B court (120 mots max) pour :
Produit : ${profile.resume}
Valeur : ${profile.proposition_valeur}
Arguments : ${(profile.arguments || []).join(' ; ')}
Cible : ${target.description} (${target.decideur})
Ton : ${profile.ton || 'direct et chaleureux'}
Expéditeur : ${senderName || '{{expediteur}}'}

Variables disponibles : {{entreprise}}, {{ville}}, {{accroche}} (phrase perso déjà rédigée, à placer en ouverture).
Pas de proposition d'appel téléphonique ni de visio : propose de répondre au mail ou d'essayer le produit.
Ne mets PAS de lien de désinscription (ajouté automatiquement).
Réponds UNIQUEMENT avec : {"subject":"...","body":"..."}`,
  };
}

export function followupTemplatePrompt({ profile, senderName }) {
  return {
    system: SYSTEM_FR,
    prompt: `Rédige un mail de RELANCE B2B très court (60 mots max), envoyé dans le même fil que le premier mail resté sans réponse.
Produit : ${profile.resume}
Valeur : ${profile.proposition_valeur}
Ton : ${profile.ton || 'direct et chaleureux'}
Expéditeur : ${senderName || '{{expediteur}}'}

Règles : rappelle en une phrase l'intérêt pour {{entreprise}}, pose une question simple qui appelle une réponse courte (oui/non),
aucune culpabilisation ("je me permets de revenir vers vous" interdit), pas de proposition d'appel ni de visio.
Variables disponibles : {{entreprise}}, {{ville}}, {{expediteur}}.
Ne mets PAS de lien de désinscription (ajouté automatiquement).
Réponds UNIQUEMENT avec : {"body":"..."}`,
  };
}

/**
 * Post LinkedIn pour un projet. `direction` (facultative) donne le sujet ; sans elle Claude choisit l'angle. `previous` =
 * brouillons déjà produits, pour que « Régénérer » donne un autre post et pas une variante du même.
 */
export function linkedinPostPrompt({ profile, target, direction = '', previous = [], author = '' }) {
  return {
    system: SYSTEM_FR,
    prompt: `Rédige UN post LinkedIn, en français, publié par ${author || 'le fondateur'} à propos de ce projet :
Produit : ${profile.resume}
Valeur : ${profile.proposition_valeur}
Arguments : ${(profile.arguments || []).join(' ; ')}
Public visé : ${target?.description || 'professionnels susceptibles d\'en avoir besoin'}
Ton : ${profile.ton || 'direct et chaleureux'}

${direction
    ? `Direction donnée par l'auteur (le sujet du post) : « ${direction} »`
    : "Aucune direction donnée : choisis toi-même un angle utile et crédible pour le public visé (un problème fréquent et comment l'aborder, un retour d'expérience plausible, les coulisses du produit, un conseil concret)."}
${previous.length ? `\nBrouillons déjà produits, à ne PAS reprendre (change l'angle, l'accroche et la structure) :\n${previous.map((p) => `---\n${String(p).slice(0, 400)}`).join('\n')}\n---\n` : ''}
Règles :
- 600 à 1 200 caractères, en courts paragraphes aérés. La première ligne est une accroche qui donne envie de lire la suite (pas de « Je suis ravi d'annoncer »).
- N'invente RIEN : aucun chiffre, client, témoignage, résultat, citation ni lien qui ne figure pas dans les informations ci-dessus. Aucune promesse de résultat.
- Première personne, ton naturel, sans jargon ni formules creuses. 3 emojis au plus, 3 hashtags au plus, à la fin.
- Termine par une question ou une invitation simple à en discuter en commentaire.
Réponds UNIQUEMENT avec : {"post":"..."}`,
  };
}

export const LEVELS = {
  rapide: { model: 'haiku', maxTurns: 12, files: 8 },
  normal: { model: 'sonnet', maxTurns: 20, files: 15 },
  approfondi: { model: 'opus', maxTurns: 30, files: 25 },
};

export function evolutionPrompt({ projectName, profile, count, level }) {
  const l = LEVELS[level];
  return {
    system: SYSTEM_FR,
    prompt: `Projet "${projectName}" (dossier courant). ${profile ? `Résumé : ${profile.resume}` : ''}
Propose ${count} évolutions qui plairaient aux utilisateurs de ce produit.
Lis ${l.files} fichiers au maximum pour comprendre l'existant. Ne propose rien qui existe déjà.

Format Markdown, pour chaque évolution :
### N. Titre
- **Pourquoi** : bénéfice utilisateur (1-2 phrases)
- **Effort** : S / M / L
- **Pistes techniques** : 1-3 puces liées au code existant

Classe de la plus rentable à la moins rentable. Aucune intro ni conclusion.`,
  };
}
