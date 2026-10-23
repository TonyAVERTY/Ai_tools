// Événements de l'agenda : détection des dates dans les réponses, propositions, ajout, liens Google / .ics, flux iCal, isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { findMoment, suggestEvent } from '../src/services/dates.js';
import { parseParisLocal, toParisLocal, eventLinks } from '../src/events.js';
import { createFeed } from '../src/services/ical.js';

// Vendredi 23 octobre 2026, 12 h à Paris
const RX = Math.floor(new Date('2026-10-23T10:00:00Z').getTime() / 1000);
const paris = (ts) => toParisLocal(ts);

test('dates dans un texte : jour, date, heure, moment de la journée, relatifs, mois', () => {
  const at = (t) => { const r = findMoment(t, RX); return r && paris(r.at); };
  assert.equal(at('Oui, mardi à 14h30 ça me va'), '2026-10-27T14:30');
  assert.equal(at('Disponible le 5 novembre à 9h'), '2026-11-05T09:00');
  assert.equal(at('le 12/11 à 15:00'), '2026-11-12T15:00');
  assert.equal(at('Le 1er décembre à 10h'), '2026-12-01T10:00');
  assert.equal(at('jeudi prochain 10h'), '2026-10-29T10:00');
  assert.equal(at('Appelez-moi demain matin'), '2026-10-24T10:00');
  assert.equal(at('après-demain à 16h'), '2026-10-25T16:00');
  assert.equal(at('dans 2 semaines'), '2026-11-06T10:00');
  assert.equal(at('vendredi à midi'), '2026-10-30T12:00', 'le jour même de la réponse : la semaine suivante');
  assert.equal(at('le 3 octobre'), '2027-10-03T10:00', 'une date passée sans année : l\'an prochain');
  assert.equal(at('le 15 janvier 2027 à 8h45'), '2027-01-15T08:45');
  assert.equal(at('rien de daté ici'), null);
  assert.equal(at('le 31/02'), null, 'date impossible');
  assert.equal(at('le 40 novembre'), null);
  const heure = findMoment('mardi à 14h30', RX);
  assert.equal(heure.guessed, false);
  assert.equal(findMoment('mardi', RX).guessed, true, 'heure absente : devinée, signalée');
  const vague = findMoment('Recontactez-moi en janvier', RX);
  assert.equal(vague.vague, true);
  assert.match(paris(vague.at), /^2027-01-/);
  assert.equal(findMoment('on se voit la semaine prochaine', RX).vague, true);
  assert.equal(paris(findMoment('lundi 2 novembre à 11h ou mardi', RX).at), '2026-11-02T11:00', 'une date précise gagne sur le reste');
  // l'heure d'été / d'hiver : 25 octobre 2026 = retour à l'heure d'hiver (la veille CEST, le lendemain CET)
  assert.equal(paris(findMoment('lundi 26 octobre à 9h', RX).at), '2026-10-26T09:00');
});

test('proposition : appel, visio, rendez-vous, rappel ; jamais pour un refus ; « date à choisir » sans date écrite', () => {
  const s = (o) => suggestEvent({ company: 'Dupont', from: 'c@dupont.fr', receivedAt: RX, ...o });
  let r = s({ text: 'Oui, appelez-moi mardi à 14h', intent: 'interested' });
  assert.deepEqual([r.title, paris(r.at), r.minutes, r.kind, r.dateToChoose], ['Appel avec Dupont', '2026-10-27T14:00', 30, 'call', false]);
  r = s({ text: 'Je préfère une visio jeudi à 11h', intent: 'interested' });
  assert.deepEqual([r.title, r.minutes, r.kind], ['Visio avec Dupont', 45, 'visio']);
  r = s({ text: 'Passez nous voir pour une démo le 5 novembre à 10h', intent: 'interested' });
  assert.deepEqual([r.title, r.minutes, r.kind], ['Rendez-vous avec Dupont', 60, 'meeting']);
  r = s({ text: 'Revenez vers moi le 15 janvier', intent: 'later' });
  assert.deepEqual([r.title, r.kind, r.minutes], ['Relancer Dupont', 'reminder', 15]);
  r = s({ text: 'Avec plaisir pour un appel !', intent: 'interested' });
  assert.equal(r.dateToChoose, true, 'partant mais sans date');
  assert.equal(paris(r.at), '2026-10-26T10:00', 'prochain jour ouvré à 10 h');
  assert.equal(s({ text: 'Non merci, jamais, ne plus me contacter le 5 novembre', intent: 'refused' }), null);
  assert.equal(s({ text: 'Merci pour votre message.', intent: 'other' }), null, 'rien à agender');
  assert.equal(s({ text: 'Intéressant, envoyez-moi un devis', intent: 'interested' }), null, 'ni date ni appel : pas de proposition');
  assert.match(s({ text: 'mardi', intent: 'question', company: '', from: 'x@atelier.fr' }).title, /atelier\.fr/, 'sans nom d\'entreprise : le domaine');
});

test('heure de Paris : conversion dans les deux sens, valeurs impossibles refusées', () => {
  const ts = parseParisLocal('2026-11-03T14:00');
  assert.equal(toParisLocal(ts), '2026-11-03T14:00');
  assert.equal(parseParisLocal('2026-07-01T09:00'), Math.floor(new Date('2026-07-01T07:00:00Z').getTime() / 1000), 'été : UTC+2');
  assert.equal(parseParisLocal('2026-12-01T09:00'), Math.floor(new Date('2026-12-01T08:00:00Z').getTime() / 1000), 'hiver : UTC+1');
  for (const bad of ['', 'demain', '2026-02-31T10:00', '2026-11-03', '2026-13-01T10:00', null]) assert.equal(parseParisLocal(bad), null, String(bad));
  const g = new URL(eventLinks({ id: 7, title: 'Appel & suite', notes: 'n', starts_at: ts, minutes: 30 }).google);
  assert.equal(g.origin + g.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(g.searchParams.get('text'), 'Appel & suite');
  assert.equal(g.searchParams.get('dates'), '20261103T130000Z/20261103T133000Z');
  assert.equal(eventLinks({ id: 7, title: 't', starts_at: ts, minutes: 30 }).ics, '/calendar/event/7.ics');
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } });

async function world(user, body = 'Oui, appelez-moi mardi à 14h30 ça me va', intent = 'interested') {
  const pid = await addProject(s.db, user.id, { name: 'Atelier', gitUrl: `https://github.com/u${user.id}/ev.git` });
  const x = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Boulangerie Dupont', 'c@dupont.fr', 'replied', ?, ?)").run(pid, RX - 3600, now())).lastInsertRowid);
  const rep = Number((await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, 1, 'c@dupont.fr', 'Re: offre', ?, ?, ?)").run(pid, x, body, intent, RX)).lastInsertRowid);
  return { pid, x, rep };
}

test('réponse avec une date : l\'API et la page Mails proposent l\'ajout, préremplie et corrigeable', async () => {
  const u = await s.newUser();
  const w = await world(u);
  const list = await (await u.get('/api/replies')).json();
  const sg = list.replies[0].suggestion;
  assert.deepEqual([sg.title, sg.whenLocal, sg.minutes, sg.kind, sg.guessed, sg.dateToChoose], ['Appel avec Boulangerie Dupont', '2026-10-27T14:30', 30, 'call', false, false]);
  assert.equal(list.replies[0].event, null);
  const page = await (await html(u, '/mails?v=replies')).text();
  assert.match(page, /data-ev-add="\d+"/);
  assert.match(page, /value="2026-10-27T14:30"/);
  assert.match(page, /value="Appel avec Boulangerie Dupont"/);
  assert.match(page, /Il évoque « mardi »/);
  // une réponse sans rien à agender : aucune proposition
  const other = await s.newUser();
  await world(other, 'Merci, bien reçu.', 'other');
  assert.equal((await (await other.get('/api/replies')).json()).replies[0].suggestion, null);
  void w;
});

test('ajouter depuis la réponse : événement créé une seule fois, liens Google et .ics, dans l\'agenda et le flux iCal', async () => {
  const u = await s.newUser();
  const { rep, pid, x } = await world(u);
  const r = await u.post(`/api/replies/${rep}/event`, { title: 'Appel avec Dupont (corrigé)', when: '2026-10-27T15:00', minutes: 45 });
  assert.equal(r.status, 201);
  const out = await r.json();
  assert.equal(out.event.title, 'Appel avec Dupont (corrigé)');
  assert.equal(out.event.startsAt, parseParisLocal('2026-10-27T15:00'));
  assert.equal(out.event.minutes, 45);
  assert.deepEqual([out.event.projectId, out.event.prospectId, out.event.replyId], [pid, x, rep]);
  assert.match(out.event.links.google, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  // deuxième ajout : le même événement, pas un doublon
  const again = await (await u.post(`/api/replies/${rep}/event`, { title: 'Autre', when: '2026-10-28T10:00' })).json();
  assert.equal(again.existing, true);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM calendar_events WHERE reply_id = ?').get(rep)).n), 1);
  // la réponse montre l'événement ajouté, plus la proposition
  const item = (await (await u.get('/api/replies')).json()).replies[0];
  assert.equal(item.suggestion, null);
  assert.equal(item.event.id, out.event.id);
  assert.match(await (await html(u, '/mails?v=replies')).text(), /Ajouté à ton calendrier/);
  // fichier .ics de l'événement
  const ics = await u.get(out.event.links.ics, { headers: { accept: '*/*' } });
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /^text\/calendar/);
  assert.match(ics.headers.get('content-disposition'), /attachment/);
  const txt = (await ics.text()).replace(/\r\n /g, '');
  assert.match(txt, /SUMMARY:Appel avec Dupont \(corrigé\)/);
  assert.match(txt, /DTSTART:20261027T140000Z/, '15 h à Paris = 14 h UTC (heure d\'été)'.replace('14 h UTC (heure d\'été)', '14 h UTC'));
  assert.match(txt, /DTEND:20261027T144500Z/);
  // le flux iCal secret contient l'événement
  const token = await createFeed(s.app, u.id);
  const feed = (await (await fetch(`${s.base}/cal/${token}.ics`)).text()).replace(/\r\n /g, '');
  assert.match(feed, /SUMMARY:Appel avec Dupont \(corrigé\)/);
});

test('validation et isolation : titre vide, date impossible ou lointaine refusés ; ni réponse ni événement d\'un autre compte', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const { rep } = await world(u);
  const post = (body, who = u) => who.post(`/api/replies/${rep}/event`, body);
  assert.equal((await post({ title: '', when: '2026-10-27T15:00' })).status, 400);
  assert.equal((await post({ title: 'x', when: 'demain' })).status, 400);
  assert.equal((await post({ title: 'x', when: '2026-02-31T10:00' })).status, 400);
  assert.equal((await post({ title: 'x', when: '2099-01-01T10:00' })).status, 400, 'au plus trois ans');
  assert.equal((await post({ title: 'x', when: '2020-01-01T10:00' })).status, 400, 'pas dans le passé lointain');
  assert.equal((await post({ title: 'x', when: '2026-10-27T15:00' }, v)).status, 404, 'réponse d\'un autre compte');
  assert.equal((await s.anon.post(`/api/replies/${rep}/event`, {})).status, 401);
  const ok = await (await post({ title: 'Mon événement', when: '2026-10-27T15:00', minutes: 7 })).json();
  assert.equal(ok.event.minutes, 30, 'durée inconnue : 30 min');
  assert.equal((await v.get(`/calendar/event/${ok.event.id}.ics`, { headers: { accept: '*/*' } })).status, 404, '.ics d\'un autre compte');
  await v.post(`/calendar/events/${ok.event.id}/delete`, {}, { form: true });
  assert.ok(await s.db.prepare('SELECT 1 FROM calendar_events WHERE id = ?').get(ok.event.id), 'un autre compte ne supprime rien');
});

test('page Calendrier : ajouter un événement à la main, le voir dans le mois et dans « À venir », le supprimer ; échappement', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const form = (body, who = u) => who.post('/calendar/events', body, { form: true });
  const r = await form({ title: '<b>Zorglub</b> client', date: '2026-11-04', time: '09:30', minutes: '60', notes: 'Penser à l\'offre' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/calendar?m=2026-11');
  const e = await s.db.prepare('SELECT * FROM calendar_events WHERE user_id = ?').get(u.id);
  assert.deepEqual([e.title, Number(e.starts_at), Number(e.minutes), e.notes], ['<b>Zorglub</b> client', parseParisLocal('2026-11-04T09:30'), 60, 'Penser à l\'offre']);
  const page = await (await html(u, '/calendar?m=2026-11')).text();
  assert.match(page, /09:30<\/span> &lt;b&gt;Zorglub&lt;\/b&gt; client/);
  assert.doesNotMatch(page, /<b>Zorglub<\/b>/);
  assert.match(page, /class="cal-ev event"/);
  assert.match(page, /calendar\.google\.com/);
  assert.match(page, /Ajouter à mon calendrier/);
  assert.doesNotMatch(await (await html(v, '/calendar?m=2026-11')).text(), /Zorglub/, 'isolation');
  // erreurs : retour sur la page avec le message
  const bad = await form({ title: '', date: '2026-11-04', time: '09:30' });
  assert.match(decodeURIComponent(bad.headers.get('location')), /^\/calendar\?e=Donne un titre/);
  assert.equal((await form({ title: 'x', date: '2026-02-31', time: '09:30' })).status, 303);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM calendar_events WHERE user_id = ?').get(u.id)).n), 1);
  await u.post(`/calendar/events/${e.id}/delete`, {}, { form: true });
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM calendar_events WHERE user_id = ?').get(u.id)).n), 0);
});
