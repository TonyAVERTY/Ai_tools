// Page « Développeur » : activation du mode, jetons d'API (montrés une seule fois), référence de l'API et du serveur MCP.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { SCOPES } from './apitokens.js';
import { API_ENDPOINTS } from './apiv1.js';
import { devLinks } from './devlinks.js';

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : 'jamais');

export function developerPage({ user, enabled, tokens = [], newToken = null, error = null, appUrl, max }) {
  const body = !enabled ? `<section class="card">
  <div class="card-h"><h2>Mode développeur</h2><p>Active le mode développeur pour utiliser l'API d'AiTools et le serveur MCP (piloter ton panel depuis Claude ou depuis tes propres scripts). Tant qu'il est désactivé, aucun jeton ne fonctionne.</p></div>
  <form method="post" action="/account/developer" class="cfg"><input type="hidden" name="enabled" value="on">
    <div class="row"><button class="btn primary">${ic('key')}Activer le mode développeur</button></div></form>
</section>` : `
${newToken ? `<section class="card" role="status">
  <div class="card-h"><h2>Jeton créé : copie-le maintenant</h2><p>Il ne sera plus jamais affiché. Si tu le perds, supprime-le et crées-en un autre.</p></div>
  <div class="tokenbox"><code data-token>${esc(newToken)}</code><button type="button" class="btn small" data-copy-token>${ic('copy')}Copier</button></div>
</section>` : ''}
<section class="card">
  <div class="card-h"><h2>Jetons d'API</h2><p>Un jeton donne accès à ton compte avec les droits cochés, et à rien d'autre. Garde-le secret : ne le mets jamais dans une page web, un dépôt ou un message. ${max} jetons au plus.</p></div>
  ${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
  ${tokens.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Début</th><th>Droits</th><th>Créé</th><th>Dernier usage</th><th></th></tr></thead><tbody>
    ${tokens.map((t) => `<tr><td>${esc(t.name)}</td><td><code>${esc(t.prefix)}…</code></td><td>${t.scopes.map((s) => `<span class="badge">${esc(s)}</span>`).join(' ')}</td><td>${esc(day(t.createdAt))}</td><td>${esc(day(t.lastUsedAt))}</td>
      <td><form method="post" action="/developer/tokens/${t.id}/revoke"><button class="btn small danger">${ic('trash')}Supprimer</button></form></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Aucun jeton pour l\'instant.</p>'}
  ${tokens.length < max ? `<form method="post" action="/developer/tokens" class="cfg">
    <label class="field"><span class="lbl">Nom du jeton</span><input name="name" maxlength="100" placeholder="ex. Claude Desktop" required></label>
    <fieldset class="evs"><legend class="lbl">Droits</legend><div class="checks">
      ${Object.entries(SCOPES).map(([k, l]) => `<label class="opt"><input type="checkbox" name="scope_${k}" value="on"${k === 'read' ? ' checked' : ''}><span class="box">${ic('check')}</span><span><b>${k}</b> : ${esc(l)}</span></label>`).join('\n      ')}
    </div></fieldset>
    <div class="row"><button class="btn primary">${ic('key')}Créer un jeton</button></div>
  </form>` : ''}
</section>
<section class="card">
  <div class="card-h"><h2>Adresses et documentation</h2><p>Tout ce qu'il faut pour brancher un script ou Claude à ton panel.</p></div>
  ${devLinks(appUrl)}
</section>
<section class="card">
  <div class="card-h"><h2>API</h2><p>Base : <code>${esc(appUrl)}/api/v1</code>. Chaque requête porte <code>Authorization: Bearer aitk_…</code> ; les corps sont en JSON. Limite : 120 requêtes par minute et par compte.</p></div>
  <div class="table-wrap"><table><thead><tr><th>Route</th><th>Droit</th><th>Rôle</th></tr></thead><tbody>
    ${API_ENDPOINTS.map((e) => `<tr><td><code>${e.method} ${esc(e.path)}</code></td><td>${e.scope ? esc(e.scope) : '—'}</td><td>${esc(e.summary)}</td></tr>`).join('')}
  </tbody></table></div>
  <pre class="md">curl -H "Authorization: Bearer $AITOOLS_TOKEN" ${esc(appUrl)}/api/v1/projects</pre>
  <p class="muted small">Réponses d'erreur : <code>{ "error": "message", "code": "…" }</code>. Documentation complète : <code>docs/API.md</code> dans le dépôt.</p>
</section>
<section class="card">
  <div class="card-h"><h2>Serveur MCP (Claude)</h2><p>Le serveur MCP relie Claude à ton panel avec ces mêmes jetons : tu peux lui demander « quelles réponses sont arrivées ? » ou « ajoute une note à ce prospect ».</p></div>
  <pre class="md">claude mcp add aitools \\
  -e AITOOLS_URL=${esc(appUrl)} \\
  -e AITOOLS_TOKEN=aitk_… \\
  -- node /chemin/vers/aitools/mcp/aitools-mcp.js</pre>
  <p class="muted small">Documentation : <code>docs/MCP.md</code>. Le serveur n'a aucun droit propre : il ne peut faire que ce que son jeton autorise.</p>
</section>
<section class="card">
  <div class="card-h"><h2>Désactiver</h2><p>Désactiver le mode développeur coupe immédiatement tous les jetons (ils sont conservés, mais inutilisables).</p></div>
  <form method="post" action="/account/developer" class="cfg"><input type="hidden" name="enabled" value="">
    <div class="row"><button class="btn">Désactiver le mode développeur</button></div></form>
</section>`;
  return layout({ title: 'Développeur', email: user.email, body: `<div class="narrow"><h1 class="h1">${ic('key')}Développeur</h1>${body}</div>` });
}
