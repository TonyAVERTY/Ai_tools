// Page « Développeur » : activation du mode, jetons d'API (montrés une seule fois), référence de l'API et du serveur MCP.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { SCOPES } from './apitokens.js';
import { API_ENDPOINTS } from './apiv1.js';
import { banner } from './banner.js';
import { lockedCard } from './lockviews.js';

/** Une valeur à copier telle quelle (adresse, commande) : monospace, bouton « Copier » (public/app.js, [data-copy-cmd]). */
const cmd = (label, text) => `<div class="cmd"><span class="lbl">${label}</span><div class="cmd-b"><pre><code>${esc(text)}</code></pre><button type="button" class="btn small" data-copy-cmd aria-label="Copier : ${esc(label)}">${ic('copy')}Copier</button></div></div>`;

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : 'jamais');

export function developerPage({ user, enabled, tokens = [], newToken = null, error = null, appUrl, max, locked = false }) {
  const body = locked ? lockedCard('api', 'Mode développeur') : !enabled ? `<section class="card">
  <div class="card-h"><h2>Mode développeur</h2><p>Active le mode développeur pour utiliser l'API d'iaboss et le serveur MCP (piloter ton panel depuis Claude ou depuis tes propres scripts). Tant qu'il est désactivé, aucun jeton ne fonctionne.</p></div>
  <form method="post" action="/account/developer" class="cfg"><input type="hidden" name="enabled" value="on">
    <div class="row"><button class="btn primary">${ic('key')}Activer le mode développeur</button></div></form>
</section>` : `
${newToken ? `<section class="card" role="status">
  <div class="card-h"><h2>Jeton créé : copie-le maintenant</h2><p>Il ne sera plus jamais affiché. Si tu le perds, supprime-le et crées-en un autre.</p></div>
  <div class="tokenbox"><code data-token>${esc(newToken)}</code><button type="button" class="btn small" data-copy-token>${ic('copy')}Copier</button></div>
</section>` : ''}
<section class="card">
  <div class="card-h"><h2>Jetons d'API</h2><p>Un jeton donne accès à ton compte avec les droits cochés, et à rien d'autre. Garde-le secret : ne le mets jamais dans une page web, un dépôt ou un message. ${max} jetons au plus.</p></div>
  ${error ? banner('err', error) : ''}
  ${tokens.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Début</th><th>Droits</th><th>Créé</th><th>Dernier usage</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
    ${tokens.map((t) => `<tr><td>${esc(t.name)}</td><td><code>${esc(t.prefix)}…</code></td><td>${t.scopes.map((s) => `<span class="badge">${esc(s)}</span>`).join(' ')}</td><td>${esc(day(t.createdAt))}</td><td>${esc(day(t.lastUsedAt))}</td>
      <td><form method="post" action="/developer/tokens/${t.id}/revoke" data-confirm="Supprimer le jeton « ${esc(t.name)} » ? Les scripts ou Claude qui l'utilisent perdront l'accès tout de suite. Cette action est définitive."><button class="btn small danger" aria-label="Supprimer le jeton ${esc(t.name)}">${ic('trash')}Supprimer</button></form></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Aucun jeton pour l\'instant.</p>'}
  ${tokens.length < max ? `<form method="post" action="/developer/tokens" class="cfg">
    <label class="field"><span class="lbl">Nom du jeton</span><input name="name" maxlength="100" placeholder="ex. Claude Desktop" required></label>
    <fieldset class="evs"><legend class="lbl">Droits</legend><div class="scopelist">
      ${Object.entries(SCOPES).map(([k, l]) => `<label class="opt"><input type="checkbox" name="scope_${k}" value="on"${k === 'read' ? ' checked' : ''}><span class="box">${ic('check')}</span><span><b><code>${k}</code></b> : ${esc(l)}</span></label>`).join('\n      ')}
    </div></fieldset>
    <div class="row"><button class="btn primary">${ic('key')}Créer un jeton</button></div>
  </form>` : ''}
</section>
<section class="card" aria-labelledby="h-dapi">
  <div class="card-h"><h2 id="h-dapi">API</h2><p>Chaque requête porte <code>Authorization: Bearer iaboss_…</code> ; les corps sont en JSON ; limite de 120 requêtes par minute et par compte. <a href="/docs/api">Référence complète, exemples et erreurs</a>.</p></div>
  ${cmd("Adresse de l'API", `${appUrl}/api/v1`)}
  ${cmd('Exemple', `curl -H "Authorization: Bearer $IABOSS_TOKEN" ${appUrl}/api/v1/projects`)}
  <details class="routes"><summary>Les ${API_ENDPOINTS.length} routes et le droit qu'elles demandent</summary>
    <div class="table-wrap"><table><thead><tr><th>Route</th><th>Droit</th><th>Rôle</th></tr></thead><tbody>
    ${API_ENDPOINTS.map((e) => `<tr><td><code>${e.method} ${esc(e.path)}</code></td><td>${e.scope ? `<code>${esc(e.scope)}</code>` : '—'}</td><td>${esc(e.summary)}</td></tr>`).join('')}
    </tbody></table></div>
  </details>
  <p class="muted small">Réponses d'erreur : <code>{ "error": "message", "code": "…" }</code>.</p>
</section>
<section class="card" aria-labelledby="h-dmcp">
  <div class="card-h"><h2 id="h-dmcp">Serveur MCP (Claude)</h2><p>Le serveur MCP relie Claude à ton panel avec ces mêmes jetons : tu peux lui demander « quelles réponses sont arrivées ? » ou « ajoute une note à ce prospect ». Il tourne sur ton ordinateur (il a besoin de Node.js) et parle à ce panel par internet, avec ton jeton. Il n'a aucun droit propre : il ne peut faire que ce que son jeton autorise.</p></div>
  <ol class="mcp-steps">
    <li><span><b>Télécharge le fichier</b> et range-le où tu veux sur ton ordinateur (par exemple dans ton dossier personnel).</span>
      <span class="row"><a class="btn small" href="/developer/mcp.js" download="iaboss-mcp.js">${ic('dl')}Télécharger iaboss-mcp.js</a></span></li>
    <li><span><b>Ajoute-le à Claude Code.</b> Dans un terminal, ouvre le dossier où tu l'as rangé et lance la commande (remplace <code>iaboss_…</code> par ton jeton).</span>
      ${cmd('Commande Claude Code', `claude mcp add iaboss \\\n  -e IABOSS_URL=${appUrl} \\\n  -e IABOSS_TOKEN=iaboss_… \\\n  -- node "$(pwd)/iaboss-mcp.js"`)}</li>
  </ol>
  <p class="muted small">Installation et outils : <a href="/docs/mcp">documentation du serveur MCP</a>.</p>
</section>
<section class="card">
  <div class="card-h"><h2>Désactiver</h2><p>Désactiver le mode développeur coupe immédiatement tous les jetons (ils sont conservés, mais inutilisables).</p></div>
  <form method="post" action="/account/developer" class="cfg"><input type="hidden" name="enabled" value="">
    <div class="row"><button class="btn">Désactiver le mode développeur</button></div></form>
</section>`;
  return layout({ title: 'Développeur', email: user.email, body: `<div class="narrow"><h1 class="h1">${ic('key')}Développeur</h1>${body}</div>` });
}
