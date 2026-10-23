// Liens du mode développeur : adresse de l'API, serveur MCP, documentation. Partagé par Mon compte et la page Développeur.
import { esc } from './http.js';
import { ic } from './icons.js';

export const DEV_DOCS = { api: 'API.md', mcp: 'MCP.md' };

/** @param {string} appUrl */
export function devLinks(appUrl) {
  const base = `${appUrl}/api/v1`;
  const mcp = `${appUrl}/developer/mcp.js`;
  const row = (label, value, extra = '') => `<div class="devlink"><span class="lbl">${label}</span><div class="tokenbox"><code>${esc(value)}</code>${extra}</div></div>`;
  return `<div class="devlinks">
    ${row("Adresse de l'API", base, `<a class="btn small" href="/developer/docs/api">${ic('dl')}Documentation API</a>`)}
    ${row('Serveur MCP (fichier à télécharger)', mcp, `<a class="btn small" href="/developer/mcp.js" download="aitools-mcp.js">${ic('dl')}Télécharger</a><a class="btn small" href="/developer/docs/mcp">${ic('dl')}Documentation MCP</a>`)}
    ${row('Commande Claude Code', `claude mcp add aitools -e AITOOLS_URL=${appUrl} -e AITOOLS_TOKEN=aitk_… -- node ./aitools-mcp.js`)}
  </div>`;
}
