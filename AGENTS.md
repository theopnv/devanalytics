# Agent rules

Read `PLAN.md` and this file before you start a task.

## Rules

- Work only on your task. Use the branch `task/<id>` and open a PR to `main`.
- Copy from `../monfil/` and adapt the code. Do not rewrite code that works. Keep the tests that come with it and adapt them.
- Do not edit anything in `../monfil/`.
- A metric task changes only `metrics/<name>/` and the generated files. If you need a change in `core/`, stop and describe it in the PR.
- Use Conventional Commits with a lowercase subject.
- Use relative paths only, in code, comments, docs, tests and CI files.
- Write a comment only for a constraint that the code cannot show. Keep it to one line.
- Write docs in ASD-STE100 Simplified Technical English.

## Checks before a PR

Run these commands:

```
npm run sync
npm run typecheck
npm run lint
npm test
```

A task that changes the Action also runs `npm run build:action` and commits `action/dist/`.

In the PR, list the checks that you could not run.

## Commands

| Command | Use |
|---|---|
| `npm run sync` | Generate the registries and `migrations/` from `metrics/*/`. |
| `npm run typecheck` | Run `tsc --noEmit`. |
| `npm run lint` | Run ESLint. Cognitive complexity limit is 15. Cyclomatic complexity limit is 10. |
| `npm test` | Run Vitest in the Workers runtime with a local D1. |
| `npm run build:action` | Bundle the Action into `action/dist/`. |
| `npm run smoke -- <metric>…` | Run the bundled Action against `wrangler dev`. |
| `npm run backfill -- --metric <name>` | Upload old history. |
| `npm run dev` | Start the Worker on a local D1. |
| `npm run migrate:local`, `npm run migrate:remote` | Run `sync`, then apply the migrations. |
| `npm run types` | Regenerate `worker-configuration.d.ts`. Copy `.dev.vars.example` to `.dev.vars` first, or the token bindings are lost. |

CI runs the checks above, checks the PR commit messages, and fails if `sync` or `build:action` changes a file.
