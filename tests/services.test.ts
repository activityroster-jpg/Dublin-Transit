import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { findServices, pathForTrip, pathIdFor, serviceActive } from '../src/dart/services';
import type { TimetableData } from '../src/dart/data';

const tt = JSON.parse(fs.readFileSync(new URL('../public/data/dart/timetable.json', import.meta.url), 'utf8')) as TimetableData;
const monday = new Date(2026, 10, 2, 12); // 2 Nov 2026

describe('timetable services', () => {
  it('finds northbound Bray -> Howth services on a weekday, in departure order', () => {
    const list = findServices(tt, { direction: 'north', from: 'bray', to: 'howth', date: monday, timeMin: 540, traffic: true });
    expect(list.length).toBeGreaterThan(20);
    for (let i = 1; i < list.length; i++) expect(list[i].dep).toBeGreaterThanOrEqual(list[i - 1].dep);
    expect(list[0].arr).toBeGreaterThan(list[0].dep);
  });
  it('finds southbound Malahide -> Greystones services', () => {
    const list = findServices(tt, { direction: 'south', from: 'malahide', to: 'greystones', date: monday, timeMin: 540, traffic: true });
    expect(list.length).toBeGreaterThan(10);
  });
  it('maps set-up options to the right baked path', () => {
    expect(pathIdFor({ direction: 'north', from: 'bray', to: 'howth' })).toBe('greystones-howth');
    expect(pathIdFor({ direction: 'south', from: 'malahide', to: 'bray' })).toBe('malahide-greystones');
  });
  it('places every active trip on one of the four paths', () => {
    let placed = 0, total = 0;
    for (const trip of tt.trips) { if (!serviceActive(tt, trip.svc, monday)) continue; total++; if (pathForTrip(tt, trip)) placed++; }
    expect(total).toBeGreaterThan(100);
    expect(placed / total).toBeGreaterThan(0.97);
  });
});
