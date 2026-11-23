import { World, makePlayer, ENEMY_TYPES } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { LEVELS, STORY_ORDER } from './level.js';
import { VIEW_W, VIEW_H } from './util.js';
import { attachTouchControls } from './touch.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input();
const audio = new Audio();
const net = new Net();
const hud = {
  hp: document.getElementById('hp'),
  energy: document.getElementById('energy'),
  score: document.getElementById('score'),
  net: document.getElementById('netstat'),
  menu: document.getElementById('menu'),
  room: document.getElementById('room'),
};

let mode = 'menu';
let world = null;
let player = null;
let storyIndex = 0;
let paused = false;
let lastResult = null;

const params = new URLSearchParams(location.search);
if (params.get('autoplay') === '1') startStory(0);

document.querySelectorAll('#menu nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio._ensure();
    const m = btn.dataset.mode;
    if (m === 'story') startStory(0);
    else if (m === 'endless') startEndless();
    else if (m === 'pvp') startOnline('coop');
    else if (m === 'royale') startOnline('royale');
  });
});

function hideMenu() { hud.menu.classList.add('hidden'); }
function showMenu() {
  hud.menu.classList.remove('hidden');
  hud.menu.querySelector('h1').textContent = lastResult === 'won' ? 'STAGE CLEAR' : lastResult === 'lost' ? 'DEFEATED' : 'NAVARA';
  mode = 'menu';
  paused = true;
}

function startStory(index) {
  storyIndex = index;
  const id = STORY_ORDER[index] ?? STORY_ORDER[0];
  world = new World(id, Date.now() & 0xffff);
  player = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  mode = 'story';
  paused = false;
  lastResult = null;
  hideMenu();
  audio.startMusic(world.spec.music);
  audio.bossWarn && world.entities.some((e) => e.boss) && audio.bossWarn();
  renderer.cam.x = Math.max(0, player.x - VIEW_W / 2);
  renderer.cam.y = Math.max(0, player.y - VIEW_H / 2);
  updateHud();
}

function startEndless() {
  world = new World('arena', Date.now() & 0xffff);
  player = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  mode = 'endless';
  paused = false;
  lastResult = null;
  hideMenu();
  audio.startMusic('arena');
  spawnSurge(6);
}

function startOnline(kind) {
  net.connect();
  net.join(kind, 'arena');
  mode = kind === 'royale' ? 'royale' : 'coop';
  world = new World('arena', 1);
  player = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  paused = false;
  hideMenu();
  audio.startMusic('arena');
  hud.room.textContent = `room: ${kind} · connecting…`;
  net.onStatus = (s) => { hud.net.textContent = s; };
  net.onMessage = (msg) => {
    if (msg.t === 'welcome') hud.room.textContent = `room: ${kind} · you are ${msg.name ?? msg.id}`;
    if (msg.t === 'state') {
      hud.room.textContent = `room: ${kind} · ${msg.players.length} players`;
      const me = msg.players.find((p) => p.id === net.id);
      if (me) { player.x = me.x; player.y = me.y; player.hp = me.hp ?? player.hp; player.score = me.score ?? player.score; }
    }
  };
}

function respawn() {
  if (!player?.checkpoint) { player.x = world.spawnPoint.x; player.y = world.spawnPoint.y; }
  else { player.x = player.checkpoint.x; player.y = player.checkpoint.y; }
  player.hp = player.maxHp;
  player.energy = 100;
  world.status = 'playing';
}

// Fixed 60 Hz simulation; render is free-running.
let acc = 0;
let prev = performance.now();
const STEP = 1000 / 60;

function loop(now) {
  const dt = Math.min(250, now - prev);
  prev = now;
  if (!paused && world && mode !== 'coop' && mode !== 'royale') {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      const snap = input.poll();
      world.tick(player, snap);
      if (snap.jump && player.jumpBuffer === 7 && player.vy < 0 && player.onGround === false && player.coyote === 0) audio.jump();
      else if (snap.jump && player.onGround === true) audio.jump();
      if (snap.dash && player.dashT > 0) audio.dash();
      if (snap.attack && player.attackCd === 15) audio.strike();
      acc -= STEP;
      steps++;
    }
    collectRegisters();
    if (world.status === 'won') {
      lastResult = 'won'; audio.win(); audio.stopMusic();
      setTimeout(() => { if (mode === 'story') startStory(storyIndex + 1); else showMenu(); }, 900);
    } else if (world.status === 'lost') {
      lastResult = 'lost'; audio.lose(); audio.stopMusic();
      setTimeout(() => showMenu(), 900);
    }
  }
  if (mode === 'coop' || mode === 'royale') {
    const snap = input.poll();
    net.input(snap);
  }
  if (world) {
    renderer.follow(player, world);
    renderer.draw(world, player, net.peers, net.id);
  }
  updateHud();
  requestAnimationFrame(loop);
}

// Convert engine events to feedback without coupling World to the renderer.
let lastCoins = 0;
let lastHp = 100;
function collectRegisters() {
  if (!player) return;
  if (player.coins !== lastCoins) { audio.coin(); renderer.burst(player.x + 4, player.y + 4, '#ffd447', 5, 1.2); lastCoins = player.coins; }
  if (player.hp < lastHp) { audio.hurt(); renderer.kick(3); renderer.burst(player.x + 5, player.y + 7, '#ff6b6b', 10, 2.4); lastHp = player.hp; }
  if (player.hp > lastHp) lastHp = player.hp;
  for (const e of world.entities) {
    if (e.kind === 'enemy' && e.dead && !e._fx) {
      // Score is already awarded by world.damageEnemy, which is what keeps a
      // headless run and a browser run in agreement. This is presentation only.
      e._fx = true;
      renderer.burst(e.x + e.w / 2, e.y + e.h / 2, e.type === 'boss' ? '#ffd447' : '#ff9f43', e.boss ? 40 : 10, e.boss ? 4 : 2.4);
      if (e.boss) renderer.kick(10);
      audio.hit();
    }
  }
}

function updateHud() {
  if (!player) return;
  hud.hp.style.width = `${Math.max(0, player.hp)}%`;
  hud.energy.style.width = `${Math.max(0, player.energy)}%`;
  hud.score.textContent = String(player.score);
  if (!net.connected) hud.net.textContent = 'offline';
}

function spawnSurge(n) {
  const types = ['enemy1', 'enemy1', 'enemy2', 'enemy3'];
  for (let i = 0; i < n; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    // Stats come from the shared table so a surge enemy is the same creature
    // the story levels use — HP, damage and bounty all agree.
    const t = ENEMY_TYPES[type];
    world.entities.push({
      type, kind: 'enemy', x: Math.random() * (world.width - 40) + 20, y: 32,
      w: t.w, h: t.h, vx: (Math.random() < 0.5 ? -1 : 1) * t.speed, vy: 0,
      hp: t.hp, maxHp: t.hp, dmg: t.dmg, score: t.score,
      onGround: false, hurtT: 0, dead: false, jumpChance: t.jump,
    });
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') paused = !paused;
  if (e.code === 'KeyM') { audio.setEnabled(!audio.enabled); }
});
input.onMute = () => audio.setEnabled(!audio.enabled);

attachTouchControls(document.getElementById('app'), input);
requestAnimationFrame((t) => { prev = t; loop(t); });

// Expose a tiny surface for the harness: it drives the game through the same
// public API a player would, never by poking internals directly.
globalThis.__navara = {
  start: (id = 's1') => {
    if (LEVELS[id]) { world = new World(id, 12345); player = makePlayer(world.spawnPoint.x, world.spawnPoint.y); mode = 'story'; paused = false; hideMenu(); }
  },
  tick: (n = 1, snap = { left: false, right: false, jump: false, attack: false, dash: false }) => {
    for (let i = 0; i < n; i++) world?.tick(player, snap);
    return snapshot();
  },
  snapshot: () => snapshot(),
  status: () => world?.status ?? 'none',
};

function snapshot() {
  return {
    mode, status: world?.status ?? 'none',
    player: player ? { x: player.x, y: player.y, vx: player.vx, hp: player.hp, score: player.score, onGround: player.onGround } : null,
    entities: world ? world.serialize().entities : [],
    peers: net.peerCount,
  };
}
