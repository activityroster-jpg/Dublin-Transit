# Dublin Transit

A browser-based driving simulator for Dublin public transport, starting with the **DART**
(Greystones/Bray ⇄ Howth/Malahide), built on real map, elevation and timetable data.

- **What we're building:** [`docs/BRIEF.md`](docs/BRIEF.md)
- **Cloudflare / GitHub setup:** [`docs/SETUP.md`](docs/SETUP.md)

## Develop

```bash
npm install
npm run dev        # local game at http://localhost:5173
npm run data       # rebuild public/data from OpenStreetMap, NTA GTFS and terrain tiles
npm run build      # production build into dist/
```

## Data credits

- Map data © OpenStreetMap contributors, ODbL. <https://www.openstreetmap.org/copyright>
- Timetable: National Transport Authority GTFS (Irish Rail), CC BY 4.0.
- Elevation: AWS Terrain Tiles (Mapzen/Tilezen, sources SRTM, GMTED, ETOPO1).
