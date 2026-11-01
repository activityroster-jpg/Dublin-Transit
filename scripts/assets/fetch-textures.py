"""Downloads CC0 textures from Poly Haven (https://polyhaven.com, CC0 - no attribution required,
credited anyway) and writes web-sized JPGs to public/assets/textures/.
Run: python3 scripts/assets/fetch-textures.py"""
import io, json, os, sys, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
os.makedirs(OUT, exist_ok=True)

# name in game -> (polyhaven id, maps, size)
# Most slots now come from AmbientCG (scripts/assets/fetch-ambientcg.py, higher resolution with
# roughness/AO). Poly Haven still supplies the generic ground detail normal.
TEX = {
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
