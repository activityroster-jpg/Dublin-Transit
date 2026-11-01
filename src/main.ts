// App shell: home -> mode set-up -> loading -> driving -> report.
import './styles.css';
import { h } from './ui/dom';
import { dartSetup, homeScreen, type SetupResult } from './ui/home';
import { Hud, pauseMenu, reportCard } from './ui/hud';
import { loadDart, loadTimetable, type DartData, type TimetableData } from './dart/data';
import { DartGame } from './dart/DartGame';
import { qualitySettings } from './core/env';

const app = document.getElementById('app')!;
let timetable: TimetableData | null = null;
let dartData: DartData | null = null;
let current: { game: DartGame; hud: Hud; raf: number } | null = null;

function show(el: HTMLElement) { app.innerHTML = ''; app.append(el); }

function home() {
  stopGame();
  show(homeScreen(() => void dartSetupScreen()));
}

async function dartSetupScreen() {
  if (!timetable) {
    show(h('div', { class: 'loading' }, h('div', {}, 'Loading timetable…')));
    timetable = await loadTimetable();
  }
  show(dartSetup(timetable, home, (r) => void drive(r)));
}

function stopGame() {
  if (!current) return;
  cancelAnimationFrame(current.raf);
  current.hud.dispose();
  current.game.dispose();
  current = null;
}

async function drive(setup: SetupResult) {
  stopGame();
  const stage = h('div', { class: 'stage' });
  const label = h('div', {}, 'Loading…');
  const bar = h('div', {});
  const loading = h('div', { class: 'loading' },
    h('div', { style: 'font-size:22px;font-weight:800' }, 'Dublin Transit · DART'), label, h('div', { class: 'bar' }, bar),
    h('div', { class: 'tips' }, 'Tip: the platform side changes from station to station. Check the HUD before you release the doors, and only depart when the DOORS CLOSED light is on.'));
  app.innerHTML = ''; app.append(stage, loading);
  try {
    dartData ??= await loadDart((l, f) => { label.textContent = l; bar.style.width = `${f * 50}%`; }, timetable ?? undefined);
    const game = new DartGame(stage, dartData, setup.opts, setup.choice, qualitySettings(setup.quality));
    await game.load((l, f) => { label.textContent = l; bar.style.width = `${50 + f * 50}%`; });
    loading.replaceChildren(
      h('div', { style: 'font-size:22px;font-weight:800' }, game.hud().service),
      h('div', { class: 'tips' }, 'You are in the cab at the platform with the doors open. Wait for boarding, press C to close the doors, wait for the DOORS CLOSED light, then push the controller (W) to depart on time.'),
      h('button', { class: 'primary', onclick: () => { loading.remove(); begin(game, setup); } }, 'Start driving'));
    // render one frame behind the overlay so the scene is warm
    game.engine.render();
  } catch (e) {
    console.error(e);
    loading.replaceChildren(h('div', {}, `Something went wrong loading the line: ${(e as Error).message}`), h('button', { class: 'ghost', onclick: home }, 'Back'));
  }
}

function begin(game: DartGame, setup: SetupResult) {
  const stage = game.engine.renderer.domElement.parentElement!;
  let paused: HTMLElement | null = null;
  const pause = () => {
    if (paused) { paused.remove(); paused = null; game.setPaused(false); return; }
    game.setPaused(true);
    paused = pauseMenu(() => pause(), () => void drive(setup), home, game);
    stage.parentElement!.append(paused);
  };
  const hud = new Hud(game, pause);
  stage.parentElement!.append(hud.root);
  game.onEnd = (g) => { stage.parentElement!.append(reportCard(g, () => void drive(setup), home)); };
  game.start();
  if (import.meta.env.DEV) (window as unknown as { __game: DartGame }).__game = game;
  let last = performance.now();
  const tick = () => { const now = performance.now(); hud.update((now - last) / 1000); last = now; if (current) current.raf = requestAnimationFrame(tick); };
  current = { game, hud, raf: requestAnimationFrame(tick) };
}

home();
