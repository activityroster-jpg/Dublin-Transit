# Lineside: what is beside the track, and how it was set

The game decides what is beside each track every 25 m, on each side, from data only
(`scripts/data/lineside.mjs`, output `public/data/dart/lineside.json`). The rules are the same
for the whole network, so the north side (Connolly to Howth and Malahide) is styled the same way as
the south, as Conor asked.

The *look* of each class was set by reviewing reference cab-ride footage of Greystones to Connolly
(Oct 2017, overcast). The footage is used as reference only: no frames, textures or 3D are taken
from it, and it is not stored in the repo.

## Classes and rules

| Class | Rule (from data) | What the game builds | Seen in the footage at |
|---|---|---|---|
| Sea | Sea within 12–20 m, or ground falling to the shore within 50 m (OSM coastline mask) | Low granite sea wall, rock armour, no fence, no vegetation | Bray Head (right), Killiney Bay, Seapoint–Blackrock, Booterstown |
| Cliff | Ground 9 m up at 20 m and 16 m up at 35 m, nobody living nearby (LiDAR + OSM buildings) | Bare rock face, sparse gorse | Bray Head (left) |
| Wall | Ground 2.4 m above rail within 7 m (LiDAR) | Granite rubble retaining wall 2–4.5 m with coping; scrub and trees above | Killiney (land side), Dalkey–Glenageary–Sandycove cuttings, Dún Laoghaire–Blackrock |
| Bank | Ground 1.8 m up or 2.5 m down at 12 m | Dense brambles, scrub and self-seeded trees right to the cess | Greystones–Bray Head, Woodbrook–Killiney, Dalkey |
| Open | Otherwise | Dark green weld-mesh fence, verge, scattered bushes | Woodbrook, Shankill, Booterstown (park), Sydney Parade, Sandymount |
| Urban | Built-up area over 15% with large footprints (OSM buildings; heights are rarely mapped here) | Tall grey palisade; portal gantries over both tracks | Docklands, Pearse–Tara Street–Connolly, East Wall |
| Station / structure / other line | Platform zones, tunnels, viaducts, the other running line | Built by the station, structure or other-track builders | – |

Overhead line: single H-section masts with cantilevers by default; steel portal gantries spanning
both tracks in urban double-track sections (built once, by the northbound line).

Weather: the footage is overcast throughout, and overcast is now the default (Sunny spells is an option).

## Checked against the footage

The classifier output for Greystones -> Connolly was compared with 78 frames sampled every 400 m.
It matches the footage section by section: cliff and sea on Bray Head, wall and sea at Killiney,
walled cuttings at Dalkey, granite walls and sea wall from Dún Laoghaire to Blackrock, open park
and sea at Booterstown, suburban fencing at Sandymount, portal gantries in the city. Known misses:
Bray yard has portal gantries in reality but is not dense enough to count as urban; a few short
walls (Blackrock noise wall) are missing because the terrain model smooths them out.

To re-tune: `LINESIDE_ONLY=1 node scripts/data/build-world.mjs` rebuilds just the classification
in about 3 minutes; `LS_URBAN_FRAC` and `LS_URBAN_SIZE` adjust the urban test.
