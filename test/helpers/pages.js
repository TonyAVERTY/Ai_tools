// Pages d'un projet : depuis la refonte (docs/REFONTE-UI.md), les sections de l'ancien accordéon sont réparties sur des onglets (/p/:id/prospection, /envoi…).
// `projectsHtml` rassemble la liste (/projets) et tous les onglets de chaque projet visible : les tests de contenu (formulaires, libellés, droits) y cherchent comme avant.
const HTML = { headers: { accept: 'text/html' } };
const SLUGS = ['', 'prospection', 'envoi', 'communication', 'outils', 'recap', 'reglages'];

export async function projectsHtml(u) {
  const list = await (await u.get('/projets', HTML)).text();
  const ids = [...new Set([...list.matchAll(/href="\/p\/(\d+)"/g)].map((m) => m[1]))];
  let out = list;
  for (const id of ids) out += await projectHtml(u, id);
  return out;
}

/** Tous les onglets d'un projet (ceux qui répondent 404 à cette personne sont sautés : un membre n'a ni Récapitulatif ni Réglages). */
export async function projectHtml(u, id) {
  let out = '';
  for (const slug of SLUGS) {
    const r = await u.get(`/p/${id}${slug ? `/${slug}` : ''}`, HTML);
    if (r.status === 200) out += await r.text();
  }
  return out;
}
