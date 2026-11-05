# Renommage AiTools → iaboss

Le produit s'appelle **iaboss** (en minuscules). Tout ce que voit une personne a changé : pages, titres, e-mails, pages légales, documentation, README, messages, consignes données à l'IA, noms de fichiers à télécharger (`iaboss-mcp.js`, `iaboss.ics`). Le monogramme « AI » du logo reste.

## Ce qui a changé et reste compatible

| Avant | Maintenant | Compatibilité |
|---|---|---|
| Serveur MCP `aitools-mcp.js`, nom de serveur `aitools` | `iaboss-mcp.js`, nom de serveur `iaboss` | Une ancienne copie du fichier continue de marcher. |
| Variables `AITOOLS_URL`, `AITOOLS_TOKEN`, `AITOOLS_READONLY` | `IABOSS_URL`, `IABOSS_TOKEN`, `IABOSS_READONLY` | Les anciens noms sont encore lus (les nouveaux passent avant). |
| Jetons d'API `aitk_…` | `iaboss_…` pour les nouveaux jetons | Les jetons `aitk_` déjà créés restent valides (même longueur, même hachage). |
| Commande `claude mcp add aitools` | `claude mcp add iaboss` | Seule la commande affichée change. |

## Noms techniques volontairement inchangés

Les renommer casserait une installation existante ou n'apporterait rien de visible :

- **Serveur** : utilisateur système `aitools`, dossier `/opt/aitools`, journal `/var/log/aitools-install.log`, unités `aitools.service`, `aitools-backup.service`, `aitools-backup.timer`, script `aitools-backup`, étiquette de disque `aitools`, `/srv/aitools`, fichiers `*.aitools.bak`.
- **Données** : fichier `data/aitools.sqlite`, noms de bases de test (`aitools_test`, `aitools_bdd_*`), verrou de migration `aitools_migrate`.
- **Code** : nom du paquet npm `aitools`, identifiant JavaScript `window.AiTools`, en-tête HTTP `X-AiTools-Nav`, clé `aitools.role` du navigateur, profil de permissions Codex `aitools`, identifiant de fiche `contexte-aitools`, bras `aitools` du banc d'essai.
- **Dossiers temporaires** : préfixes `aitools-…` (bac à sable, voix, Chromium, connexions).
- **Agenda** : le domaine des identifiants d'événements iCal (`@aitools`) : le changer ferait réapparaître en double les événements déjà abonnés.
- **Dépôt GitHub** : `Ai_tools`.

Tout ceci peut être renommé plus tard, séparément, avec sa propre migration.
