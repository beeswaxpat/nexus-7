# Releasing NEXUS-7

Maintainer guide for cutting a public release.

## Seeds: personal vs public

NEXUS-7 supports a first-run seed at `resources/seed-settings.json`. On first launch (no saved profile yet), the settings store reads that seed and merges it over the built-in defaults, then writes the result to `%APPDATA%\NEXUS-7\settings.json`.

Confirmed from the source (`src/main/store/settings-store.ts`, `load()` and `loadSeed()`): if `resources/seed-settings.json` is ABSENT, `loadSeed()` returns `null` and the app falls back to `defaultSettings()` from `src/shared/constants.ts`. The app boots fine with no seed present. The seed is a convenience, never a requirement. The same is true if the seed is unreadable or malformed: any failure falls through to `defaultSettings()`.

The personal seeds carry real holdings and personal box titles and are gitignored, so they never get published:

- `resources/seed-settings.json`
- `resources/seed-settings.buddy.json`
- `scripts/seed-og.json`

The neutral public demo seed is tracked: `resources/seed-settings.example.json`. It mirrors the public defaults (the default asset set and example holdings, no personal positions) and uses default box titles.

### Before a public build

You have two valid options:

1. Ship plain defaults (simplest): do nothing. With `resources/seed-settings.json` absent, the app falls back to `defaultSettings()` and boots fine. This is the recommended default for a public release.
2. Ship the neutral demo: copy the example seed into place before building.

   ```
   cp resources/seed-settings.example.json resources/seed-settings.json
   npm run build:exe
   ```

   Then delete `resources/seed-settings.json` again afterward so you do not accidentally commit it (it is gitignored, so git will not stage it, but keep your tree clean). Never copy a PERSONAL seed into a public build.

Reminder: keep personal builds local. If you build for yourself with a personal seed in place, do not upload that exe to a public release.

## Cutting a GitHub release

The release workflow (`.github/workflows/release.yml`) builds the portable exe on a version tag and attaches it to the GitHub release.

1. Make sure the default branch is green in CI.
2. Decide the seed strategy above (default: no seed, plain defaults).
3. Bump the version in `package.json` if needed and commit.
4. Tag and push:

   ```
   git tag v<version>
   git push origin v<version>
   ```

5. The `release` workflow triggers on the `v*` tag, runs on windows-latest with Node 20, runs `npm ci`, runs `npm run build:exe`, and uploads `dist/*.exe` as a release asset.
6. Open the draft or published release on GitHub, confirm `NEXUS-7-<version>.exe` is attached, and write the release notes.

## Manual fallback

If you need to build locally instead of via CI:

```
npm ci
npm run build:exe
```

The portable exe lands at `dist/NEXUS-7-<version>.exe`. Upload it manually to the GitHub release.

## Before you publish

Run through `docs/QA-CHECKLIST.md`. The unit tests and CI cover the data layer; the QA checklist covers the things only a human running the app can verify.
