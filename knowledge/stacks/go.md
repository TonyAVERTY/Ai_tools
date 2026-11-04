---
nom: go
titre: Repères Go
langages: Go
---
- Commandes standard : `go build ./...`, `go test ./...`, `go vet ./...` ; lis le Makefile et les workflows pour les variantes (race, tags, couverture).
- Erreurs : retournées et enveloppées (`fmt.Errorf("...: %w", err)`), jamais ignorées ; compare avec `errors.Is` / `errors.As`.
- Concurrence : tout goroutine a un arrêt (contexte, canal) ; surveille les courses de données et les canaux jamais fermés.
- Interfaces petites, définies côté consommateur ; reste dans les conventions du paquet voisin.
- Tests : fichiers `_test.go` voisins, tests pilotés par table ; respecte les helpers existants.
- Modules : `go.mod` et `go.sum` ne s'éditent pas à la main ; passe par `go get` / `go mod tidy`.
