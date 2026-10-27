---
nom: rust
titre: Repères Rust
langages: Rust
---
- Commandes standard : `cargo build`, `cargo test`, `cargo clippy`, `cargo fmt` ; lis le workspace (Cargo.toml) pour savoir dans quel crate travailler.
- Erreurs : `Result` propagé avec `?` ; pas de `unwrap()` ni `expect()` dans le code de production sans justification.
- Propriété et durées de vie : préfère modifier la conception à multiplier les `clone()` ou les `unsafe` ; tout `unsafe` demande un commentaire d'invariant.
- Asynchrone : un seul runtime (celui du dépôt) ; pas de code bloquant dans une tâche asynchrone.
- Dépendances : `Cargo.lock` suit la convention du dépôt (versionné pour les binaires) ; active seulement les fonctionnalités nécessaires.
