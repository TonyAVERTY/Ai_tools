// Écrans d'exploitation : chiffres réels par projet, indicateurs de la page Mails et ses états vides, panneau « À venir » du Calendrier.
// Rien n'est inventé : chaque valeur affichée vient de la base, et un autre compte ne voit jamais celles d'un voisin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { projectStats } from '../src/projects.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());
const DAY = 86400;

async function seedProspects(projectId) {
  const rows = [['A', 'new'], ['B', 'new'], ['C', 'sent'], ['D', 'replied'], ['E', 'client'], ['F', 'refused']];
  let i = 0;
  for (const [name, status] of rows) {
    await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(projectId, `Société ${name}`, `${name.toLowerCase()}@exemple.fr`, status, status === 'new' ? null : now() - (++i) * DAY, now());
  }
}

test('projectStats : prospects, à contacter, réponses et dernier envoi, projet par projet', async () => {
  const u = await s.newUser();
  const p1 = await addProject(s.db, u.id, { name: 'Un', gitUrl: 'https://github.com/u/un.git' });
  const p2 = await addProject(s.db, u.id, { name: 'Vide', gitUrl: 'https://github.com/u/vide.git' });
  await seedProspects(p1);
  const st = await projectStats(s.db, [p1, p2]);
  assert.deepEqual({ ...st.get(Number(p1)), lastSentAt: typeof st.get(Number(p1)).lastSentAt }, { prospects: 6, toContact: 2, replies: 2, lastSentAt: 'number' });
  assert.deepEqual(st.get(Number(p2)), { prospects: 0, toContact: 0, replies: 0, lastSentAt: null }, 'un projet vide renvoie des zéros, pas de valeur inventée');
  assert.equal((await projectStats(s.db, [])).size, 0);
});

test('page Projets : les chiffres réels sont sur la ligne du projet ; un projet vide le dit ; un autre compte ne les voit pas', async () => {
  const u = await s.newUser();
  const other = await s.newUser();
  const p1 = await addProject(s.db, u.id, { name: 'Avec prospects', gitUrl: 'https://github.com/u/a.git' });
  await addProject(s.db, u.id, { name: 'Sans prospect', gitUrl: 'https://github.com/u/b.git' });
  await seedProspects(p1);
  const page = await html(u, '/');
  assert.match(page, /<span class="pfacts"><span><b>6<\/b> prospects<\/span><span><b>2<\/b> à contacter<\/span><span class="ok"><b>2<\/b> réponses<\/span><span>dernier envoi le /);
  assert.match(page, /<span class="pfacts"><span class="muted">aucun prospect<\/span><\/span>/);
  assert.doesNotMatch(await html(other, '/'), /Avec prospects|à contacter/, 'isolation');
});

test('page Mails : la barre de chiffres filtre la liste, la cause d\'un échec est visible, les états vides guident', async () => {
  const u = await s.newUser();
  const empty = await html(u, '/mails');
  assert.match(empty, /<nav class="mstats" aria-label="Filtrer par état">/);
  assert.match(empty, /Aucun mail envoyé pour l'instant\.<\/b>[^<]*<\/p><a class="btn small" href="\/">Ouvrir mes projets<\/a>/);
  assert.match(await html(u, '/mails?v=replies'), /Aucune réponse pour l'instant\.<\/b>[^]*?Régler la boîte de réception/);
  assert.match(empty, /Comment sont comptés « Lu » et « Répondu » \?/, "l'aide est repliée dans une aide contextuelle");

  const pid = await addProject(s.db, u.id, { name: 'Courrier', gitUrl: 'https://github.com/u/c.git' });
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'Boulangerie Exemple', 'ok@exemple.fr', 'sent', ?)").run(pid, now());
  const prospect = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(pid);
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, subject) VALUES(?, ?, 'ok@exemple.fr', ?, NULL, 'initial', 'Bonjour')").run(pid, prospect.id, now() - 60);
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, subject) VALUES(?, NULL, 'ko@exemple.fr', ?, 'SMTP : connexion refusée', 'initial', 'Bonjour')").run(pid, now() - 30);
  const page = await html(u, '/mails');
  assert.match(page, /<a class="mstat on" href="\/mails"[^>]*><b>2<\/b><span>Tous<\/span>/);
  assert.match(page, /<a class="mstat bad" href="\/mails\?filter=failed"><b>1<\/b><span>Non envoyé<\/span>/);
  assert.match(page, /<b>Boulangerie Exemple<\/b><span class="td-s">ok@exemple\.fr<\/span>/);
  assert.match(page, /Non envoyé<\/span><span class="td-s">SMTP : connexion refusée<\/span>/);
  const filtered = await html(u, '/mails?filter=failed');
  assert.match(filtered, /ko@exemple\.fr/);
  assert.doesNotMatch(filtered, /ok@exemple\.fr/);
  assert.match(await html(u, '/mails?filter=refused'), /Aucun mail dans cet état\.<\/p><a class="btn small" href="\/mails">Voir tous<\/a>/);
  assert.doesNotMatch(await html(await s.newUser(), '/mails'), /ko@exemple\.fr|Boulangerie Exemple/, 'isolation');
});

test('Calendrier : « À venir » liste ce qui est réellement prévu, aujourd\'hui est repéré, rien n\'est inventé', async () => {
  const u = await s.newUser();
  const vide = await html(u, '/calendar');
  assert.match(vide, /<h2 id="h-agenda">À venir<\/h2>/);
  assert.match(vide, /Rien de prévu pour l'instant\./);
  assert.match(vide, /class="cal-cell today" aria-current="date"/);
  const at = now() + 2 * DAY;
  await s.db.prepare("INSERT INTO calendar_events(user_id, title, starts_at, minutes, notes, created_at) VALUES(?, 'Appel <b>Exemple</b>', ?, 30, 'Démo', ?)").run(u.id, at, now());
  const page = await html(u, '/calendar');
  assert.match(page, /<ul class="agenda">[^]*?<b>Appel &lt;b&gt;Exemple&lt;\/b&gt;<\/b>/, 'échappé');
  assert.match(page, /Google Agenda<\/a><a href="[^"]*\.ics|Fichier \.ics/);
  assert.match(page, /action="\/calendar\/events\/\d+\/delete"/);
  assert.doesNotMatch(page, /Rien de prévu pour l'instant\./);
  assert.doesNotMatch(await html(await s.newUser(), '/calendar'), /Appel &lt;b&gt;Exemple/, 'isolation');
});

test('Assistant et Réglages : le « $ » relatif des modèles seulement avec une clé API ; Mon compte sans doublon', async () => {
  const sub = await s.newUser();
  const api = await s.newUser({ link: { v: 1, mode: 'api_key', valid: true } });
  const chatSub = await html(sub, '/chat');
  assert.match(chatSub, /Sonnet[^<]*· intermédiaire<\/option>/);
  assert.doesNotMatch(chatSub, /\$\$/, 'abonnement : aucun symbole de prix');
  assert.match(await html(api, '/chat'), /· intermédiaire \$\$<\/option>/);
  assert.match(await html(api, '/support'), /· économe \$<\/option>/);

  const account = await html(sub, '/account');
  assert.match(account, /<div data-claude-card hidden><ul class="usage-list usage-claude" data-usage-claude/, 'la liste Claude est masquée tant qu\'elle est vide');
  assert.equal((account.match(/Affiche tes prochaines actions et tes posts LinkedIn/g) || []).length, 1, "le texte d'introduction de l'agenda n'est pas répété");
});
