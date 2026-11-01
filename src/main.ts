import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sound } from './audio';
import { CEILING, LAUNCH, THIN_AIR, type PlaneStats, PERFECT_BONUS } from './config';
import { createFlight, stepFlight, type FlightInput, type FlightState, ringBoost, SKIM_HEIGHT } from './flight';
import { Altimeter, Speedo } from './gauges';
import { Hangar, type Career } from './hangar';
import { Particles } from './particles';
import { SpeedLines } from './speedlines';
import { gustAt, makeAir, roughness, type Air } from './air';
import { Pickups } from './pickups';
import { Obstacles } from './obstacles';
import { createPlaneMesh, type PlaneModel } from './planeModel';
import { computeStats, partsOf, type Levels, type Upgrade } from './upgrades';
import { BIOMES, LEVELS } from './biomes';
import { LevelMap } from './levelmap';
import { countStars, starReward, starRow, starsFrom, challengesFor } from './stars';
import {
  Scenery, Trail, createGround, createHorizon, createSky, createSlingshot, followGround, paintGround, paintSky, type Slingshot,
} from './world';

type GameState = 'title' | 'hangar' | 'map' | 'aim' | 'flying' | 'result';

// ---------- Save data ----------
const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(`sling-plane:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(`sling-plane:${key}`, JSON.stringify(v));
  } catch {}
};
// Personal best per map; `best` is always the current map's
let bests = load<Record<string, number> | null>('bests', null);
let best = 0;
let wallet = load('coins', 0);
let levels: Levels = load('levels', {});
let levelIndex = Math.min(load('level', -1), LEVELS.length - 1);
const level = () => LEVELS[levelIndex];
if (!bests || levelIndex < 0) {
  // Saves from before the 25-level campaign: start at the first level of the biome you'd reached,
  // keep coins and upgrades
  levelIndex = Math.min(load('biome', 0), BIOMES.length - 1) * LEVELS.length / BIOMES.length;
  bests = {};
  save('bests', bests);
  save('level', levelIndex);
}
// The furthest level you've reached; levelIndex is whichever one you've picked to fly
let unlocked = Math.max(levelIndex, load('unlocked', levelIndex));
// Stars per level as a bitmask (bit i = challenge i)
let stars = load<Record<string, number>>('stars', {});
const syncBest = () => (best = bests![level().id] ?? 0);
syncBest();
if (levels.gear) {
  wallet += [0, 30, 180, 780][levels.gear] ?? 0;
  delete levels.gear;
  save('coins', wallet);
  save('levels', levels);
}

// ---------- Renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xffffff, 160, 600);
const fog = scene.fog as THREE.Fog;

// Soft studio reflections for the plane's metal and glass
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);

const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 800 });
const SUN_DIR = new THREE.Vector3(-30, 70, 40).normalize().multiplyScalar(450);
scene.add(sun, sun.target);

const sky = createSky();
const horizon = createHorizon();
scene.add(sky, horizon);
const ground = createGround();
scene.add(ground);
const scenery = new Scenery(scene);
const pickups = new Pickups(scene);
const obstacles = new Obstacles(scene);
const trails = [new Trail(scene), new Trail(scene)];
const speedLines = new SpeedLines(document.getElementById('speed-lines') as HTMLCanvasElement);
const smoke = new Particles(scene, 240, false);
const sparks = new Particles(scene, 160, true);
const sound = new Sound();

// ---------- Biomes ----------
let paintedBiome = -1;
function applyBiome() {
  if (paintedBiome === level().theme) return;
  paintedBiome = level().theme;
  const b = level();
  (scene.background as THREE.Color).set(b.horizon);
  fog.color.set(b.horizon);
  hemi.color.set(b.hemi[0]);
  hemi.groundColor.set(b.hemi[1]);
  sun.color.set(b.sun);
  paintSky(sky, horizon, b);
  paintGround(ground, b);
  scenery.setBiome(b);
}
applyBiome();

const previewDots: THREE.Mesh[] = [];
{
  const geo = new THREE.SphereGeometry(0.15, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 40; i++) {
    const d = new THREE.Mesh(geo, mat);
    d.visible = false;
    previewDots.push(d);
    scene.add(d);
  }
}

// ---------- Plane & slingshot (rebuilt whenever upgrades change) ----------
let stats: PlaneStats = computeStats(levels);
let model: PlaneModel = createPlaneMesh(partsOf(levels));
let slingshot: Slingshot = createSlingshot(stats.pocketHeight);
const pocket = new THREE.Vector3(0, stats.pocketHeight, 0);
scene.add(model.group, slingshot.group);

function applyLevels() {
  stats = computeStats(levels);
  scene.remove(model.group, slingshot.group);
  model = createPlaneMesh(partsOf(levels));
  slingshot = createSlingshot(stats.pocketHeight);
  pocket.y = stats.pocketHeight;
  scene.add(model.group, slingshot.group);
  parkPlane();
}

function parkPlane() {
  model.group.position.copy(pocket);
  model.group.rotation.set(0, aim.yaw, LAUNCH.pitch);
  slingshot.updateBand(pocket);
}

// ---------- HUD ----------
const $ = (id: string) => document.getElementById(id)!;
const hud = {
  root: $('hud'), dist: $('dist'), best: $('best'), coins: $('coins'),
  hint: $('hint'), power: $('power'), powerFill: $('power-fill'), powerSweet: $('power-sweet'),
  fuel: $('fuel'), fuelFill: $('fuel-fill'), boostBtn: $('boost-btn'), rocketFill: $('rocket-fill'),
  hangarBtn: $('hangar-btn'), mapBtn: $('map-btn'), goalStars: $('goal-stars'), hangarBadge: $('hangar-badge'), resultBadge: $('result-badge'),
  speedo: $('speedo'), altimeter: $('altimeter'), mute: $('mute'),
  statsPill: $('stats-pill'), goal: $('goal'), goalName: $('goal-name'), goalTarget: $('goal-target'), goalFill: $('goal-fill'), goalBest: $('goal-best'), goalBestLabel: $('goal-best-label'), goalGhost: $('goal-ghost'),
};
const titleEl = $('title');
const resultEl = $('result');
const hangarEl = $('hangar');
const mapEl = $('map');
const speedo = new Speedo(hud.speedo as unknown as SVGSVGElement);
const altimeter = new Altimeter(hud.altimeter);
hud.best.textContent = best.toLocaleString();
updateTitle();

let hintTimer = 0;
function showHint(text: string, seconds = 0) {
  hud.hint.textContent = text;
  hud.hint.style.opacity = '1';
  clearTimeout(hintTimer);
  if (seconds) hintTimer = window.setTimeout(() => (hud.hint.style.opacity = '0'), seconds * 1000);
}
const hideHint = () => (hud.hint.style.opacity = '0');

// Screen-edge glow: a steady warning (stall) and one-off flashes (perfect launch, records)
const edgeWarn = $('edge-warn');
const edgeFlashEl = $('edge-flash');
function setEdgeWarn(level: 'none' | 'near' | 'stall') {
  edgeWarn.classList.toggle('near', level === 'near');
  edgeWarn.classList.toggle('stall', level === 'stall');
}
function edgeFlash(color: string) {
  edgeFlashEl.style.setProperty('--flash', color);
  edgeFlashEl.classList.remove('go');
  void edgeFlashEl.offsetWidth; // restart the CSS animation
  edgeFlashEl.classList.add('go');
}

function updateBadges() {
  const n = hangar.affordable();
  for (const b of [hud.hangarBadge, hud.resultBadge]) {
    b.textContent = String(n);
    b.classList.toggle('hidden', n === 0);
  }
}

/** Animate a number counting up, for the results screen. */
function countUp(el: HTMLElement, from: number, to: number, ms: number, prefix = '') {
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = prefix + Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const vibrate = (ms: number) => navigator.vibrate?.(ms);

sound.muted = load('muted', false);
hud.mute.classList.toggle('muted', sound.muted);
hud.mute.addEventListener('click', (e) => {
  e.stopPropagation();
  sound.unlock();
  sound.setMuted(!sound.muted);
  save('muted', sound.muted);
  hud.mute.classList.toggle('muted', sound.muted);
});

// ---------- Hangar ----------
const hangar = new Hangar(hangarEl, {
  levels: () => levels,
  wallet: () => wallet,
  stats: () => stats,
  bests: () => bests!,
  levelIndex: () => levelIndex,
  career: () => career,
  buy(u: Upgrade) {
    const next = (levels[u.id] ?? 0) + 1;
    const cost = u.cost(next);
    if (cost > wallet) return;
    wallet -= cost;
    levels = { ...levels, [u.id]: next };
    save('coins', wallet);
    save('levels', levels);
    applyLevels();
    sound.buy();
    vibrate(25);
  },
});

// ---------- Level map ----------
const levelMap = new LevelMap(mapEl, {
  stars: () => stars,
  bests: () => bests!,
  unlocked: () => unlocked,
  selected: () => levelIndex,
  select(i: number) {
    if (i > unlocked || i === levelIndex) return;
    levelIndex = i;
    save('level', levelIndex);
    syncBest();
    applyBiome();
    updateTitle();
    sound.click();
  },
});

if (new URLSearchParams(location.search).has('dev')) {
  $('dev').classList.remove('hidden');
  $('dev-coins').addEventListener('click', () => {
    wallet += 1000;
    save('coins', wallet);
    hangar.render();
  });
}

// Wipes this device's progress; needs a second tap within 3s to confirm
const resetBtn = $('reset-progress');
let resetArmed = 0;
resetBtn.addEventListener('click', () => {
  if (performance.now() > resetArmed) {
    resetArmed = performance.now() + 3000;
    resetBtn.textContent = 'Tap again to wipe';
    resetBtn.classList.add('armed');
    setTimeout(() => {
      resetBtn.textContent = 'Reset progress';
      resetBtn.classList.remove('armed');
    }, 3000);
    return;
  }
  resetArmed = 0;
  wallet = best = 0;
  bests = {};
  save('bests', bests);
  career = { ...NEW_CAREER };
  save('career', career);
  levels = {};
  save('coins', 0);
  save('best', 0);
  save('levels', levels);
  levelIndex = unlocked = 0;
  save('level', 0);
  save('unlocked', 0);
  stars = {};
  save('stars', stars);
  applyBiome();
  updateTitle();
  hud.best.textContent = '0';
  hud.coins.textContent = '0';
  applyLevels();
  hangar.render();
  updateBadges();
  resetBtn.textContent = 'Progress wiped';
  sound.click();
});

// ---------- Game state ----------
let state: GameState = 'title';
let flight: FlightState = createFlight(stats, 0, pocket.y, 0, 0, 0, 0);
let runCoins = 0;
// Ground skimming: metres in the current low streak, and progress to the next skim coin
let skimStreak = 0;
let skimCoinAcc = 0;
const SKIM_COIN_EVERY = 8; // metres per coin while skimming
// Turbulence for this run, rougher on each map
let air: Air = makeAir(0);
// Lifetime totals for the hangar's Stats tab
const NEW_CAREER: Career = { flights: 0, distance: 0, coins: 0, perfects: 0, rings: 0, longest: 0 };
let career: Career = { ...NEW_CAREER, ...load<Partial<Career>>('career', {}) };
let ringsHit = 0;
let runHits = 0;
let launchedPerfect = false;
// Stars lit on the goal bar this flight: ones you already had plus any earned so far
let liveStars = 0;
let bestAtLaunch = 0;
let passedBest = false;
let reachedFinish = false;
let shake = 0;
let hangarFading = 0;
let orbitAngle = 0;

// Aim: screen-space drag → power (pull down) and yaw (pull sideways)
let dragStart: { x: number; y: number } | null = null;
// Power meter: while you hold, it sweeps empty → full → empty; the release moment sets the power.
// Max power comes from the Band power upgrade, the sweep speed and perfect zone from Steady grip.
const aim = { yaw: 0, power: 0, phase: 0 };
const isPerfect = () => aim.power >= 1 - stats.perfectZone;
const launchSpeed = () => stats.launchSpeed * aim.power * (isPerfect() ? PERFECT_BONUS : 1);

// Fingers / mouse buttons currently held down to climb
const climbPointers = new Set<number>();
const keys = new Set<string>();
let boostHeld = false;

function setFlightHud(on: boolean) {
  hud.fuel.classList.toggle('hidden', !on || stats.fuel <= 0);
  hud.boostBtn.classList.toggle('hidden', !on || stats.rocketFuel <= 0);
  hud.speedo.classList.toggle('hidden', !on);
  hud.altimeter.classList.toggle('hidden', !on);
  if (!on) hud.altimeter.classList.remove('thin', 'max');
}

function clearRunEffects() {
  scenery.reset();
  scenery.setGoals(best, level().target, level().accent);
  pickups.reset();
  obstacles.reset();
  trails.forEach((t) => t.clear());
  smoke.clear();
  sparks.clear();
}

function enterAim() {
  state = 'aim';
  aim.yaw = 0;
  aim.power = 0;
  hud.powerSweet.style.left = `${(1 - stats.perfectZone) * 100}%`;
  hud.powerSweet.style.width = `${stats.perfectZone * 100}%`;
  applyBiome();
  syncBest();
  hud.best.textContent = best.toLocaleString();
  passedBest = reachedFinish = false;
  runCoins = 0;
  ringsHit = 0;
  skimStreak = skimCoinAcc = 0;
  flight = createFlight(stats, 0, pocket.y, 0, 0, 0, 0);
  parkPlane();
  titleEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  closeHangar();
  closeScreen(mapEl);
  hud.root.classList.remove('hidden');
  hud.hangarBtn.classList.remove('hidden');
  hud.mapBtn.classList.remove('hidden');
  setFlightHud(false);
  hud.coins.textContent = wallet.toLocaleString();
  hud.dist.textContent = '0';
  showGoal(0);
  hud.goalStars.innerHTML = starRow(stars[level().id] ?? 0);
  // Control hints only while you're learning
  if (career.flights < 3) showHint('Hold, then release at the top');
  else hideHint();
  clearRunEffects();
  climbPointers.clear();
  updateBadges();
  snapCamera();
}

/** Slide a full-screen menu back out the way it came in, then hide it. */
function closeScreen(el: HTMLElement) {
  if (el.classList.contains('hidden') || el.classList.contains('closing')) return;
  el.classList.add('closing');
  el.addEventListener('animationend', function done(e) {
    if (e.target !== el) return;
    el.removeEventListener('animationend', done);
    // Reopened while closing: leave it open
    if (!el.classList.contains('closing')) return;
    el.classList.remove('closing');
    el.classList.add('hidden');
  });
}
const closeHangar = () => closeScreen(hangarEl);
/** Hangar or level map: covers the whole screen, the plane sits parked behind. */
const inMenu = () => state === 'hangar' || state === 'map';

/** Shared setup for opening either full-screen menu. */
function enterMenu(next: 'hangar' | 'map') {
  state = next;
  hud.goal.classList.add('hidden');
  aim.yaw = 0;
  dragStart = null;
  parkPlane();
  previewDots.forEach((d) => (d.visible = false));
  resultEl.classList.add('hidden');
  hud.root.classList.add('hidden');
  hud.hangarBtn.classList.add('hidden');
  hud.mapBtn.classList.add('hidden');
  hud.power.classList.add('hidden');
  setFlightHud(false);
  hideHint();
  clearRunEffects();
  hangarFading = 0.4;
  sound.click();
}

function openHangar() {
  enterMenu('hangar');
  closeScreen(mapEl);
  hangarEl.classList.remove('hidden', 'closing');
  hangar.open();
}

function openMap() {
  enterMenu('map');
  closeHangar();
  mapEl.classList.remove('hidden', 'closing');
  levelMap.open();
}

function launch() {
  flight = createFlight(stats, pocket.x, pocket.y, pocket.z, launchSpeed(), LAUNCH.pitch, aim.yaw);
  state = 'flying';
  crashTimer = 0;
  air = makeAir(0.35 + 0.15 * level().difficulty);
  obstacles.setLevel(level().difficulty);
  // Mid-flight the pill shows this run's running total (see showRunTotal)
  hud.coins.textContent = '+0';
  bestAtLaunch = best;
  passedBest = reachedFinish = false;
  runHits = 0;
  launchedPerfect = isPerfect();
  liveStars = stars[level().id] ?? 0;
  hud.goalStars.innerHTML = starRow(liveStars);
  hud.statsPill.classList.remove('record');
  hud.goal.classList.remove('cleared');
  showGoal(0);
  slingshot.updateBand(pocket);
  previewDots.forEach((d) => (d.visible = false));
  hud.power.classList.add('hidden');
  hud.hangarBtn.classList.add('hidden');
  hud.mapBtn.classList.add('hidden');
  setFlightHud(true);
  if (career.flights < 3) showHint('Hold to climb, let go to dive', 4);
  else hideHint();
  smoke.burst(pocket, 8, 3, { color: 0xd8c6a0, size: 0.6, life: 0.7, grow: 3, opacity: 0.5 });
  sound.launch();
  if (isPerfect()) {
    career.perfects++;
    edgeFlash('255, 204, 64');
    sound.perfect();
    vibrate(30);
  }
  vibrate(30);
}

/** Tap after touchdown: play out the bounces and slide instantly and go to the results. */
function finishLanding() {
  for (let i = 0; i < 6000 && !flight.stopped; i++) stepFlight(flight, stats, { x: 0, y: 0, boost: false }, STEP);
  endRun();
}

/** Everything a run is worth at `dist`: the same sum the results screen pays out. */
function runEarnings(dist: number) {
  const b = level();
  const distCoins = Math.floor((dist / 10) * stats.distanceCoins);
  // Beating your best pays 1 coin per 4m beaten; the first finish on a map pays its reward
  const recordBonus = bestAtLaunch > 0 && dist > bestAtLaunch ? Math.round(((dist - bestAtLaunch) / 4) * stats.coinMultiplier) : 0;
  const finishReward = reachedFinish && bestAtLaunch < b.target ? b.reward : 0;
  const earned = Math.round((distCoins + runCoins) * stats.coinMultiplier * b.coinBonus) + recordBonus + finishReward;
  return { distCoins, recordBonus, finishReward, earned };
}

/** Mid-flight the coin pill shows the run's full running total, multipliers and bonuses included. */
function showRunTotal() {
  hud.coins.textContent = `+${runEarnings(Math.max(0, Math.floor(flight.x))).earned.toLocaleString()}`;
}

function endRun() {
  setEdgeWarn('none');
  state = 'result';
  climbPointers.clear();
  boostHeld = false;
  hud.boostBtn.classList.remove('firing');
  hud.goal.classList.add('hidden');
  const b = level();
  const dist = Math.max(0, Math.floor(flight.x));
  const { distCoins, recordBonus, finishReward, earned: flown } = runEarnings(dist);
  // Stars lit during the flight that you didn't have before pay out once
  const hadStars = stars[b.id] ?? 0;
  const newStars = liveStars & ~hadStars;
  const starCoins = countStars(newStars) * starReward(b);
  const earned = flown + starCoins;
  if (newStars) {
    stars = { ...stars, [b.id]: hadStars | newStars };
    save('stars', stars);
  }
  const before = wallet;
  wallet += earned;
  save('coins', wallet);
  career.flights++;
  career.distance += dist;
  career.coins += earned;
  career.longest = Math.max(career.longest, dist);
  save('career', career);

  const fmt = (v: number) => `×${v.toFixed(2).replace(/\.?0+$/, '')}`;
  $('result-distcoins').textContent = String(distCoins);
  $('result-pickups').textContent = String(runCoins);
  $('result-mult').textContent = fmt(stats.coinMultiplier);
  $('result-biome-name').textContent = `${b.name} bonus`;
  $('result-biome').textContent = fmt(b.coinBonus);
  $('row-biome').classList.toggle('hidden', b.coinBonus === 1);
  $('result-record').textContent = `+${recordBonus}`;
  $('row-record').classList.toggle('hidden', recordBonus === 0);
  $('result-checkpoint').textContent = `+${finishReward}`;
  $('row-checkpoint').classList.toggle('hidden', finishReward === 0);
  $('result-starcoins').textContent = `+${starCoins}`;
  $('row-stars').classList.toggle('hidden', starCoins === 0);
  const allStars = hadStars | newStars;
  $('result-stars').innerHTML = starRow(allStars, newStars);
  const todo = challengesFor(b).find((_, i) => !(allStars & (1 << i)));
  $('result-next').textContent = todo ? `Next star: ${todo.text}` : 'All three stars earned';

  if (dist > best) {
    $('result-best').textContent = 'New best';
    best = bests![b.id] = dist;
    save('bests', bests);
  } else {
    $('result-best').textContent = `Best on level ${b.n}: ${best.toLocaleString()}m`;
  }

  // Finishing the furthest level unlocks the next one and moves you onto it. Replays of
  // earlier levels stay put so you can keep going for their stars.
  const next = reachedFinish && levelIndex === unlocked ? LEVELS[levelIndex + 1] : undefined;
  const newBiome = next && next.theme !== b.theme;
  if (next) {
    levelIndex = ++unlocked;
    save('level', levelIndex);
    save('unlocked', unlocked);
    syncBest();
  }
  updateTitle();
  $('result-unlock').classList.toggle('hidden', !next);
  if (next) $('result-unlock').innerHTML = `<b>${newBiome ? `${next.name} unlocked` : `Level ${next.n} unlocked`}</b><span>Finish line at ${next.target.toLocaleString()}m</span>`;
  $('result-fly').textContent = next ? `Fly level ${next.n}` : 'Fly again';
  countUp($('result-dist'), 0, dist, 700);
  countUp($('result-total'), 0, earned, 900, '+');
  countUp($('result-wallet'), before, wallet, 900);
  hideHint();
  setFlightHud(false);
  sound.update(false, 0, false, false);
  hud.coins.textContent = wallet.toLocaleString();
  updateBadges();
  resultEl.classList.remove('hidden');
}

// ---------- Aiming ----------
const aimDir = new THREE.Vector3();
let perfectBuzzed = false;

/** Runs every frame while charging: sweep the meter and pull the plane back with it. */
function updateCharge(dt: number) {
  // Triangle wave: up in meterTime, back down in meterTime
  aim.phase = (aim.phase + dt / stats.meterTime) % 2;
  aim.power = aim.phase < 1 ? aim.phase : 2 - aim.phase;
  const perfect = isPerfect();
  if (perfect && !perfectBuzzed) vibrate(12);
  perfectBuzzed = perfect;
  hud.power.classList.toggle('perfect', perfect);
  hud.powerFill.style.width = `${aim.power * 100}%`;
  sound.stretch(aim.power);

  aimDir.set(Math.cos(aim.yaw) * Math.cos(LAUNCH.pitch), Math.sin(LAUNCH.pitch), -Math.sin(aim.yaw) * Math.cos(LAUNCH.pitch));
  model.group.position.copy(pocket).addScaledVector(aimDir, -aim.power * LAUNCH.maxPullWorld);
  model.group.rotation.set(0, aim.yaw, LAUNCH.pitch);
  slingshot.updateBand(model.group.position);
  updatePreview();
}

function startCharge(x: number, y: number) {
  dragStart = { x, y };
  aim.phase = aim.power = 0;
  perfectBuzzed = false;
  sound.stretch(0);
  hud.powerFill.style.width = '0';
  hud.power.classList.remove('perfect');
  hud.power.classList.remove('hidden');
  hud.goal.classList.add('hidden');
  hideHint();
}

function releaseCharge() {
  if (!dragStart) return;
  dragStart = null;
  sound.stretch(0);
  if (aim.power >= LAUNCH.minPower) launch();
  else cancelAim();
}

function updatePreview() {
  const sim = createFlight(stats, pocket.x, pocket.y, pocket.z, launchSpeed(), LAUNCH.pitch, aim.yaw);
  const show = aim.power >= LAUNCH.minPower;
  const noInput = { x: 0, y: 0, boost: false };
  previewDots.forEach((dot, i) => {
    for (let k = 0; k < 6; k++) stepFlight(sim, stats, noInput, 1 / 60);
    dot.position.set(sim.x, sim.y, sim.z);
    dot.visible = show && i < stats.aimDots && !sim.grounded;
  });
}

function cancelAim() {
  aim.power = 0;
  parkPlane();
  previewDots.forEach((d) => (d.visible = false));
  hud.power.classList.add('hidden');
  showGoal(0);
}

// ---------- Input ----------
titleEl.addEventListener('pointerdown', () => {
  sound.unlock();
  enterAim();
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state === 'aim') {
    // Keep tracking the aim even if the pointer leaves the window
    renderer.domElement.setPointerCapture(e.pointerId);
    startCharge(e.clientX, e.clientY);
  } else if (state === 'flying' && flight.touchedDown) {
    finishLanding();
  } else if (state === 'flying') {
    // Hold anywhere to climb
    renderer.domElement.setPointerCapture(e.pointerId);
    climbPointers.add(e.pointerId);
  }
});
const pointerUp = (e: PointerEvent) => {
  if (state === 'aim') releaseCharge();
  climbPointers.delete(e.pointerId);
};
window.addEventListener('pointerup', pointerUp);
window.addEventListener('pointercancel', pointerUp);

const setBoost = (on: boolean) => {
  boostHeld = on;
  hud.boostBtn.classList.toggle('firing', on);
};
hud.boostBtn.addEventListener('pointerdown', () => setBoost(true));
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) hud.boostBtn.addEventListener(ev, () => setBoost(false));

hud.hangarBtn.addEventListener('click', openHangar);
hud.mapBtn.addEventListener('click', openMap);
$('result-map').addEventListener('click', openMap);
$('map-fly').addEventListener('click', enterAim);
$('result-hangar').addEventListener('click', openHangar);
$('result-fly').addEventListener('click', enterAim);
$('hangar-fly').addEventListener('click', enterAim);

window.addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (e.key === ' ') e.preventDefault(); // don't let Space click a focused button
  if (e.repeat) return;
  const start = e.key === ' ' || e.key === 'Enter';
  if (state === 'title' && start) {
    sound.unlock();
    enterAim();
  } else if ((state === 'result' || inMenu()) && start) {
    enterAim();
  } else if (state === 'flying' && start && flight.touchedDown) {
    finishLanding();
  } else if (state === 'aim' && e.key === ' ' && !dragStart) {
    startCharge(window.innerWidth / 2, window.innerHeight / 2);
  } else if (e.key === 'm' || e.key === 'M' || (e.key === 'Escape' && state === 'map')) {
    if (state === 'map') enterAim();
    else if (state !== 'flying' && !dragStart) {
      if (state === 'title') {
        sound.unlock();
        titleEl.classList.add('hidden');
      }
      openMap();
    }
  } else if (e.key === 'h' || e.key === 'H' || (e.key === 'Escape' && state === 'hangar')) {
    // H toggles the hangar from any screen except mid-flight or mid-pull; Esc closes it
    if (state === 'hangar') enterAim();
    else if (state !== 'flying' && !dragStart) {
      if (state === 'title') {
        sound.unlock();
        titleEl.classList.add('hidden');
      }
      openHangar();
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.key);
  if (e.key === ' ' && state === 'aim') releaseCharge();
});

const input: FlightInput = { x: 0, y: 0, boost: false };
function readInput() {
  // One button: hold to climb, let go and the nose drops. No steering.
  const held = climbPointers.size > 0 || [' ', 'ArrowUp', 'w', 'W'].some((k) => keys.has(k));
  input.x = 0;
  input.y = held ? 1 : 0;
  // Two fingers on the screen fires the rockets too
  const twoFinger = climbPointers.size >= 2;
  input.boost = boostHeld || twoFinger || keys.has('Shift');
  if (!boostHeld) hud.boostBtn.classList.toggle('firing', twoFinger);
}

// ---------- Camera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const fwd = new THREE.Vector3();

function desiredCamera() {
  const p = model.group.position;
  if (inMenu() || state === 'title') {
    // Slow orbit around the parked plane to show off the parts
    const r = state === 'title' ? 7.5 : 6;
    camPos.set(p.x + Math.sin(orbitAngle) * r, p.y + 1.4, p.z + Math.cos(orbitAngle) * r);
    camLook.copy(p);
    return;
  }
  if (state === 'aim') {
    fwd.set(Math.cos(aim.yaw), 0, -Math.sin(aim.yaw));
    camPos.copy(pocket).addScaledVector(fwd, -12);
    camPos.y += 1.6;
    camLook.copy(pocket).addScaledVector(fwd, 12);
    camLook.y -= 1.2;
    return;
  }
  // Chase cam: behind the plane along its heading, following some of its pitch
  const pitch = flight.grounded ? 0 : flight.gamma * 0.5;
  fwd.set(Math.cos(flight.psi) * Math.cos(pitch), Math.sin(pitch), -Math.sin(flight.psi) * Math.cos(pitch));
  const dist = 8 + flight.speed * 0.06;
  camPos.copy(p).addScaledVector(fwd, -dist);
  camPos.y += 2.2;
  camPos.y = Math.max(camPos.y, 0.8);
  camLook.copy(p).addScaledVector(fwd, 10);
  camLook.y += 0.8;
}

function snapCamera() {
  desiredCamera();
  camera.position.copy(camPos);
  lookAt.copy(camLook);
  camera.lookAt(lookAt);
}

function updateViewOffset() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!inMenu()) {
    if (camera.view?.enabled) camera.clearViewOffset();
    return;
  }
  // Shift the view so the plane sits in the part of the screen the hangar panel doesn't cover
  if (w > h) camera.setViewOffset(w, h, w * 0.27, 0, w, h);
  else camera.setViewOffset(w, h, 0, h * 0.3, w, h);
}

function updateCamera(dt: number) {
  desiredCamera();
  const k = 1 - Math.exp(-6 * dt);
  camera.position.lerp(camPos, k);
  lookAt.lerp(camLook, k);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.lookAt(lookAt);
  // Widen field of view with speed for a sense of rush
  const targetFov = state === 'flying' ? 60 + Math.min(25, Math.max(0, flight.speed - 15) * 0.6) : 60;
  camera.fov += (targetFov - camera.fov) * k;
  updateViewOffset();
  camera.updateProjectionMatrix();

  // Sky and distant mountains travel with the camera; fog thins as you climb so the ground stays visible
  sky.position.copy(camera.position);
  horizon.position.set(camera.position.x, 0, camera.position.z);
  const alt = Math.max(0, camera.position.y);
  fog.near = 160 + alt * 1.5;
  fog.far = 600 + alt * 4;
}

// ---------- Loop ----------
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
const tip = new THREE.Vector3();
const tmp = new THREE.Vector3();
const vel = new THREE.Vector3();
let crashTimer = 0;

function impact(strength: number) {
  shake = Math.max(shake, strength);
  sound.thud(strength);
  vibrate(Math.round(20 + strength * 40));
  tmp.set(flight.x, 0.3, flight.z);
  smoke.burst(tmp, 10 + Math.round(strength * 14), 5 + strength * 6, {
    color: 0xc9a46c, size: 0.9, life: 1.1, grow: 3.5, opacity: 0.55, gravity: -0.5,
  });
}

function emitFlightEffects() {
  // Backwards along the plane's flight direction
  vel.set(-Math.cos(flight.psi), -Math.sin(flight.gamma) * 0.5, Math.sin(flight.psi));

  if (flight.rocketOn) {
    for (const f of model.flames) {
      f.getWorldPosition(tmp);
      tmp.addScaledVector(vel, 0.8);
      smoke.emit(tmp, tmp.clone().set(vel.x * 6 + (Math.random() - 0.5) * 2, vel.y * 6 + Math.random(), vel.z * 6 + (Math.random() - 0.5) * 2), {
        color: 0xd9d9d9, size: 0.6, life: 1.4, grow: 5, opacity: 0.45,
      });
      sparks.emit(tmp, vel.clone().multiplyScalar(10), { color: 0xff9a2a, size: 0.5, life: 0.2, opacity: 0.9 });
    }
  }
  if (flight.engineOn && Math.random() < 0.5) {
    for (const ex of model.exhausts) {
      ex.getWorldPosition(tmp);
      smoke.emit(tmp, vel.clone().multiplyScalar(3), { color: 0x9a9a9a, size: 0.2, life: 0.8, grow: 4, opacity: 0.3 });
    }
  }
}

// ---------- Goals: progress to this map's finish line, with your best marked ----------
function showGoal(x: number) {
  const b = level();
  const mark = state === 'flying' ? bestAtLaunch : best;
  const markPos = Math.min(1, mark / b.target);
  hud.goal.style.setProperty('--accent', `#${b.accent.toString(16).padStart(6, '0')}`);
  hud.goalName.innerHTML = `<b>Level ${b.n}</b> ${b.name}`;
  hud.goalFill.style.width = `${Math.min(1, x / b.target) * 100}%`;
  hud.goalGhost.style.width = `${markPos * 100}%`;
  hud.goalBest.classList.toggle('hidden', mark <= 0);
  hud.goalBestLabel.classList.toggle('hidden', mark <= 0);
  hud.goalBest.style.left = hud.goalBestLabel.style.left = `${markPos * 100}%`;
  // Label slides from left-aligned at the start to right-aligned at the finish, so it never spills out
  hud.goalBestLabel.style.transform = `translateX(-${markPos * 100}%)`;
  hud.goalBestLabel.textContent = `Best ${mark.toLocaleString()}m`;
  hud.goalTarget.textContent = reachedFinish
    ? 'Finished'
    : state === 'flying'
      ? `${Math.floor(x).toLocaleString()} / ${b.target.toLocaleString()}m`
      : `Finish ${b.target.toLocaleString()}m`;
  hud.goal.classList.remove('hidden');
}

function trackGoals() {
  const x = Math.max(0, flight.x);
  if (!passedBest && bestAtLaunch > 0 && x > bestAtLaunch) {
    passedBest = true;
    hud.statsPill.classList.add('record');
    edgeFlash('255, 214, 10');
    tmp.set(flight.x, flight.y, flight.z);
    sparks.burst(tmp, 50, 14, { color: 0xffd60a, size: 0.6, life: 0.9, opacity: 1 });
    sound.perfect();
    vibrate(30);
  }
  const b = level();
  if (!reachedFinish && x >= b.target) {
    reachedFinish = true;
    hud.goal.classList.add('cleared');
    // Celebration burst instead of a banner: the arch, the green flash and the pill say the rest
    tmp.set(flight.x, flight.y, flight.z);
    sparks.burst(tmp, 90, 20, { color: 0x30d158, size: 0.7, life: 1.2, opacity: 1 });
    sparks.burst(tmp, 50, 16, { color: 0xffd60a, size: 0.5, life: 1, opacity: 1 });
    edgeFlash('48, 209, 88');
    sound.ring();
    sound.perfect();
    vibrate(60);
  }
  if (passedBest) hud.best.textContent = Math.floor(x).toLocaleString();
  // Stars light up on the goal bar the moment you earn them
  const lit = liveStars | starsFrom(b, { dist: x, finished: reachedFinish, coins: runCoins, rings: ringsHit, hits: runHits, perfect: launchedPerfect });
  if (lit !== liveStars) {
    hud.goalStars.innerHTML = starRow(lit, lit & ~liveStars);
    liveStars = lit;
    sound.coin();
    vibrate(20);
  }
  showGoal(x);
}

function updateTitle() {
  const b = level();
  $('title-level').textContent = `Level ${b.n} of ${LEVELS.length} · ${b.name}`;
  $('title-best').textContent = best > 0 ? `Best ${best.toLocaleString()}m of ${b.target.toLocaleString()}m` : `Finish line ${b.target.toLocaleString()}m`;
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state === 'flying') {
    readInput();
    const prevX = flight.x;
    // Once it's on the ground nothing you do matters, so the bounces and slide play fast
    acc += dt * (flight.touchedDown ? 3 : 1);
    while (acc >= STEP) {
      input.gust = gustAt(air, flight.x);
      stepFlight(flight, stats, input, STEP);
      if (flight.impact) impact(flight.impact);
      if (!flight.grounded && scenery.hitTree(flight.x, flight.y, flight.z)) {
        flight.speed *= 0.4;
        flight.gamma = -0.3;
        flight.gammaRate = 0;
        impact(0.8);
        tmp.set(flight.x, flight.y, flight.z);
        smoke.burst(tmp, 16, 6, { color: 0x3f9a3a, size: 0.4, life: 1.2, opacity: 0.9, gravity: 4 });
      }
      acc -= STEP;
    }

    const ev = pickups.update(flight.x, flight.y, flight.z, prevX, dt, stats.magnetRadius);
    tmp.set(flight.x, flight.y, flight.z);
    if (ev.coins) {
      runCoins += ev.coins;
      sparks.burst(tmp, 10 * ev.coins, 6, { color: 0xffd23a, size: 0.45, life: 0.5, opacity: 1 });
      sound.coin();
      vibrate(10);
    }
    const ob = obstacles.update(flight.x, flight.y, flight.z, prevX, dt, (x0, x1) => pickups.clearSpan(x0, x1));
    if (ob.gate) {
      runCoins += 3;
      sparks.burst(ob.at, 40, 14, { color: 0x5dffa0, size: 0.6, life: 0.7, opacity: 1 });
      edgeFlash('48, 209, 88');
      sound.gate();
      vibrate(25);
    }
    if (ob.hit && !flight.touchedDown) {
      runHits++;
      // Clipping anything costs most of your speed and knocks the nose down
      const keep = ob.hit === 'balloon' ? 0.5 : 0.4;
      flight.speed *= keep;
      flight.gamma = Math.min(flight.gamma, -0.45);
      flight.gammaRate = 0;
      shake = Math.max(shake, 0.7);
      edgeFlash('255, 69, 58');
      sound.smash();
      vibrate(80);
      const fx = ob.hit === 'balloon' ? { color: 0xffb36b, size: 0.5, life: 1, opacity: 0.9, gravity: 3 }
        : { color: 0xff6b5e, size: 0.5, life: 0.8, opacity: 1, gravity: 6 };
      sparks.burst(ob.at, 40, 10, fx);
    }
    // Rough air rattles the camera and gets a heads-up when you fly into it
    if (!flight.touchedDown) {
      const rough = roughness(air, flight.x);
      shake = Math.max(shake, rough * 0.1);
    }
    if (ev.boost) {
      ringBoost(flight, stats, ringsHit++, ev.boost);
      career.rings++;
      const color = ev.bullseye ? 0xffd23a : 0x48e5ff;
      sparks.burst(tmp, ev.bullseye ? 60 : 36, ev.bullseye ? 18 : 14, { color, size: 0.7, life: 0.7, opacity: 1 });
      edgeFlash(ev.bullseye ? '255, 204, 64' : '72, 229, 255');
      speedLines.kick();
      sound.ring();
      if (ev.bullseye) sound.perfect();
      vibrate(ev.bullseye ? 60 : 40);
    }

    // Skimming: coins for every few metres flown in ground effect. No badge: the ground sprays
    // up behind you (harder the lower you are) and each coin pops out of the plane in gold.
    if (flight.skimming && !flight.touchedDown) {
      const dx = flight.x - prevX;
      skimStreak += dx;
      skimCoinAcc += dx;
      while (skimCoinAcc >= SKIM_COIN_EVERY) {
        skimCoinAcc -= SKIM_COIN_EVERY;
        runCoins++;
        tmp.set(flight.x, flight.y + 0.4, flight.z);
        sparks.burst(tmp, 8, 4, { color: 0xffd23a, size: 0.35, life: 0.45, opacity: 1 });
      }
      const low = 1 - flight.y / SKIM_HEIGHT;
      const spray = 1 + Math.round(low * 3 + Math.min(1, skimStreak / 40) * 2);
      for (let i = 0; i < spray; i++) {
        // Twin rooster tails kicked up either side of the plane's track
        const side = i % 2 ? 1 : -1;
        smoke.emit(tmp.set(flight.x - 1.5, 0.15, flight.z + side * (0.6 + Math.random() * 0.8)),
          tmp.clone().set(-3 - Math.random() * 3, 2 + low * 4 + Math.random() * 2, side * (2 + Math.random() * 3)), {
            color: 0xe9dcc0, size: 0.35 + low * 0.3, life: 0.7, grow: 3, opacity: 0.3 + low * 0.25, gravity: 6,
          });
      }
    } else {
      skimStreak = 0;
    }

    const g = model.group;
    g.position.set(flight.x, flight.y + 0.3, flight.z);
    g.rotation.set(-flight.bank, flight.psi, flight.grounded ? 0 : flight.gamma + flight.gammaRate * 0.15);
    // Buffet: the airframe starts shaking as you slow toward stall, so it never comes as a surprise
    const airborneNow = !flight.touchedDown && !flight.grounded;
    const nearStall = airborneNow ? THREE.MathUtils.clamp((stats.stallSpeed * 1.35 - flight.speed) / (stats.stallSpeed * 0.35), 0, 1) : 0;
    if (nearStall > 0) {
      const t = performance.now() / 1000;
      g.rotation.x += nearStall * 0.07 * Math.sin(t * 41);
      g.rotation.z += nearStall * 0.04 * Math.sin(t * 33 + 1.3);
      shake = Math.max(shake, nearStall * 0.08);
    }
    const warn = !airborneNow ? 'none' : flight.stalled ? 'stall' : nearStall > 0.4 ? 'near' : 'none';
    speedo.setWarning(warn);
    setEdgeWarn(warn);
    if (model.propeller) model.propeller.rotation.x += (flight.engineOn ? 50 : flight.grounded ? 0 : 5) * dt;
    if (model.propDisc) model.propDisc.visible = flight.engineOn;
    for (const f of model.flames) {
      f.visible = flight.rocketOn;
      f.scale.set(0.8 + Math.random() * 0.5, 1, 1);
    }

    if (!flight.grounded) {
      g.updateMatrixWorld();
      trails.forEach((t, i) => t.push(tip.copy(model.wingtips[i]).applyMatrix4(g.matrixWorld)));
    }
    emitFlightEffects();

    hud.dist.textContent = Math.max(0, Math.floor(flight.x)).toLocaleString();
    trackGoals();
    showRunTotal();
    speedo.setStall(stats.stallSpeed);
    speedo.set(flight.speed);
    altimeter.set(flight.y);
    altimeter.setCap(flight.touchedDown ? Infinity : flight.capY);
    if (stats.fuel > 0) hud.fuelFill.style.width = `${(flight.fuel / stats.fuel) * 100}%`;
    if (stats.rocketFuel > 0) hud.rocketFill.style.width = `${(flight.rocketFuel / stats.rocketFuel) * 100}%`;

    // Thin air shows on the altimeter itself (stall already has the speedo, buffet and edge glow)
    const airborne = !flight.grounded;
    hud.altimeter.classList.toggle('max', airborne && flight.y > CEILING - 5);
    hud.altimeter.classList.toggle('thin', airborne && flight.y > THIN_AIR && flight.y <= CEILING - 5);
    sound.update(true, flight.speed, flight.engineOn, flight.rocketOn);

    // Hold on the landing for a moment before the results
    if (flight.stopped && (crashTimer += dt) > 0.7) endRun();
  } else if (state === 'aim' && dragStart) {
    updateCharge(dt);
  } else if (inMenu() || state === 'title') {
    orbitAngle += dt * (state === 'title' ? 0.25 : 0.35);
    if (model.propeller) model.propeller.rotation.x += 6 * dt;
  }

  smoke.update(dt);
  sparks.update(dt);

  const p = model.group.position;
  followGround(ground, p.x, p.z);
  scenery.update(p.x, p.z);
  // Fixed sun direction, aimed at the ground under the plane
  sun.target.position.set(p.x, 0, p.z);
  sun.position.copy(sun.target.position).add(SUN_DIR);
  updateCamera(dt);
  const fast = state === 'flying' && !flight.touchedDown;
  speedLines.update(dt, flight.speed, fast);
  // Vapour trails thicken and brighten with speed
  const vapour = fast ? Math.min(1, Math.max(0, (flight.speed - 20) / 45)) : 0;
  for (const t of trails) t.update(camera.position, vapour);

  // The hangar covers the whole screen, so the world only draws while it's animating in
  if (!inMenu() || hangarFading > 0) renderer.render(scene, camera);
  hangarFading = Math.max(0, hangarFading - dt);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  speedLines.resize();
});

// Start on the title screen with the plane parked on the slingshot
parkPlane();
clearRunEffects();
snapCamera();
requestAnimationFrame(frame);
