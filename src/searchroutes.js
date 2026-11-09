// Recherche globale (⌘K) : projets, prospects et clients, réponses de mails. Limitée aux projets de la personne (les siens et ceux de son équipe).
import { json } from './http.js';
import { accessibleProjects } from './mailroutes.js';

const MAX_PER_GROUP = 6;
const like = (q) => `%${q.replace(/[!%_]/g, (c) => `!${c}`)}%`; // « ! » protège % et _ (pas d'antislash : MySQL le traite à part)

export function registerSearchRoutes(router, app) {
  const { db } = app;

  router.get('/api/search', async ({ res, session, url }) => {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return json(res, { q, groups: [] });
    const projects = await accessibleProjects(db, session.userId);
    const ids = projects.map((p) => Number(p.id));
    const names = new Map(projects.map((p) => [Number(p.id), p.name]));
    const needle = like(q.toLowerCase());
    const groups = [];

    const hits = projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, MAX_PER_GROUP)
      .map((p) => ({ title: p.name, sub: 'Projet', href: `/p/${p.id}` }));
    if (hits.length) groups.push({ id: 'projects', label: 'Projets', items: hits });

    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      const prospects = await db.prepare(`SELECT id, project_id, company, email, status FROM prospects WHERE project_id IN (${marks}) AND (LOWER(company) LIKE ? ESCAPE '!' OR LOWER(email) LIKE ? ESCAPE '!') ORDER BY created_at DESC LIMIT ${MAX_PER_GROUP}`).all(...ids, needle, needle);
      if (prospects.length) {
        groups.push({ id: 'prospects', label: 'Prospects et clients', items: prospects.map((r) => ({
          title: r.company, sub: `${r.status === 'client' ? 'Client' : 'Prospect'} · ${r.email} · ${names.get(Number(r.project_id)) || ''}`, href: `/p/${r.project_id}/prospection`,
        })) });
      }
      const replies = await db.prepare(`SELECT id, project_id, from_email, subject FROM replies WHERE project_id IN (${marks}) AND (LOWER(from_email) LIKE ? ESCAPE '!' OR LOWER(subject) LIKE ? ESCAPE '!') ORDER BY received_at DESC LIMIT ${MAX_PER_GROUP}`).all(...ids, needle, needle);
      if (replies.length) {
        groups.push({ id: 'replies', label: 'Mails reçus', items: replies.map((r) => ({
          title: r.subject || '(sans objet)', sub: `${r.from_email} · ${names.get(Number(r.project_id)) || ''}`, href: '/mails',
        })) });
      }
    }
    json(res, { q, groups });
  }, { limit: 'search' });
}
