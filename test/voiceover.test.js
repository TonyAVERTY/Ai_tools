// Voix off des vidéos de promotion : validation, script de Claude, placement, mixage ffmpeg réel, fournisseurs (sans réseau), tâche et routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject } from './helpers/users.js';
import { Worker, latestJobs } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { SceneError } from '../src/services/promovideo.js';
import { VOICE_PROVIDERS, parseVoiceParams, extractVoiceScript, planVoice, edgeGec, edgeSsml, googleChunks, synthesize, audioDuration, mixVoice, voiceCatalog } from '../src/services/voiceover.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const skipFf = !hasFfmpeg && "ffmpeg n'est pas installé";
const doc = (json) => `<html><body><script type="application/json" id="voix">${json}</script></body></html>`;

test('paramètres : sans case rien n\'est lu ; fournisseur et voix doivent exister', () => {
  assert.deepEqual(parseVoiceParams({}), { voice: null });
  assert.deepEqual(parseVoiceParams({ voice: false, voiceProvider: 'edge' }), { voice: null });
  assert.match(parseVoiceParams({ voice: true, voiceProvider: 'x' }).error, /fournisseur/);
  assert.match(parseVoiceParams({ voice: true, voiceProvider: 'edge', voiceName: 'inconnue' }).error, /voix/);
  assert.deepEqual(parseVoiceParams({ voice: true, voiceProvider: 'edge', voiceName: 'fr-FR-DeniseNeural' }).voice, { provider: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' });
  assert.deepEqual(parseVoiceParams({ voice: true, voiceProvider: 'google', voiceName: 'en' }).voice, { provider: 'google', voice: 'en', lang: 'en' });
  for (const p of voiceCatalog()) assert.ok(p.label && p.voices.length, p.id);
});

test('script de Claude : forme, instants, longueurs ; erreurs renvoyées comme des défauts de scène', () => {
  assert.deepEqual(extractVoiceScript(doc('[{"t":4,"texte":"Deux."},{"t":0.5,"texte":"Un."}]'), 10), [{ t: 0.5, text: 'Un.' }, { t: 4, text: 'Deux.' }]);
  const bad = (json, re) => assert.throws(() => extractVoiceScript(json === null ? '<html></html>' : doc(json), 10), (e) => e instanceof SceneError && re.test(e.message));
  bad(null, /Il manque le script de la voix/);
  bad('pas du json', /JSON valide/);
  bad('[]', /vide/);
  bad('[{"t":12,"texte":"Trop tard"}]', /entre 0 et 10/);
  bad('[{"t":"a","texte":"x y"}]', /entre 0 et 10/);
  bad('[{"t":1,"texte":""}]', /non vide/);
  bad(`[{"t":1,"texte":"${'a'.repeat(300)}"}]`, /300 caractères/);
  bad(JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ t: i / 3, texte: 'Phrase.' }))), /Trop de phrases/);
  bad(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ t: i, texte: 'a'.repeat(200) }))), /caractères : 1500 au plus/);
});

test('placement : jamais deux voix en même temps, dépassement mesuré', () => {
  const p = planVoice([{ t: 0, dur: 3 }, { t: 1, dur: 2 }, { t: 8, dur: 1 }], 10);
  assert.deepEqual(p.placed.map((x) => [x.start, x.end]), [[0, 3], [3.2, 5.2], [8, 9]]);
  assert.equal(p.overflow, 0);
  assert.ok(Math.abs(planVoice([{ t: 8, dur: 4 }], 10).overflow - 2) < 1e-9);
});

test('Edge : jeton de sécurité sur 5 minutes, SSML échappé ; Google : texte découpé en morceaux courts', () => {
  const t = Date.UTC(2026, 0, 1, 12, 0, 10);
  assert.match(edgeGec(t), /^[0-9A-F]{64}$/);
  assert.equal(edgeGec(t), edgeGec(t + 200_000 - 10_000), 'même fenêtre de 5 minutes');
  assert.notEqual(edgeGec(t), edgeGec(t + 400_000));
  const x = edgeSsml('Tom & "Jerry" <b>', 'fr-FR-DeniseNeural');
  assert.match(x, /xml:lang='fr-FR'/);
  assert.match(x, /Tom &amp; &quot;Jerry&quot; &lt;b&gt;/);
  const chunks = googleChunks(`${'Un mot '.repeat(60)}fin.`.trim());
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 180), JSON.stringify(chunks.map((c) => c.length)));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), `${'Un mot '.repeat(60)}fin.`.trim());
});

test('Edge : dialogue WebSocket simulé (config, SSML, trames audio, fin de tour)', async () => {
  const sent = [];
  class FakeWS {
    constructor(url, opts) { this.url = url; this.opts = opts; setTimeout(() => this.onopen(), 0); FakeWS.last = this; }
    send(m) {
      sent.push(m);
      if (/Path:ssml/.test(m)) {
        const head = Buffer.from('X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n', 'latin1');
        const frame = Buffer.concat([Buffer.from([head.length >> 8, head.length & 255]), head, Buffer.alloc(500, 7)]);
        setTimeout(() => { this.onmessage({ data: frame }); this.onmessage({ data: 'X-RequestId:1\r\nPath:turn.end\r\n\r\n{}' }); }, 0);
      }
    }
    close() { setTimeout(() => this.onclose?.(), 0); }
  }
  const audio = await synthesize({ provider: 'edge', voice: 'fr-FR-DeniseNeural', text: 'Bonjour à tous' }, { WS: FakeWS });
  assert.equal(audio.length, 500);
  assert.match(FakeWS.last.url, /TrustedClientToken=.*Sec-MS-GEC=[0-9A-F]{64}/);
  assert.match(FakeWS.last.opts.headers.Origin, /^chrome-extension:/);
  assert.match(sent[0], /Path:speech\.config/);
  assert.match(sent[1], /Path:ssml[\s\S]*Bonjour à tous/);
});

test('Edge refusé : erreur lisible, sans texte du projet ; Google : refus HTTP signalé', async () => {
  class Refuse { constructor() { setTimeout(() => this.onerror(), 0); } close() {} }
  await assert.rejects(synthesize({ provider: 'edge', voice: 'fr-FR-DeniseNeural', text: 'secret du projet' }, { WS: Refuse }), (e) => /Connexion refusée/.test(e.message) && !/secret/.test(e.message));
  await assert.rejects(synthesize({ provider: 'google', voice: 'fr', text: 'Bonjour tout le monde' }, { fetchImpl: async () => ({ ok: false, status: 429 }) }), /refusé la requête \(429\)/);
  const ok = await synthesize({ provider: 'google', voice: 'fr', text: 'Bonjour tout le monde' }, { fetchImpl: async (u) => { assert.match(u, /tl=fr&q=Bonjour/); return { ok: true, arrayBuffer: async () => new Uint8Array(400).buffer }; } });
  assert.equal(ok.length, 400);
  await assert.rejects(synthesize({ provider: 'edge', voice: 'nimporte', text: 'x y' }), /Voix inconnue/);
});

test('mixage ffmpeg réel : voix posées aux bons instants, image intacte, durée de la vidéo conservée', { skip: skipFf }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voix-test-'));
  try {
    const cfg = {};
    const video = join(dir, 'v.mp4');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', video]).status, 0);
    const mk = (name, hz) => { const f = join(dir, name); assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=1`, f]).status, 0); return f; };
    const a = mk('a.mp3', 440);
    const b = mk('b.mp3', 880);
    const dur = await audioDuration(cfg, a);
    assert.ok(dur > 0.9 && dur < 1.2, `durée mesurée ${dur}`);
    await mixVoice({ cfg, videoPath: video, placed: [{ file: a, start: 0.2 }, { file: b, start: 2 }], seconds: 4 });
    const probe = (args) => spawnSync('ffprobe', ['-v', 'error', ...args, video]).stdout.toString().trim();
    assert.equal(probe(['-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0']), 'aac');
    assert.equal(probe(['-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0']), 'h264', 'image copiée sans ré-encodage');
    assert.ok(Math.abs(Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0'])) - 4) < 0.25, 'durée de la vidéo');
    assert.ok(!existsSync(`${video}.voix.mp4`), 'pas de fichier temporaire');
    // Une seule voix : même chemin
    const solo = join(dir, 's.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', solo]);
    await mixVoice({ cfg, videoPath: solo, placed: [{ file: a, start: 0 }], seconds: 3 });
    assert.ok(statSync(solo).size > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Tâche et routes ----------
let s;
let worker;
before(async () => {
  s = await startApp();
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: join(s.tmp, 'voix.log') } });
  worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
});
after(async () => { await s.close(); });
const PROFILE = JSON.stringify({ resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', arguments: ['simple'], ton: 'direct' });
async function setup() {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(PROFILE, pid);
  return { u, pid };
}
function fakes({ overflow = 0 } = {}) {
  const log = { rendered: [], mixed: [], synth: [], prepared: 0 };
  s.app.promoSupported = () => ({ ok: true });
  s.app.renderPromo = async (o) => { log.rendered.push(o); writeFileSync(o.out, 'mp4'); return { frames: 10, bytes: 3 }; };
  s.app.synthVoice = async (o) => { log.synth.push(o); return Buffer.alloc(400); };
  s.app.prepareVoice = async (o) => { log.prepared++; const dir = mkdtempSync(join(tmpdir(), 'aitools-voix-')); await o.synth({ provider: o.voice.provider, voice: o.voice.voice, text: o.segments[0].text }); return { dir, placed: o.segments.map((x) => ({ ...x, file: 'x', start: x.t, end: x.t + 1 })), overflow: typeof overflow === 'function' ? overflow(log.prepared) : overflow }; };
  s.app.mixVoice = async (o) => { log.mixed.push(o); };
  return log;
}
const unfake = () => { for (const k of ['promoSupported', 'renderPromo', 'synthVoice', 'prepareVoice', 'mixVoice']) delete s.app[k]; };
const gen = (u, pid, body) => u.post(`/api/projects/${pid}/promo/generate`, body);
const runJob = async (pid) => { await worker.tick(); return (await latestJobs(s.db, pid)).promo_video; };
const VOICE = { voice: true, voiceProvider: 'edge', voiceName: 'en-US-JennyNeural' };

test('route : fournisseur ou voix inconnus refusés ; sans la case, aucun paramètre de voix n\'est gardé', async () => {
  const { u, pid } = await setup();
  s.app.promoSupported = () => ({ ok: true });
  try {
    assert.equal((await gen(u, pid, { voice: true, voiceProvider: 'x', voiceName: 'y' })).status, 400);
    assert.equal((await gen(u, pid, { voice: true, voiceProvider: 'edge', voiceName: 'y' })).status, 400);
    const log = fakes();
    assert.equal((await gen(u, pid, { fps: 10, seconds: 4 })).status, 200);
    const job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    assert.equal(log.prepared, 0);
    assert.equal(log.mixed.length, 0, 'pas de voix demandée : pas de mixage');
  } finally { unfake(); }
});

test('vidéo avec voix : le prompt demande le script dans la langue de la voix, la voix est préparée avant le rendu puis mixée', async () => {
  const { u, pid } = await setup();
  const log = fakes();
  try {
    assert.equal((await gen(u, pid, { fps: 10, seconds: 6, ...VOICE })).status, 200);
    const job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    const result = job.result;
    assert.equal(result.voice, 'en-US-JennyNeural');
    assert.equal(log.prepared, 1);
    assert.equal(log.rendered.length, 1);
    assert.equal(log.mixed.length, 1);
    assert.deepEqual(log.mixed[0].placed.map((p) => p.text), ['Bonjour', 'Au revoir']);
    assert.equal(log.synth[0].provider, 'edge');
  } finally { unfake(); }
});

test('script de voix oublié : renvoyé une fois à Claude, puis accepté', async () => {
  const { u, pid } = await setup();
  const log = fakes();
  try {
    await gen(u, pid, { fps: 10, seconds: 6, subject: 'VOICEBAD', ...VOICE });
    const job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.result.attempts, 2);
    assert.equal(log.mixed.length, 1);
  } finally { unfake(); }
});

test('voix trop longue : corrigée une fois par Claude, puis acceptée avec une remarque', async () => {
  const { u, pid } = await setup();
  const log = fakes({ overflow: 3 });
  try {
    await gen(u, pid, { fps: 10, seconds: 6, ...VOICE });
    const job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    const r = job.result;
    assert.equal(r.attempts, 2);
    assert.match(r.notes.join(' '), /Voix coupée en fin de vidéo/);
    assert.equal(log.rendered.length, 1, 'une seule vidéo rendue (la première version est refusée avant le rendu)');
  } finally { unfake(); }
});

test('service de voix en panne : tâche en erreur lisible, aucune vidéo laissée', async () => {
  const { u, pid } = await setup();
  const log = fakes();
  s.app.prepareVoice = async () => { throw new Error('Microsoft Edge (gratuit) : délai dépassé'); };
  try {
    await gen(u, pid, { fps: 10, seconds: 6, ...VOICE });
    const job = await runJob(pid);
    assert.equal(job.status, 'error');
    assert.match(job.error, /délai dépassé/);
    assert.equal(log.rendered.length, 0, 'le rendu n\'est pas lancé si la voix échoue');
    assert.equal(((await (await u.get(`/api/projects/${pid}/promo`)).json()).videos).length, 0);
  } finally { unfake(); }
});

test('extrait d\'écoute : audio MP3, mis en cache, voix inconnue refusée, connecté obligatoire, panne du service en 502', async () => {
  const u = await s.newUser();
  let n = 0;
  s.app.sampleVoice = async () => { n++; return Buffer.alloc(300, 1); };
  try {
    const url = '/api/promo/voice-sample?provider=edge&voice=fr-FR-HenriNeural';
    const r = await u.get(url);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await r.arrayBuffer()).byteLength, 300);
    await u.get(url);
    assert.equal(n, 1, 'second appel servi depuis le cache');
    assert.equal((await u.get('/api/promo/voice-sample?provider=edge&voice=nimporte')).status, 400);
    assert.equal((await u.get('/api/promo/voice-sample?provider=x&voice=y')).status, 400);
    assert.equal((await s.anon.get(url)).status, 401);
    s.app.sampleVoice = async () => { throw new Error('délai dépassé'); };
    const bad = await u.get('/api/promo/voice-sample?provider=google&voice=fr');
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).error, /Google Traduction \(gratuit\) ne répond pas : délai dépassé/);
  } finally { delete s.app.sampleVoice; }
  assert.ok(VOICE_PROVIDERS.edge && VOICE_PROVIDERS.google);
});

test('l\'état de l\'onglet liste les fournisseurs et leurs voix', async () => {
  const { u, pid } = await setup();
  const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
  assert.deepEqual(st.voices.map((p) => p.id), ['edge', 'google']);
  assert.ok(st.voices[0].voices.some((v) => v.id === 'fr-FR-DeniseNeural'));
});

test('prompt : le contrat de voix apparaît seulement avec une voix, dans sa langue, avec la forme du script', async () => {
  const { promoPrompt } = await import('../src/services/prompts.js');
  const base = { projectName: 'Fidélio', profile: JSON.parse(PROFILE), target: {}, seconds: 30, fps: 30, format: 'vertical', width: 720, height: 1280, custom: {} };
  assert.doesNotMatch(promoPrompt(base).prompt, /VOIX OFF/);
  const p = promoPrompt({ ...base, voice: { provider: 'edge', voice: 'es-ES-ElviraNeural', lang: 'es', langName: 'espagnol' } }).prompt;
  assert.match(p, /VOIX OFF : une voix lira la vidéo en espagnol/);
  assert.match(p, /<script type="application\/json" id="voix">\[\{"t":0\.4/);
  assert.match(p, /72 mots au plus pour 30 s/);
});
