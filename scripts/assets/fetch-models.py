"""Downloads CC0 scanned models (glTF, 1k textures) from Poly Haven into public/assets/models/<id>/.
Run: python3 scripts/assets/fetch-models.py"""
import json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'models')
MODELS = ['shrub_02', 'shrub_03', 'shrub_04', 'grass_medium_02', 'weed_plant_02', 'nettle_plant',
          'street_lamp_01', 'painted_wooden_bench', 'metal_trash_can', 'rock_moss_set_01']

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'DublinTransit-assets/0.1'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()

credits = []
for m in MODELS:
    files = json.loads(get(f'https://api.polyhaven.com/files/{m}'))
    g = files['gltf']
    res = '1k' if '1k' in g else sorted(g)[0]
    f = g[res]['gltf']
    d = os.path.join(OUT, m)
    os.makedirs(d, exist_ok=True)
    main = os.path.join(d, f'{m}.gltf')
    if not os.path.exists(main):
        open(main, 'wb').write(get(f['url']))
    total = 0
    for rel, info in f.get('include', {}).items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if not os.path.exists(p):
            open(p, 'wb').write(get(info['url']))
        total += os.path.getsize(p)
    print(m, res, f'{total // 1000} KB')
    credits.append(f'- `{m}`: Poly Haven (CC0) https://polyhaven.com/a/{m}')
open(os.path.join(OUT, 'CREDITS.md'), 'w').write('# Model credits\n\nAll models are CC0 from Poly Haven.\n\n' + '\n'.join(credits) + '\n')
