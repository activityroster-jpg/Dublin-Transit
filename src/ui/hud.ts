// In-game HUD, toasts, timetable panel, pause menu, touch controls and the end-of-run report.
import { h, esc } from './dom';
import type { DartGame } from '../dart/DartGame';
import { CAMERA_LABELS } from '../dart/DartGame';
import { SUBS } from '../sim/scoring';
import { isTouch } from '../core/env';
import { NOTCH_MAX, NOTCH_MIN } from '../train/physics';

export class Hud {
  readonly root = h('div', { class: 'hud' });
  private tl = h('div', { class: 'panel tl' });
  private tr = h('div', { class: 'panel tr' });
  private bc = h('div', { class: 'panel bc' });
  private toasts = h('div', { class: 'toasts' });
  private tt = h('div', { class: 'panel tt', style: 'display:none' });
  private help = h('div', { class: 'panel help' });
  private flash = h('div', { class: 'warnflash', style: 'display:none' });
  private timer = 0;
  private touchKnob: HTMLElement | null = null;

  constructor(private game: DartGame, private onPause: () => void) {
    const top = h('div', { class: 'topbtns' },
      h('button', { class: 'iconbtn', onclick: () => game.cycleCamera() }, '🎥 View'),
      h('button', { class: 'iconbtn', onclick: () => this.toggleTT() }, '🕑 Timetable'),
      h('button', { class: 'iconbtn', onclick: onPause }, '⏸'));
    this.help.innerHTML = `<b>Controls</b><br><kbd>W</kbd>/<kbd>S</kbd> power / brake · <kbd>X</kbd> emergency<br><kbd>Space</kbd> acknowledge warning · <kbd>H</kbd> horn<br><kbd>A</kbd>/<kbd>D</kbd> release left/right doors · <kbd>C</kbd> close doors<br><kbd>1</kbd>–<kbd>5</kbd> views · drag to look · <kbd>T</kbd> timetable · <kbd>Esc</kbd> pause<br><span class="muted">In the cab you can also click the buttons on the desk.</span>`;
    this.root.append(this.flash, this.tl, this.tr, this.bc, this.tt, top, this.toasts);
    if (!isTouch) this.root.append(this.help);
    else this.root.append(this.touchControls());
    game.onMessage = (text, kind) => this.toast(text, kind);
    window.addEventListener('keydown', this.onKey);
    setTimeout(() => (this.help.style.opacity = '0.55'), 15000);
  }
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.onPause();
    if (e.key.toLowerCase() === 't') this.toggleTT();
    if (e.key === '?' || e.key === 'F1') { e.preventDefault(); this.help.style.display = this.help.style.display === 'none' ? '' : 'none'; }
  };
  dispose() { window.removeEventListener('keydown', this.onKey); this.root.remove(); }
  private toggleTT() { this.tt.style.display = this.tt.style.display === 'none' ? '' : 'none'; }

  toast(text: string, kind = 'info') {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 3) this.toasts.lastChild?.remove();
    setTimeout(() => t.remove(), kind === 'bad' ? 8000 : 5500);
  }

  update(dt: number) {
    this.timer += dt;
    const s = this.game.hud();
    this.flash.style.display = s.warning ? '' : 'none';
    if (this.timer < 0.1) return;
    this.timer = 0;
    const asp = s.aspect;
    const nx = s.next;
    this.tl.innerHTML = `<div class="muted">${esc(s.service)}</div>
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline"><div class="big">${s.clock}</div><div class="muted">${esc(CAMERA_LABELS[s.camera])}</div></div>
      ${nx ? `<div style="margin-top:6px">Next: <b>${esc(nx.name)}</b> due ${nx.arr}</div><div class="muted">${nx.dist > 0 ? `${(nx.dist / 1000).toFixed(nx.dist < 1000 ? 2 : 1)} km` : 'at platform'} · doors <b>${nx.side}</b> · ${esc(nx.delta)}</div>` : '<div>Terminus</div>'}
      ${s.boarding ? `<div style="margin-top:4px;color:#f5c400">${esc(s.boarding)}</div>` : ''}`;
    this.tr.innerHTML = `<div class="muted">Driver score</div><div class="big">${s.score}</div><div class="muted">out of 100</div>`;
    const lim = s.limit, over = s.kmh > lim + 3;
    this.bc.innerHTML = `
      <div><div class="big" style="color:${over ? '#ff6a5a' : '#fff'}">${Math.round(s.kmh)}</div><div class="muted">km/h</div></div>
      <div><div style="font-weight:800;font-size:20px">${lim}</div><div class="muted">limit${s.nextLimit ? ` · ${s.nextLimit.kmh} in ${Math.round(s.nextLimit.dist)} m` : ''}</div></div>
      <div><div style="font-weight:800;font-size:20px;color:${s.notchValue > 0 ? '#6f6' : s.notchValue < 0 ? '#fb0' : '#fff'}">${s.notch}</div><div class="muted">controller</div></div>
      <div class="aspect"><i class="${asp === 'YY' ? 'y' : ''}"></i><i class="${asp === 'G' ? 'g' : ''}"></i><i class="${asp === 'Y' || asp === 'YY' ? 'y' : ''}"></i><i class="${asp === 'R' ? 'r' : ''}"></i></div>
      <div style="font-size:12px;line-height:1.7"><span class="lamp ${s.interlock ? 'on' : ''}"></span>Doors closed<br><span class="lamp ${s.doorsL > 0.01 ? 'amber' : ''}"></span>L <span class="lamp ${s.doorsR > 0.01 ? 'amber' : ''}" style="margin-left:6px"></span>R</div>`;
    if (this.tt.style.display !== 'none') {
      this.tt.innerHTML = `<b>Timetable</b><table>${s.stops.map((r) => `<tr class="${r.state}"><td>${esc(r.name)}</td><td>${r.arr || r.dep}</td><td>${r.actual}</td></tr>`).join('')}</table>`;
    }
    if (this.touchKnob) {
      const f = (s.notchValue - NOTCH_MIN) / (NOTCH_MAX - NOTCH_MIN);
      this.touchKnob.style.top = `${(1 - f) * (260 - 40) + 3}px`;
      this.touchKnob.textContent = s.notch;
    }
  }

  private touchControls(): HTMLElement {
    const g = this.game;
    const lever = h('div', { class: 'lever' });
    const zero = (NOTCH_MAX - 0) / (NOTCH_MAX - NOTCH_MIN);
    lever.append(h('div', { class: 'mid', style: `top:${zero * 220 + 20}px` }));
    const knob = h('div', { class: 'knob' }, 'B7');
    lever.append(knob);
    this.touchKnob = knob;
    const setFromY = (y: number) => {
      const r = lever.getBoundingClientRect();
      const f = 1 - Math.max(0, Math.min(1, (y - r.top - 20) / (r.height - 40)));
      g.setNotch(NOTCH_MIN + f * (NOTCH_MAX - NOTCH_MIN));
    };
    lever.addEventListener('pointerdown', (e) => { lever.setPointerCapture(e.pointerId); setFromY(e.clientY); });
    lever.addEventListener('pointermove', (e) => { if (e.buttons) setFromY(e.clientY); });
    const b = (label: string, cls: string, fn: () => void, up?: () => void) => {
      const el = h('button', { class: cls }, label);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
      if (up) { el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); }
      return el;
    };
    const btns = h('div', { class: 'btns' },
      b('ACK', 'ack', () => g.acknowledge()), b('HORN', '', () => g.horn(true), () => g.horn(false)),
      b('◀ DOORS', '', () => g.openDoors('left')), b('DOORS ▶', '', () => g.openDoors('right')),
      b('CLOSE', '', () => g.closeDoors()), b('EMERG', 'eb', () => g.emergency()));
    return h('div', { class: 'touch' }, lever, btns);
  }
}

export function pauseMenu(onResume: () => void, onRestart: () => void, onQuit: () => void, game: DartGame): HTMLElement {
  return h('div', { class: 'modal' }, h('div', { class: 'card', style: 'max-width:420px' },
    h('h2', {}, 'Paused'),
    h('p', { class: 'tag', style: 'text-align:left;margin:6px 0 16px' }, `Score so far: ${game.score.total()}/100`),
    h('div', { class: 'row', style: 'flex-direction:column' },
      h('button', { class: 'primary', onclick: onResume }, 'Resume'),
      h('button', { class: 'ghost', onclick: onRestart }, 'Restart this service'),
      h('button', { class: 'ghost', onclick: onQuit }, 'Quit to home'))));
}

export function reportCard(game: DartGame, onRetry: () => void, onHome: () => void): HTMLElement {
  const sc = game.score;
  const total = sc.total();
  const failed = game.state === 'failed';
  const subs = SUBS.map((s) => {
    const v = Math.round(sc.sub(s.key));
    return h('div', { class: 'sub' }, h('div', {}, h('b', {}, s.label), h('div', { class: 'muted', style: 'font-size:11px;color:#9fb3aa' }, s.blurb)), h('div', { class: 'track' }, h('div', { style: `width:${v}%` })), h('b', {}, String(v)));
  });
  const done = game.stops.filter((s) => s.arrTime != null && !s.skipped).length;
  return h('div', { class: 'modal' }, h('div', { class: 'card' },
    h('div', { class: 'lbl' }, failed ? 'Run ended' : 'Run complete'),
    h('h2', {}, game.hud().service),
    failed ? h('p', { style: 'color:#ff8a7a' }, game.failReason) : null,
    h('div', { style: 'display:flex;align-items:flex-end;gap:16px;margin-top:10px' }, h('div', { class: 'scorebig' }, String(total)), h('div', {}, h('div', { class: 'muted', style: 'color:#9fb3aa' }, 'out of 100'), h('b', {}, sc.grade()))),
    h('div', { class: 'subs' }, ...subs),
    h('p', { class: 'muted', style: 'color:#9fb3aa;font-size:13px' }, `${done} of ${game.stops.length - 1} stops made · ${(game.phys.odometer / 1000).toFixed(1)} km · ${game.phys.energyKWh.toFixed(0)} kWh traction energy`),
    h('div', { class: 'events' }, ...sc.events.map((e) => h('div', { class: e.points < 0 ? 'neg' : '' }, `${fmtClock(e.t)}  ${e.text}${e.points < 0 ? ` (${e.points})` : ''}`))),
    h('div', { class: 'row', style: 'justify-content:space-between;margin-top:18px' },
      h('button', { class: 'ghost', onclick: onHome }, 'Home'),
      h('button', { class: 'primary', onclick: onRetry }, 'Drive it again'))));
}
function fmtClock(t: number) { const s = Math.round(t) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
