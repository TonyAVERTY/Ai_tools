// Liste de mise en route d'un projet : ce qui est déjà configuré, ce qui reste à faire pour profiter de tout l'outil.
// Calculée à chaque lecture à partir de l'état réel du projet (rien n'est stocké : la liste ne peut pas se désynchroniser).
import { prospectStats, getTemplate } from './projects.js';
import { linkedinAccount, linkedinAvailable } from './linkedin.js';
import { latestJobs } from './services/jobs.js';
import { aiName, forAi } from './services/ainame.js';

/**
 * Étapes dans l'ordre conseillé. `acc` : section (data-acc) à ouvrir ; `sel` : sélecteur de repli. `optional` : le cœur de
 * l'outil (trouver des clients par mail) marche sans. `needsConfig` : réservé à ceux qui peuvent régler le projet.
 */
const STEPS = [
  { key: 'analyze', label: 'Analyser le projet', hint: 'Claude lit ton code et écrit la fiche du projet.', acc: 'header', sel: '.profile', done: (f) => f.hasProfile },
  { key: 'target', label: 'Valider la cible', hint: 'Qui veux-tu contacter ? Claude propose, tu ajustes.', acc: 'target', sel: '.profile', done: (f) => f.targetValidated },
  { key: 'prospects', label: 'Chercher des prospects', hint: 'Claude trouve des entreprises qui collent à ta cible.', acc: 'search', done: (f) => f.prospects > 0 },
  { key: 'smtp', label: "Configurer l'envoi des mails (SMTP)", hint: 'Sans SMTP, aucun mail ne peut partir.', acc: 'config', needsConfig: true, done: (f) => f.hasSmtp },
  { key: 'template', label: 'Valider le modèle de mail', hint: 'Relis et valide le premier mail avant tout envoi.', acc: 'template', done: (f) => f.templateValidated },
  { key: 'send', label: 'Envoyer un premier lot', hint: 'Commence petit : 5 à 10 mails.', acc: 'send', done: (f) => f.mailsSent },
  { key: 'imap', label: 'Connecter ta boîte de réception', hint: 'Pour détecter les réponses et les adresses invalides.', acc: 'config', needsConfig: true, optional: true, done: (f) => f.hasImap },
  { key: 'followup', label: 'Activer la relance automatique', hint: 'Une seule relance, dans le même fil, si pas de réponse.', acc: 'followup', optional: true, done: (f) => f.followupEnabled },
  { key: 'evolution', label: "Demander des idées d'évolution", hint: 'Claude propose des fonctionnalités tirées de ton code.', acc: 'evolution', optional: true, done: (f) => f.evolutionDone },
  { key: 'linkedin', label: 'Relier un compte LinkedIn', hint: 'Pour publier des posts écrits par Claude.', acc: 'linkedin', optional: true, needsLinkedin: true, done: (f) => f.linkedinConnected },
  { key: 'post', label: 'Publier un premier post LinkedIn', hint: 'Génère un brouillon, relis-le, publie.', acc: 'linkedin', optional: true, needsLinkedin: true, done: (f) => f.linkedinPosted },
];

/**
 * Fonction pure : des faits sur le projet vers la liste.
 * `done` / `total` ne comptent que les étapes obligatoires. `ready` : tout ce qui est obligatoire est fait (le projet peut prospecter) ; `complete` : idem,
 * la mise en route est terminée (les étapes facultatives restent proposées, sans compter).
 */
export function buildChecklist(f) {
  const steps = STEPS
    .filter((s) => (f.canConfigure || !s.needsConfig) && (f.linkedinAvailable || !s.needsLinkedin))
    .map((s) => ({ key: s.key, label: s.label, hint: forAi(s.hint, aiName()), acc: s.acc ?? null, sel: s.sel ?? null, optional: !!s.optional, done: !!s.done(f) }));
  // Seules les étapes obligatoires comptent : une étape facultative ne se « termine » pas forcément et ne doit pas laisser croire qu'il reste quelque chose à faire
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const ready = done === required.length;
  return { steps, done, total: required.length, ready, complete: ready };
}

/** Rassemble les faits d'un projet (déjà chargé par getProject) et construit sa liste. */
export async function projectChecklist(app, p) {
  const { db } = app;
  const stats = await prospectStats(db, p.id);
  const jobs = await latestJobs(db, p.id);
  const sent = await db.prepare('SELECT 1 AS x FROM mail_log WHERE project_id = ? AND error IS NULL LIMIT 1').get(p.id);
  // Une évolution qui a abouti une fois suffit : une demande plus récente (en cours, annulée, en erreur) ne doit pas faire retomber l'étape
  const evolved = await db.prepare("SELECT 1 AS x FROM jobs WHERE project_id = ? AND type = 'evolution' AND status = 'done' LIMIT 1").get(p.id);
  const li = linkedinAvailable(app.cfg) ? await linkedinAccount(db, p.id) : null;
  const posted = li ? await db.prepare("SELECT 1 AS x FROM linkedin_posts WHERE project_id = ? AND status = 'published' LIMIT 1").get(p.id) : null;
  return buildChecklist({
    canConfigure: p.access !== 'member',
    hasProfile: !!p.profile, targetValidated: p.targetValidated, prospects: stats.total || 0,
    hasSmtp: p.hasSmtp, templateValidated: (await getTemplate(db, p.id, 'initial', { validatedOnly: true })) != null,
    mailsSent: !!sent, hasImap: p.hasImap, followupEnabled: p.followupEnabled,
    evolutionDone: !!evolved,
    linkedinAvailable: linkedinAvailable(app.cfg), linkedinConnected: !!li && !li.expired, linkedinPosted: !!posted,
  });
}
