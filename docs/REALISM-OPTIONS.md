# Every route to realism, with costs and risks

*For Conor, 1 Nov 2026. Written after two rendering passes on the code-only build. Confidence tags: [Certain] hard evidence or first-hand; [Likely] strong inference; [Guessing] filling gaps.*

## The one-paragraph answer

[Certain] The reference screenshots (Train Sim World) are the output of a team of artists working for a year with a studio asset library. No tool, including anything I have, generates that automatically. There are, however, **four things that each move the needle a lot** and that we have not used yet because they need a decision or money from you: **(1) a filmed capture of the route turned into Gaussian splats** (photographic lineside, the single biggest jump); **(2) a commissioned train and cab model** (the thing on screen 90% of the time); **(3) a scanned-asset library** (Quixel Megascans or similar) instead of the small CC0 set; **(4) Google's photoreal 3D tiles for the city and distance** (paid per player). Everything else below is incremental. The recommendation at the end sequences these.

## Where we are (so you can judge the options)

| Element | Today | Ceiling of the current approach |
|---|---|---|
| Sky, lighting | Real sky domes (6 CC0 HDRIs), sun shadows, AO on High | Already near the ceiling. Add volumetric clouds/rain for weather |
| Terrain | Satellite elevation (30 m SRTM via terrain tiles), carved to the railway, coastline mask | **Mediocre.** 30 m data smears hills onto beaches. 1 m LiDAR would transform cuttings, embankments, the sea wall |
| Track, wires, signals | Generated from the real alignment: rails, sleepers, ballast, troughs, fences, H-masts, relay cabinets | Good. Can go further with scanned ballast, weathering, proper catenary registration |
| Lineside | Card trees + scanned CC0 shrubs/grass/nettles near the track | OK at speed, weak when stopped. Needs a bigger scanned library or splats |
| Buildings | Real footprints and heights (OSM), generated facades, chimneys, kerbs | Reads as "a town", never as "Dalkey". Needs photo textures or 3D tiles |
| Stations | Correct platforms/sides, canopies, footbridges, lamps, benches, bins, CIS boards, palisade | Generic. Each real station needs an artist pass or a scan |
| Train exterior/cab | Code-built placeholder with working instruments | **This is the biggest visible gap.** Needs a modelled asset |
| Sea | Shader water, Dublin Bay / Killiney Bay correct extent | Fine. Add shoreline foam, boats |

## A. Capture-based realism (photographic, the biggest jump)

### A1. Gaussian splatting of the whole corridor from a filmed cab ride
- **What:** Film the line from the front of a DART (or a drone along the corridor where legal), reconstruct it as 3D Gaussian splats, stream the splats along the chainage, and render the train, track and dynamic objects on top. The lineside, cuttings, walls, stations and buildings then look **photographic**, because they are photographs.
- **Feasibility:** [Likely] Technically feasible in three.js in 2026: there are three.js splat renderers with camera-driven LOD streaming for large scenes (Gaussian Splat Lite, Reall3dViewer, Spark RAD/SOG formats) and MapTiler is beta-testing georeferenced city-scale "GeoSplats" streaming ([three.js forum](https://discourse.threejs.org/t/gaussian-splat-lite-1-0-webgpu-streaming-lod-and-depth-rendering-for-three-js/94234), [Reall3dViewer](https://docsearch.algolia.com/mcp/docs/repo/reall3d-com/reall3dviewer), [RadianceFields on GeoSplats](https://radiancefields.com/tags/geosplats)). Vehicle-mounted capture to splat simulators is an established research pattern ([GSAVS paper](https://arxiv.org/pdf/2412.18816)).
- **Capture requirements:** multi-camera forward + side views, a GPS/IMU track, consistent overcast light, several passes. Processing: ~45 km of corridor at a few hundred thousand splats per 100 m is tens of GB raw, compressed to roughly 1–3 GB streamed in sections [Guessing]. Hosting on R2 is fine; download per run is a few hundred MB.
- **Hard parts:** (1) the train in the footage must be masked out; (2) moving people/cars bake in as ghosts; (3) time of day is frozen at capture time, so dynamic lighting is faked by relighting (SplatGen-style relightable splats exist but are early); (4) filming from the cab needs Irish Rail permission: filming on IÉ property goes through Corporate Communications with an indemnity form and an accompanying inspector ([Iarnród Éireann filming page](https://www.irishrail.ie/about-us/filming-iarnrod-eireann-services-and-property)). Filming from the first passenger window of an 8500 (which has a front window onto the cab) is a grey area; ask.
- **Cost:** your time + a 360/GoPro rig (~€500–1,500) + a GPU for reconstruction (cloud ~€50–200) [Guessing]. Engineering: 3–6 weeks to integrate and tune.
- **Verdict:** the only route that gets the *lineside* to photographic quality without an art team. Highest reward, medium risk. The right first experiment is **one 3 km section** (Killiney–Dalkey or Booterstown–Blackrock) filmed from the front window.

### A2. Photogrammetry / LiDAR of the train and cab
- **What:** 200–400 phone photos of an 8500 at a platform plus a cab visit with a phone LiDAR scanner → a mesh in RealityCapture/Meshroom (free) → cleaned in Blender. 
- **Feasibility:** [Likely] Exterior from platforms is realistic (public, no flash, don't obstruct). The cab needs IÉ cooperation. A photogrammetry train model needs 1–2 days of cleanup to remove platform geometry and fix reflective glass.
- **Cost:** near zero cash; 2–4 days of work. **Verdict:** best value route to a real-looking exterior if a commission (B2) is off the table.

### A3. Station scans
- Same technique as A2, per station: platform, canopy, buildings. [Likely] Good results for Dún Laoghaire, Bray, Dalkey, Howth (ornate, worth it); not worth it for the identical modern halts.

### A4. Street-level imagery as *reference only*
- **Mapillary** (CC BY-SA images) is usable to *look at* while modelling and arguably to texture from, with attribution and share-alike; its service terms restrict derivative works, so get written confirmation before baking textures ([Mapillary legal](https://mapillary.com/legal), [CC BY-SA note](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data)).
- **Google Street View**: reference only, never as a texture source. [Certain]

## B. Asset-based realism (buy, commission or scan)

### B1. Scanned asset libraries
- **Quixel Megascans via Fab**: the 2024 "free for all engines" window closed; since 2025 most Megascans are paid on Fab, some free ([Epic/Fab launch](https://www.unrealengine.com/blog/fab-epics-new-unified-content-marketplace-launches-today), [CG Channel](https://www.cgchannel.com/2024/10/epic-games-has-made-megascans-free-to-all-but-only-until-the-end-of-2024/)). The Fab Standard License allows use in any engine, including a three.js web build [Likely; verify the clause on redistributing source assets in a web bundle, which is the usual sticking point for browser games]. Budget €100–400 for a lineside set (brambles, ivy, nettles, gorse, Irish hedgerow, granite sea-wall blocks, ballast, concrete).
- **Poly Haven (CC0)**: what we use now; ~500 models, a dozen useful. Free, no restrictions.
- **Other CC0/CC-BY**: Sketchfab has a CC filter but almost nothing for modern EMUs; the only CC0 train pack found is a generic metro set ([itch.io metro pack](https://elbolilloduro.itch.io/metro)). No DART model exists on any marketplace ([search](https://www.turbosquid.com/3d-models/modern-european-intercity-train-3d-model-1810687)).
- **Verdict:** B1 lifts lineside and stations one notch; it does not solve the train.

### B2. Commission the train and cab
- **What:** a freelance vehicle modeller builds the 8500 (or the new Alstom DART+) exterior and cab to game spec (glTF, PBR, ~150k tris exterior, ~100k cab, 4k textures).
- **Cost:** [Guessing] €2–5k exterior, €3–8k cab, from ArtStation/Upwork/railway-sim modding communities (the TSW/Trainz modding scene has people who do exactly this). Turnaround 4–8 weeks. You must supply photos (A2 photos double as reference).
- **Verdict:** the single most visible upgrade per euro. The cab is on screen 90% of the time.

### B3. Hero stations by an artist
- €1–4k per station [Guessing]. Do Dún Laoghaire, Bray, Howth, Connolly, Pearse, Tara Street. Leave the halts generated.

## C. Data-based realism (free or cheap, large effect on terrain and city)

### C1. 1 m LiDAR terrain
- [Likely] Geological Survey Ireland hosts OPW flood-management LiDAR as open data under CC BY 4.0 (0.13–2 m resolution depending on source), and OPW/TII data includes coastal and urban areas ([data.gov.ie Open Topographic Lidar](https://data.gov.ie/en_GB/dataset/open-topographic-lidar-data), [OPW release](https://www.gov.ie/en/office-of-public-works/press-releases/opw-releases-lidar-captured-as-part-of-flood-risk-management-projects-as-open-data)). Coverage of the exact DART corridor must be checked tile by tile. A commercial 1 m Dublin DTM (BlueSky) exists but is licensed, not open ([UCD guide](https://libguides.ucd.ie/gisguide/LiDAR)).
- **Effect:** cuttings, embankments, the sea wall, Killiney Hill and Howth Head become the real shapes; the "SRTM garbage over water" problem disappears. Our pipeline already supports swapping the elevation source.
- **Cost:** free; 2–3 days of pipeline work. **Verdict: do this regardless of anything else.**

### C2. Better buildings
- **Dublin Docklands open 3D model** (DCC/Smart Dublin): textured LOD2/LOD3 FBX, but **CC BY-NC**, so not usable in a commercial game ([Smart Dublin](https://data.smartdublin.ie/organization/about/3d-model-datalyticon), [data.gov.ie blog](https://data.gov.ie/ga/blog/unleash-the-power-of-3d-data-for-dublin)). Usable if the game stays free and non-commercial.
- **Overture Maps** buildings with heights are ODbL/CDLA; height coverage is US-lidar-derived and Dublin coverage is unverified ([Overture](https://overturemaps.org/?p=365)). Probably no better than OSM for us.
- **Tailte Éireann (OSi) aerial orthophotos**: licensed only, not open; viewable free, extracts sold ([Tailte aerial imagery](https://tailte.ie/en/surveying/products/professional-mapping/aerial-imagery-maps-and-data/)). A licence for roof textures is possible but not cheap [Guessing].
- **Procedural improvements (free):** facade kits per Dublin typology (Georgian terrace, Victorian red-brick, 1970s semi, pebble-dash bungalow, dockland glass), real window/door textures, garden walls and hedges from OSM barriers (already), trees from OSM `natural=tree` (already). One more pass here gets "generic Dublin" rather than "generic UK".

### C3. Google Photorealistic 3D Tiles for the city and distance
- **What:** stream Google's photogrammetry of Dublin for everything beyond ~150 m; keep our generated track corridor in front. three.js supports it via `3d-tiles-renderer` ([three.js example](https://threejs.org/examples/webgl_loader_3dtiles.html)).
- **Rules:** Google logo plus an aggregated data-attribution line must be rendered on screen at all times ([Google renderer rules](https://developers.google.com/maps/documentation/tile/create-renderer), [Cesium thread](https://community.cesium.com/t/google-photorealistic-tiles-copyright-attribution/23999)). Billing is per *root tile request* (a session), Enterprise SKU, tiered; pricing changed March 2025 and I could not read the current table from this session (developers.google.com is blocked here) ([billing page](https://developers.google.cn/maps/documentation/tile/usage-and-billing?hl=en)). Budget on the order of cents per player session [Guessing]; needs a Google Cloud project, API key restricted to your domain, and it ties you to Google's ToS (no caching beyond limits).
- **Look:** melted close up, convincing at 150 m+. Dublin skyline, Howth Head, Dún Laoghaire harbour and Killiney Hill would look real.
- **Verdict:** strong for the mid/far distance, zero help for the cab and lineside. Breaks the "GitHub + Cloudflare only" rule and adds a third party.

### C4. Cesium ion / Bing imagery
- Paid for commercial use (plans from ~$149/month per third-party listing), and Bing imagery is being retired ([Cesium pricing](https://cesium.com/pricing/), [Bing retirement note](https://cesium.com/platform/cesium-ion/content/bing-maps-imagery/)). **Not recommended.**

### C5. Signalling and operations data
- Irish Rail's signalling plans aren't public; OSM gives ~14 real signals per direction and we generate the rest. A cab-ride video (A1) would let us place every signal, speed board, milepost and neutral section exactly. The IÉ **Network Statement** publishes line speeds by section [Likely]; worth cross-checking our OSM speeds.

## D. Rendering-based realism (free, engineering time)

| Technique | Gain | Effort | Note |
|---|---|---|---|
| **WebGPU renderer (three.js TSL)** | Faster draw-call-heavy scenes, compute for grass/particles | 2–3 weeks | Safari 26 shipped WebGPU; Firefox still behind a flag; WebGL2 fallback exists ([migration notes](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)) |
| Cascaded shadow maps | Sharp shadows near, soft far, no shimmer | 2 days | three.js CSM addon |
| Screen-space reflections | Wet rails, train paint, glass | 3 days | High preset only |
| TAA + motion blur | TSW "look", hides aliasing on wires | 3 days | |
| Volumetric clouds / fog / rain / wet surfaces | Irish weather | 1–2 weeks | Needs the weather option on the set-up screen |
| Height fog + aerial perspective tied to HDRI | Distance realism | 1 day | |
| Vertex-animated catenary and pantograph sparks | Life | 1 day | |
| Wheel/rail audio from recordings | Sound sells realism as much as pixels | 2 days + recordings | Record on a real DART with a phone |
| Imposters/billboards for far trees and buildings | Lets us draw 3× more | 1 week | |
| Procedural ivy/bramble on walls and fences | Irish lineside look | 3 days | |
| Decals: grime, rust streaks, graffiti, ballast weeds | Cheap realism | 2 days | |
| Night: real point lights at stations, lit saloons, headlight bloom | | 1 day | |

## E. Engine-level alternatives (if the bar is non-negotiable)

| Option | Realism ceiling | Cost | Fits GitHub+Cloudflare |
|---|---|---|---|
| **Stay on three.js (WebGL2/WebGPU)** | High with assets; no Lumen/Nanite | £0 hosting | Yes |
| **Babylon.js / PlayCanvas** | Same ceiling, different ergonomics; no gain | Rewrite cost | Yes |
| **Unity Web (WebGPU)** | Slightly higher, better tooling for artists | Unity licence; 50–200 MB builds | Yes, large downloads |
| **Unreal Engine 5 streamed (Pixel Streaming)** | **Matches the reference screenshots** (Lumen, Nanite, Megascans native) | ~$0.30–1+ per concurrent player-hour on raw GPUs plus bandwidth and orchestration; managed platforms cost more ([GPU price survey](https://www.hostinger.com/tutorials/?p=158956), [CoreWeave](https://www.coreweave.com/pixel-streaming), [platform comparison](https://vagon.io/blog/best-pixel-streaming-platforms)) | **No.** Needs cloud GPUs; input lag; cost scales with players |
| **Native download (UE5/Unity desktop), website just hosts the installer** | Matches the reference | Dev time; no per-player cost | Yes for hosting the download |

[Certain] If the bar is literally "indistinguishable from Train Sim World", the honest answer is UE5 — as a **downloadable** game, with the website as the storefront. The browser constraint is what caps us, not the effort.

## F. What AI can and cannot do here (since you asked about "Claude design")

- **Can:** generate code, shaders, procedural geometry, data pipelines, facade rules, placement logic, UI, docs (this document). Generate 2D textures and decals from prompts via an image model (you'd need to pick one and check its licence for commercial use).
- **Cannot (in this session):** produce rigged, textured, game-ready 3D models of a specific train or station; run photogrammetry on your photos; film the line. There is no "Claude Design" product for 3D assets. Text-to-3D services exist (Meshy, Tripo, Luma Genie) and can give rough props, but a train or cab from them will not pass as the real thing [Likely].

## G. Recommendation (sequenced)

1. **Now, free:** 1 m LiDAR terrain (C1); procedural Dublin facade kit and weathering (C2); CSM shadows, height fog, decals, real audio recordings (D). ~2–3 weeks of my time.
2. **Now, your time:** photograph an 8500 at a platform and film one 3 km stretch from the front window (A2, A1 pilot). Ask IÉ Corporate Communications for a cab visit and a cab-ride filming slot; the worst answer is no.
3. **Decision, ~€5–13k:** commission the train exterior and cab (B2). This is what makes the game *look* like a train game.
4. **Pilot, 3–6 weeks:** Gaussian-splat the filmed 3 km and stream it (A1). If it works, extend to the whole line in sections.
5. **Optional, paid per player:** Google 3D Tiles for the far scene (C3), only if you accept the third party and the per-session cost.
6. **If the bar is still not met after 1–4:** the constraint is the browser, and the answer is UE5 downloadable (E).

Things I need from you to start step 1: nothing. For step 2: your photos and footage into the repo (`reference/`, git-ignored if large) or a shared drive. For step 3: a budget yes/no.
