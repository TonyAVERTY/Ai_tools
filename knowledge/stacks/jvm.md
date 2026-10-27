---
nom: jvm
titre: Repères Java et Kotlin
langages: Java, Kotlin, Scala
---
- Build : Maven (`mvn test`, `mvn package`) ou Gradle (`./gradlew test`, `./gradlew build`) selon le fichier présent ; privilégie le wrapper du dépôt.
- Frameworks : suis les conventions de Spring Boot ou du framework présent (injection par constructeur, configuration par profils, validation des entrées).
- Tests : JUnit ; les tests d'intégration peuvent démarrer le contexte complet : dis-le quand tu en proposes un.
- Pièges : valeurs nulles, ressources non fermées, transactions mal délimitées, requêtes N+1 avec l'ORM, concurrence sur l'état partagé, sérialisation des dates.
- Migrations : Flyway ou Liquibase, ajoutées à la suite et jamais modifiées après livraison.
