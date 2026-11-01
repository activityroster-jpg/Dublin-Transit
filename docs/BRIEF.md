# Dublin Transit: what we're building

*Living brief. Last updated 1 Nov 2026.*

**Current state (code-only build, no commissioned art):** see [`docs/mockups/`](mockups/) for
screenshots rendered from the game: Killiney Bay, the cab by day and night, Dún Laoghaire
platform, the Pearse viaduct, Howth harbour. Everything in them is generated from real data
plus CC0 textures and real-sky HDRIs; the train and cab are placeholders until an artist is
brought in.

## In one paragraph

**Dublin Transit** is a driving simulator for Dublin's public transport that runs in a web browser.
The first mode is the **DART**: you drive a real service from the real timetable on a 3D
model of the real line, from Greystones or Bray in the south to Howth or Malahide in the north
(or the other way). You manage the controls, watch the signals, stop at the platform mark, open the
right doors, wait for passengers to get on and off, close up, wait for the doors-closed light and
keep to time. Later modes are the **Luas Green Line**, **Luas Red Line** and **Dublin Bus routes**,
all chosen from the same home screen.

Main platform: **desktop browser**. It must also be **usable on phones and tablets**, with touch
controls and lower graphics settings.

## The quality bar, and the honest part

The target is the look of the reference screenshots (Train Sim World-style realism). Getting
there is mostly **art production**, not code:

| Part of the scene | How we get it | Can it reach the bar? |
|---|---|---|
| Track, sleepers, ballast, overhead wires and masts | Generated in code along the real track line | Yes |
| Terrain, cuttings, embankments, sea wall, coast | Real elevation data plus the coastline, shaped around the railway | Yes, close |
| Sky, sun and sky light | Real photographed sky domes (HDRIs, CC0) picked by time of day and weather, rotated to the real sun position | Yes |
| Lineside bushes and trees, haze, water | Code and shaders | Yes, close |
| Streets and buildings | Real OpenStreetMap footprints and heights, with generated facades | Good, but generic: not a copy of each real building |
| **Driver's cab interior** | Needs a 3D artist (or photos of a real cab to model from) | **Not without an artist**. Placeholder cab until then |
| **Train exterior** | Same | Good silhouette in code. Fine detail needs an artist |
| **Landmark stations** (Connolly, Dún Laoghaire, Howth, Pearse) | Hand-modelling from reference photos | Needs an artist pass |

We **do not use Google Street View**. Its terms forbid building content from its imagery.
References are OpenStreetMap, Mapillary (open-licence street photos) and our own footage.

## Home screen

```
DUBLIN TRANSIT
 ├─ DART                       ← playable
 ├─ Luas Green Line            (coming soon)
 ├─ Luas Red Line              (coming soon)
 └─ Dublin Bus                 (coming soon)

DART set-up
 ├─ Direction:   Northbound / Southbound
 ├─ From:        Greystones or Bray   (northbound)   |  Howth or Malahide (southbound)
 ├─ To:          Howth or Malahide    (northbound)   |  Bray or Greystones (southbound)
 ├─ Day + time:  pick a time, and we pick the real timetabled service nearest to it
 │               (also sets the sun position and lighting)
 └─ Traffic:     On (every other DART on the timetable runs too) / Off
```

## What you do in a DART run

1. **Start in the cab** at the platform, doors closed, at the timetabled departure time.
2. **Drive**: one combined power/brake handle (power notches, coast, service brake steps,
   emergency). The train has realistic weight, acceleration, braking and gradient resistance.
3. **Obey signals**: colour-light signals (red / single yellow / double yellow / green). A cab
   warning system sounds when you pass a restrictive signal, and you must acknowledge it within a
   few seconds or the brakes go on automatically. Passing a red is a SPAD (signal passed at
   danger) and ends the run.
4. **Obey speed limits**: real line speeds from OpenStreetMap, shown in the cab. Overspeeding is
   penalised.
5. **Stop at the platform**: stop with the front of the train at the stop mark. The score depends
   on how accurate the stop is.
6. **Doors**: release the doors on the **correct side** (the platform side changes station by
   station and comes from the real data). Passengers get off, then on. You wait. Close the doors
   and wait for the **doors-closed-and-locked light**. Traction is locked out until it's lit.
7. **Keep time**: arrival and departure are scored against the real timetable.
8. **Views**: driver's cab, outside the train (chase and orbit), trackside camera, passenger
   view, free camera.

## The real-world data (already gathered)

| Data | Source | Licence | What we got |
|---|---|---|---|
| Track geometry for all 4 DART routes | OpenStreetMap route relations 6979124–6979127 | ODbL (credit "© OpenStreetMap contributors") | Greystones→Howth **44.24 km**, Greystones→Malahide **45.52 km**, 29 stations per route, every curve as mapped |
| Line speeds, bridges, viaducts, tunnels, cuttings, embankments | OSM track tags | ODbL | e.g. Bray Head tunnels, Dalkey tunnel, the Westland Row viaduct and Loopline Bridge |
| Signals | OSM (Irish Rail signal IDs such as "BR 48") | ODbL | ~14 real signals per direction where mapped. The rest are generated at realistic spacing and flagged as such |
| Platforms and which side they're on | OSM platform areas | ODbL | Platform start and end, and the left or right side for every station stop |
| Timetable | National Transport Authority GTFS (Irish Rail feed) | CC BY 4.0 | 789 DART trips, 32 stations, valid to Oct 2027 |
| Terrain height | AWS Terrain Tiles (open data, satellite-derived) | Open | ~5 m grid near the line, coarser to the horizon |
| Sky domes | Poly Haven HDRIs (six: partly cloudy day, overcast, misty morning, low sun, sunset, night) | CC0 | Real clouds, sky light and reflections |
| Buildings, roads, walls, trees, parks, coastline | OSM | ODbL | ~63,000 buildings, 17,000 roads, 6,700 walls and fences, 93,000 trees within ~600 m of the line |

All of this is downloaded and processed by scripts in `scripts/data/`. They can be re-run any time
(for example when the timetable changes) and write ready-to-load files to `public/data/dart/`.

## Technology (kept to GitHub + Cloudflare)

- **Game**: TypeScript + three.js (3D in the browser), built with Vite.
- **Hosting**: Cloudflare Workers (static site), deployed by GitHub Actions on every push.
- **Large files later**: Cloudflare R2 storage, once the 3D art outgrows the static site.
- **No server, accounts or database for now.** Only needed if we add leaderboards or cloud saves,
  which would add GDPR obligations.
- **Secrets needed**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository
  secrets (see `docs/SETUP.md`).

## How to get past the code-only ceiling

See [`docs/REALISM-OPTIONS.md`](REALISM-OPTIONS.md): every route (filmed capture → Gaussian splats,
photogrammetry, commissioned train/cab, scanned asset libraries, 1 m LiDAR, Google 3D tiles,
rendering upgrades, engine alternatives) with cost, licence and risk, and a sequenced recommendation.

## Phases

| Phase | What's in it | Status |
|---|---|---|
| **1. Foundations** | Real data pipeline; home screen; drivable DART on the whole network with code-generated world; physics, signals, timetable, doors, passengers, camera views; desktop + touch controls; Cloudflare deploy | **In progress** |
| 2. Look | Better materials and lighting, vegetation density, weather and night, station detail pass, sound | Next |
| 3. Art | Commissioned or bought cab interior and train model; hand-built landmark stations (needs budget) | Needs a decision |
| 4. Depth | Fuller signalling (junction routes at Howth Junction and Connolly), faults, announcements, career and scoring | Later |
| 5. More modes | Luas Green, Luas Red, Dublin Bus, built the same way (OSM + NTA GTFS) | Later |

## Known limits in phase 1

- Signals are only partly real (OpenStreetMap coverage is patchy). Irish Rail's signalling plans
  aren't public.
- Track height is derived from satellite elevation data and smoothed, so gradients are close but
  not surveyed values.
- Buildings use real footprints and heights with generic facades, not each building's real look.
- Platforms are placed from map data. Connolly's platform position is estimated.
- The cab and train are code-built placeholders until there's an art budget.

## Decisions still open

1. **Train class**: currently a generic 8500-style 4-car unit.
2. **Branding**: generic "Dublin Transit" livery. Using Irish Rail or DART logos commercially needs
   their permission.
3. **Art budget** for the cab, train and landmark stations.
4. **Reference footage**: a filmed cab ride and platform walks would raise accuracy more than
   anything else.
