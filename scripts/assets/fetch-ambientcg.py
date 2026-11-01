"""High-quality CC0 PBR materials from AmbientCG (https://ambientcg.com, CC0 1.0: free for commercial
use, no attribution required; credited anyway). Downloads the 2K-JPG set of each material and writes
web-ready maps to public/assets/textures/:
    <slot>_diff.jpg    colour (sRGB)
    <slot>_nor_gl.jpg  OpenGL normal map
    <slot>_arm.jpg     packed AO (R), roughness (G), metalness (B)
plus public/assets/textures/materials.json with each material's real-world size in metres, so the
game can tile it at true scale. Re-running is cheap: downloads are cached in data-raw/ambientcg.

Run: python3 scripts/assets/fetch-ambientcg.py"""
import io, json, os, urllib.request, zipfile, concurrent.futures
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
CACHE = os.path.join(ROOT, 'data-raw', 'ambientcg')
os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'DublinTransit-assets/0.1'}

# slot -> (AmbientCG id, colour size, normal/arm size, note)
SLOTS = {
    # track and lineside
    'ballast':        ('Rocks006', 2048, 1024, 'railway ballast (angular dark granite)'),
    'cess':           ('Gravel040', 1024, 1024, 'cess / lineside gravel'),
    'concrete':       ('Concrete042A', 1024, 1024, 'sleepers, troughs, plinths'),
    'rustmetal':      ('Rust004', 1024, 512, 'rail web and foot'),
    'galvanised':     ('Metal032', 1024, 512, 'OLE masts, cantilevers'),
    'metal':          ('Metal009', 1024, 1024, 'brushed steel (cab, canopies)'),
    # buildings and walls
    'brick':          ('Bricks097', 2048, 1024, 'Victorian red brick'),
    'pebbledash':     ('Concrete037', 1024, 1024, 'roughcast / pebble-dash render'),
    'render':         ('Plaster003', 1024, 1024, 'smooth render'),
    'stonewall':      ('Bricks076A', 1024, 1024, 'granite rubble walls, sea wall, tunnels'),
    'granite':        ('Bricks108A', 1024, 1024, 'dressed granite (churches, stations)'),
    'roof':           ('RoofingTiles013A', 1024, 1024, 'Irish slate'),
    'flatroof':       ('Gravel043', 1024, 512, 'flat roofs (felt and gravel)'),
    # streets and stations
    'asphalt':        ('Asphalt025C', 1024, 1024, 'road surface'),
    'footway':        ('PavingStones111', 1024, 1024, 'concrete footpath slabs'),
    'platform':       ('PavingStones109', 2048, 1024, 'platform block paving'),
    'platformwall':   ('Concrete044A', 1024, 1024, 'platform faces and copings'),
    # vegetation
    'bark':           ('Bark012', 1024, 512, 'tree trunks'),
    # cab
    'rubber':         ('Rubber004', 512, 512, 'cab floor and desk mat'),
    'plastic':        ('Plastic018A', 512, 512, 'moulded cab panels (light grey)'),
    'fabric':         ('Fabric030', 512, 512, 'driver seat cloth'),
    # terrain layers (array texture), in layer order 0..8
    'terrain_grass':  ('Grass004', 1024, 512, 'layer 0: rough lineside grass'),
    'terrain_urban':  ('Grass003', 1024, 512, 'layer 1: gardens'),
    'terrain_forest': ('Ground078', 1024, 512, 'layer 2: leaf litter'),
    'terrain_sand':   ('Ground079S', 1024, 512, 'layer 3: sand / shore'),
    'terrain_rock':   ('Rock028', 1024, 512, 'layer 4: rock'),
    'terrain_gravel': ('Gravel043', 1024, 512, 'layer 5: formation gravel'),
    'terrain_park':   ('Grass006', 1024, 512, 'layer 6: mown park grass'),
    'terrain_farm':   ('Grass007', 1024, 512, 'layer 7: fields'),
    'terrain_paved':  ('Concrete030', 1024, 512, 'layer 8: yards and car parks'),
}

ROUGH_FLOOR = {
    'ballast': 0.6, 'cess': 0.6, 'concrete': 0.4, 'asphalt': 0.55, 'footway': 0.45, 'platform': 0.4,
    'platformwall': 0.4, 'brick': 0.45, 'pebbledash': 0.7, 'render': 0.55, 'stonewall': 0.55,
    'granite': 0.4, 'flatroof': 0.7, 'roof': 0.25, 'bark': 0.7, 'rustmetal': 0.5,
    'terrain_grass': 0.7, 'terrain_urban': 0.7, 'terrain_forest': 0.7, 'terrain_sand': 0.55,
    'terrain_rock': 0.55, 'terrain_gravel': 0.6, 'terrain_park': 0.7, 'terrain_farm': 0.7, 'terrain_paved': 0.5,
}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
        return r.read()

def info(asset):
    d = json.loads(get(f'https://ambientcg.com/api/v2/full_json?id={asset}&include=dimensionsData'))
    a = d['foundAssets'][0]
    return a

def fetch(asset):
    p = os.path.join(CACHE, f'{asset}_2K-JPG.zip')
    if not os.path.exists(p):
        open(p, 'wb').write(get(f'https://ambientcg.com/get?file={asset}_2K-JPG.zip'))
    return zipfile.ZipFile(p)

def pick(z, *keys):
    for n in z.namelist():
        base = n.rsplit('/', 1)[-1]
        if base.endswith('.jpg') and any(f'_{k}.' in base for k in keys):
            return Image.open(io.BytesIO(z.read(n)))
    return None

def build(slot):
    asset, csize, nsize, note = SLOTS[slot]
    z = fetch(asset)
    col = pick(z, 'Color')
    nor = pick(z, 'NormalGL')
    rough = pick(z, 'Roughness')
    ao = pick(z, 'AmbientOcclusion')
    metal = pick(z, 'Metalness')
    col.convert('RGB').resize((csize, csize), Image.LANCZOS).save(os.path.join(OUT, f'{slot}_diff.jpg'), quality=86, optimize=True, progressive=True)
    if nor:
        nor.convert('RGB').resize((nsize, nsize), Image.LANCZOS).save(os.path.join(OUT, f'{slot}_nor_gl.jpg'), quality=90, optimize=True)
    size = (nsize, nsize)
    R = (ao.convert('L') if ao else Image.new('L', size, 255)).resize(size, Image.LANCZOS)
    G = (rough.convert('L') if rough else Image.new('L', size, 200)).resize(size, Image.LANCZOS)
    # Scans are often shot damp or under studio light; dry outdoor surfaces in low sun glint unless
    # the roughness is lifted. Remap r -> lo + r * (1 - lo) per slot, keeping the variation.
    lo = ROUGH_FLOOR.get(slot, 0.0)
    if lo:
        G = G.point(lambda v: int(round(lo * 255 + v * (1 - lo))))
    B = (metal.convert('L') if metal else Image.new('L', size, 0)).resize(size, Image.LANCZOS)
    Image.merge('RGB', (R, G, B)).save(os.path.join(OUT, f'{slot}_arm.jpg'), quality=88, optimize=True)
    a = info(asset)
    dx, dy = a.get('dimensionX'), a.get('dimensionY')
    return slot, {'asset': asset, 'note': note, 'sizeM': [round((dx or 100) / 100, 3), round((dy or 100) / 100, 3)], 'normal': bool(nor), 'url': f'https://ambientcg.com/a/{asset}'}

with concurrent.futures.ThreadPoolExecutor(6) as ex:
    results = dict(ex.map(build, SLOTS))
json.dump(results, open(os.path.join(OUT, 'materials.json'), 'w'), indent=1)

# credits: keep any Poly Haven lines for slots we did not replace
cred = os.path.join(OUT, 'CREDITS.md')
old = open(cred).read().splitlines() if os.path.exists(cred) else []
kept = [l for l in old if l.startswith('- `') and l.split('`')[1] not in results]
lines = ['# Texture credits', '', 'AmbientCG materials are CC0 1.0 (https://ambientcg.com). Poly Haven textures are CC0.', '']
lines += [f"- `{s}`: AmbientCG \"{r['asset']}\" (CC0), {r['note']}, {r['sizeM'][0]} x {r['sizeM'][1]} m, {r['url']}" for s, r in results.items()]
lines += kept
open(cred, 'w').write('\n'.join(lines) + '\n')
for s, r in results.items():
    print(f"{s:16s} {r['asset']:18s} {r['sizeM']} m")
