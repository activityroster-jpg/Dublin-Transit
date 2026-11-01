import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { NetworkData } from '../src/dart/data';

const net = JSON.parse(fs.readFileSync(new URL('../public/data/dart/network.json', import.meta.url), 'utf8')) as NetworkData;

describe('baked DART network', () => {
  it('has the four driving paths with realistic lengths', () => {
    const ids = net.paths.map((p) => p.id).sort();
    expect(ids).toEqual(['greystones-howth', 'greystones-malahide', 'howth-greystones', 'malahide-greystones']);
    for (const p of net.paths) { expect(p.length).toBeGreaterThan(43000); expect(p.length).toBeLessThan(47000); }
  });
  it('has 29 stations per path in the right order with increasing chainage', () => {
    for (const p of net.paths) {
      expect(p.stations.length).toBe(29);
      for (let i = 1; i < p.stations.length; i++) expect(p.stations[i].s).toBeGreaterThan(p.stations[i - 1].s);
    }
    const gh = net.paths.find((p) => p.id === 'greystones-howth')!;
    expect(gh.stations[0].name).toMatch(/Greystones/);
    expect(gh.stations[1].name).toMatch(/Bray/);
    expect(gh.stations[28].name).toBe('Howth');
  });
  it('matches the real Bray -> Howth distance (about 36.2 km by the GTFS shape)', () => {
    const gh = net.paths.find((p) => p.id === 'greystones-howth')!;
    const bray = gh.stations.find((s) => /Bray/.test(s.name))!, howth = gh.stations[28];
    const d = howth.s - bray.s;
    expect(d).toBeGreaterThan(35500); expect(d).toBeLessThan(37000);
  });
  it('is fully signalled with no block longer than 1.4 km', () => {
    for (const p of net.paths) {
      const mains = p.signals.filter((s) => !s.repeater).map((s) => s.s);
      for (let i = 1; i < mains.length; i++) expect(mains[i] - mains[i - 1]).toBeLessThan(1400);
    }
  });
  it('keeps the track above sea level and below Killiney Hill', () => {
    for (const p of net.paths) for (let i = 1; i < p.pts.length; i += 3) { expect(p.pts[i]).toBeGreaterThan(1); expect(p.pts[i]).toBeLessThan(60); }
  });
});
