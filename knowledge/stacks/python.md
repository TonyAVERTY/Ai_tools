---
nom: python
titre: Repères Python
langages: Python
---
- Environnement : pyproject.toml, requirements*.txt, Pipfile ou uv.lock disent le gestionnaire ; ne suppose pas un environnement virtuel actif et ne propose pas d'installer en global.
- Tests : pytest si configuré (pyproject, pytest.ini) ; sinon unittest. Les fixtures et conftest.py du dépôt fixent les conventions.
- Style : ruff, black, flake8, mypy seulement s'ils sont configurés ; respecte leur configuration, ne la change pas pour faire taire un avertissement.
- Pièges : valeurs par défaut mutables, imports circulaires, fuseaux horaires (naïf contre conscient), I/O bloquant dans du code asynchrone, sessions de base non fermées.
- Migrations : Alembic ou migrations Django selon le dépôt ; ne modifie jamais une migration déjà appliquée.
