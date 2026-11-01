# CLAUDE.md — Dublin Transit conventions

Browser-based driving simulator for Dublin public transport (DART first; Luas and Dublin Bus
later). TypeScript + three.js + Vite, hosted on Cloudflare Workers, deployed by GitHub Actions.
The brief is `docs/BRIEF.md`; set-up steps for Conor are `docs/SETUP.md`.

## Non-negotiables

1. **Real data only.** Track geometry, stations, platform sides, speed limits, structures and
   signals come from OpenStreetMap; the timetable from the NTA GTFS feed; heights from terrain
   tiles. Never hand-type coordinates, distances or times. If data is missing, generate it
   deterministically and **flag it** (`src: 'gen'`, `guessed: true`) so it can be replaced.
2. **Licences.** OSM is ODbL (attribution on screen, in the README and in `docs/BRIEF.md`).
   GTFS is CC BY 4.0. Textures are CC0 from Poly Haven (`public/assets/textures/CREDITS.md`).
   **Never** derive content from Google Maps / Street View imagery.
3. **No accounts, no personal data, no third-party scripts** until a feature needs them, and
   then only after a decision from Conor. The game runs fully client-side.
4. **Desktop first, mobile usable.** Every control must work by keyboard, by clicking the cab,
   and by touch (`src/ui/hud.ts` touch controls). `low` quality must stay playable on a phone.
5. **Branding.** Generic "Dublin Transit" livery and names. No Irish Rail / DART / TFI logos.

## Layout

```
scripts/data/      Node pipeline: OSM + GTFS + terrain -> public/data/dart/*  (npm run data)
scripts/assets/    CC0 texture fetch (python3 scripts/assets/fetch-textures.py)
public/data/dart/  baked data (committed; refreshed by the monthly workflow)
src/core           env/quality presets, PRNG, solar position
src/dart           data types + loaders, TrackPath/Network, service selection, DartGame (the run)
src/render         engine (sky/sun/fog/post), terrain, water, track + OLE, stations, signals,
                   buildings, streets, vegetation, people, world streaming
src/train          physics (pure), 3D model, cab
src/sim            signalling + CAWS, traffic (other timetabled trains), passengers, scoring
src/audio          procedural Web Audio
src/ui             home, DART set-up, HUD, pause, report card
tests/             vitest: physics, scoring, services, baked network invariants
```

## Conventions

- TypeScript strict, no `any`. Pure logic (physics, scoring, signalling rules, service lookup)
  stays free of three.js and DOM so it can be unit-tested.
- Scenery is streamed in `src/render/world.ts`: every item has a key, a distance and a builder;
  builders must be cheap or async. Per-item materials get `userData.perItem = true` so they are
  disposed; shared geometries get `userData.keep = true`.
- Coordinates: local metres around `ORIGIN` (53.3 N, 6.18 W). x = east, z = south, y = up.
  Chainage `s` is metres along a path from its first point.
- Data pipeline runs on GitHub (`refresh-data.yml`). Locally behind a proxy set
  `NODE_USE_ENV_PROXY=1`.
- Scoring (`src/sim/scoring.ts`) mirrors driver-selection criteria: safety & rules, reaction,
  concentration, stop accuracy, timekeeping. Keep the weights summing to 1 and SPAD capping at 20.

## Commands

- `npm run dev` — local game. `npm run build` — typecheck + production build.
- `npm test` — vitest. `npm run typecheck`.
- `npm run data` — rebuild `public/data` (network access needed).
- Deploys: every push builds, tests and deploys a preview; `main` deploys the live worker.
