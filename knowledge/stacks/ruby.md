---
nom: ruby
titre: Repères Ruby
langages: Ruby
---
- Gestionnaire : Bundler ; `Gemfile.lock` ne s'édite pas à la main. Exécute via `bundle exec` ou les binstubs du dépôt.
- Rails : migrations dans `db/migrate` (jamais modifiées après livraison), paramètres forts dans les contrôleurs, logique métier hors des vues.
- Tests : RSpec ou Minitest selon le dépôt ; les factories et fixtures existantes fixent les conventions.
- Pièges : requêtes N+1 (`includes`), callbacks aux effets cachés, `update_all` qui saute les validations, métaprogrammation difficile à suivre.
