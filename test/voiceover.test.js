// Voix off des vidéos de promotion : validation, script de Claude, placement, mixage ffmpeg réel, fournisseurs (sans réseau), tâche et routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject } from './helpers/users.js';
import { Worker, latestJobs } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { SceneError } from '../src/services/promovideo.js';
import { VOICE_PROVIDERS, ELEVEN_SHORTLIST, pickElevenVoices, elevenVoiceLang, listVoices, piperVoices, localStatus, localConfig, resetLocalStatus, audioType, parseVoiceParams, extractVoiceScript, planVoice, googleChunks, synthesize, audioDuration, mixVoice, voiceCatalog } from '../src/services/voiceover.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const skipFf = !hasFfmpeg && "ffmpeg n'est pas installé";
const doc = (json) => `<html><body><script type="application/json" id="voix">${json}</script></body></html>`;

test('paramètres : sans case rien n\'est lu ; fournisseur et voix doivent exister', () => {
  assert.deepEqual(parseVoiceParams({}), { voice: null });
  assert.deepEqual(parseVoiceParams({ voice: false, voiceProvider: 'google' }), { voice: null });
  assert.match(parseVoiceParams({ voice: true, voiceProvider: 'x' }).error, /fournisseur/);
  assert.match(parseVoiceParams({ voice: true, voiceProvider: 'google', voiceName: 'klingon' }).error, /voix/);
    assert.deepEqual(parseVoiceParams({ voice: true, voiceProvider: 'google', voiceName: 'en' }).voice, { provider: 'google', voice: 'en', lang: 'en' });
  assert.deepEqual(voiceCatalog().map((p) => p.id), ['google', 'piper', 'espeak', 'elevenlabs', 'googlecloud', 'azure']);
  for (const p of voiceCatalog()) assert.ok(p.label && (p.keyed ? !p.voices : p.voices), p.id);
  assert.deepEqual(voiceCatalog().filter((p) => !p.keyed).map((p) => p.id), ['google', 'piper', 'espeak'], 'trois fournisseurs sans clé');
  // Fournisseurs à clé : identifiant de voix de forme sûre ; langue choisie (ElevenLabs) ou déduite de la voix (Google Cloud)
  assert.deepEqual(parseVoiceParams({ voice: true, voiceProvider: 'elevenlabs', voiceName: 'EXAVITQu4vr4xnSDxMaL', voiceLang: 'es' }).voice, { provider: 'elevenlabs', voice: 'EXAVITQu4vr4xnSDxMaL', lang: 'es' });
  assert.equal(parseVoiceParams({ voice: true, voiceProvider: 'elevenlabs', voiceName: 'abc', voiceLang: 'xx' }).voice.lang, 'fr');
  assert.equal(parseVoiceParams({ voice: true, voiceProvider: 'googlecloud', voiceName: 'de-DE-Chirp3-HD-Aoede' }).voice.lang, 'de');
  assert.match(parseVoiceParams({ voice: true, voiceProvider: 'elevenlabs', voiceName: '../../etc' }).error, /voix/);
  assert.equal(voiceCatalog({ elevenlabs: '1234' }).find((p) => p.id === 'elevenlabs').keyLast4, '1234');
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


const status = (code) => async () => ({ ok: code < 400, status: code });

test('Google Traduction : texte découpé en morceaux courts, refus HTTP signalé, voix inconnue refusée', async () => {
  const chunks = googleChunks(`${'Un mot '.repeat(60)}fin.`.trim());
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 180), JSON.stringify(chunks.map((c) => c.length)));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), `${'Un mot '.repeat(60)}fin.`.trim());
  await assert.rejects(synthesize({ provider: 'google', voice: 'fr', text: 'Bonjour tout le monde' }, { fetchImpl: status(429) }), /refusé la requête \(429\)/);
  const ok = await synthesize({ provider: 'google', voice: 'fr', text: 'Bonjour tout le monde' }, { fetchImpl: async (u) => { assert.match(u, /tl=fr&q=Bonjour/); return { ok: true, arrayBuffer: async () => new Uint8Array(400).buffer }; } });
  assert.equal(ok.length, 400);
  await assert.rejects(synthesize({ provider: 'google', voice: 'nimporte', text: 'x y' }), /Voix inconnue/);
  await assert.rejects(synthesize({ provider: 'edge', voice: 'fr-FR-DeniseNeural', text: 'x y' }), /Voix inconnue/, 'le service d\'Edge n\'est plus proposé');
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
  s.app.reviewPromo = async () => ({ reviews: [{ reviewer: 'layout', approved: true }, { reviewer: 'motion', approved: true }] });
  return log;
}
const unfake = () => { for (const k of ['promoSupported', 'renderPromo', 'synthVoice', 'prepareVoice', 'mixVoice', 'reviewPromo']) delete s.app[k]; };
const gen = (u, pid, body) => u.post(`/api/projects/${pid}/promo/generate`, body);
const runJob = async (pid) => { await worker.tick(); return (await latestJobs(s.db, pid)).promo_video; };
const VOICE = { voice: true, voiceProvider: 'google', voiceName: 'en' };

test('route : fournisseur ou voix inconnus refusés ; sans la case, aucun paramètre de voix n\'est gardé', async () => {
  const { u, pid } = await setup();
  s.app.promoSupported = () => ({ ok: true });
  try {
    assert.equal((await gen(u, pid, { voice: true, voiceProvider: 'x', voiceName: 'y' })).status, 400);
    assert.equal((await gen(u, pid, { voice: true, voiceProvider: 'google', voiceName: 'y' })).status, 400);
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
    assert.equal(result.voice, 'en');
    assert.equal(log.prepared, 1);
    assert.equal(log.rendered.length, 1);
    assert.equal(log.mixed.length, 1);
    assert.deepEqual(log.mixed[0].placed.map((p) => p.text), ['Bonjour', 'Au revoir']);
    assert.equal(log.synth[0].provider, 'google');
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

test('voix toujours trop longue : trois tentatives, aucune troncature ni vidéo livrée', async () => {
  const { u, pid } = await setup();
  const log = fakes({ overflow: 3 });
  try {
    await gen(u, pid, { fps: 10, seconds: 6, ...VOICE });
    const job = await runJob(pid);
    assert.equal(job.status, 'error');
    assert.match(job.error, /La voix dure 3.0 s de plus/);
    assert.equal(log.prepared, 3);
    assert.equal(log.rendered.length, 0, 'chaque version est refusée avant le rendu');
    assert.equal(log.mixed.length, 0);
    assert.deepEqual((await (await u.get(`/api/projects/${pid}/promo`)).json()).videos, []);
  } finally { unfake(); }
});

test('service de voix en panne : tâche en erreur lisible, aucune vidéo laissée', async () => {
  const { u, pid } = await setup();
  const log = fakes();
  s.app.prepareVoice = async () => { throw new Error('Google Traduction (gratuit) : délai dépassé'); };
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
    const url = '/api/promo/voice-sample?provider=google&voice=fr';
    const r = await u.get(url);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await r.arrayBuffer()).byteLength, 300);
    await u.get(url);
    assert.equal(n, 1, 'second appel servi depuis le cache');
    assert.equal((await u.get('/api/promo/voice-sample?provider=google&voice=nimporte')).status, 400);
    assert.equal((await u.get('/api/promo/voice-sample?provider=x&voice=y')).status, 400);
    assert.equal((await s.anon.get(url)).status, 401);
    s.app.sampleVoice = async () => { throw new Error('délai dépassé'); };
    const bad = await u.get('/api/promo/voice-sample?provider=google&voice=de');
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).error, /Google Traduction \(gratuit\) ne répond pas : délai dépassé/);
  } finally { delete s.app.sampleVoice; }
  assert.ok(VOICE_PROVIDERS.google && VOICE_PROVIDERS.azure && !VOICE_PROVIDERS.edge);
});

test('l\'état de l\'onglet liste les fournisseurs et leurs voix', async () => {
  const { u, pid } = await setup();
  const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
  assert.deepEqual(st.voices.map((p) => p.id), ['google', 'piper', 'espeak', 'elevenlabs', 'googlecloud', 'azure']);
  assert.ok(st.voices[0].voices.some((v) => v.id === 'fr'));
});

test('prompt : le contrat de voix apparaît seulement avec une voix, dans sa langue, avec la forme du script', async () => {
  const { promoPrompt } = await import('../src/services/prompts.js');
  const base = { projectName: 'Fidélio', profile: JSON.parse(PROFILE), target: {}, seconds: 30, fps: 30, format: 'vertical', width: 720, height: 1280, custom: {} };
  assert.doesNotMatch(promoPrompt(base).prompt, /VOIX OFF/);
  const p = promoPrompt({ ...base, voice: { provider: 'google', voice: 'es', lang: 'es', langName: 'espagnol' } }).prompt;
  assert.match(p, /VOIX OFF : une voix lira la vidéo en espagnol/);
  assert.match(p, /<script type="application\/json" id="voix">\[\{"t":0\.4/);
  assert.match(p, /60 mots au plus pour 30 s/);
});

// ---------- Fournisseurs à clé (ElevenLabs, Google Cloud) ----------
const KEY = 'sk_test_1234567890abcdefghij';
const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, arrayBuffer: async () => new Uint8Array(500).buffer });

test('ElevenLabs : clé dans l\'en-tête (jamais dans l\'adresse), modèle multilingue, erreurs sans la clé', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return jsonRes({}); };
  const audio = await synthesize({ provider: 'elevenlabs', voice: 'EXAVITQu4vr4xnSDxMaL', text: 'Bonjour à tous', key: KEY }, { fetchImpl });
  assert.equal(audio.length, 500);
  assert.match(seen[0].url, /api\.elevenlabs\.io\/v1\/text-to-speech\/EXAVITQu4vr4xnSDxMaL/);
  assert.ok(!seen[0].url.includes(KEY));
  assert.equal(seen[0].init.headers['xi-api-key'], KEY);
  assert.equal(JSON.parse(seen[0].init.body).model_id, 'eleven_multilingual_v2');
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z', key: KEY }, { fetchImpl: async () => jsonRes({}, 401) }), (e) => /ElevenLabs a refusé la clé API/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z', key: KEY }, { fetchImpl: async () => jsonRes({}, 429) }), /quota ou débit/);
  // 402 : voix de la bibliothèque avec le plan gratuit ; autre refus : le message du fournisseur est repris, sans la clé
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z', key: KEY }, { fetchImpl: async () => jsonRes({ detail: { status: 'paid_plan_required', message: 'Free users cannot use library voices via the API' } }, 402) }), (e) => /abonnement payant pour cette voix/.test(e.message) && /voix de base/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z', key: KEY }, { fetchImpl: async () => jsonRes({ detail: { status: 'voice_not_found', message: 'A voice with the voice_id abc was not found.' } }, 404) }), /refusé la requête \(404 : A voice with the voice_id abc was not found\.\)/);
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z', key: KEY }, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new Error('pas du JSON'); } }) }), (e) => /refusé la requête \(500\)$/.test(e.message));
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z', key: KEY }, { fetchImpl: async () => { throw new Error(`boom ${KEY}`); } }), (e) => /ElevenLabs ne répond pas/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(synthesize({ provider: 'elevenlabs', voice: 'abc', text: 'x y z' }), /Aucune clé API ElevenLabs/);
});

test('Google Cloud : clé dans l\'en-tête, langue déduite de la voix, audio décodé', async () => {
  let seen;
  const audio = await synthesize({ provider: 'googlecloud', voice: 'fr-FR-Chirp3-HD-Aoede', text: 'Bonjour à tous', key: KEY }, { fetchImpl: async (url, init) => { seen = { url, init }; return jsonRes({ audioContent: Buffer.alloc(600, 3).toString('base64') }); } });
  assert.equal(audio.length, 600);
  assert.ok(!seen.url.includes(KEY));
  assert.equal(seen.init.headers['X-Goog-Api-Key'], KEY);
  assert.deepEqual(JSON.parse(seen.init.body).voice, { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' });
});

test('listes de voix : ElevenLabs (étiquettes lisibles) et Google Cloud (voix naturelles seulement, Chirp en premier)', async () => {
  const el = await listVoices('elevenlabs', { key: KEY, fetchImpl: async () => jsonRes({ voices: [{ voice_id: 'b1', name: 'Bella', labels: { gender: 'female', accent: 'american' } }, { voice_id: '../x', name: 'Piège' }, { voice_id: 'a1', name: 'Adam', labels: { gender: 'male', accent: 'british' } }] }) });
  assert.deepEqual(el.map((x) => [x.id, x.label]), [['a1', 'Adam · masculine, british'], ['b1', 'Bella · féminine, american']]);
  const gc = await listVoices('googlecloud', { key: KEY, fetchImpl: async (url) => jsonRes({ voices: url.includes('fr-FR') ? [
    { name: 'fr-FR-Standard-A', ssmlGender: 'FEMALE' }, { name: 'fr-FR-Neural2-B', ssmlGender: 'MALE' }, { name: 'fr-FR-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }] : [] }) });
  assert.deepEqual(gc.map((x) => [x.id, x.lang]), [['fr-FR-Chirp3-HD-Aoede', 'fr'], ['fr-FR-Neural2-B', 'fr']]);
  assert.match(gc[0].label, /très naturelle/);
});

test('clé API : essayée avant d\'être gardée, chiffrée en base, jamais renvoyée, retirable, propre à chaque compte', async () => {
  const u = await s.newUser();
  const other = await s.newUser();
  const calls = [];
  s.app.listVoices = async (provider, { key }) => { calls.push([provider, key]); if (key.startsWith('bad')) throw new Error('ElevenLabs a refusé la clé API (vérifie-la, ou son quota)'); return [{ id: 'v1', label: 'Voix un', lang: 'fr' }]; };
  try {
    assert.equal((await u.post('/api/promo/voice-key', { provider: 'google', key: KEY })).status, 400, 'fournisseur sans clé');
    assert.equal((await u.post('/api/promo/voice-key', { provider: 'elevenlabs', key: 'court' })).status, 400);
    assert.equal((await u.post('/api/promo/voice-key', { provider: 'elevenlabs', key: 'a b c d e f g h i j k l m n' })).status, 400);
    const bad = await u.post('/api/promo/voice-key', { provider: 'elevenlabs', key: 'bad_key_1234567890abcdef' });
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).error, /ElevenLabs a refusé la clé API/);
    assert.equal(await s.db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND `key` = 'voice_key_elevenlabs_enc'").get(u.id), undefined, 'clé refusée : rien de gardé');
    const ok = await u.post('/api/promo/voice-key', { provider: 'elevenlabs', key: KEY });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.keyLast4, KEY.slice(-4));
    assert.ok(!JSON.stringify(body).includes(KEY), 'la clé n\'est pas renvoyée');
    const row = await s.db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND `key` = 'voice_key_elevenlabs_enc'").get(u.id);
    assert.ok(row.value.startsWith('v1:') && !row.value.includes(KEY), 'chiffrée en base');
    const pid = await addProject(s.db, u.id, { name: 'P', gitUrl: 'https://github.com/u/p.git' });
    const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
    const el = st.voices.find((p) => p.id === 'elevenlabs');
    assert.equal(el.keyLast4, KEY.slice(-4));
    assert.ok(!JSON.stringify(st).includes(KEY));
    // Liste des voix : demandée avec la clé de la personne, puis gardée
    const n = calls.length;
    const list = await (await u.get('/api/promo/voices?provider=elevenlabs')).json();
    assert.deepEqual(list.voices.map((x) => x.id), ['v1']);
    assert.equal(calls.length, n, 'liste en cache après l\'enregistrement');
    // Isolation : un autre compte n'a pas cette clé
    assert.equal((await other.get('/api/promo/voices?provider=elevenlabs')).status, 400);
    assert.equal((await other.get('/api/promo/voice-sample?provider=elevenlabs&voice=v1')).status, 400);
    assert.equal((await s.anon.post('/api/promo/voice-key', { provider: 'elevenlabs', key: KEY })).status, 401);
    // Retrait
    assert.equal((await u.post('/api/promo/voice-key/delete', { provider: 'elevenlabs' })).status, 200);
    assert.equal((await u.get('/api/promo/voices?provider=elevenlabs')).status, 400);
    assert.equal(((await (await u.get(`/api/projects/${pid}/promo`)).json()).voices.find((p) => p.id === 'elevenlabs')).keyLast4, null);
  } finally { delete s.app.listVoices; }
});

test('vidéo avec une voix ElevenLabs : la clé du compte est transmise à la synthèse, absente = erreur claire avant le rendu', async () => {
  const { u, pid } = await setup();
  const log = fakes();
  const body = { fps: 10, seconds: 6, voice: true, voiceProvider: 'elevenlabs', voiceName: 'EXAVITQu4vr4xnSDxMaL', voiceLang: 'es' };
  try {
    await gen(u, pid, body);
    let job = await runJob(pid);
    assert.equal(job.status, 'error');
    assert.match(job.error, /Aucune clé API ElevenLabs/);
    assert.equal(log.rendered.length, 0);
    s.app.listVoices = async () => [{ id: 'x', label: 'x', lang: 'fr' }];
    assert.equal((await u.post('/api/promo/voice-key', { provider: 'elevenlabs', key: KEY })).status, 200);
    await gen(u, pid, body);
    job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    assert.equal(log.synth[0].key, KEY);
    assert.equal(log.synth[0].provider, 'elevenlabs');
    assert.ok(!JSON.stringify(job).includes(KEY), 'la clé n\'apparaît pas dans la tâche');
  } finally { unfake(); delete s.app.listVoices; }
});

// ---------- Microsoft Azure AI Speech (clé + région) ----------
test('Azure : clé dans l\'en-tête, région dans l\'adresse, SSML échappé, erreurs sans la clé ; région obligatoire', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return jsonRes({}); };
  const audio = await synthesize({ provider: 'azure', voice: 'fr-FR-VivienneMultilingualNeural', text: 'Tom & <Jerry>', key: KEY, region: 'francecentral' }, { fetchImpl });
  assert.equal(audio.length, 500);
  assert.equal(seen.url, 'https://francecentral.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(seen.init.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.ok(!seen.url.includes(KEY));
  assert.equal(seen.init.headers['Content-Type'], 'application/ssml+xml');
  assert.match(seen.init.body, /xml:lang='fr-FR'><voice name='fr-FR-VivienneMultilingualNeural'>Tom &amp; &lt;Jerry&gt;<\/voice>/);
  await assert.rejects(synthesize({ provider: 'azure', voice: 'fr-FR-DeniseNeural', text: 'x y z', key: KEY, region: 'francecentral' }, { fetchImpl: async () => jsonRes({}, 401) }), (e) => /Microsoft Azure a refusé la clé API/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(synthesize({ provider: 'azure', voice: 'fr-FR-DeniseNeural', text: 'x y z', key: KEY }), /Aucune région Microsoft Azure/);
  await assert.rejects(synthesize({ provider: 'azure', voice: 'fr-FR-DeniseNeural', text: 'x y z', key: KEY, region: 'evil.com/x' }), /Aucune région/, 'région de forme sûre uniquement');
  await assert.rejects(synthesize({ provider: 'azure', voice: 'fr-FR-DeniseNeural', text: 'x y z', region: 'westeurope' }), /Aucune clé API Microsoft Azure/);
  assert.match(parseVoiceParams({ voice: true, voiceProvider: 'azure', voiceName: 'de-DE-KatjaNeural' }).voice.lang, /de/);
});

test('Azure : liste des voix (langues gérées, neuronales seulement, multilingues en premier)', async () => {
  let seen;
  const voices = await listVoices('azure', { key: KEY, region: 'westeurope', fetchImpl: async (url, init) => { seen = { url, init }; return jsonRes([
    { ShortName: 'fr-FR-DeniseNeural', LocalName: 'Denise', Locale: 'fr-FR', LocaleName: 'français (France)', Gender: 'Female' },
    { ShortName: 'fr-FR-VivienneMultilingualNeural', LocalName: 'Vivienne', Locale: 'fr-FR', LocaleName: 'français (France)', Gender: 'Female' },
    { ShortName: 'fr-FR-Old-Standard', Locale: 'fr-FR', Gender: 'Male' },
    { ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP', Gender: 'Female' },
  ]); } });
  assert.equal(seen.url, 'https://westeurope.tts.speech.microsoft.com/cognitiveservices/voices/list');
  assert.equal(seen.init.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.deepEqual(voices.map((x) => x.id), ['fr-FR-VivienneMultilingualNeural', 'fr-FR-DeniseNeural']);
  assert.match(voices[0].label, /très naturelle/);
  await assert.rejects(listVoices('azure', { key: KEY, region: 'a b' }), /région/);
});

test('Azure : région demandée avec la clé, gardée avec elle, rendue à la page, effacée au retrait, transmise à la synthèse', async () => {
  const u = await s.newUser();
  const calls = [];
  s.app.listVoices = async (provider, o) => { calls.push([provider, o.region]); return [{ id: 'fr-FR-DeniseNeural', label: 'Denise', lang: 'fr' }]; };
  try {
    assert.equal((await u.post('/api/promo/voice-key', { provider: 'azure', key: KEY })).status, 400, 'région absente');
    assert.equal((await u.post('/api/promo/voice-key', { provider: 'azure', key: KEY, region: 'Mauvaise Région!' })).status, 400);
    const ok = await u.post('/api/promo/voice-key', { provider: 'azure', key: KEY, region: ' FranceCentral ' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).region, 'francecentral');
    assert.deepEqual(calls.at(-1), ['azure', 'francecentral']);
    const pid = await addProject(s.db, u.id, { name: 'P', gitUrl: 'https://github.com/u/p.git' });
    const az = (await (await u.get(`/api/projects/${pid}/promo`)).json()).voices.find((p) => p.id === 'azure');
    assert.deepEqual([az.keyed, az.needsRegion, az.keyLast4, az.region], [true, true, KEY.slice(-4), 'francecentral']);
    // la synthèse reçoit clé ET région
    const log = fakes();
    await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(PROFILE, pid);
    await gen(u, pid, { fps: 10, seconds: 6, voice: true, voiceProvider: 'azure', voiceName: 'fr-FR-DeniseNeural' });
    const job = await runJob(pid);
    assert.equal(job.status, 'done', job.error);
    assert.equal(log.synth[0].region, 'francecentral');
    assert.equal(log.synth[0].key, KEY);
    unfake();
    assert.equal((await u.post('/api/promo/voice-key/delete', { provider: 'azure' })).status, 200);
    const gone = (await (await u.get(`/api/projects/${pid}/promo`)).json()).voices.find((p) => p.id === 'azure');
    assert.deepEqual([gone.keyLast4, gone.region], [null, null]);
  } finally { unfake(); delete s.app.listVoices; }
});

// ---------- Voix locales : Piper et eSpeak NG (sans clé, sur le serveur) ----------
import { chmodSync } from 'node:fs';

/** Faux programmes de voix : écrivent un vrai WAV (ffmpeg) et notent leurs arguments, pour tester le lancement réel sans installer Piper. */
function fakeTools(dir) {
  const log = join(dir, 'args.log');
  const script = (name, flag) => {
    const f = join(dir, name);
    writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nout=''\nwhile [ $# -gt 0 ]; do if [ "$1" = '${flag}' ]; then out="$2"; fi; shift; done\nexec ffmpeg -v error -y -f lavfi -i sine=frequency=300:duration=1 "$out"\n`);
    chmodSync(f, 0o755);
    return f;
  };
  return { log, espeakBin: script('espeak-ng', '-w'), piperBin: script('piper', '-f') };
}

test('Piper : voix installées lues sur le disque (modèle + fiche .json, langues gérées, noms sûrs)', () => {
  const files = ['fr_FR-siwis-medium.onnx', 'fr_FR-siwis-medium.onnx.json', 'fr_FR-tom-medium.onnx', 'en_US-lessac-high.onnx', 'en_US-lessac-high.onnx.json', 'ja_JP-x-low.onnx', 'ja_JP-x-low.onnx.json', 'notes.txt', 'fr_FR-a b-low.onnx', 'fr_FR-a b-low.onnx.json'];
  const v = piperVoices('/voix', { list: () => files });
  assert.deepEqual(v.map((x) => [x.id, x.lang]), [['en_US-lessac-high', 'en'], ['fr_FR-siwis-medium', 'fr']]);
  assert.match(v[1].label, /Siwis · français \(FR\), qualité medium/);
  assert.deepEqual(piperVoices('/absent', { list: () => { throw new Error('ENOENT'); } }), []);
});

test('voix locales : disponibilité selon les programmes et les voix installées, réglages du serveur', () => {
  resetLocalStatus();
  const ok = () => ({ status: 0 });
  const ko = () => ({ status: 1 });
  const cfg = { piperBin: '/opt/piper/bin/python3', piperVoicesDir: '/voix', espeakBin: 'espeak-ng' };
  const list = () => ['fr_FR-siwis-medium.onnx', 'fr_FR-siwis-medium.onnx.json'];
  const st = localStatus(cfg, { run: ok, list });
  assert.equal(st.piper.ok, true);
  assert.equal(st.piper.voices[0].id, 'fr_FR-siwis-medium');
  assert.equal(st.espeak.ok, true);
  assert.equal(st.espeak.voices.length, VOICE_PROVIDERS.espeak.voices.length);
  assert.equal(localStatus(cfg, { run: ko, list }).piper.ok, false, 'programme absent ou en panne');
  assert.equal(localStatus({ ...cfg, piperVoicesDir: '' }, { run: ok, list }).piper.ok, false, 'aucun dossier de voix');
  assert.equal(localStatus(cfg, { run: ok, list: () => [] }).piper.ok, false, 'aucune voix installée');
  assert.deepEqual(localConfig({}, { PIPER_BIN: '/p', PIPER_VOICES_DIR: '/v', ESPEAK_BIN: '/e' }), { piperBin: '/p', piperVoicesDir: '/v', espeakBin: '/e' });
  assert.deepEqual(localConfig({}, {}), { piperBin: 'piper', piperVoicesDir: '', espeakBin: 'espeak-ng' });
  const cat = voiceCatalog({}, {}, { piper: { ok: false, voices: [] }, espeak: st.espeak });
  const piper = cat.find((p) => p.id === 'piper');
  assert.deepEqual([piper.local, piper.available, piper.voices], [true, false, []]);
  assert.match(piper.unavailable, /Piper n'est pas installé/);
  assert.equal(cat.find((p) => p.id === 'espeak').available, true);
  assert.equal(audioType(Buffer.from('RIFFxxxx')).mime, 'audio/wav');
  assert.equal(audioType(Buffer.from('ID3xxxx')).mime, 'audio/mpeg');
});

test('voix locales : lancement réel (sans shell), texte après « -- », WAV rendu, voix non installée refusée', { skip: skipFf }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voix-local-'));
  try {
    const { log, espeakBin, piperBin } = fakeTools(dir);
    const voices = join(dir, 'voices');
    mkdirSync(voices);
    writeFileSync(join(voices, 'fr_FR-siwis-medium.onnx'), 'x');
    writeFileSync(join(voices, 'fr_FR-siwis-medium.onnx.json'), '{}');
    const cfg = { espeakBin, piperBin, piperVoicesDir: voices };
    const hostile = '--version; rm -rf / $(id) `id` "quote"';
    const wav = await synthesize({ provider: 'espeak', voice: 'fr+f3', text: hostile }, { cfg });
    assert.equal(audioType(wav).ext, 'wav');
    const pw = await synthesize({ provider: 'piper', voice: 'fr_FR-siwis-medium', text: 'Bonjour à tous' }, { cfg });
    assert.equal(audioType(pw).ext, 'wav');
    const args = readFileSync(log, 'utf8').trim().split('\n');
    assert.match(args[0], /^-v fr\+f3 -s 150 -w \S+voix\.wav -- --version; rm -rf \/ \$\(id\) `id` "quote"$/, 'le texte reste un seul argument, après « -- »');
    assert.match(args[1], /^-m fr_FR-siwis-medium --data-dir \S+voices -f \S+voix\.wav -- Bonjour à tous$/);
    await assert.rejects(synthesize({ provider: 'piper', voice: 'fr_FR-inconnue-low', text: 'x y' }, { cfg }), /pas installée/);
    await assert.rejects(synthesize({ provider: 'piper', voice: '../../etc/passwd', text: 'x y' }, { cfg }), /Voix inconnue/);
    await assert.rejects(synthesize({ provider: 'espeak', voice: 'fr', text: 'x y' }, { cfg: { espeakBin: join(dir, 'absent') } }), /ne démarre pas/);
    // le WAV se mixe comme un MP3
    const video = join(dir, 'v.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', video]);
    const f = join(dir, '0.wav');
    writeFileSync(f, wav);
    await mixVoice({ cfg: {}, videoPath: video, placed: [{ file: f, start: 0.5 }], seconds: 3 });
    assert.equal(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', video]).stdout.toString().trim(), 'aac');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('voix locales : l\'état de l\'onglet les indique, l\'extrait est servi en WAV', async () => {
  const { u, pid } = await setup();
  s.app.localStatus = () => ({ piper: { ok: false, voices: [] }, espeak: { ok: true, voices: VOICE_PROVIDERS.espeak.voices } });
  s.app.sampleVoice = async () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(300)]);
  try {
    const st = await (await u.get(`/api/projects/${pid}/promo`)).json();
    const piper = st.voices.find((p) => p.id === 'piper');
    assert.deepEqual([piper.available, piper.voices.length], [false, 0]);
    assert.match(piper.unavailable, /administrateur/);
    assert.equal(st.voices.find((p) => p.id === 'espeak').available, true);
    const r = await u.get('/api/promo/voice-sample?provider=espeak&voice=fr%2Bf3');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/wav');
    assert.equal((await u.get('/api/promo/voice-sample?provider=piper&voice=..%2F..%2Fx')).status, 400, 'nom de voix Piper de forme sûre uniquement');
  } finally { delete s.app.localStatus; delete s.app.sampleVoice; }
});

test('voix ElevenLabs : 5 françaises puis 3 anglaises, les mieux soignées d\'abord, langue inconnue écartée', () => {
  assert.deepEqual(ELEVEN_SHORTLIST, { fr: 5, en: 3 });
  const mk = (id, name, labels = {}, extra = {}) => ({ voice_id: id, name, labels, ...extra });
  const library = [
    ...['Zoé', 'Yann', 'Xavier', 'Wendy', 'Victor', 'Ugo'].map((n, i) => mk(`fr${i}`, n, { accent: 'parisian', gender: 'male' })), // six voix françaises : une de trop
    mk('frpro', 'Zélie', { accent: 'parisian' }, { category: 'professional' }),
    mk('fr-name', 'Adolescente française - Chicadi'),
    mk('fr-lang', 'Camille', { language: 'fr' }),
    ...['Adam', 'Alice', 'Bella', 'Bill', 'Brian'].map((n, i) => mk(`en${i}`, n, { accent: i % 2 ? 'british' : 'american' })),
    mk('none', 'Audrey', { accent: 'standard' }),   // aucune langue lisible : écartée
    mk('bad', 'Piège', { accent: 'parisian' }),
  ];
  library.find((x) => x.voice_id === 'bad').voice_id = '../x';
  const picked = pickElevenVoices(library);
  const fr = picked.filter((x) => x.lang === 'fr'), en = picked.filter((x) => x.lang === 'en');
  assert.equal(fr.length, 5);
  assert.equal(en.length, 3);
  assert.deepEqual(picked.map((x) => x.lang), ['fr', 'fr', 'fr', 'fr', 'fr', 'en', 'en', 'en'], 'françaises d\'abord');
  assert.equal(fr[0].id, 'frpro', 'une voix professionnelle passe avant les voix de base');
  assert.deepEqual(en.map((x) => x.label.split(' · ')[0]), ['Adam', 'Alice', 'Bella']);
  assert.ok(!picked.some((x) => ['none', '../x'].includes(x.id)), 'langue inconnue et identifiant piégé écartés');
  assert.deepEqual(pickElevenVoices([mk('a', 'A', { accent: 'british' })]).map((x) => x.lang), ['en'], 'moins de voix que prévu : on montre ce qu\'il y a');
});

test('langue d\'une voix ElevenLabs : étiquette de langue, accent, nom, puis langues vérifiées', () => {
  assert.equal(elevenVoiceLang({ name: 'X', labels: { language: 'fr' } }), 'fr');
  assert.equal(elevenVoiceLang({ name: 'Hugo from Paris', labels: {} }), 'fr');
  assert.equal(elevenVoiceLang({ name: 'X', labels: { accent: 'Australian' } }), 'en');
  assert.equal(elevenVoiceLang({ name: 'X', labels: {}, verified_languages: [{ language: 'fr' }] }), 'fr');
  assert.equal(elevenVoiceLang({ name: 'X', labels: {}, verified_languages: [{ language: 'fr' }, { language: 'en' }] }), '', 'deux langues sans accent : on ne devine pas');
  assert.equal(elevenVoiceLang({ name: 'X', labels: { accent: 'standard' } }), '');
});
