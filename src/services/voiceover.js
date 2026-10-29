// Voix off des vidéos de promotion. Claude écrit, avec la scène, un petit script (« voix ») : des phrases avec l'instant où elles commencent.
// Ce module le valide, le fait lire par un fournisseur de synthèse vocale, puis ffmpeg pose les voix sur la bande-son de la vidéo.
//  - google      : voix de Google Traduction, gratuit et sans clé, la plus simple (une voix par langue) ; service non officiel, il peut changer ou refuser des requêtes ;
//  - elevenlabs  : les voix les plus naturelles, avec la clé API de l'utilisateur (plan gratuit mensuel) ;
//  - googlecloud : voix Google Cloud (Chirp 3 HD, Neural2, Studio), avec la clé API de l'utilisateur (quota gratuit mensuel) ;
//  - azure       : Microsoft Azure AI Speech (voix neuronales dont les « Multilingual »), avec la clé et la région de l'utilisateur (niveau gratuit F0).
// Le service de lecture à voix haute de Microsoft Edge n'est volontairement PAS utilisé : Microsoft le réserve à son navigateur (jeton propre à Edge : un client tiers
// reçoit un 403) et ne le propose pas aux applications ; la voie officielle de Microsoft, ce sont les voix Azure ci-dessus. Le texte lu est envoyé au fournisseur choisi.
// Les clés sont chiffrées en base, jamais réaffichées, jamais dans un message d'erreur ni un journal.
// Aucun appel réseau n'est fait ailleurs que dans `synthesize` (remplaçable dans les tests).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SceneError } from './promovideo.js';

export const VOICE = { maxSegments: 20, maxSegmentChars: 240, maxTotalChars: 1500, gap: 0.2, sampleText: 'Bonjour, voici ma voix pour ta vidéo de promotion.', timeoutMs: 20_000 };

const LANGS = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais' };
const SAMPLES = {
  fr: 'Bonjour, voici ma voix pour ta vidéo de promotion.', en: 'Hello, this is my voice for your promotion video.', es: 'Hola, esta es mi voz para tu vídeo de promoción.',
  de: 'Hallo, das ist meine Stimme für dein Werbevideo.', it: 'Ciao, questa è la mia voce per il tuo video promozionale.', pt: 'Olá, esta é a minha voz para o teu vídeo de promoção.',
};

const v = (id, label, lang) => ({ id, label, lang });
export const VOICE_LANGS = Object.entries(LANGS).map(([id, label]) => ({ id, label: label[0].toUpperCase() + label.slice(1) }));
export const VOICE_PROVIDERS = {
  google: {
    label: 'Google Traduction (gratuit)',
    voices: [v('fr', 'Français', 'fr'), v('en', 'Anglais', 'en'), v('es', 'Espagnol', 'es'), v('de', 'Allemand', 'de'), v('it', 'Italien', 'it'), v('pt', 'Portugais', 'pt')],
  },
  // Voix très naturelles : la clé de l'utilisateur ouvre la liste de ses voix ; une voix ElevenLabs parle toutes les langues (modèle multilingue)
  elevenlabs: { label: 'ElevenLabs (clé gratuite)', keyed: true, multilingual: true, keyUrl: 'elevenlabs.io', keyHelp: 'Crée un compte gratuit sur elevenlabs.io, ouvre ton profil → « API Keys », crée une clé et colle-la ici.' },
  googlecloud: { label: 'Google Cloud (clé gratuite)', keyed: true, keyUrl: 'console.cloud.google.com', keyHelp: 'Dans console.cloud.google.com : active « Cloud Text-to-Speech API », puis Identifiants → Créer des identifiants → Clé API, et colle-la ici.' },
  // Microsoft : la voie officielle (niveau gratuit F0 : 500 000 caractères par mois). Clé ET région (celle de la ressource, par exemple « francecentral » ou « westeurope »)
  azure: { label: 'Microsoft Azure (clé gratuite)', keyed: true, region: true, keyUrl: 'portal.azure.com', keyHelp: 'Sur portal.azure.com : crée une ressource « Speech » (niveau gratuit F0), ouvre « Clés et point de terminaison », puis colle ici la clé 1 et la région (par exemple francecentral).' },
};

/** Catalogue pour la page : les voix des fournisseurs à clé viennent de leur API (une fois la clé enregistrée). `keys` : { fournisseur: 4 derniers caractères }. */
export const voiceCatalog = (keys = {}, regions = {}) => Object.entries(VOICE_PROVIDERS).map(([id, p]) => ({
  id, label: p.label, keyed: !!p.keyed, multilingual: !!p.multilingual, needsRegion: !!p.region, keyHelp: p.keyHelp || null,
  keyLast4: p.keyed ? (keys[id] || null) : null, region: p.region ? (regions[id] || null) : null, voices: p.voices || null,
}));
const REGION_RE = /^[a-z0-9]{3,30}$/;
export const REGION = { test: (r) => typeof r === 'string' && REGION_RE.test(r) }; // « null » ou un nombre ne sont pas une région
const findVoice = (provider, id) => VOICE_PROVIDERS[provider]?.voices?.find((x) => x.id === id) || null;
export const langName = (lang) => LANGS[lang] || 'français';
const VOICE_ID = /^[A-Za-z0-9_.-]{1,80}$/;

/** Choix du formulaire → `{ provider, voice, lang }`, `null` (pas de voix), ou une erreur lisible. */
export function parseVoiceParams(b = {}) {
  if (!(b.voice === true || b.voice === 'true' || b.voice === 1 || b.voice === '1' || b.voice === 'on')) return { voice: null };
  const provider = String(b.voiceProvider ?? '');
  const p = VOICE_PROVIDERS[provider];
  if (!p) return { error: 'Voix : choisis un fournisseur dans la liste.' };
  const id = String(b.voiceName ?? '');
  if (p.keyed) {
    if (!VOICE_ID.test(id)) return { error: 'Voix : choisis une voix dans la liste.' };
    const lang = p.multilingual ? (LANGS[b.voiceLang] ? String(b.voiceLang) : 'fr') : (LANGS[id.slice(0, 2)] ? id.slice(0, 2) : 'fr');
    return { voice: { provider, voice: id, lang } };
  }
  const found = findVoice(provider, id);
  if (!found) return { error: 'Voix : choisis une voix dans la liste.' };
  return { voice: { provider, voice: found.id, lang: found.lang } };
}

// ---------- Le script écrit par Claude ----------

const SCRIPT = /<script[^>]*\bid=["']voix["'][^>]*>([\s\S]*?)<\/script>/i;

/**
 * Document HTML de Claude → phrases à dire `[{ t, text }]` triées par instant. Une erreur de forme est une SceneError : elle est renvoyée à Claude
 * pour correction, comme un défaut de scène.
 */
export function extractVoiceScript(html, seconds) {
  const m = SCRIPT.exec(String(html ?? ''));
  if (!m) throw new SceneError('Il manque le script de la voix : ajoute dans le <body> <script type="application/json" id="voix">[{"t":0.5,"texte":"…"}, …]</script> (une phrase par plan, "t" = seconde où elle commence).');
  let list;
  try { list = JSON.parse(m[1]); } catch { throw new SceneError('Le script de la voix (<script id="voix">) n\'est pas du JSON valide : un tableau de {"t": secondes, "texte": "phrase"}.'); }
  if (!Array.isArray(list) || !list.length) throw new SceneError('Le script de la voix est vide : écris au moins une phrase par plan.');
  const segs = list.map((x) => ({ t: Number(x?.t), text: String(x?.texte ?? x?.text ?? '').replace(/\s+/g, ' ').trim() }));
  if (segs.length > VOICE.maxSegments) throw new SceneError(`Trop de phrases dans la voix (${segs.length}) : ${VOICE.maxSegments} au plus, une par plan.`);
  for (const s of segs) {
    if (!Number.isFinite(s.t) || s.t < 0 || s.t >= seconds) throw new SceneError(`Dans la voix, "t" doit être un nombre de secondes entre 0 et ${seconds} (reçu : ${JSON.stringify(s.t)}).`);
    if (s.text.length < 2) throw new SceneError('Dans la voix, chaque phrase doit avoir un "texte" non vide.');
    if (s.text.length > VOICE.maxSegmentChars) throw new SceneError(`Une phrase de la voix fait ${s.text.length} caractères : ${VOICE.maxSegmentChars} au plus ; coupe-la en deux phrases à deux instants différents.`);
  }
  const total = segs.reduce((n, s) => n + s.text.length, 0);
  if (total > VOICE.maxTotalChars) throw new SceneError(`La voix totalise ${total} caractères : ${VOICE.maxTotalChars} au plus ; raccourcis les phrases.`);
  return segs.sort((a, b) => a.t - b.t);
}

/**
 * Place les phrases : chacune commence à son instant, ou juste après la précédente si celle-ci n'est pas finie (jamais deux voix en même temps).
 * `overflow` : secondes de voix qui dépasseraient la fin de la vidéo.
 */
export function planVoice(parts, seconds) {
  let cursor = 0;
  const placed = parts.map((p) => {
    const start = Math.max(p.t, cursor);
    cursor = start + p.dur + VOICE.gap;
    return { ...p, start, end: start + p.dur };
  });
  const end = placed.length ? placed[placed.length - 1].end : 0;
  return { placed, overflow: Math.max(0, end - seconds) };
}

// ---------- Synthèse ----------

const withTimeout = async (promise, ms, what) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} : délai dépassé`)), ms); })]); } finally { clearTimeout(timer); }
};

const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Google Traduction : une requête GET par morceau d'au plus 180 caractères, les MP3 se mettent bout à bout.
export function googleChunks(text, max = 180) {
  const out = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if ((`${cur} ${word}`).trim().length > max) { if (cur) out.push(cur); cur = word.slice(0, max); } else cur = `${cur} ${word}`.trim();
    if (/[.!?]$/.test(word) && cur.length > max * 0.6) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

async function googleSynth(text, lang, { fetchImpl = fetch } = {}) {
  const bufs = [];
  for (const q of googleChunks(text)) {
    const res = await fetchImpl(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Google Traduction a refusé la requête (${res.status})`);
    bufs.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(bufs);
}

// Fournisseurs à clé : appels REST officiels. La clé voyage dans un en-tête, jamais dans l'adresse ; les erreurs ne la citent jamais.
const keyedFetch = async (fetchImpl, url, init, label) => {
  let res;
  try { res = await fetchImpl(url, init); } catch { throw new Error(`${label} ne répond pas`); }
  if (res.status === 401 || res.status === 403) throw new Error(`${label} a refusé la clé API (vérifie-la, ou son quota)`);
  if (res.status === 429) throw new Error(`${label} : quota ou débit dépassé`);
  if (!res.ok) throw new Error(`${label} a refusé la requête (${res.status})`);
  return res;
};

async function elevenSynth(text, voice, { key, fetchImpl = fetch }) {
  const res = await keyedFetch(fetchImpl, `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
  }, 'ElevenLabs');
  return Buffer.from(await res.arrayBuffer());
}

async function googleCloudSynth(text, voice, { key, fetchImpl = fetch }) {
  const res = await keyedFetch(fetchImpl, 'https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST', headers: { 'X-Goog-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: { languageCode: voice.split('-').slice(0, 2).join('-'), name: voice }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 } }),
  }, 'Google Cloud');
  return Buffer.from(String((await res.json())?.audioContent || ''), 'base64');
}

const azureHost = (region) => `https://${region}.tts.speech.microsoft.com/cognitiveservices`;

async function azureSynth(text, voice, { key, region, fetchImpl = fetch }) {
  const lang = voice.split('-').slice(0, 2).join('-');
  const ssml = `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'>${xmlEscape(text)}</voice></speak>`;
  const res = await keyedFetch(fetchImpl, `${azureHost(region)}/v1`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'AiTools' }, body: ssml,
  }, 'Microsoft Azure');
  return Buffer.from(await res.arrayBuffer());
}

/** Voix proposées par un fournisseur à clé (c'est aussi le test de la clé : refusée, la liste échoue). */
export async function listVoices(provider, { key, region = null, fetchImpl = fetch } = {}) {
  if (provider === 'elevenlabs') {
    const res = await keyedFetch(fetchImpl, 'https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } }, 'ElevenLabs');
    const sex = { female: 'féminine', male: 'masculine' };
    return ((await res.json())?.voices || []).filter((x) => VOICE_ID.test(String(x.voice_id))).map((x) => {
      const l = x.labels || {};
      const tags = [sex[l.gender] || l.gender, l.accent, l.descriptive || l.description].filter(Boolean).join(', ');
      return v(x.voice_id, `${x.name}${tags ? ` · ${tags}` : ''}`, 'fr');
    }).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }
  if (provider === 'googlecloud') {
    const out = [];
    for (const code of ['fr-FR', 'en-US', 'en-GB', 'es-ES', 'de-DE', 'it-IT', 'pt-BR']) {
      const res = await keyedFetch(fetchImpl, `https://texttospeech.googleapis.com/v1/voices?languageCode=${code}`, { headers: { 'X-Goog-Api-Key': key } }, 'Google Cloud');
      for (const x of (await res.json())?.voices || []) {
        const m = /(Chirp3-HD|Chirp-HD|Studio|Neural2)/.exec(x.name || '');
        if (!m || !VOICE_ID.test(x.name)) continue;
        out.push({ ...v(x.name, `${x.name.split('-').slice(2).join(' ')} · ${x.ssmlGender === 'FEMALE' ? 'féminine' : x.ssmlGender === 'MALE' ? 'masculine' : 'neutre'}${/Chirp/.test(m[1]) ? ' (très naturelle)' : ''}`, code.slice(0, 2)), rank: /Chirp/.test(m[1]) ? 0 : m[1] === 'Studio' ? 1 : 2 });
      }
    }
    return out.sort((a, b) => a.lang.localeCompare(b.lang) || a.rank - b.rank || a.label.localeCompare(b.label)).map(({ rank, ...x }) => x);
  }
  if (provider === 'azure') {
    if (!REGION.test(region)) throw new Error('Microsoft Azure : région absente ou de mauvaise forme (par exemple francecentral)');
    const res = await keyedFetch(fetchImpl, `${azureHost(region)}/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': key } }, 'Microsoft Azure');
    const out = [];
    for (const x of (await res.json()) || []) {
      const lang = String(x.Locale || '').slice(0, 2);
      const name = String(x.ShortName || '');
      if (!LANGS[lang] || !VOICE_ID.test(name) || !/Neural|Multilingual|HD/.test(name)) continue;
      const multi = /Multilingual|HD/.test(name);
      out.push({ ...v(name, `${x.LocalName || x.DisplayName || name} · ${x.LocaleName || x.Locale}, ${x.Gender === 'Female' ? 'féminine' : x.Gender === 'Male' ? 'masculine' : 'neutre'}${multi ? ' (très naturelle)' : ''}`, lang), rank: multi ? 0 : 1 });
    }
    return out.sort((a, b) => a.lang.localeCompare(b.lang) || a.rank - b.rank || a.label.localeCompare(b.label, 'fr')).map(({ rank, ...x }) => x);
  }
  throw new Error('Ce fournisseur n\'a pas de liste de voix');
}

/** Texte → MP3 (Buffer). Les erreurs réseau remontent avec le nom du service ; jamais de clé ni de texte dans le message. */
export async function synthesize({ provider, voice, text, key = null, region = null }, deps = {}) {
  const p = VOICE_PROVIDERS[provider];
  if (!p || (p.voices ? !findVoice(provider, voice) : !VOICE_ID.test(String(voice)))) throw new Error('Voix inconnue');
  if (p.keyed && !key) throw new Error(`Aucune clé API ${p.label.split(' (')[0]} : ajoute-la dans l'onglet Promotion`);
  if (p.region && !REGION.test(region)) throw new Error(`Aucune région ${p.label.split(' (')[0]} : ajoute-la dans l'onglet Promotion`);
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Texte vide');
  const run = provider === 'google' ? googleSynth(clean, voice, deps)
    : provider === 'elevenlabs' ? elevenSynth(clean, voice, { ...deps, key }) : provider === 'azure' ? azureSynth(clean, voice, { ...deps, key, region }) : googleCloudSynth(clean, voice, { ...deps, key });
  const audio = await withTimeout(run, VOICE.timeoutMs, `Service de voix ${p.label}`);
  if (audio.length < 200) throw new Error('Le service de voix a renvoyé un audio vide');
  return audio;
}

/** Extrait d'écoute : phrase courte dans la langue de la voix. */
export const sampleFor = ({ provider, voice, lang, key, region }, deps) => synthesize({ provider, voice, key, region, text: SAMPLES[findVoice(provider, voice)?.lang || lang] || VOICE.sampleText }, deps);

// ---------- ffmpeg ----------

function run(bin, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg a échoué : ${err.trim().split('\n').pop() || `code ${code}`}`))));
  });
}

/** Durée d'un fichier audio en secondes (lue sur la sortie d'ffmpeg, sans dépendre de ffprobe). */
export function audioDuration(cfg, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(cfg.ffmpegBin || 'ffmpeg', ['-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', reject);
    p.on('close', () => {
      const all = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
      if (!all) return reject(new Error("Audio illisible : la voix n'a pas pu être mesurée"));
      resolve(Number(all[1]) * 3600 + Number(all[2]) * 60 + Number(all[3]));
    });
  });
}

/**
 * Synthétise chaque phrase, mesure sa durée et la place. Renvoie `{ dir, placed, overflow }` ; `dir` contient les MP3 (à effacer avec `cleanVoice`).
 */
export async function prepareVoice({ cfg, segments, voice, seconds, synth = synthesize, onProgress = () => {}, signal }) {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-voix-'));
  try {
    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      if (signal?.aborted) throw new Error('Annulé');
      onProgress({ done: i, total: segments.length });
      const file = join(dir, `${i}.mp3`);
      writeFileSync(file, await synth({ provider: voice.provider, voice: voice.voice, text: segments[i].text }));
      parts.push({ t: segments[i].t, text: segments[i].text, file, dur: await audioDuration(cfg, file) });
    }
    onProgress({ done: segments.length, total: segments.length });
    return { dir, ...planVoice(parts, seconds) };
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}

export const cleanVoice = (prepared) => { if (prepared?.dir) rmSync(prepared.dir, { recursive: true, force: true }); };

/** Pose les voix sur la vidéo (déjà encodée, sans son) : l'image n'est pas ré-encodée, la bande-son est coupée à la durée de la vidéo. */
export async function mixVoice({ cfg, videoPath, placed, seconds, signal }) {
  if (!placed.length) return;
  const tmp = `${videoPath}.voix.mp4`;
  const inputs = placed.flatMap((p) => ['-i', p.file]);
  const delays = placed.map((p, i) => { const ms = Math.round(p.start * 1000); return `[${i + 1}:a]adelay=${ms}|${ms},volume=1.0[a${i}]`; });
  const mixed = placed.length > 1 ? `${placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0[m]` : '[a0]anull[m]';
  const fade = Math.max(0, seconds - 0.4);
  const filter = `${delays.join(';')};${mixed};[m]apad,atrim=0:${seconds},afade=t=out:st=${fade}:d=0.4[a]`;
  try {
    await run(cfg.ffmpegBin || 'ffmpeg', ['-v', 'error', '-y', '-i', videoPath, ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-t', String(seconds), '-movflags', '+faststart', tmp], { signal });
    renameSync(tmp, videoPath);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}
