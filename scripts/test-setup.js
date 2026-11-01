// Préchargé par `npm test` : la charge de la machine ne doit pas décider du résultat d'un test.
// Le worker met en pause les nouveaux jobs quand la charge (1 min) dépasse 90 % des cœurs ; sur une machine chargée
// (runner de CI, tests Chromium qui viennent de tourner) les jobs restaient « queued ». Les tests qui vérifient la pause
// injectent leur propre mesure (`load`).
import os from 'node:os';

os.loadavg = () => [0, 0, 0];
