# Contributing to NEXUS-7

Thanks for your interest in NEXUS-7. This is a small project, so the process is light.

## Dev setup

Requires Node 20 and npm.

```
npm install
npm run dev
```

`npm run dev` runs Vite and Electron together. `npm run dev:web` runs just the renderer in a browser for quick visual work (data is mocked in that mode).

## Run the checks

Before opening a pull request, make sure these pass locally:

```
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.main.json --noEmit
npm test
```

The same checks run in CI on every push and pull request (see `.github/workflows/ci.yml`).

The live data-source checks are separate and need a network:

```
npm run selftest
```

## Code style

- TypeScript strict mode. Keep types honest: no `any` to silence the compiler, prefer the shared shapes in `src/shared/types.ts`.
- Do not use em-dashes in user-facing copy (UI strings, README, docs, commit messages). Use commas, colons, or parentheses instead.
- Match the existing file structure: data adapters live under `src/main/data`, renderer panels under `src/renderer/panels`.
- The IPC data shapes in `src/shared/types.ts` are a frozen contract. Do not rename or retype a field without updating every adapter and panel that touches it.

## Proposing changes

1. Fork the repo and create a branch off the default branch.
2. Make your change, run the checks above, and add or update unit tests where it makes sense.
3. Open a pull request with a short description of what changed and why.

For anything large or structural, open an issue first so we can agree on the approach before you write the code.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened. For security issues, see [SECURITY.md](SECURITY.md) instead.
