---
nom: dotnet
titre: Repères .NET
langages: C#
---
- Commandes standard : `dotnet build`, `dotnet test`, `dotnet format` ; lis le fichier de solution ou de projet pour savoir quel projet concerner.
- Asynchrone : `async` de bout en bout, `CancellationToken` propagé, pas de `.Result` ni `.Wait()` bloquants.
- Données : Entity Framework avec migrations (`dotnet ef`) ; ne modifie pas une migration déjà appliquée.
- Configuration : par environnement et secrets utilisateur ; aucun secret dans appsettings versionné.
- Pièges : valeurs nulles (activer les types nullables si le projet les utilise), `IDisposable` non libéré, injection de dépendances à durée de vie incorrecte.
