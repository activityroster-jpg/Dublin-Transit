"""Downloads CC0 textures from Poly Haven (https://polyhaven.com, CC0 - no attribution required,
credited anyway) and writes web-sized JPGs to public/assets/textures/.
Run: python3 scripts/assets/fetch-textures.py"""
import io, json, os, sys, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
os.makedirs(OUT, exist_ok=True)

# name in game -> (polyhaven id, maps, size)
TEX = {
    'terrain_grass':   ('sparse_grass', ['diff'], 512),
    'terrain_park':    ('sparse_grass', ['diff'], 512),
    'terrain_farm':    ('grass_ground', ['diff'], 512),
    'terrain_forest':  ('forest_floor', ['diff'], 512),
    'terrain_urban':   ('grass_ground', ['diff'], 512),
    'terrain_sand':    ('coast_sand_01', ['diff'], 512),
    'terrain_rock':    ('aerial_rocks_02', ['diff'], 512),
    'terrain_gravel':  ('gravel', ['diff'], 512),
    'terrain_paved':   ('concrete_floor', ['diff'], 512),
    'ballast':         ('gravel', ['diff', 'nor_gl', 'arm'], 1024),
    'asphalt':         ('asphalt_02', ['diff', 'nor_gl'], 1024),
    'platform':        ('rectangular_paving', ['diff', 'nor_gl'], 1024),
    'concrete':        ('concrete', ['diff', 'nor_gl'], 1024),
    'stonewall':       ('rustic_stone_wall', ['diff', 'nor_gl'], 1024),
    'brick':           ('brick_wall_001', ['diff', 'nor_gl'], 1024),
    'pebbledash':      ('pebble_embedded_concrete', ['diff', 'nor_gl'], 1024),
    'roof':            ('grey_roof_tiles', ['diff', 'nor_gl'], 1024),
    'bark':            ('bark_brown_02', ['diff'], 512),
    'rustmetal':       ('rusty_metal_02', ['diff'], 512),
    'groundnormal':    ('leafy_grass', ['nor_gl'], 1024),
}

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'DublinTransit-assets/0.1'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

credits = []
for name, (pid, maps, size) in TEX.items():
    files = json.loads(get(f'https://api.polyhaven.com/files/{pid}'))
    for m in maps:
        key = {'diff': 'Diffuse', 'nor_gl': 'nor_gl', 'arm': 'arm'}[m]
        src = files[key]['2k']['jpg']['url'] if '2k' in files[key] else files[key]['1k']['jpg']['url']
        out = os.path.join(OUT, f'{name}_{m}.jpg')
        if os.path.exists(out):
            continue
        img = Image.open(io.BytesIO(get(src))).convert('RGB').resize((size, size), Image.LANCZOS)
        img.save(out, quality=86, optimize=True, progressive=True)
        print('wrote', out)
    credits.append(f'- `{name}`: Poly Haven "{pid}" (CC0) https://polyhaven.com/a/{pid}')

with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
    f.write('# Texture credits\n\nAll textures are CC0 (public domain) from Poly Haven.\n\n' + '\n'.join(credits) + '\n')
