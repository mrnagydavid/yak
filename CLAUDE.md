# Yak — Vocabulary Trainer PWA

## What is this?
A Progressive Web App for vocabulary training, tailored to language learning (not generic
flashcards). Offline-first, single-user, no backend in v1. Swedish ↔ English ships first.
See `SPEC.md` for the full specification.

## Tech Stack
- **Package manager:** pnpm (reproducibility via committed `pnpm-lock.yaml`)
- **Language:** TypeScript (strict)
- **Framework:** Vite + Preact
- **Styling:** CSS Modules (co-located `.module.css` files)
- **Routing:** `preact-router`
- **Linting:** oxlint
- **Local storage:** IndexedDB via Dexie.js, reactive queries via `dexie-react-hooks` + `preact/compat`
- **SRS:** FSRS via `ts-fsrs`
- **Tests:** Vitest
- **PWA:** `vite-plugin-pwa` (Workbox)

## Dependency policy (SPEC §3)
Updates are manual and explicit — no Renovate, no Dependabot. The committed `pnpm-lock.yaml`
is the lock; CI runs `pnpm install` with a frozen lockfile. Each new dependency requires
justification — prefer the standard library + small utilities over frameworks.

## Development Workflow
**Design-then-build, in turns.** We discuss each step before building it.
1. Discuss the step's scope.
2. Build after agreement.
3. Review before moving on.

## Project Structure (target — see SPEC §14)
```
src/
  main.tsx        # entry point
  app.tsx         # app shell, three-tab routing
  components/     # screens + shared UI (co-located .module.css)
  db/             # Dexie schema + queries
  srs/            # FSRS adapter + session composer
  lang/           # per-language render modules (sv, en, …)
  enrichment/     # ipa-dict + Wiktionary clients
  styles/         # global.css (design tokens, big-screen phone frame)
```

## Key Conventions
- Preact hooks from `preact/hooks`; use `preact/compat` only when a dependency needs React.
- Small, focused components; CSS Modules next to each component.
- All data through Dexie with `useLiveQuery` for reactivity.
- ULIDs for entity IDs; timestamps as unix ms (per SPEC data model).
- The user's mental model is **words**, not cards — no SRS terminology in the UI.

## Display
Mobile-first (~380px). On screens ≥580px the app renders as a centered phone-shaped frame
(`global.css` `@media (min-width: 580px)`), matching the calorie-counter pattern.

## Deployment
Push to `main` → `.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages
via `peaceiris/actions-gh-pages`. Custom domain `yak.mrnagydavid.dev` (`public/CNAME`).

## Current Phase
Core app is built: Dexie schema, FSRS scheduling, the Swedish→English seed, and the three-tab UI
(Practice / Vocabulary / Profile). Recent feature: **multi-meaning words** — a word's distinct English
meanings become separate production cards (recognition stays per-word). How the seed is built and edited
— layers, field ownership, the split/gloss/grouping passes, and re-run recipes — lives in
`SEED-PIPELINE-DESIGN.md` (see §4.8 for multi-meaning words).
