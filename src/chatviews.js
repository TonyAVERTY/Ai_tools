// Page IA : liste des conversations à gauche, fil et zone de saisie à droite. Le fil est rendu côté serveur (réponses en Markdown déjà échappé) ;
// public/chat.js envoie les messages et affiche la réponse au fil de l'écriture.
import { esc } from './http.js';
import { ic } from './icons.js';
import { layout } from './views.js';
import { RECOMMENDED, OTHERS } from './services/models.js';

const SUGGESTIONS = [
  'Rédige un mail de prospection pour un artisan, en 100 mots',
  'Aide-moi à répondre à un prospect qui trouve ça trop cher',
  'Propose 5 idées de posts LinkedIn pour mon produit',
  'Comment relancer sans être insistant ?',
];

const bubble = (m) => (m.role === 'user'
  ? `<article class="msg user" data-id="${m.id}"><div class="bubble">${esc(m.content)}</div></article>`
  : `<article class="msg bot" data-id="${m.id}"><div class="bubble md">${m.html}</div>
      <div class="msg-actions"><button type="button" class="link small" data-chat-copy data-md="${esc(m.content)}">${ic('copy')}Copier</button></div></article>`);

function modelSelect(model) {
  const opt = (m) => `<option value="${m.id}"${m.id === model ? ' selected' : ''}>${esc(m.label)}${m.tier ? ` · ${esc(m.tier)} ${m.cost}` : ''}</option>`;
  return `<span class="sel chat-model"><select name="model" aria-label="Modèle Claude" data-chat-model>
    <optgroup label="Recommandés">${RECOMMENDED.map(opt).join('')}</optgroup>
    <optgroup label="Autres modèles">${OTHERS.map(opt).join('')}</optgroup>
  </select>${ic('down')}</span>`;
}

export function chatPage({ email, conversations, current, messages, model, max }) {
  const list = conversations.map((c) => `<li class="${current?.id === c.id ? 'on' : ''}" data-conv="${c.id}">
      <a href="/chat/${c.id}"${current?.id === c.id ? ' aria-current="page"' : ''}>${esc(c.title)}</a>
      <button type="button" class="chat-del" data-chat-del="${c.id}" aria-label="Supprimer la conversation « ${esc(c.title)} »">${ic('trash')}</button>
    </li>`).join('');
  const body = `<div class="chat" id="chat" data-conv="${current ? current.id : ''}" data-max="${max}">
  <aside class="chat-side" aria-label="Conversations">
    <a class="btn primary chat-new" href="/chat">${ic('plus')}Nouvelle conversation</a>
    <ul class="chat-list" data-chat-list>${list}</ul>
    <p class="muted small chat-none"${conversations.length ? ' hidden' : ''} data-chat-none>Tes conversations apparaîtront ici.</p>
  </aside>
  <section class="chat-main" aria-label="Conversation avec Claude">
    <header class="chat-head">
      <h1>${ic('spark')}Assistant IA</h1>
      ${modelSelect(model)}
    </header>
    <div class="chat-log" id="chat-log" data-chat-log tabindex="0" aria-live="polite" aria-label="Messages">
      ${messages.length ? messages.map(bubble).join('\n') : `<div class="chat-empty" data-chat-empty>
        <div class="chat-empty-i">${ic('spark')}</div>
        <h2>Discute avec Claude</h2>
        <p class="muted">Rédaction de mails, réponses à tes prospects, idées de posts, stratégie… Chaque message est envoyé à Claude avec ton propre compte.</p>
        <div class="chat-ideas">${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-chat-idea>${esc(s)}</button>`).join('')}</div>
      </div>`}
    </div>
    <p class="chat-err" role="alert" data-chat-error hidden></p>
    <form class="chat-form" data-chat-form>
      <label class="sr-only" for="chat-input">Ton message</label>
      <textarea id="chat-input" name="message" rows="1" maxlength="${max}" placeholder="Écris à Claude…  (Entrée pour envoyer, Maj+Entrée pour un retour à la ligne)" data-chat-input></textarea>
      <button class="btn primary" data-chat-send>${ic('send')}<span>Envoyer</span></button>
      <button type="button" class="btn" data-chat-stop hidden>${ic('stop')}<span>Arrêter</span></button>
    </form>
    <p class="chat-note muted small">Claude n'a accès à aucune donnée d'AiTools (projets, prospects, mails) ni à Internet : il ne voit que cette conversation. Il peut se tromper, vérifie avant d'envoyer.</p>
  </section>
</div>`;
  return layout({ title: 'IA', email, body, scripts: ['/static/chat.js'] });
}
