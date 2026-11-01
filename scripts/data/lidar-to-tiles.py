"""Open Irish LiDAR (GSI / TII / OPW, CC BY 4.0) -> Terrarium PNG tiles at zoom 16 for the DART corridor.

The game pipeline reads elevation as Terrarium-encoded web-mercator tiles (see fetch-dem.mjs). This
script fills data-raw/dem/16/ from 2 m LiDAR DTMs so that cuttings, embankments, the sea wall and
the hills are real shapes instead of 30 m satellite data. Tiles are written only where LiDAR
covers at least 25% of the tile; elsewhere the JS side falls back to zoom 14.

Usage:
  python3 scripts/data/lidar-to-tiles.py [--src /tmp/lidar] [--out data-raw/dem/16]
Needs: numpy, pyproj, tifffile, pillow. Attribution (required by the licence):
  "Contains Irish Public Sector Data (Geological Survey Ireland & Transport Infrastructure Ireland /
   Office of Public Works) licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence."
"""
import argparse, io, json, math, os, zipfile
import numpy as np
from PIL import Image
from pyproj import Transformer
import tifffile

ap = argparse.ArgumentParser()
ap.add_argument('--src', default='/tmp/lidar')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'data-raw', 'dem', '16'))
ap.add_argument('--zoom', type=int, default=16)
# corridor bounding box (lon/lat) with margin: Greystones .. Malahide
ap.add_argument('--bbox', default='-6.33,53.13,-6.05,53.47')
ap.add_argument('--fetch', action='store_true', help='query the GSI coverage services and download the LiDAR zips into --src first')
args = ap.parse_args()

if args.fetch:
    import urllib.request, concurrent.futures
    os.makedirs(args.src, exist_ok=True)
    def q(url):
        req = urllib.request.Request(url, headers={'User-Agent': 'DublinTransit-data-pipeline/0.1'})
        return json.load(urllib.request.urlopen(req, timeout=180))
    # corridor envelope in ITM (EPSG:2157)
    LAYERS = {'IE_GSI_LiDAR_Coverage_TII_IE26_ITM': 0, 'IE_GSI_LiDAR_Coverage_OPW_IE26_ITM': 3, 'IE_GSI_LiDAR_Coverage_OPW_NASC_IE26_ITM': 3}
    recs = []
    for lyr, i in LAYERS.items():
        base = f'https://gsi.geodata.gov.ie/server/rest/services/Lidar/{lyr}/MapServer/{i}'
        d = q(base + '/query?where=1%3D1&geometry=712000,710000,734000,750000&geometryType=esriGeometryEnvelope&inSR=2157&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json&resultRecordCount=500')
        for f in d.get('features', []):
            a = f['attributes']
            recs.append({'layer': lyr, 'oid': a['OBJECTID'], 'name': a.get('DATA_NAME'), 'url': a.get('DATA_URL'), 'res': a.get('RESOLUTION'), 'loc': a.get('LOCATION') or a.get('COUNTY'), 'date': a.get('DATECAPTUR'), 'licence': a.get('LICENCE')})
    def ext(r):
        d = q(f"https://gsi.geodata.gov.ie/server/rest/services/Lidar/{r['layer']}/MapServer/{LAYERS[r['layer']]}/query?objectIds={r['oid']}&returnExtentOnly=true&outSR=2157&f=json")
        e = d.get('extent') or {}
        r.update({k: e.get(k) for k in ('xmin', 'ymin', 'xmax', 'ymax')})
        return r
    def dl(r):
        if not r['url']: return
        fn = os.path.join(args.src, os.path.basename(r['url']))
        if os.path.exists(fn): return
        req = urllib.request.Request(r['url'], headers={'User-Agent': 'DublinTransit-data-pipeline/0.1'})
        open(fn, 'wb').write(urllib.request.urlopen(req, timeout=900).read())
    with concurrent.futures.ThreadPoolExecutor(6) as ex:
        list(ex.map(ext, recs)); list(ex.map(dl, recs))
    json.dump(recs, open(os.path.join(args.src, 'coverage.json'), 'w'), indent=1)
    print(f'fetched {len(recs)} LiDAR tiles into {args.src}')
os.makedirs(args.out, exist_ok=True)
Z = args.zoom
lon0, lat0, lon1, lat1 = map(float, args.bbox.split(','))

cov = json.load(open(os.path.join(args.src, 'coverage.json')))
# Prefer true DTMs: TII 2 m (2011), OPW coastal 2 m (2011), OPW 2 m (2007). NYU is a DSM (buildings): skip.
# NASC (OPW coastal 2011) first: clean rasters; TII (2011) next but it uses 0.0 as nodata; OPW 2007 last.
PRIO = {'IE_GSI_LiDAR_Coverage_OPW_NASC_IE26_ITM': 0, 'IE_GSI_LiDAR_Coverage_TII_IE26_ITM': 1, 'IE_GSI_LiDAR_Coverage_OPW_IE26_ITM': 2}
tiles = [r for r in cov if r['layer'] in PRIO and r.get('xmin') is not None and r.get('url')]
tiles.sort(key=lambda r: PRIO[r['layer']])

class Raster:
    def __init__(self, rec):
        self.rec = rec
        zp = os.path.join(args.src, os.path.basename(rec['url']))
        with zipfile.ZipFile(zp) as z:
            tif = [n for n in z.namelist() if n.lower().endswith('.tif')][0]
            self.a = tifffile.imread(io.BytesIO(z.read(tif))).astype(np.float32)
        self.a[self.a < -50] = np.nan  # nodata (-99 / -3.4e38) and voids
        if 'TII' in rec['layer']:
            self.a[self.a == 0.0] = np.nan  # TII tiles use exactly 0 as nodata
        self.x0, self.y0, self.x1, self.y1 = rec['xmin'], rec['ymin'], rec['xmax'], rec['ymax']
        self.h, self.w = self.a.shape
        self.px = (self.x1 - self.x0) / self.w
        self.py = (self.y1 - self.y0) / self.h
    def sample(self, X, Y):
        """Bilinear sample at ITM coords (arrays); NaN outside or at voids. Row 0 is north."""
        fx = (X - self.x0) / self.px - 0.5
        fy = (self.y1 - Y) / self.py - 0.5
        out = np.full(X.shape, np.nan, dtype=np.float32)
        inside = (fx >= 0) & (fy >= 0) & (fx <= self.w - 1) & (fy <= self.h - 1)
        if not inside.any():
            return out
        fx = fx[inside]; fy = fy[inside]
        x0 = np.floor(fx).astype(int); y0 = np.floor(fy).astype(int)
        x1 = np.minimum(x0 + 1, self.w - 1); y1 = np.minimum(y0 + 1, self.h - 1)
        tx = fx - x0; ty = fy - y0
        a = self.a[y0, x0]; b = self.a[y0, x1]; c = self.a[y1, x0]; d = self.a[y1, x1]
        v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
        out[inside] = v
        return out

rasters = {}
def raster(rec):
    k = rec['name']
    if k not in rasters:
        rasters[k] = Raster(rec)
    return rasters[k]

to_itm = Transformer.from_crs('EPSG:4326', 'EPSG:2157', always_xy=True)

def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y
def tile_to_lonlat(x, y, z):
    n = 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat

tx0, ty1 = lonlat_to_tile(lon0, lat0, Z)
tx1, ty0 = lonlat_to_tile(lon1, lat1, Z)
tx0, ty0, tx1, ty1 = int(tx0), int(ty0), int(tx1), int(ty1)
print(f'zoom {Z}: tiles x {tx0}..{tx1} y {ty0}..{ty1} ({(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} candidates), {len(tiles)} LiDAR rasters')

T = 256
written = skipped = 0
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        # pixel-centre lon/lat grid
        xs = tx + (np.arange(T) + 0.5) / T
        ys = ty + (np.arange(T) + 0.5) / T
        n = 2 ** Z
        lons = xs / n * 360 - 180
        lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * ys / n))))
        LON, LAT = np.meshgrid(lons, lats)
        X, Y = to_itm.transform(LON, LAT)
        bx0, bx1, by0, by1 = X.min(), X.max(), Y.min(), Y.max()
        hits = [r for r in tiles if r['xmin'] < bx1 and r['xmax'] > bx0 and r['ymin'] < by1 and r['ymax'] > by0]
        if not hits:
            skipped += 1; continue
        H = np.full((T, T), np.nan, dtype=np.float32)
        for rec in hits:  # in priority order; only fill NaNs
            v = raster(rec).sample(X, Y)
            m = np.isnan(H) & ~np.isnan(v)
            H[m] = v[m]
        frac = 1 - np.isnan(H).mean()
        if frac < 0.25:
            skipped += 1; continue
        # 5x5 median (10 m): removes hedges, walls and kerbs that survive DTM filtering, keeps slopes
        pad = np.pad(H, 2, mode='edge')
        stack = np.stack([pad[dy:dy + T, dx:dx + T] for dy in range(5) for dx in range(5)])
        med = np.nanmedian(stack, axis=0)
        H = np.where(np.isnan(H), H, med)
        # Terrarium: v = (R*256 + G + B/256) - 32768 ; NaN -> the sentinel -32768 (decoded as a void by the JS side)
        v = np.where(np.isnan(H), -32768.0, H) + 32768.0
        v = np.clip(v, 0, 65535.996)
        R = np.floor(v / 256); G = np.floor(v - R * 256); B = np.floor((v - R * 256 - G) * 256)
        img = np.stack([R, G, B], axis=-1).astype(np.uint8)
        Image.fromarray(img, 'RGB').save(os.path.join(args.out, f'{tx}_{ty}.png'), optimize=True)
        written += 1
print(f'written {written}, skipped {skipped}')
