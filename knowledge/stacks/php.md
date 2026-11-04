---
nom: php
titre: Repères PHP
langages: PHP
---
- Gestionnaire : Composer ; `composer.lock` ne s'édite pas à la main. Les scripts utiles sont dans la section « scripts » de composer.json.
- Frameworks : suis les conventions de Laravel ou Symfony quand ils sont présents (contrôleurs, requêtes validées, migrations dans le dossier prévu, configuration par environnement).
- Tests : PHPUnit (ou Pest) ; les tests de fonctionnalité utilisent souvent une base de test : ne les lance pas contre une base réelle.
- Pièges : requêtes préparées obligatoires, échappement en sortie, comparaisons lâches (== contre ===), upload de fichiers, mass assignment (champs autorisés), sessions et CSRF.
- Migrations : un fichier par changement, jamais modifié après livraison.
