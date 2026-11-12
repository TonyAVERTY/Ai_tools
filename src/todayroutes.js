// Page « Aujourd'hui » (accueil de l'application) et marquage « traité » d'une ligne de la liste.
import { html, json, readBody, HttpError } from './http.js';
import { getUser } from './users.js';
import { listProjects, getProject } from './projects.js';
import { projectChecklist } from './checklist.js';
import { userAccountingSettings } from './accountingroutes.js';
import { todayData, setDone } from './today.js';
import { todayPage } from './todayviews.js';
import { needsTour, tourJson } from './tour.js';

export function registerTodayRoutes(router, app) {
  const { db } = app;

  router.get('/', async ({ res, session, url }) => {
    const userId = session.userId;
    const user = await getUser(db, userId);
    const projects = await listProjects(app, userId);
    const onboarding = new Map();
    for (const p of projects) {
      const full = await getProject(app, p.id, { userId, secrets: true });
      onboarding.set(Number(p.id), await projectChecklist(app, full));
    }
    const settings = await userAccountingSettings(db, userId);
    const accRows = settings.complete ? await db.prepare('SELECT * FROM accounting_entries WHERE user_id = ? AND pending = 0').all(Number(userId)) : [];
    const declared = new Set((await db.prepare('SELECT period FROM accounting_declarations WHERE user_id = ?').all(Number(userId))).map((r) => r.period));
    const data = await todayData(db, user, { projects, onboarding, settings, accRows, declared });
    // Visite guidée : relancée à la demande (?tour=1), ou toute seule une fois après les questions de bienvenue
    const tour = url.searchParams.get('tour') === '1' ? 'replay' : (await needsTour(db, userId)) ? 'auto' : null;
    html(res, todayPage({ email: session.email, data, tour, tourJson: tour ? tourJson() : '' }));
  });

  // Une ligne « traitée » (ou son annulation) : la clé ne désigne qu'une ligne que la personne voit déjà
  router.post('/api/today/done', async ({ req, res, session }) => {
    const b = await readBody(req);
    if (!(await setDone(db, session.userId, String(b.key ?? ''), b.done !== false))) throw new HttpError(400, 'Ligne inconnue : recharge la page');
    json(res, { ok: true });
  });
}
