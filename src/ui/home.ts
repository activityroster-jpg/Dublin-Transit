// Home screen (choose a mode) and the DART set-up screen.
import { h } from './dom';
import { END_NAMES, findServices, fmtTime, servicesNear, type Direction, type End, type RunOptions, type ServiceChoice } from '../dart/services';
import type { TimetableData } from '../dart/data';
import { defaultQuality, type Quality } from '../core/env';

const LOGO = `<svg class="logo" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b6b4b"/><path d="M14 40h36M18 46l-4 6M46 46l4 6" stroke="#fff" stroke-width="4" stroke-linecap="round"/><rect x="16" y="12" width="32" height="28" rx="6" fill="#fff"/><rect x="21" y="17" width="22" height="10" rx="2" fill="#0b6b4b"/><circle cx="23" cy="34" r="2.5" fill="#f5c400"/><circle cx="41" cy="34" r="2.5" fill="#f5c400"/></svg>`;

const FOOT = () => h('div', { class: 'foot', html: 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL) · Timetable: National Transport Authority GTFS (CC BY 4.0) · Contains Irish Public Sector Data (Geological Survey Ireland &amp; Transport Infrastructure Ireland / OPW) licensed under CC BY 4.0 · Textures, skies and models: Poly Haven (CC0).<br>Dublin Transit is an independent simulator and is not affiliated with Iarnród Éireann / Irish Rail or Transport Infrastructure Ireland.' });

export function homeScreen(onDart: () => void): HTMLElement {
  const mode = (title: string, desc: string, colour: string, live: boolean, onClick?: () => void) =>
    h('button', { class: 'mode', disabled: !live, onclick: onClick },
      h('div', { class: 'stripe', style: `background:${colour}` }),
      h('span', { class: `badge ${live ? '' : 'soon'}` }, live ? 'PLAY' : 'COMING SOON'),
      h('h2', {}, title), h('p', {}, desc));
  return h('div', { class: 'screen' },
    h('div', { class: 'brand', html: `${LOGO}<h1>Dublin Transit</h1>` }),
    h('p', { class: 'tag' }, 'Drive Dublin’s real routes on real timetables. Pick what you want to drive.'),
    h('div', { class: 'modes' },
      mode('DART', 'Greystones · Bray ⇄ Howth · Malahide. The coastal electric railway, every station, real signals and timetable.', '#13a06f', true, onDart),
      mode('Luas Green Line', 'Broombridge ⇄ Brides Glen street running and segregated tram line.', '#00a651', false),
      mode('Luas Red Line', 'The Point / Saggart / Tallaght through the city centre.', '#e2231a', false),
      mode('Dublin Bus', 'Selected city routes with real stops and schedules.', '#f5c400', false),
    ),
    FOOT());
}

export interface SetupResult { opts: RunOptions; choice: ServiceChoice; quality: Quality }

export function dartSetup(tt: TimetableData, onBack: () => void, onStart: (r: SetupResult) => void): HTMLElement {
  const now = new Date();
  const st = { direction: 'north' as Direction, from: 'bray' as End, to: 'howth' as End, date: now, timeMin: now.getHours() * 60 + now.getMinutes(), traffic: true, quality: defaultQuality(), chosen: null as ServiceChoice | null };
  const root = h('div', { class: 'screen' });
  const render = () => {
    root.innerHTML = '';
    const seg = <T extends string>(vals: [T, string][], cur: T, set: (v: T) => void) =>
      h('div', { class: 'seg' }, ...vals.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', onclick: () => { set(v); st.chosen = null; render(); } }, l)));
    const fromOpts: [End, string][] = st.direction === 'north' ? [['greystones', 'Greystones'], ['bray', 'Bray']] : [['howth', 'Howth'], ['malahide', 'Malahide']];
    const toOpts: [End, string][] = st.direction === 'north' ? [['howth', 'Howth'], ['malahide', 'Malahide']] : [['bray', 'Bray'], ['greystones', 'Greystones']];
    if (!fromOpts.some(([v]) => v === st.from)) st.from = fromOpts[1][0];
    if (!toOpts.some(([v]) => v === st.to)) st.to = toOpts[0][0];
    const opts: RunOptions = { direction: st.direction, from: st.from, to: st.to, date: st.date, timeMin: st.timeMin, traffic: st.traffic };
    const all = findServices(tt, opts);
    const near = servicesNear(all, st.timeMin, 8);
    if (!st.chosen || !near.includes(st.chosen)) st.chosen = near[0] ?? null;
    const dateStr = `${st.date.getFullYear()}-${String(st.date.getMonth() + 1).padStart(2, '0')}-${String(st.date.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(Math.floor(st.timeMin / 60)).padStart(2, '0')}:${String(st.timeMin % 60).padStart(2, '0')}`;
    root.append(
      h('div', { class: 'brand', html: `${LOGO}<h1>DART</h1>` }),
      h('div', { class: 'card' },
        h('div', { class: 'lbl' }, 'Direction'),
        h('div', { class: 'row' }, seg([['north', 'Northbound'], ['south', 'Southbound']], st.direction, (v) => { st.direction = v; if (v === 'north') { st.from = 'bray'; st.to = 'howth'; } else { st.from = 'howth'; st.to = 'bray'; } })),
        h('div', { class: 'lbl' }, 'From'),
        h('div', { class: 'row' }, seg(fromOpts, st.from, (v) => (st.from = v))),
        h('div', { class: 'lbl' }, 'To'),
        h('div', { class: 'row' }, seg(toOpts, st.to, (v) => (st.to = v))),
        h('div', { class: 'lbl' }, 'Day and time of day'),
        h('div', { class: 'row' },
          h('input', { type: 'date', value: dateStr, min: tt.feedStart.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'), max: tt.feedEnd.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) { const [y, m, d] = v.split('-').map(Number); st.date = new Date(y, m - 1, d, 12); st.chosen = null; render(); } } }),
          h('input', { type: 'time', value: timeStr, onchange: (e: Event) => { const [hh, mm] = (e.target as HTMLInputElement).value.split(':').map(Number); st.timeMin = hh * 60 + mm; st.chosen = null; render(); } }),
          seg([['0', 'Dawn'], ['1', 'Morning peak'], ['2', 'Midday'], ['3', 'Evening'], ['4', 'Night']] as [string, string][], '', (v) => { st.timeMin = [6 * 60 + 10, 8 * 60, 12 * 60 + 30, 17 * 60 + 30, 21 * 60 + 45][+v]; }),
        ),
        h('div', { class: 'lbl' }, `Real services: ${END_NAMES[st.from]} → ${END_NAMES[st.to]} (${all.length} today)`),
        near.length ? h('div', { class: 'services' }, ...near.map((c) => h('button', { class: `svc ${c === st.chosen ? 'on' : ''}`, onclick: () => { st.chosen = c; render(); } },
          h('b', {}, fmtTime(c.dep)), h('span', {}, `arr ${fmtTime(c.arr)} · ${c.toIdx - c.fromIdx} stops · ${c.trip.code || c.trip.id.split('_')[1]}`)))) :
          h('p', { class: 'tag' }, 'No services for this combination on this day. Try another day or end point.'),
        h('div', { class: 'lbl' }, 'Other traffic'),
        h('div', { class: 'row' }, seg([['on', 'On: every other DART runs too'], ['off', 'Off: clear line']] as ['on' | 'off', string][], st.traffic ? 'on' : 'off', (v) => (st.traffic = v === 'on'))),
        h('div', { class: 'lbl' }, 'Graphics'),
        h('div', { class: 'row' }, seg([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as [Quality, string][], st.quality, (v) => { st.quality = v; localStorage.setItem('dt.quality', v); })),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:22px' },
          h('button', { class: 'ghost', onclick: onBack }, '← Back'),
          h('button', { class: 'primary', disabled: !st.chosen, onclick: () => st.chosen && onStart({ opts, choice: st.chosen, quality: st.quality }) }, st.chosen ? `Drive the ${fmtTime(st.chosen.dep)} →` : 'Choose a service')),
      ),
      FOOT());
  };
  render();
  return root;
}
