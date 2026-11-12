// Postes d'une entreprise et tâches que l'IA y fait. Source unique : le filtre « par poste » du projet, la section « Postes et tâches IA »,
// les routes, les prompts et la documentation du Support (générée) lisent tous ce catalogue.
//
// Une tâche = un livrable en Markdown, écrit par Claude à partir de la fiche du projet (et de tes précisions).
//   web  : Claude peut chercher et lire des pages web (marché, concurrents, mots-clés).
//   repo : Claude lit le dépôt du projet, en lecture seule (documentation technique, tests, conformité…). Réservé aux administrateurs.
// Une tâche devient un job IA de type `poste_<id>` : l'id est donc court, en minuscules et chiffres, et unique dans tout le catalogue.
//
// `sections` = les sections de projet (data-acc) qui relèvent déjà de ce poste dans iaboss : le filtre les garde visibles.
// Sections sans poste (En-tête, Configuration du projet) : toujours visibles.

export const POSTE_PREFIX = 'poste_';

export const ROLES = [
  {
    id: 'direction', label: 'Direction', summary: 'Cap, objectifs, arbitrages et vision d\'ensemble.',
    sections: ['recap'],
    tasks: [
      { id: 'strategie', label: 'Note de stratégie', brief: 'Rédige une note de stratégie courte pour le dirigeant : où joue le produit, comment il gagne, ce qu\'il laisse de côté.', sections: ['Constat', 'Positionnement', 'Trois axes stratégiques', 'Ce qu\'on ne fait pas', 'Risques', 'Plan des 90 prochains jours'] },
      { id: 'okr', label: 'Objectifs et résultats clés (OKR)', brief: 'Propose les objectifs du trimestre et leurs résultats clés mesurables, un jeu par poste de l\'entreprise.', sections: ['Objectifs du trimestre', 'Résultats clés mesurables', 'Responsable de chaque objectif', 'Comment on mesure et à quelle fréquence'] },
      { id: 'concurrence', label: 'Analyse SWOT et concurrents', brief: 'Analyse la situation du produit face à ses concurrents réels, en t\'appuyant sur des pages web que tu as lues.', web: true, sections: ['Concurrents identifiés (avec source)', 'Forces', 'Faiblesses', 'Opportunités', 'Menaces', 'Ce qui nous différencie vraiment'] },
      { id: 'plan_affaires', label: 'Plan d\'affaires simplifié', brief: 'Bâtis un plan d\'affaires simple dont chaque chiffre est une hypothèse à confirmer, jamais un fait.', sections: ['Problème et solution', 'Clients visés', 'Modèle économique', 'Hypothèses chiffrées (à confirmer)', 'Plan d\'action sur 12 mois', 'Besoins en ressources'] },
      { id: 'revue_mensuelle', label: 'Revue mensuelle de direction', brief: 'Prépare l\'ordre du jour et les questions d\'une revue mensuelle de l\'activité avec l\'équipe.', sections: ['Ordre du jour', 'Questions à poser à chaque poste', 'Indicateurs à apporter', 'Décisions à prendre'] },
    ],
  },
  {
    id: 'commerce', label: 'Commerce', summary: 'Trouver des clients, leur écrire, les convaincre et conclure.',
    sections: ['target', 'prospect'],
    tasks: [
      { id: 'proposition', label: 'Proposition commerciale', brief: 'Rédige une proposition commerciale prête à adapter : le besoin du client, ta réponse, le déroulé, ce qui est inclus et les prochaines étapes. Les prix restent à renseigner.', sections: ['Le besoin du client', 'Notre réponse', 'Ce qui est inclus', 'Déroulé et délais', 'Investissement (prix à renseigner)', 'Prochaines étapes'] },
      { id: 'script_appel', label: 'Script d\'appel et objections', brief: 'Écris un script d\'appel de découverte de 5 minutes et les réponses aux objections les plus courantes de la cible.', sections: ['Accroche d\'ouverture', 'Questions de découverte', 'Présentation en 30 secondes', 'Objections courantes et réponses', 'Conclusion et prise de rendez-vous'] },
      { id: 'sequence', label: 'Séquence de prospection multicanale', brief: 'Conçois une séquence de prospection sur 3 semaines mêlant e-mail, LinkedIn et téléphone, avec le texte de chaque message.', sections: ['Logique de la séquence', 'Calendrier jour par jour', 'Texte de chaque message', 'Signaux pour arrêter ou relancer'] },
      { id: 'battlecard', label: 'Fiche face aux concurrents', brief: 'Prépare une fiche de vente face aux concurrents réels du produit, en t\'appuyant sur des pages web que tu as lues.', web: true, sections: ['Concurrents (avec source)', 'Comparaison point par point', 'Quand on gagne', 'Quand on perd', 'Phrases à dire et à éviter'] },
      { id: 'offres', label: 'Offres et grille tarifaire', brief: 'Propose une structure d\'offres (de quoi justifier chaque palier) et la logique de prix. Les montants sont des hypothèses à tester.', sections: ['Logique de prix', 'Offres proposées', 'Ce qui change d\'un palier à l\'autre', 'Remises possibles et limites', 'Comment tester les prix'] },
    ],
  },
  {
    id: 'marketing', label: 'Marketing', summary: 'Positionnement, acquisition, référencement et pages qui convertissent.',
    sections: ['target', 'linkedin', 'instagram', 'newsletter', 'promo'],
    tasks: [
      { id: 'positionnement', label: 'Positionnement et messages clés', brief: 'Formule le positionnement du produit et les messages clés par cible, avec preuves à l\'appui.', sections: ['Cible principale', 'Problème et promesse', 'Messages clés', 'Preuves à fournir', 'Ton et mots à utiliser ou éviter'] },
      { id: 'personas', label: 'Personas et parcours client', brief: 'Décris 2 ou 3 personas réalistes et leur parcours, de la prise de conscience à l\'achat.', sections: ['Personas', 'Motivations et freins', 'Parcours par étape', 'Contenus utiles à chaque étape'] },
      { id: 'seo', label: 'Plan de référencement (SEO)', brief: 'Construis un plan de référencement : mots-clés visés, pages à créer et ordre de priorité, en vérifiant sur le web ce que les concurrents publient.', web: true, sections: ['Mots-clés visés et intention de recherche', 'Pages à créer ou à améliorer', 'Idées d\'articles', 'Priorités sur 3 mois'] },
      { id: 'landing', label: 'Texte d\'une page d\'accueil', brief: 'Écris le texte complet d\'une page d\'accueil qui convertit, section par section.', sections: ['Titre et sous-titre', 'Bénéfices', 'Comment ça marche', 'Preuves et réponses aux doutes', 'Appel à l\'action'] },
      { id: 'campagne', label: 'Plan de campagne d\'acquisition', brief: 'Planifie une campagne d\'acquisition sur un mois : canaux, messages, budget indicatif et indicateurs.', sections: ['Objectif chiffré (hypothèse)', 'Canaux retenus et pourquoi', 'Messages par canal', 'Calendrier', 'Indicateurs de suivi'] },
    ],
  },
  {
    id: 'communication', label: 'Communication', summary: 'Contenus, réseaux sociaux, relations presse et image de marque.',
    sections: ['linkedin', 'instagram', 'newsletter', 'promo'],
    tasks: [
      { id: 'idees_contenus', label: 'Idées de contenus sur 4 semaines', brief: 'Propose un programme de contenus pour 4 semaines : sujets, format, plateforme et accroche de chacun.', sections: ['Fil rouge du mois', 'Programme semaine par semaine', 'Accroche de chaque contenu', 'Idées à réutiliser sur plusieurs plateformes'] },
      { id: 'ligne_editoriale', label: 'Ligne éditoriale et ton de marque', brief: 'Définis la ligne éditoriale du produit : la voix de la marque (avec des exemples de phrases à faire et à éviter), les thèmes récurrents, les formats par canal et la fréquence de publication.', sections: ['Voix et ton de la marque', 'Thèmes récurrents', 'Formats par canal', 'Rythme de publication', 'À faire et à éviter'] },
      { id: 'communique', label: 'Communiqué de presse', brief: 'Rédige un communiqué de presse sur un fait réel du produit. Si aucun fait précis n\'est donné, propose le meilleur angle et marque les éléments à confirmer.', sections: ['Titre', 'Chapeau', 'Corps du communiqué', 'Citation (à faire valider)', 'À propos', 'Contact presse (à renseigner)'] },
      { id: 'incident_com', label: 'Message en cas d\'incident', brief: 'Prépare les messages à publier en cas de panne ou d\'incident : première annonce, point d\'étape, clôture et excuses.', sections: ['Première annonce', 'Point d\'étape', 'Message de clôture', 'Réponse type aux clients mécontents', 'Qui valide quoi'] },
    ],
  },
  {
    id: 'produit', label: 'Produit', summary: 'Comprendre les utilisateurs, choisir quoi construire et dans quel ordre.',
    sections: ['evolution'],
    tasks: [
      { id: 'roadmap', label: 'Feuille de route produit', brief: 'Propose une feuille de route sur 3 trimestres, justifiée par la valeur pour les utilisateurs.', sections: ['Vision produit', 'Maintenant', 'Ensuite', 'Plus tard', 'Ce qui est volontairement écarté', 'Risques'] },
      { id: 'priorisation', label: 'Priorisation des idées (RICE)', brief: 'Priorise les idées d\'évolution du produit avec la méthode RICE. Les scores sont des estimations à discuter, présentées en tableau.', sections: ['Méthode et hypothèses', 'Tableau des idées (portée, impact, confiance, effort, score)', 'Ordre recommandé', 'Idées à valider avant de les construire'] },
      { id: 'user_stories', label: 'User stories et critères d\'acceptation', brief: 'Transforme une fonctionnalité en user stories avec critères d\'acceptation vérifiables.', sections: ['Contexte', 'User stories', 'Critères d\'acceptation', 'Cas limites', 'Hors périmètre'] },
      { id: 'entretiens', label: 'Guide d\'entretien utilisateurs', brief: 'Écris un guide d\'entretien pour comprendre comment les utilisateurs font aujourd\'hui, sans orienter leurs réponses.', sections: ['Objectifs de l\'étude', 'Profils à interviewer', 'Questions (neutres, ouvertes)', 'Ce qu\'il faut observer', 'Comment analyser les réponses'] },
      { id: 'metriques_produit', label: 'Indicateurs d\'usage à suivre', brief: 'Définis les indicateurs d\'usage qui disent si le produit apporte de la valeur : activation, rétention, usage des fonctions clés.', sections: ['Parcours de valeur', 'Indicateurs et définitions', 'Seuils d\'alerte', 'Comment les collecter'] },
    ],
  },
  {
    id: 'technique', label: 'Développement', summary: 'Code, qualité, mise en production et exploitation.',
    sections: ['audit'],
    tasks: [
      { id: 'doc_tech', label: 'Documentation technique du dépôt', brief: 'Rédige la documentation technique du dépôt à partir du code que tu lis : architecture, modules, lancement, configuration.', repo: true, sections: ['Vue d\'ensemble', 'Architecture et modules', 'Lancer le projet en local', 'Configuration et variables', 'Points d\'attention'] },
      { id: 'plan_tests', label: 'Plan de tests à ajouter', brief: 'Repère ce qui n\'est pas testé dans le dépôt et propose un plan de tests priorisé par risque.', repo: true, sections: ['État actuel des tests', 'Zones à risque non couvertes', 'Tests à écrire en priorité', 'Outils et conventions déjà en place'] },
      { id: 'dette_tech', label: 'Dette technique et plan de remboursement', brief: 'Recense la dette technique du dépôt (duplication, fichiers trop gros, dépendances) et propose un plan de remboursement progressif.', repo: true, sections: ['Constats (avec fichiers)', 'Impact pour l\'équipe', 'Plan par étapes', 'Gains attendus'] },
      { id: 'exploitation', label: 'Guide de déploiement et d\'exploitation', brief: 'Rédige un guide de mise en production et d\'exploitation d\'après le dépôt : déploiement, sauvegardes, surveillance, retour arrière.', repo: true, sections: ['Prérequis', 'Déployer', 'Sauvegardes et restauration', 'Surveillance et alertes', 'Revenir en arrière', 'Incidents fréquents'] },
      { id: 'accueil_dev', label: 'Guide d\'arrivée d\'un développeur', brief: 'Écris un guide pour qu\'un nouveau développeur soit opérationnel en une journée sur ce dépôt.', repo: true, sections: ['Avant de commencer', 'Installer et lancer', 'Où se trouve quoi', 'Conventions de code et de commit', 'Premières tâches conseillées'] },
    ],
  },
  {
    id: 'support', label: 'Support client', summary: 'Accompagner les clients, répondre vite et capitaliser sur les questions.',
    sections: [],
    tasks: [
      { id: 'faq', label: 'Foire aux questions', brief: 'Rédige la foire aux questions du produit : les questions que les clients se posent vraiment, avec des réponses courtes et exactes.', sections: ['Questions sur l\'offre', 'Questions sur l\'utilisation', 'Questions sur la facturation', 'Questions sur la sécurité et les données'] },
      { id: 'reponses_types', label: 'Modèles de réponses aux demandes courantes', brief: 'Prépare des modèles de réponse aux demandes les plus fréquentes, chaleureux et précis, à personnaliser.', sections: ['Cas courants (un modèle par cas)', 'Quand escalader', 'Formules à éviter'] },
      { id: 'articles_aide', label: 'Articles d\'aide pas à pas', brief: 'Écris des articles d\'aide pas à pas pour les 5 tâches les plus fréquentes des utilisateurs.', sections: ['Liste des articles', 'Contenu de chaque article (étapes numérotées)', 'Erreurs fréquentes et remèdes'] },
      { id: 'accueil_client', label: 'Parcours d\'accueil d\'un nouveau client', brief: 'Conçois les e-mails d\'accueil d\'un nouveau client sur ses 14 premiers jours, avec le but de chacun.', sections: ['Objectif du parcours', 'Calendrier des messages', 'Texte de chaque message', 'Signaux d\'un client en difficulté'] },
      { id: 'satisfaction', label: 'Enquête de satisfaction', brief: 'Prépare une enquête de satisfaction courte (questions, échelle) et la façon d\'exploiter les réponses.', sections: ['Objectif', 'Questions', 'Moment et canal d\'envoi', 'Lecture des résultats', 'Actions types selon les réponses'] },
    ],
  },
  {
    id: 'finance', label: 'Finance', summary: 'Prix, budget, facturation et indicateurs de santé financière.',
    sections: [],
    tasks: [
      { id: 'budget', label: 'Budget prévisionnel', brief: 'Construis un budget prévisionnel sur 12 mois sous forme de tableaux, avec des hypothèses clairement signalées « à compléter ».', sections: ['Hypothèses (à compléter)', 'Recettes', 'Dépenses', 'Trésorerie mois par mois', 'Points de vigilance'] },
      { id: 'prix_marges', label: 'Étude de prix et de marges', brief: 'Analyse le prix de vente et les marges possibles selon plusieurs scénarios. Les chiffres sont des hypothèses, jamais des faits.', sections: ['Coûts à prendre en compte', 'Scénarios de prix', 'Marge par scénario', 'Seuil de rentabilité', 'Recommandation'] },
      { id: 'devis_facturation', label: 'Modèles de devis et conditions de paiement', brief: 'Prépare un modèle de devis, de facture et des conditions de paiement, avec les mentions à vérifier selon le pays.', sections: ['Modèle de devis', 'Modèle de facture', 'Conditions de paiement', 'Relance des impayés (3 niveaux)', 'Mentions à faire vérifier'] },
      { id: 'tableau_financier', label: 'Tableau de bord financier', brief: 'Définis le tableau de bord financier d\'une petite entreprise : indicateurs, formules, fréquence et seuils d\'alerte.', sections: ['Indicateurs clés', 'Formules', 'Fréquence de suivi', 'Seuils d\'alerte', 'Décisions associées'] },
    ],
  },
  {
    id: 'juridique', label: 'Juridique et conformité', summary: 'Contrats, données personnelles et règles à respecter. Brouillons à faire relire.',
    sections: [],
    tasks: [
      { id: 'rgpd', label: 'Registre des traitements (RGPD)', brief: 'Dresse le registre des traitements de données personnelles à partir des données que le code manipule réellement.', repo: true, sections: ['Données personnelles traitées (avec fichiers)', 'Finalités', 'Base légale', 'Durées de conservation', 'Destinataires et sous-traitants', 'Mesures de sécurité', 'Points à corriger'] },
      { id: 'cgv', label: 'Conditions générales de vente', brief: 'Rédige un brouillon de conditions générales de vente adapté au produit.', sections: ['Objet', 'Prix et paiement', 'Durée et résiliation', 'Responsabilité', 'Données personnelles', 'Droit applicable', 'Points à faire valider par un juriste'] },
      { id: 'contrat', label: 'Modèle de contrat de prestation', brief: 'Rédige un brouillon de contrat de prestation de services adapté au produit.', sections: ['Parties', 'Objet et livrables', 'Prix et facturation', 'Propriété intellectuelle', 'Confidentialité', 'Fin du contrat', 'Points à faire valider par un juriste'] },
      { id: 'mentions', label: 'Mentions légales et confidentialité', brief: 'Rédige un brouillon de mentions légales et de politique de confidentialité, avec les éléments à renseigner entre crochets.', sections: ['Mentions légales', 'Politique de confidentialité', 'Cookies', 'Droits des personnes', 'Éléments à renseigner'] },
    ],
  },
  {
    id: 'rh', label: 'Ressources humaines', summary: 'Recruter, intégrer et faire grandir l\'équipe.',
    sections: [],
    tasks: [
      { id: 'fiche_poste', label: 'Fiche de poste', brief: 'Rédige une fiche de poste claire pour le prochain recrutement le plus utile à l\'entreprise, et justifie ce choix.', sections: ['Pourquoi ce poste', 'Missions', 'Profil recherché', 'Compétences indispensables et souhaitées', 'Conditions (à renseigner)'] },
      { id: 'annonce', label: 'Annonce de recrutement', brief: 'Rédige une annonce de recrutement attractive et honnête, prête à publier.', sections: ['Titre', 'Qui nous sommes', 'Ta mission', 'Ton profil', 'Ce que nous offrons (à renseigner)', 'Comment candidater'] },
      { id: 'grille_entretien', label: 'Grille d\'entretien d\'embauche', brief: 'Prépare une grille d\'entretien structurée pour comparer les candidats de façon équitable.', sections: ['Critères d\'évaluation', 'Questions par critère', 'Échelle de notation', 'Signaux d\'alerte', 'Questions interdites'] },
      { id: 'integration', label: 'Plan d\'intégration 30-60-90 jours', brief: 'Conçois le plan d\'intégration d\'une nouvelle recrue sur ses 90 premiers jours.', sections: ['Avant l\'arrivée', 'Première semaine', '30 jours', '60 jours', '90 jours', 'Points de suivi avec le manager'] },
    ],
  },
  {
    id: 'operations', label: 'Opérations et qualité', summary: 'Processus, outils, fournisseurs et amélioration continue.',
    sections: [],
    tasks: [
      { id: 'processus', label: 'Processus et procédures', brief: 'Décris les processus clés de l\'entreprise et rédige les procédures des 3 plus importants.', sections: ['Processus clés', 'Procédure détaillée de chacun des 3 plus importants', 'Responsables', 'Points de contrôle'] },
      { id: 'continuite', label: 'Gestion d\'incident et continuité', brief: 'Prépare la procédure de gestion d\'incident et le plan de continuité d\'activité.', sections: ['Niveaux de gravité', 'Qui fait quoi', 'Déroulé d\'un incident', 'Plan de continuité', 'Retour d\'expérience'] },
      { id: 'qualite', label: 'Indicateurs qualité et revue mensuelle', brief: 'Définis les indicateurs de qualité de service et la revue mensuelle qui en découle.', sections: ['Indicateurs et définitions', 'Cibles', 'Déroulé de la revue mensuelle', 'Plan d\'amélioration'] },
      { id: 'outils', label: 'Choix d\'outils et de prestataires', brief: 'Compare les outils ou prestataires utiles à l\'entreprise sur des critères précis, en vérifiant leurs offres sur le web.', web: true, sections: ['Besoin et critères', 'Comparatif (avec sources)', 'Recommandation', 'Risques et plan de sortie'] },
    ],
  },
];

/** Tâches à plat : { ...tâche, role, job } où `job` est le type de job (poste_<id>). */
export const ROLE_TASKS = ROLES.flatMap((r) => r.tasks.map((t) => ({ ...t, role: r.id, roleLabel: r.label, job: `${POSTE_PREFIX}${t.id}` })));

const BY_JOB = new Map(ROLE_TASKS.map((t) => [t.job, t]));
const BY_ID = new Map(ROLE_TASKS.map((t) => [t.id, t]));

export const roleTaskByJob = (type) => BY_JOB.get(type) || null;
export const roleTaskById = (id) => BY_ID.get(String(id)) || null;
export const roleById = (id) => ROLES.find((r) => r.id === id) || null;
export const isRoleJob = (type) => BY_JOB.has(type);

/** Postes auxquels se rattache une section de projet (data-acc), ou [] pour une section toujours visible. */
export function rolesOfSection(key) {
  return ROLES.filter((r) => r.sections.includes(key)).map((r) => r.id);
}

/** Longueur maximale des précisions saisies avec une tâche. */
export const MAX_NOTES = 1000;
