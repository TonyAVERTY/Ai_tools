// Diagnostic des voix Microsoft Edge depuis CE serveur : réseau, horloge, poignée de main WebSocket (code et réponse de Microsoft), puis une vraie lecture.
// Lancer sur le serveur : node scripts/edge-voice-check.mjs   (ne contient et n'affiche aucun secret)
import { edgeDiagnose, edgeProbe, edgeHint, synthesize } from '../src/services/voiceover.js';

console.log(`Node ${process.version}, WebSocket intégré : ${typeof WebSocket === 'function' ? 'oui' : 'NON'}, heure du serveur : ${new Date().toISOString()}`);
const d = await edgeDiagnose();
console.log('Diagnostic :', JSON.stringify(d));
console.log('Message affiché dans l\'application :', edgeHint(d));
const probe = await edgeProbe({ skew: Math.abs(d.skew || 0) > 30_000 ? d.skew : 0 });
console.log('Poignée de main WebSocket :', probe.status ?? `erreur ${probe.error}`);
if (probe.status && probe.status !== 101) {
  console.log('En-têtes de la réponse :', JSON.stringify(probe.headers));
  console.log('Début du corps :', JSON.stringify(probe.body || ''));
}
try {
  const audio = await synthesize({ provider: 'edge', voice: 'fr-FR-DeniseNeural', text: 'Bonjour, ceci est un essai de la voix.' });
  console.log(`Lecture réussie : ${audio.length} octets d'audio MP3`);
} catch (e) { console.log('Lecture échouée :', e.message); process.exitCode = 1; }
