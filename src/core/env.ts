// Device detection and graphics quality presets.
export type Quality = 'low' | 'medium' | 'high';

export const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
export const isMobile = isTouch && Math.min(screen.width, screen.height) < 820;

export interface QualitySettings {
  quality: Quality;
  pixelRatio: number;
  shadowMapSize: number;
  shadowRange: number;
  viewDistance: number; // metres of detailed scenery
  treeDistance: number;
  grassDensity: number; // 0..1
  postFX: boolean;
  msaa: number;
  maxPeople: number;
}

export function qualitySettings(q: Quality): QualitySettings {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  switch (q) {
    case 'low':
      return { quality: q, pixelRatio: Math.min(dpr, 1), shadowMapSize: 1024, shadowRange: 70, viewDistance: 900, treeDistance: 450, grassDensity: 0, postFX: false, msaa: 0, maxPeople: 30 };
    case 'medium':
      return { quality: q, pixelRatio: Math.min(dpr, 1.5), shadowMapSize: 2048, shadowRange: 110, viewDistance: 1400, treeDistance: 800, grassDensity: 0.5, postFX: true, msaa: 0, maxPeople: 60 };
    default:
      return { quality: q, pixelRatio: dpr, shadowMapSize: 4096, shadowRange: 160, viewDistance: 2000, treeDistance: 1300, grassDensity: 1, postFX: true, msaa: 4, maxPeople: 120 };
  }
}

export function defaultQuality(): Quality {
  const saved = localStorage.getItem('dt.quality') as Quality | null;
  if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  return isMobile ? 'low' : isTouch ? 'medium' : 'high';
}
