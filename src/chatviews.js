// Page IA : liste des conversations à gauche, fil et zone de saisie à droite. Le fil est rendu côté serveur (réponses en Markdown déjà échappé) ;
// public/chat.js envoie les messages et affiche la réponse au fil de l'écriture.
import { esc } from './http.js';
import { ic } from './icons.js';
import { layout } from './views.js';
import { RECOMMENDED, OTHERS } from './services/models.js';

const SUPPORT_SUGGESTIONS = [
  'Comment relier mon compte Claude ?',
  'Pourquoi mes mails ne partent pas ?',
  'À quoi sert la liste de mise en route ?',
  'Comment créer une vidéo de promotion ?',
];

const SUGGESTIONS = [
  'Rédige un mail de prospection pour un artisan, en 100 mots',
  'Aide-moi à répondre à un prospect qui trouve ça trop cher',
  'Propose 5 idées de posts LinkedIn pour mon produit',
  'Comment relancer sans être insistant ?',
];

const mo = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const ICON = { pdf: 'file', text: 'file', video: 'film', project: 'folder', image: 'file' };

/** Une pièce jointe dans le fil : aperçu pour une image ou une vidéo, pastille pour le reste. public/chat.js construit les mêmes éléments. */
export const attachmentHtml = (a) => {
  if (a.kind === 'image') return `<a class="att att-img" href="/api/chat/files/${a.id}" target="_blank" rel="noopener" data-noajax><img src="/api/chat/files/${a.id}" alt="${esc(a.name)}" loading="lazy"></a>`;
  if (a.kind === 'video') return `<video class="att att-video" controls preload="metadata" src="/api/chat/files/${a.id}" aria-label="${esc(a.name)}"></video>`;
  if (a.kind === 'project') return `<span class="att att-chip att-project">${ic('folder')}<span>${esc(a.name)}</span></span>`;
  return `<a class="att att-chip" href="/api/chat/files/${a.id}" target="_blank" rel="noopener" data-noajax>${ic(ICON[a.kind] || 'file')}<span>${esc(a.name)}</span><small>${mo(a.size)}</small></a>`;
};

const bubble = (m) => (m.role === 'user'
  ? `<article class="msg user" data-id="${m.id}">${m.attachments?.length ? `<div class="atts">${m.attachments.map(attachmentHtml).join('')}</div>` : ''}<div class="bubble">${esc(m.content)}</div></article>`
  : `<article class="msg bot" data-id="${m.id}"><div class="bubble md">${m.html}</div>
      <div class="msg-actions"><button type="button" class="link small" data-chat-copy data-md="${esc(m.content)}">${ic('copy')}Copier</button></div></article>`);

// Le « $ » relatif n'apparaît qu'avec une clé API (facturée à l'usage) : avec un abonnement, on ne montre que la gamme (économe, intermédiaire…)
function modelSelect(model, priced = false) {
  const opt = (m) => `<option value="${m.id}"${m.id === model ? ' selected' : ''}>${esc(m.label)}${m.tier ? ` · ${esc(m.tier)}${priced ? ` ${m.cost}` : ''}` : ''}</option>`;
  return `<span class="sel chat-model"><select name="model" aria-label="Modèle Claude" data-chat-model>
    <optgroup label="Recommandés">${RECOMMENDED.map(opt).join('')}</optgroup>
    <optgroup label="Autres modèles">${OTHERS.map(opt).join('')}</optgroup>
  </select>${ic('down')}</span>`;
}

export function chatPage({ email, mode = 'claude', priced = false, conversations, current, messages, model, max, project = null, limits = { files: 6, maxMb: {} } }) {
  const support = mode === 'support';
  const base = support ? '/support' : '/chat';
  const list = conversations.map((c) => `<li class="${current?.id === c.id ? 'on' : ''}" data-conv="${c.id}">
      <a href="${base}/${c.id}"${current?.id === c.id ? ' aria-current="page"' : ''}>${esc(c.title)}</a>
      <button type="button" class="chat-del" data-chat-del="${c.id}" aria-label="Supprimer la conversation « ${esc(c.title)} »">${ic('trash')}</button>
    </li>`).join('');
  const body = `<div class="chat" id="chat" data-mode="${mode}" data-conv="${current ? current.id : ''}" data-max="${max}" data-files="${limits.files}" data-mb="${esc(JSON.stringify(limits.maxMb))}"${project ? ` data-project="${project.id}" data-project-name="${esc(project.name)}"` : ''}>
  <aside class="chat-side" aria-label="Conversations">
    <a class="btn primary chat-new" href="${base}">${ic('plus')}Nouvelle conversation</a>
    <ul class="chat-list" data-chat-list>${list}</ul>
    <p class="muted small chat-none"${conversations.length ? ' hidden' : ''} data-chat-none>Tes conversations apparaîtront ici.</p>
  </aside>
  <section class="chat-main" aria-label="${support ? 'Conversation avec le Support' : 'Conversation avec Claude'}">
    <header class="chat-head">
      <h1>${ic(support ? 'help' : 'spark')}${support ? 'Support' : 'Assistant IA'}</h1>
      ${modelSelect(model, priced)}
    </header>
    <div class="chat-log" id="chat-log" data-chat-log tabindex="0" aria-live="polite" aria-label="Messages">
      ${messages.length ? messages.map(bubble).join('\n') : `<div class="chat-empty" data-chat-empty>
        <div class="chat-empty-i">${ic(support ? 'help' : 'spark')}</div>
        <h2>${support ? 'Une question sur AiTools ?' : 'Discute avec Claude'}</h2>
        <p class="muted">${support
    ? "Où cliquer, comment configurer, pourquoi quelque chose ne marche pas : Claude lit la documentation d'AiTools pour te répondre. Chaque message est envoyé à Claude avec ton propre compte."
    : 'Rédaction de mails, réponses à tes prospects, idées de posts, stratégie… Chaque message est envoyé à Claude avec ton propre compte.'}</p>
        <div class="chat-ideas">${(support ? SUPPORT_SUGGESTIONS : SUGGESTIONS).map((s) => `<button type="button" class="chip" data-chat-idea>${esc(s)}</button>`).join('')}</div>
      </div>`}
    </div>
    <p class="chat-err" role="alert" data-chat-error hidden></p>
    <form class="chat-form" data-chat-form>
      <div class="chat-tray" data-chat-tray hidden></div>
      <div class="chat-row">
        <input type="file" data-chat-file multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,video/mp4,video/quicktime,video/webm,.txt,.md,.csv,.json,.log,.xml,.yml,.yaml,.html,.css,.js,.ts,.php,.py,.sql">
        <button type="button" class="btn icon-btn" data-chat-attach aria-label="Joindre une photo, une vidéo ou un fichier" title="Joindre une photo, une vidéo ou un fichier">${ic('clip')}</button>
        ${support ? '' : `<details class="chat-proj" data-chat-projmenu>
          <summary class="btn icon-btn" aria-label="Joindre un projet AiTools" title="Joindre un projet AiTools">${ic('folder')}</summary>
          <div class="chat-projlist" data-chat-projlist role="menu" aria-label="Projets AiTools"><p class="muted small">Chargement…</p></div>
        </details>`}
        <label class="sr-only" for="chat-input">Ton message</label>
        <textarea id="chat-input" name="message" rows="1" maxlength="${max}" placeholder="${support ? 'Pose ta question sur AiTools…' : 'Écris à Claude…'}  (Entrée pour envoyer, Maj+Entrée pour un retour à la ligne)" data-chat-input></textarea>
        <button class="btn primary" data-chat-send>${ic('send')}<span>Envoyer</span></button>
        <button type="button" class="btn" data-chat-stop hidden>${ic('stop')}<span>Arrêter</span></button>
      </div>
    </form>
    <p class="chat-note muted small">${support
    ? "Le Support répond d'après la documentation d'AiTools. Il ne voit ni tes projets, ni tes prospects, ni tes mails. Tu peux joindre une capture d'écran pour montrer un problème. Il peut se tromper : vérifie avant d'agir."
    : "Claude ne voit que cette conversation, et ce que tu joins : un projet AiTools (son code, en lecture seule), des photos, des PDF, des fichiers texte ou des vidéos (quelques images en sont tirées, sans le son). Il peut se tromper, vérifie avant d'envoyer."}</p>
  </section>
</div>`;
  return layout({ title: support ? 'Support' : 'IA', email, body, scripts: ['/static/chat.js'] });
}
