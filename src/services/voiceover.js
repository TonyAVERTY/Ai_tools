// Voix off des vidéos de promotion. Claude écrit, avec la scène, un petit script (« voix ») : des phrases avec l'instant où elles commencent.
// Ce module le valide, le fait lire par un fournisseur de synthèse vocale, puis ffmpeg pose les voix sur la bande-son de la vidéo.
//  - google      : voix de Google Traduction, gratuit et sans clé, la plus simple (une voix par langue) ; service non officiel, il peut changer ou refuser des requêtes ;
//  - elevenlabs  : les voix les plus naturelles, avec la clé API de l'utilisateur (plan gratuit mensuel) ;
//  - googlecloud : voix Google Cloud (Chirp 3 HD, Neural2, Studio), avec la clé API de l'utilisateur (quota gratuit mensuel) ;
//  - piper       : Piper, voix neuronales libres qui tournent SUR le serveur (hors ligne, sans clé, rien ne sort du serveur) ; à installer par l'administrateur ;
//  - espeak      : eSpeak NG, synthèse locale très simple (robotique mais toujours disponible : un paquet à installer) ;
//  - azure       : Microsoft Azure AI Speech (voix neuronales dont les « Multilingual »), avec la clé et la région de l'utilisateur (niveau gratuit F0).
// Le service de lecture à voix haute de Microsoft Edge n'est volontairement PAS utilisé : Microsoft le réserve à son navigateur (jeton propre à Edge : un client tiers
// reçoit un 403) et ne le propose pas aux applications ; la voie officielle de Microsoft, ce sont les voix Azure ci-dessus. Le texte lu est envoyé au fournisseur choisi.
// Les clés sont chiffrées en base, jamais réaffichées, jamais dans un message d'erreur ni un journal.
// Aucun appel réseau n'est fait ailleurs que dans `synthesize` (remplaçable dans les tests).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
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
  // Voix locales : exécutées par le serveur lui-même (aucun appel réseau, aucune clé). Disponibles seulement si l'administrateur les a installées.
  piper: { label: 'Piper (voix locale, gratuit)', local: true, installHelp: 'Piper n\'est pas installé sur ce serveur : l\'administrateur doit l\'installer (voir la documentation du Support, « Voix locales ») puis renseigner PIPER_BIN et PIPER_VOICES_DIR.' },
  espeak: {
    label: 'eSpeak NG (voix locale, simple)', local: true, installHelp: 'eSpeak NG n\'est pas installé sur ce serveur : l\'administrateur doit installer le paquet espeak-ng.',
    voices: [
      v('fr', 'Français · voix masculine', 'fr'), v('fr+f3', 'Français · voix féminine', 'fr'), v('en-us', 'Anglais américain · voix masculine', 'en'), v('en-us+f3', 'Anglais américain · voix féminine', 'en'),
      v('en-gb', 'Anglais britannique · voix masculine', 'en'), v('es', 'Espagnol · voix masculine', 'es'), v('es+f3', 'Espagnol · voix féminine', 'es'),
      v('de', 'Allemand · voix masculine', 'de'), v('de+f3', 'Allemand · voix féminine', 'de'), v('it', 'Italien · voix masculine', 'it'), v('it+f3', 'Italien · voix féminine', 'it'),
      v('pt-br', 'Portugais · voix masculine', 'pt'), v('pt-br+f3', 'Portugais · voix féminine', 'pt'),
    ],
  },
  // Voix très naturelles : la clé de l'utilisateur ouvre la liste de ses voix ; une voix ElevenLabs parle toutes les langues (modèle multilingue)
  elevenlabs: { label: 'ElevenLabs (clé gratuite)', keyed: true, multilingual: true, keyUrl: 'elevenlabs.io', keyHelp: 'Crée un compte gratuit sur elevenlabs.io, ouvre ton profil → « API Keys », crée une clé et colle-la ici.' },
  googlecloud: { label: 'Google Cloud (clé gratuite)', keyed: true, keyUrl: 'console.cloud.google.com', keyHelp: 'Dans console.cloud.google.com : active « Cloud Text-to-Speech API », puis Identifiants → Créer des identifiants → Clé API, et colle-la ici.' },
  // Microsoft : la voie officielle (niveau gratuit F0 : 500 000 caractères par mois). Clé ET région (celle de la ressource, par exemple « francecentral » ou « westeurope »)
  azure: { label: 'Microsoft Azure (clé gratuite)', keyed: true, region: true, keyUrl: 'portal.azure.com', keyHelp: 'Sur portal.azure.com : crée une ressource « Speech » (niveau gratuit F0), ouvre « Clés et point de terminaison », puis colle ici la clé 1 et la région (par exemple francecentral).' },
};

/** Catalogue pour la page : les voix des fournisseurs à clé viennent de leur API (une fois la clé enregistrée). `keys` : { fournisseur: 4 derniers caractères }. */
export const voiceCatalog = (keys = {}, regions = {}, locals = {}) => Object.entries(VOICE_PROVIDERS).map(([id, p]) => ({
  id, label: p.label, keyed: !!p.keyed, multilingual: !!p.multilingual, needsRegion: !!p.region, keyHelp: p.keyHelp || null,
  keyLast4: p.keyed ? (keys[id] || null) : null, region: p.region ? (regions[id] || null) : null,
  local: !!p.local, available: p.local ? !!locals[id]?.ok : true, unavailable: p.local && !locals[id]?.ok ? p.installHelp : null,
  voices: p.local ? (locals[id]?.ok ? locals[id].voices : []) : (p.voices || null),
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
  if (p.keyed || (p.local && !p.voices)) {
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

// ---------- Voix locales (Piper, eSpeak NG) ----------

/** Outils locaux : réglages du compte serveur (variables d'environnement), jamais choisis par un utilisateur. */
export const localConfig = (cfg = {}, env = process.env) => ({
  piperBin: cfg.piperBin || env.PIPER_BIN || 'piper',
  piperVoicesDir: cfg.piperVoicesDir || env.PIPER_VOICES_DIR || '',
  espeakBin: cfg.espeakBin || env.ESPEAK_BIN || 'espeak-ng',
});
const isPython = (bin) => /(^|\/)python[\d.]*$/.test(bin);
const piperArgs = (bin) => (isPython(bin) ? ['-m', 'piper'] : []); // « python -m piper » (installation pip) ou un exécutable piper

/** Voix Piper installées : un fichier `<nom>.onnx` avec son `<nom>.onnx.json`, dans les langues gérées. */
export function piperVoices(dir, { list = readdirSync } = {}) {
  let names;
  try { names = list(dir); } catch { return []; }
  const set = new Set(names);
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.onnx')) continue;
    const id = f.slice(0, -5);
    const lang = id.slice(0, 2);
    if (!VOICE_ID.test(id) || !set.has(`${f}.json`) || !LANGS[lang]) continue;
    const [loc, name, quality] = id.split('-');
    out.push(v(id, `${(name || id).replace(/^./, (c) => c.toUpperCase())} · ${LANGS[lang]}${/_/.test(loc || '') ? ` (${loc.split('_')[1]})` : ''}${quality ? `, qualité ${quality}` : ''}`, lang));
  }
  return out.sort((a, b) => a.lang.localeCompare(b.lang) || a.label.localeCompare(b.label, 'fr'));
}

const works = (bin, args, run = spawnSync) => { try { return run(bin, args, { stdio: 'ignore', timeout: 8000 }).status === 0; } catch { return false; } };

/** Disponibilité des voix locales (gardée une minute : elle interroge le disque et lance les programmes). */
let localCache = null;
export function localStatus(cfg, { run = spawnSync, list = readdirSync, now = Date.now } = {}) {
  const c = localConfig(cfg);
  const key = JSON.stringify(c);
  if (localCache && localCache.key === key && localCache.at > now() - 60_000 && run === spawnSync) return localCache.value;
  const piper = c.piperVoicesDir ? piperVoices(c.piperVoicesDir, { list }) : [];
  const value = {
    piper: works(c.piperBin, [...piperArgs(c.piperBin), '--help'], run) && piper.length ? { ok: true, voices: piper } : { ok: false, voices: [] },
    espeak: works(c.espeakBin, ['--version'], run) ? { ok: true, voices: VOICE_PROVIDERS.espeak.voices } : { ok: false, voices: [] },
  };
  if (run === spawnSync) localCache = { key, at: now(), value };
  return value;
}
export const resetLocalStatus = () => { localCache = null; };

/** Lance un programme local sans shell ; renvoie ce qu'il a écrit dans le fichier de sortie. */
function localRun(bin, args, outFile, { run = spawn, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = run(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs }); } catch { return reject(new Error('Le programme de voix locale ne démarre pas')); }
    let err = '';
    child.stderr?.on('data', (d) => { err = (err + d).slice(-500); });
    child.on('error', () => reject(new Error('Le programme de voix locale ne démarre pas')));
    child.on('close', (code) => (code === 0 ? resolve(readFileSync(outFile)) : reject(new Error(`La voix locale a échoué (code ${code})`))));
  });
}

async function localSynth(provider, voice, text, { cfg = {}, run } = {}) {
  const c = localConfig(cfg);
  const dir = mkdtempSync(join(tmpdir(), 'aitools-tts-'));
  const out = join(dir, 'voix.wav');
  try {
    if (provider === 'piper') {
      if (!piperVoices(c.piperVoicesDir).some((x) => x.id === voice)) throw new Error('Cette voix Piper n\'est pas installée sur le serveur');
      return await localRun(c.piperBin, [...piperArgs(c.piperBin), '-m', voice, '--data-dir', c.piperVoicesDir, '-f', out, '--', text], out, { run });
    }
    return await localRun(c.espeakBin, ['-v', voice, '-s', '150', '-w', out, '--', text], out, { run });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Type du son produit : les voix locales rendent du WAV, les services du MP3. */
export const audioType = (buf) => (buf.subarray(0, 4).toString('latin1') === 'RIFF' ? { ext: 'wav', mime: 'audio/wav' } : { ext: 'mp3', mime: 'audio/mpeg' });

/** Texte → son (Buffer : MP3 des services, WAV des voix locales). Les erreurs réseau remontent avec le nom du service ; jamais de clé ni de texte dans le message. */
export async function synthesize({ provider, voice, text, key = null, region = null }, deps = {}) {
  const p = VOICE_PROVIDERS[provider];
  if (!p || (p.voices ? !findVoice(provider, voice) : !VOICE_ID.test(String(voice)))) throw new Error('Voix inconnue');
  if (p.keyed && !key) throw new Error(`Aucune clé API ${p.label.split(' (')[0]} : ajoute-la dans l'onglet Promotion`);
  if (p.region && !REGION.test(region)) throw new Error(`Aucune région ${p.label.split(' (')[0]} : ajoute-la dans l'onglet Promotion`);
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Texte vide');
  const run = p.local ? localSynth(provider, voice, clean, deps) : provider === 'google' ? googleSynth(clean, voice, deps)
    : provider === 'elevenlabs' ? elevenSynth(clean, voice, { ...deps, key }) : provider === 'azure' ? azureSynth(clean, voice, { ...deps, key, region }) : googleCloudSynth(clean, voice, { ...deps, key });
  const audio = await withTimeout(run, p.local ? 70_000 : VOICE.timeoutMs, `Service de voix ${p.label}`);
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
      const audio = await synth({ provider: voice.provider, voice: voice.voice, text: segments[i].text });
      const file = join(dir, `${i}.${audioType(audio).ext}`);
      writeFileSync(file, audio);
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
