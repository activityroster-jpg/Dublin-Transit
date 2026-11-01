"""Converts Poly Haven CC0 'pure sky' HDRIs into game assets:
   public/assets/sky/<id>.jpg   4096x2048 tonemapped background
   public/assets/sky/<id>_1k.hdr  lighting probe
   public/assets/sky/skies.json   manifest with the sun position found in each HDRI
Needs the 4k and 1k .hdr files in a source directory (default /tmp/hdri). Run:
   python3 scripts/assets/build-skies.py [srcdir]"""
import json, os, subprocess, sys, shutil
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'sky')
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/hdri'
os.makedirs(OUT, exist_ok=True)

SKIES = [
    # id, polyhaven name, kind, exposure (background bake), notes
    ('day_partly', 'kloofendal_48d_partly_cloudy_puresky', 'day', 1.0),
    ('day_overcast', 'kloofendal_overcast_puresky', 'overcast', 1.4),
    ('morning_mist', 'kloofendal_misty_morning_puresky', 'mist', 1.3),
    ('golden', 'kloppenheim_06_puresky', 'lowsun', 1.6),
    ('sunset', 'belfast_sunset_puresky', 'sunset', 1.8),
    ('night', 'kloppenheim_02_puresky', 'night', 1.0),
]

def read_hdr(path):
    """Radiance RGBE reader (new-style RLE scanlines), returns float32 HxWx3."""
    with open(path, 'rb') as f:
        data = f.read()
    pos = 0
    w = h = None
    while True:
        end = data.index(b'\n', pos)
        line = data[pos:end].decode('latin1').strip(); pos = end + 1
        if line.startswith('-Y'):
            parts = line.split(); h = int(parts[1]); w = int(parts[3]); break
    buf = np.frombuffer(data, dtype=np.uint8, offset=pos)
    out = np.empty((h, w, 4), dtype=np.uint8)
    i = 0
    for y in range(h):
        if buf[i] == 2 and buf[i + 1] == 2 and (int(buf[i + 2]) << 8 | int(buf[i + 3])) == w:
            i += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = int(buf[i]); i += 1
                    if n > 128:
                        n -= 128; out[y, x:x + n, c] = buf[i]; i += 1; x += n
                    else:
                        out[y, x:x + n, c] = buf[i:i + n]; i += n; x += n
        else:
            out[y] = buf[i:i + w * 4].reshape(w, 4); i += w * 4
    e = out[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0).astype(np.float32)
    return out[..., :3].astype(np.float32) * scale[..., None]

def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)

manifest = []
for sid, name, kind, exposure in SKIES:
    src4 = os.path.join(SRC, f'{name}_4k.hdr'); src1 = os.path.join(SRC, f'{name}_1k.hdr')
    img = read_hdr(src4)
    # sun: brightest 0.02% of pixels in the 4k
    lum = img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722
    thr = np.quantile(lum, 0.9998)
    ys, xs = np.nonzero(lum >= thr)
    h, w = lum.shape
    sun_u = (xs.mean() + 0.5) / w; sun_v = (ys.mean() + 0.5) / h
    # equirect: u=0.5 is the image centre (-z in three.js convention), v from top
    sun_az = (sun_u - 0.5) * 2 * np.pi  # radians, positive = to the right of centre
    sun_el = (0.5 - sun_v) * np.pi
    # mean brightness of the upper hemisphere (for ambient estimate)
    upper = lum[: h // 2].mean()
    tm = aces(img * exposure) ** (1 / 2.2)
    Image.fromarray((tm * 255).astype(np.uint8)).save(os.path.join(OUT, f'{sid}.jpg'), quality=82, optimize=True, progressive=True)
    shutil.copy(src1, os.path.join(OUT, f'{sid}_1k.hdr'))
    manifest.append({'id': sid, 'kind': kind, 'source': name, 'sunAz': round(float(sun_az), 4), 'sunEl': round(float(sun_el), 4), 'sunStrength': round(float(thr / max(upper, 1e-6)), 1), 'upperMean': round(float(upper), 4), 'exposure': exposure})
    print(sid, 'sun az %.1f° el %.1f°' % (np.degrees(sun_az), np.degrees(sun_el)), 'upper mean %.3f' % upper, 'peak/mean %.0f' % (thr / upper))
with open(os.path.join(OUT, 'skies.json'), 'w') as f:
    json.dump({'credit': 'Poly Haven (CC0) https://polyhaven.com/hdris', 'skies': manifest}, f, indent=1)
