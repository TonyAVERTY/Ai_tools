// Dépôts factices de plusieurs stacks et niveaux de maturité, avec ce qu'un profil correct doit y trouver (vérité terrain écrite à la main).
// Sert au test du profil de dépôt (test/repoprofile.test.js) et au banc d'essai (scripts/bench.mjs). Aucun réseau, aucun appel à Claude.
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const json = (o) => JSON.stringify(o, null, 2);

export const REPOS = {
  'web-ts': {
    label: 'Application web TypeScript (Express + React + Prisma), mature',
    files: {
      'package.json': json({ name: 'shop', type: 'module', engines: { node: '>=20' }, scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' }, dependencies: { express: '^4', react: '^18', '@prisma/client': '^5' }, devDependencies: { vitest: '^1', typescript: '^5', eslint: '^9' } }),
      'package-lock.json': '{}', 'tsconfig.json': '{}', '.eslintrc.json': '{}', '.gitignore': 'node_modules\n.env\n',
      'src/index.ts': 'export {}', 'src/auth/login.ts': 'export {}', 'src/ui/App.tsx': 'export {}',
      'tests/login.test.ts': 'export {}', 'tests/cart.test.ts': 'export {}',
      'prisma/schema.prisma': 'generator client {}', 'prisma/migrations/001_init/migration.sql': 'select 1;',
      '.github/workflows/ci.yml': 'on: push', 'README.md': '# Shop', 'CLAUDE.md': '# règles', '.env': 'SECRET=1', 'Dockerfile': 'FROM node',
    },
    expect: { languages: ['TypeScript'], frameworks: ['Express', 'React', 'Prisma', 'Vitest'], commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build', typecheck: 'npm run typecheck' }, tests: true, ci: true, db: true, instructions: ['CLAUDE.md'], frontend: true, api: true, sensitive: ['src/auth'], gapsExclude: ['pas de README'] },
  },
  'python-api': {
    label: 'API Python (FastAPI + SQLAlchemy + Alembic), outillée',
    files: {
      'pyproject.toml': '[project]\nname="api"\ndependencies=["fastapi","sqlalchemy","alembic","pydantic"]\n[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n',
      'main.py': 'print(1)', 'app/routes.py': 'x=1', 'app/security.py': 'x=1', 'tests/test_routes.py': 'def test_a(): pass',
      'alembic/versions/0001_init.py': 'x=1', 'Dockerfile': 'FROM python', 'README.md': '# api', '.gitignore': '.env\n',
    },
    expect: { languages: ['Python'], frameworks: ['FastAPI', 'SQLAlchemy', 'Alembic'], commands: { test: 'pytest', lint: 'ruff check .', typecheck: 'mypy .' }, tests: true, ci: false, db: true, instructions: [], api: true, sensitive: ['app/security.py'], gapsInclude: ['aucune intégration continue détectée'] },
  },
  'go-cli': {
    label: 'Outil CLI Go (Cobra), Makefile',
    files: {
      'go.mod': 'module x\nrequire github.com/spf13/cobra v1.8.0\n', 'cmd/main.go': 'package main', 'internal/run.go': 'package internal', 'internal/run_test.go': 'package internal',
      'Makefile': 'build:\n\tgo build ./...\ntest:\n\tgo test ./...\n', 'README.md': '# cli', '.github/workflows/test.yml': 'on: push',
    },
    expect: { languages: ['Go'], frameworks: ['Cobra'], commands: { test: 'go test ./...', build: 'go build ./...' }, tests: true, ci: true, db: false, instructions: [], entry: 'cmd/main.go' },
  },
  'php-laravel': {
    label: 'Application PHP (Laravel + PHPUnit), peu documentée',
    files: {
      'composer.json': json({ require: { 'laravel/framework': '^11' }, 'require-dev': { 'phpunit/phpunit': '^11' }, scripts: { test: 'phpunit' } }),
      'artisan': '#!/usr/bin/env php', 'app/Http/Controllers/PaymentController.php': '<?php', 'database/migrations/2024_01_01_create_users.php': '<?php', 'tests/Feature/PaymentTest.php': '<?php',
    },
    expect: { languages: ['PHP'], frameworks: ['Laravel', 'PHPUnit'], commands: { test: 'composer test' }, tests: true, ci: false, db: true, instructions: [], gapsInclude: ['pas de README'], sensitive: ['app/Http/Controllers/PaymentController.php'] },
  },
  'monorepo-js': {
    label: 'Monorepo JavaScript (workspaces pnpm)',
    files: {
      'package.json': json({ private: true, workspaces: ['packages/*'], scripts: { test: 'pnpm -r test' } }), 'pnpm-lock.yaml': '', 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/web/package.json': json({ name: 'web', dependencies: { vue: '^3' } }), 'packages/api/package.json': json({ name: 'api', dependencies: { fastify: '^4' } }),
      'packages/api/src/index.js': 'x', 'README.md': '# mono',
    },
    expect: { languages: ['JavaScript'], frameworks: ['Vue', 'Fastify'], commands: { test: 'pnpm test' }, monorepo: true, ci: false, instructions: [] },
  },
  'bare-notes': {
    label: 'Dépôt sans code reconnu (notes), à ne pas sur-interpréter',
    files: { 'notes.txt': 'idées', 'plan/semaine1.txt': 'x' },
    expect: { languages: [], frameworks: [], commands: {}, tests: false, ci: false, instructions: [], gapsInclude: ['pas de README', 'aucun langage ni manifeste reconnu : dépôt vide, documentaire ou stack non couverte'] },
  },
};

/** Écrit un dépôt factice dans un dossier temporaire (avec un .git minimal, sans commit) et renvoie son chemin. */
export function writeRepo(name, root = mkdtempSync(join(tmpdir(), 'aitools-repo-'))) {
  const dir = join(root, name);
  for (const [rel, content] of Object.entries(REPOS[name].files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
}
