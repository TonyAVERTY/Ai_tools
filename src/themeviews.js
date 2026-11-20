// Carte « Affichage » de Mon compte : thème automatique (réglage du système), clair ou sombre.
import { ic } from './icons.js';

const CHOICES = [['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']];

export function themeCard(current) {
  const now = current || 'auto';
  return `<section class="card" id="affichage" aria-labelledby="h-aff">
  <div class="card-h"><h2 id="h-aff">Affichage</h2><p>Choisis le thème de l'application. « Automatique » suit le réglage de ton appareil. Ton choix est gardé dans un cookie de préférence sur ce navigateur, y compris sur la page de connexion.</p></div>
  <form method="post" action="/account/theme" class="cfg"><div class="row" role="group" aria-label="Thème">
    ${CHOICES.map(([v, l]) => `<button class="btn${v === now ? ' primary' : ''}" name="theme" value="${v}" aria-pressed="${v === now}">${v === now ? ic('check') : ''}${l}</button>`).join('\n    ')}
  </div></form>
</section>`;
}
