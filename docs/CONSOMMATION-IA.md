# Consommation IA : cartographie, mesures, optimisations

Tout appel à l'IA Claude passe par `makeClaude` (`src/handlers.js`) puis `runClaude` (`src/services/claude.js`) : un processus `claude -p` par appel, jamais de session réutilisée. Le coût fixe d'un appel (consignes intégrées du CLI + définition des outils) compte donc **à chaque appel et à chaque tour** d'un job multi-tours.

## Cartographie des appels

| Action / tâche | Où | Outils | Tours max |
|---|---|---|---|
| Analyse du projet | `handlers.js` (analyze) | Read, Glob, Grep | 20 |
| Identité visuelle (facturation) | `ensureBrand` | Read, Glob, Grep | 14 |
| Évolution, audit | `handlers.js` | Read, Glob, Grep | selon niveau |
| Prospection, accroche | `handlers.js` (prospect, hook) | WebSearch, WebFetch / WebFetch | 6 à 1 |
| Modèle de mail, relance | `handlers.js` | aucun | 1 |
| Contrôle du sens des mails | `services/mailsense.js` | aucun | 1 (lots de 10, 2 essais pour une autre phrase) |
| Posts LinkedIn / Instagram / newsletter | `handlers.js` + `stillqa.js` | aucun ; Read pour le contrôle visuel | 1 ; 6 |
| Vidéo de promotion | `handlers.js` + `promoqa.js` | aucun ; Read pour le contrôle | 1 ; 12 |
| Devis, factures, relecture | `handlers.js`, `billingreview.js` | aucun ; Read | 1 ; 10 × 3 rondes |
| Postes (rôles) | `handlers.js` (`ROLE_TASKS`) | selon la tâche | selon la tâche |
| Page IA / Support | `chat.js` | aucun, ou Read/Glob/Grep avec pièces jointes ou projet | 1 à 14 |
| `/compacter` | `chat.js` | aucun | 1 |
| Test du jeton | `claudelink.js` | aucun | 1 |

Comptabilité de l'usage : `total_cost_usd` et `usage` de chaque résultat (jobs : `tokens_in`, `tokens_out`, `cost_usd` ; chat : `chat_messages.cost_usd`) ; quota d'abonnement : l'événement `rate_limit_event` du CLI, rangé dans le réglage `claude_rate_limit_json` (fenêtres `fiveHour` et `sevenDay`, voir `budget.js`). Aucune de ces valeurs ne dit comment Anthropic pondère les tokens lus en cache dans la fenêtre de 5 heures : les gains sont donnés en tokens et en coût, pas en minutes de quota.

## Ce qui a été changé

1. **`--tools` aligné sur `--allowedTools`** (`runClaude`). Jusqu'ici seul le chat passait `--tools` ; les jobs envoyaient la définition de tous les outils intégrés (Bash, WebFetch, Task, TodoWrite…) à chaque tour alors que `--allowedTools` ne fait qu'autoriser. Le modèle ne peut utiliser que la liste déjà autorisée : même capacité, moins de texte envoyé.
2. **`--exclude-dynamic-system-prompt-sections`**, uniquement si le CLI du serveur l'annonce dans `--help` (lu une fois au démarrage : `probeClaudeFlags`, résultat dans `cfg.claudeFlags`). Dossier de travail, environnement et état git passent dans le premier message au lieu des consignes : le modèle reçoit les mêmes informations, et le début de la requête est identique d'un appel à l'autre, donc relu en cache au lieu d'être réécrit. Un CLI plus ancien ne reçoit pas l'option.

## Mesures réelles (CLI 2.1.323, modèle haiku, HOME jetable, 1 mesure par ligne)

Les modèles de l'application ne changent pas ; haiku sert aux mesures pour limiter la dépense, le surcoût fixe ne dépend pas du modèle.

| Scénario | Appels | Tokens d'entrée avant → après | Coût avant → après | Contrôle d'équivalence |
|---|---|---|---|---|
| Appel minimal sans outil (« ok ») | 1 | 14 912 → 3 410 | 0,00122 $ → 0,00056 $ | même réponse |
| Appel minimal Read/Glob/Grep | 1 | 14 913 → 6 050 | 0,00122 $ → 0,00060 $ | même réponse |
| Appel minimal WebSearch/WebFetch/Read | 1 | 14 912 → 5 482 | 0,00122 $ → 0,00062 $ | même réponse |
| S1 contrôle du sens (3 mails, JSON) | 1 | 19 555 → 8 051 (2e mesure : 19 573 → 8 070) | 0,0040 $ → 0,0030 $ | mêmes verdicts [mail 1 : refusé, 2 : accepté, 3 : refusé], mêmes `fix_body` présents, en 4 exécutions |
| S2 modèle de mail (JSON subject / subject_b / body) | 1 | 22 586 → 11 083 | 0,0058 $ → 0,0038 $ | JSON valide aux deux, mêmes clés ; texte différent comme d'un appel à l'autre |
| S3 lecture d'un petit dépôt (3 tours) | 1 | 32 336 → 14 739 (2e mesure : 32 421 → 19 544) | 0,0021 $ → 0,0014 $ (2e : 0,0012 $) | même réponse (85 %, `budget.js:48`) en 6 exécutions |
| S4 chat, 20 messages d'historique | 1 | 14 859 → 14 861 | inchangé | aucun changement attendu : le chat passait déjà `--tools` |

Avec l'option de cache, deux appels depuis des dossiers différents (sans outil) : 2 758 tokens écrits en cache → 1 102, 2 111 relus ; coût 0,00056 $ → 0,00024 $. Le nombre total de tokens ne change pas : le gain est en cache écrit, pas en tokens lus.

La latence est dominée par la réflexion du modèle (tokens de sortie qui varient de 2 000 à 6 000 sur le même prompt) : les écarts mesurés (de 28 s à 17 s sur S2, de 10 s à 12 s sur S1) sont du bruit, aucun gain de latence n'est annoncé.

## Vérifié sans appel

- Double déclenchement : `enqueue` (`services/jobs.js`) renvoie le job déjà en file ou en cours pour le même projet et le même type (test existant) ; la page IA refuse un second envoi tant qu'une réponse est en cours (409).
- Reprise après erreur : un job « running » au redémarrage passe en erreur (« Interrompu (redémarrage) »), rien n'est rejoué tout seul ; une relance vient de l'utilisateur (`retryJob`).
- Arguments : `test/claude-run.test.js` contrôle `--tools`, son égalité avec `--allowedTools`, et que l'option récente n'est passée que si le CLI la connaît.

## Laissé tel quel, faute de preuve d'équivalence

- **Contrôle du sens à l'aperçu puis à l'envoi** : les deux sont des appels différents (modèle ou mails remplis différents) ; réutiliser le résultat de l'aperçu changerait ce qui est contrôlé à l'envoi.
- **Rondes de relecture** (`billingreview.js`, `stillqa.js`, `promoqa.js`) et **vidéo** : étapes IA qui contribuent au résultat, conservées.
- **Réflexion du modèle** (`--effort`, budget de réflexion) : réduirait les tokens de sortie mais change la qualité ; non touché.
- **Historique du chat** : `/compacter` existe déjà pour l'utilisateur ; un résumé automatique changerait ce que le modèle voit.
- **Non mesuré** : les modèles Sonnet, Opus et Fable, les outils web en conditions réelles, les jobs complets (analyse d'un vrai dépôt, vidéo), la version du CLI installée sur le serveur de production, et la conversion en minutes de la fenêtre de 5 heures.
