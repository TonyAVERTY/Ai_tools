# Serveur MCP AiTools

Le serveur MCP (Model Context Protocol) relie **Claude** à ton panel AiTools : tu peux lui demander « quelles réponses sont arrivées ? », « ajoute une note à ce prospect » ou « lance une recherche de 20 prospects ». Il utilise l'[API](API.md) : il est donc **réservé au mode développeur** et n'a aucun droit propre, seulement ceux de son jeton.

Fichier : `mcp/aitools-mcp.js` (Node 22, aucune dépendance, protocole MCP sur stdio).

## 1. Prérequis

1. Mode développeur activé (Mon compte → *Mode développeur*).
2. Un jeton d'API créé dans la page **Développeur**. Pour commencer : droit `read` seul.

## 2. Installation

### Claude Code
```bash
claude mcp add aitools \
  -e AITOOLS_URL=https://ton-panel \
  -e AITOOLS_TOKEN=aitk_… \
  -- node /chemin/vers/aitools/mcp/aitools-mcp.js
```

### Claude Desktop
Dans `claude_desktop_config.json` :
```json
{
  "mcpServers": {
    "aitools": {
      "command": "node",
      "args": ["/chemin/vers/aitools/mcp/aitools-mcp.js"],
      "env": { "AITOOLS_URL": "https://ton-panel", "AITOOLS_TOKEN": "aitk_…" }
    }
  }
}
```

Variables :

| Variable | Rôle |
|---|---|
| `AITOOLS_URL` | Adresse du panel (obligatoire) |
| `AITOOLS_TOKEN` | Jeton d'API `aitk_…` (obligatoire) |
| `AITOOLS_READONLY=1` | Ne propose que les outils de lecture, même si le jeton a plus de droits |

## 3. Outils

| Outil | Droit du jeton | Rôle |
|---|---|---|
| `list_projects` | `read` | Projets et compteurs |
| `get_project` | `read` | Détail d'un projet |
| `list_prospects` | `read` | Prospects d'un projet (filtres) |
| `get_prospect` | `read` | Fiche d'un prospect |
| `list_replies` | `read` | Réponses reçues, intention, réponse suggérée |
| `list_sent_mails` | `read` | Mails envoyés |
| `get_job` | `read` | État d'une tâche |
| `add_prospects` | `write` | Ajouter des prospects |
| `set_prospect_status` | `write` | Changer un statut (`refused` = opposition) |
| `add_note` | `write` | Ajouter une note |
| `set_next_action` | `write` | Définir la prochaine action |
| `mark_reply_seen` | `write` | Marquer une réponse lue |
| `run_job` | `jobs` | Lancer analyse, recherche, évolutions, audit ou envoi |
| `regenerate_hook` | `jobs` | Régénérer l'accroche d'un prospect |

## 4. Sécurité

- **Moindre droit** : crée un jeton dédié à Claude avec seulement `read`, puis ajoute `write` ou `jobs` si nécessaire. Avec `AITOOLS_READONLY=1`, les outils d'écriture n'existent plus pour Claude.
- **Envoi de mails** : `run_job` avec `type: "send"` exige `confirm: true`, et le serveur demande à Claude de recueillir ton accord explicite avant. N'accorde le droit `jobs` que si tu veux cet usage.
- **Contenus de tiers** : les réponses des prospects et les pages web sont écrites par d'autres. Le serveur les signale comme *données* à Claude, qui ne doit jamais les suivre comme des instructions ; relis les actions proposées avant de les valider.
- Le jeton ne quitte jamais ta machine que vers ton panel, et il est masqué dans les messages d'erreur. Révoque-le depuis la page Développeur s'il a pu fuiter.

## 5. Dépannage

| Message | Cause |
|---|---|
| `Jeton d'API manquant ou invalide (invalid_token)` | Jeton recopié incomplètement ou supprimé |
| `Le mode développeur est désactivé (developer_mode_off)` | Réactive-le dans Mon compte |
| `Ce jeton n'a pas le droit « write » (insufficient_scope)` | Crée un jeton avec ce droit |
| `Trop de requêtes (rate_limited)` | 120 requêtes par minute : attends quelques secondes |
