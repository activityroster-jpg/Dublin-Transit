# Dublin Transit

A browser-based driving simulator for Dublin public transport, starting with the **DART**
(Greystones/Bray ⇄ Howth/Malahide), built on real map, elevation and timetable data.

- **What we're building:** [`docs/BRIEF.md`](docs/BRIEF.md)
- **Cloudflare / GitHub setup:** [`docs/SETUP.md`](docs/SETUP.md)

## Develop

```bash
npm install
npm run dev        # local game at http://localhost:5173
npm run data:lidar # fetch open Irish LiDAR and bake 2 m elevation tiles (python3, numpy, pyproj, tifffile, pillow)
npm run data       # rebuild public/data from OpenStreetMap, NTA GTFS, LiDAR and terrain tiles
npm run build      # production build into dist/
```

## Data credits

- Map data © OpenStreetMap contributors, ODbL. <https://www.openstreetmap.org/copyright>
- Timetable: National Transport Authority GTFS (Irish Rail), CC BY 4.0.
- Elevation: Contains Irish Public Sector Data (Geological Survey Ireland & Transport Infrastructure Ireland / Office of Public Works) licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence; AWS Terrain Tiles (SRTM/GMTED) elsewhere.
- Materials: [AmbientCG](https://ambientcg.com) (CC0) — scanned PBR sets with colour, normal, roughness and AO (`npm run assets:materials`).
- Sky HDRIs, scanned plants and street furniture: [Poly Haven](https://polyhaven.com) (CC0). See `public/assets/*/CREDITS.md` and `public/assets/sky/skies.json`.
