# Réponses, statuts des prospects et CRM
Résumé : détection des réponses par IMAP, les statuts d'un prospect, liste et Kanban, filtres, fiche prospect (prochaine action, notes, historique), import et export CSV.

## Détecter les réponses (boîte IMAP)
Dans « Configuration du projet → Boîte de réception (IMAP) », renseigne l'hôte (vide = désactivé), le port, l'utilisateur et le mot de passe (vides = mêmes identifiants que le SMTP), puis **Enregistrer et tester**. AiTools lit la boîte toutes les 15 minutes, et à la demande avec **« Vérifier maintenant »** (dans la section Envoi).
- Une réponse fait passer le prospect en **« A répondu »**. Elle est rattachée par le fil de discussion, puis par l'adresse, puis par le domaine professionnel s'il est unique.
- Les absences, réponses automatiques et newsletters sont ignorées.
- Les mails rejetés (bounces) passent le prospect en **« Rejeté »** et l'adresse en liste d'opposition.
- Aucun token Claude n'est consommé pour lire la boîte.

## Les statuts d'un prospect
**À contacter**, **Contacté**, **A répondu**, **Client**, **Refus**, **Rejeté**, **Adresse invalide**.
Marquer un prospect en **Refus** ajoute son adresse à la liste d'opposition (une confirmation est demandée).

## La liste des prospects (Prospecter → Prospects)
- Deux affichages : **Liste** et **Kanban**.
- **Recherche** par entreprise, email, ville ou secteur.
- Filtres : **statut**, **score minimum** (≥ 5, ≥ 7, ≥ 9), case **« Actions à faire »** (prospects dont la prochaine action est due), **tri** (score, plus récents, dernier contact, entreprise A → Z). Pagination par 100.
- **Kanban** : une colonne par statut ; on glisse une carte pour changer son statut, ou on utilise le menu de statut de la carte (au clavier). Une carte montre l'entreprise, l'email, la ville, le score et la prochaine action.

## La fiche d'un prospect
Un clic sur le nom de l'entreprise ouvre la fiche : accroche et origine de l'email (avec les boutons **Générer une accroche** / **Régénérer l'accroche**), **Historique** (premier mail avec sa variante A/B, relance, réponse, échecs d'envoi), **Prochaine action** (champs « Quoi » et « Quand », boutons **Enregistrer** et **Effacer**, un rappel à 9h heure de Paris alimente le filtre « Actions à faire ») et **Notes** libres (**Ajouter la note**). Bouton **Fermer** pour revenir.

## Exporter en CSV
Lien **Exporter (CSV)** : format Excel français (séparateur `;`, UTF-8 avec BOM). L'export reprend les filtres affichés. Les cellules qui commencent par `=`, `+`, `-` ou `@` sont neutralisées pour qu'Excel ne les exécute pas.

## Importer un CSV
Bouton **Importer un CSV** : 2000 lignes au plus. Colonnes reconnues (en français ou en anglais) : entreprise, email, site, ville, secteur, score, source, accroche. L'encodage UTF-8 ou Windows-1252 est détecté (les fichiers d'Excel passent tels quels). Les doublons et les adresses en liste d'opposition sont ignorés ; un rapport ligne par ligne s'affiche. L'origine de chaque contact est toujours renseignée (« Import CSV du JJ/MM/AAAA » par défaut), pour le RGPD.

## Liste d'opposition (Réglages → Liste d'opposition)
Une personne qui se désinscrit, refuse ou dont l'adresse est invalide n'est plus jamais contactée ni proposée, quel que soit le compte ou le projet. La liste est commune à tous les comptes et personne ne peut la consulter : on ne voit que le statut de ses propres prospects. Elle subsiste après la suppression d'un compte.
