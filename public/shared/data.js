// Shared game data — imported by both the server (simulation) and the browser (rendering/UI).

export const TILE = 2;            // world units per grid tile
export const GRID_W = 24;
export const GRID_H = 16;
export const ROUND_TIME = 120;    // seconds per round (2 minutes)
export const TOTAL_ROUNDS = 10;
export const SELL_REFUND = 0.6;
export const FREE_TOWERS_FOR_NEW = 3;
export const MAX_PARTY = 6;
export const STARTER_TOWERS = ['wizard', 'witch', 'archer'];
export const PLAYER_COLORS = ['#a78bfa', '#38bdf8', '#f472b6', '#facc15', '#4ade80', '#fb923c'];
export const TARGET_MODES = ['first', 'last', 'strong', 'close'];

export function roundBonus(round) { return 75 + 25 * round; }

export const DIFFICULTIES = {
  easy:   { id: 'easy',   name: 'Easy',   hpMult: 0.75, startMana: 600, baseHp: 150, coins: 60,  color: '#4ade80' },
  medium: { id: 'medium', name: 'Medium', hpMult: 1.15, startMana: 500, baseHp: 100, coins: 150, color: '#facc15' },
  hard:   { id: 'hard',   name: 'Hard',   hpMult: 2.2,  startMana: 450, baseHp: 60,  coins: 300, color: '#f87171' },
};

// Each level lists only what changes; towerStats() merges them.
export const TOWERS = {
  wizard: {
    id: 'wizard', name: 'Arcane Wizard', icon: '🧙', shopPrice: 0, cost: 100, attack: 'bolt',
    desc: 'Hurls homing arcane bolts at a single foe.',
    perk: 'Reliable all-rounder. Level 3 gains True Sight.',
    levels: [
      { dmg: 14, range: 9, cd: 0.8 },
      { cost: 90, dmg: 22, range: 10, cd: 0.7 },
      { cost: 200, dmg: 38, range: 11, cd: 0.6 },
      { cost: 450, dmg: 70, range: 12, cd: 0.5, trueSight: true },
    ],
  },
  witch: {
    id: 'witch', name: 'Frost Witch', icon: '❄️', shopPrice: 0, cost: 150, attack: 'frost',
    desc: 'Shatters ice shards that chill everything nearby.',
    perk: 'Slows enemies in a small area. Bosses are only half affected.',
    levels: [
      { dmg: 6, range: 8, cd: 1.0, splash: 2, slow: 0.35, slowTime: 1.5 },
      { cost: 110, dmg: 10, slow: 0.45 },
      { cost: 240, dmg: 16, range: 9, slow: 0.5, slowTime: 2 },
      { cost: 500, dmg: 28, range: 10, slow: 0.6, slowTime: 2.5, splash: 3 },
    ],
  },
  archer: {
    id: 'archer', name: 'Spectral Archer', icon: '🏹', shopPrice: 0, cost: 125, attack: 'arrow',
    desc: 'A ghostly marksman with very long range.',
    perk: 'True Sight: can hit invisible Phantoms. Fast, long-range shots.',
    levels: [
      { dmg: 8, range: 13, cd: 0.45, trueSight: true },
      { cost: 100, dmg: 12, range: 14, cd: 0.4 },
      { cost: 230, dmg: 20, range: 15, cd: 0.35 },
      { cost: 480, dmg: 34, range: 17, cd: 0.25 },
    ],
  },
  pyro: {
    id: 'pyro', name: 'Pyromancer', icon: '🔥', shopPrice: 300, cost: 300, attack: 'fire',
    desc: 'Launches exploding fireballs that set foes ablaze.',
    perk: 'Area damage + burning. Ignores half of enemy armor.',
    levels: [
      { dmg: 25, range: 8.5, cd: 1.4, splash: 3, burn: 8, burnTime: 2, pierce: 0.5 },
      { cost: 220, dmg: 38, splash: 3.2, burn: 12 },
      { cost: 420, dmg: 60, range: 9.5, splash: 3.5, burn: 20 },
      { cost: 800, dmg: 100, range: 10.5, cd: 1.1, splash: 4, burn: 35, burnTime: 3 },
    ],
  },
  storm: {
    id: 'storm', name: 'Storm Mage', icon: '⚡', shopPrice: 500, cost: 400, attack: 'chain',
    desc: 'Calls chain lightning that leaps between enemies.',
    perk: 'Hits several enemies per strike. True Sight.',
    levels: [
      { dmg: 20, range: 10, cd: 1.1, chains: 3, trueSight: true },
      { cost: 260, dmg: 30, chains: 4 },
      { cost: 520, dmg: 48, range: 11, cd: 1.0, chains: 5 },
      { cost: 950, dmg: 80, range: 12, cd: 0.85, chains: 7 },
    ],
  },
  necro: {
    id: 'necro', name: 'Necromancer', icon: '💀', shopPrice: 750, cost: 350, attack: 'shadow',
    desc: 'Curses the living dead and harvests their souls.',
    perk: 'Cursed enemies in range take extra damage from ALL towers. Kills nearby give you bonus mana.',
    levels: [
      { dmg: 10, range: 9, cd: 0.9, curse: 0.15, harvest: 2 },
      { cost: 250, dmg: 16, curse: 0.2, harvest: 3 },
      { cost: 500, dmg: 26, range: 10, curse: 0.25, harvest: 4 },
      { cost: 900, dmg: 40, range: 11, curse: 0.35, harvest: 6 },
    ],
  },
  obelisk: {
    id: 'obelisk', name: 'Celestial Obelisk', icon: '✨', shopPrice: 900, cost: 500, attack: 'aura',
    desc: 'A holy monolith that empowers nearby defenders.',
    perk: 'No attack. Towers in range get bonus damage, bonus range and True Sight.',
    levels: [
      { range: 7, buff: 0.15, rangeBuff: 0.05 },
      { cost: 350, range: 8, buff: 0.22, rangeBuff: 0.08 },
      { cost: 650, range: 9, buff: 0.3, rangeBuff: 0.1 },
      { cost: 1100, range: 10, buff: 0.4, rangeBuff: 0.15 },
    ],
  },
  dragon: {
    id: 'dragon', name: 'Dragon Roost', icon: '🐉', shopPrice: 1500, cost: 1200, attack: 'dragon',
    desc: 'An ancient dragon that rains fire from its perch.',
    perk: 'Huge explosions, heavy burn, pierces 75% armor. Level 3 gains True Sight.',
    levels: [
      { dmg: 80, range: 12, cd: 2.0, splash: 4, burn: 20, burnTime: 3, pierce: 0.75 },
      { cost: 700, dmg: 120, splash: 4.5, burn: 30 },
      { cost: 1300, dmg: 180, range: 13, cd: 1.8, burn: 45 },
      { cost: 2200, dmg: 300, range: 14, cd: 1.5, splash: 5.5, burn: 70, trueSight: true },
    ],
  },
};
export const TOWER_ORDER = Object.keys(TOWERS);

export function towerStats(type, level) {
  const def = TOWERS[type];
  const s = {};
  for (let i = 0; i <= level; i++) Object.assign(s, def.levels[i]);
  delete s.cost;
  return s;
}
export function upgradeCost(type, level) {
  const next = TOWERS[type].levels[level + 1];
  return next ? next.cost : null;
}

export const ENEMIES = {
  zombie:   { name: 'Zombie',          hp: 60,   speed: 2.2, bounty: 6,   dmg: 1 },
  bat:      { name: 'Vampire Bat',     hp: 35,   speed: 4.5, bounty: 5,   dmg: 1, flying: true },
  skeleton: { name: 'Skeleton Knight', hp: 160,  speed: 1.8, bounty: 12,  dmg: 2, armor: 4 },
  phantom:  { name: 'Phantom',         hp: 90,   speed: 3.0, bounty: 12,  dmg: 2, hidden: true },
  golem:    { name: 'Stone Golem',     hp: 600,  speed: 1.2, bounty: 40,  dmg: 5, armor: 8, slowRes: 0.3 },
  lich:     { name: 'The Lich King',   hp: 6000, speed: 0.9, bounty: 500, dmg: 50, armor: 10, slowRes: 0.5, boss: true,
              summon: { e: 'skeleton', n: 2, every: 8 } },
};
export const ENEMY_KEYS = Object.keys(ENEMIES);

// Each wave: groups of { e: enemy, n: count, gap: seconds between spawns, at: first spawn time }
export const WAVES = [
  { msg: 'The dead are rising…', groups: [{ e: 'zombie', n: 10, gap: 1.5, at: 3 }] },
  { msg: 'Vampire bats swarm in!', groups: [{ e: 'zombie', n: 14, gap: 1.1, at: 3 }, { e: 'bat', n: 6, gap: 1.0, at: 12 }] },
  { msg: 'Skeleton Knights are armored — hit them hard.', groups: [{ e: 'zombie', n: 14, gap: 1.0, at: 3 }, { e: 'skeleton', n: 5, gap: 2.5, at: 10 }, { e: 'bat', n: 8, gap: 0.8, at: 20 }] },
  { msg: 'Phantoms are invisible! Only True Sight towers can hit them.', groups: [{ e: 'skeleton', n: 10, gap: 1.6, at: 3 }, { e: 'phantom', n: 4, gap: 2, at: 14 }, { e: 'zombie', n: 16, gap: 0.7, at: 22 }] },
  { msg: 'Stone Golems approach — heavy armor!', groups: [{ e: 'golem', n: 2, gap: 8, at: 3 }, { e: 'skeleton', n: 12, gap: 1.3, at: 8 }, { e: 'bat', n: 12, gap: 0.6, at: 18 }, { e: 'phantom', n: 6, gap: 1.5, at: 26 }] },
  { msg: 'A horde of the dead!', groups: [{ e: 'zombie', n: 30, gap: 0.45, at: 3 }, { e: 'phantom', n: 10, gap: 1.2, at: 12 }, { e: 'skeleton', n: 10, gap: 1.2, at: 22 }] },
  { msg: 'The sky darkens with wings…', groups: [{ e: 'golem', n: 5, gap: 4, at: 3 }, { e: 'bat', n: 20, gap: 0.4, at: 10 }, { e: 'skeleton', n: 15, gap: 1.0, at: 18 }] },
  { msg: 'Spirits and stone march together.', groups: [{ e: 'phantom', n: 18, gap: 0.8, at: 3 }, { e: 'golem', n: 6, gap: 3.5, at: 10 }, { e: 'skeleton', n: 20, gap: 0.8, at: 20 }] },
  { msg: 'The final army gathers!', groups: [{ e: 'golem', n: 10, gap: 2.5, at: 3 }, { e: 'phantom', n: 20, gap: 0.7, at: 8 }, { e: 'bat', n: 30, gap: 0.35, at: 20 }, { e: 'skeleton', n: 20, gap: 0.7, at: 30 }] },
  { msg: 'THE LICH KING HAS AWOKEN!', boss: true, groups: [{ e: 'skeleton', n: 20, gap: 0.8, at: 3 }, { e: 'phantom', n: 15, gap: 0.9, at: 10 }, { e: 'lich', n: 1, gap: 1, at: 20 }, { e: 'golem', n: 6, gap: 3, at: 24 }] },
];

export const MAPS = {
  graveyard: {
    id: 'graveyard', name: 'Haunted Graveyard',
    desc: 'Crooked tombstones beneath a blood moon.',
    theme: { ground: 0x4a5066, path: 0x7a6249, sky: 0x150d26, fog: 0x1f1533, hemi: 0x9d8fe6, sun: 0xd4c8ff, sunI: 2.2, exposure: 1.3, particles: 0xb388ff, deco: ['tomb', 'tomb', 'deadtree', 'cross', 'pumpkin'] },
    path: [[0, 3], [5, 3], [5, 12], [11, 12], [11, 3], [18, 3], [18, 12], [22, 12]],
  },
  forest: {
    id: 'forest', name: 'Enchanted Forest',
    desc: 'Glowing mushrooms and ancient trees.',
    theme: { ground: 0x3f7a3f, path: 0x9a7650, sky: 0x10301f, fog: 0x1f4a33, hemi: 0xb5f0b5, sun: 0xfff1c4, sunI: 2.2, exposure: 1.15, particles: 0xd9ff66, deco: ['tree', 'tree', 'mushroom', 'rock', 'tree'] },
    path: [[0, 8], [6, 8], [6, 2], [12, 2], [12, 13], [18, 13], [18, 6], [22, 6]],
  },
  frost: {
    id: 'frost', name: 'Frozen Peaks',
    desc: 'A long, winding pass through snow and ice.',
    theme: { ground: 0xdfe8f2, path: 0x8aa0b8, sky: 0x8fb7dd, fog: 0xbcd3e8, hemi: 0xe6f2ff, sun: 0xffffff, sunI: 1.6, exposure: 0.95, particles: 0xffffff, deco: ['pine', 'pine', 'icecrystal', 'snowrock'] },
    path: [[0, 1], [20, 1], [20, 5], [3, 5], [3, 10], [20, 10], [20, 14], [22, 14]],
  },
  inferno: {
    id: 'inferno', name: 'Infernal Depths',
    desc: 'A short, scorching path. For the brave.',
    theme: { ground: 0x4a2a22, path: 0x8a4428, sky: 0x1f0805, fog: 0x3a120a, hemi: 0xffa07a, sun: 0xffc08a, sunI: 2.2, exposure: 1.3, particles: 0xff7a1a, deco: ['lavarock', 'spike', 'lavapool', 'lavarock'] },
    path: [[0, 2], [9, 2], [9, 13], [15, 13], [15, 2], [22, 2]],
  },
};
export const MAP_ORDER = Object.keys(MAPS);

export function tileToWorld(i, j) {
  return { x: (i - GRID_W / 2 + 0.5) * TILE, z: (j - GRID_H / 2 + 0.5) * TILE };
}
export function worldToTile(x, z) {
  return { i: Math.floor(x / TILE + GRID_W / 2), j: Math.floor(z / TILE + GRID_H / 2) };
}
export const tileKey = (i, j) => i + ',' + j;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function seededRng(seed) { return mulberry32(typeof seed === 'string' ? hashStr(seed) : seed); }

// Builds the deterministic layout of a map: path geometry, path tiles and blocking decorations.
export function buildMap(mapId) {
  const m = MAPS[mapId];
  const pts = m.path.map(([i, j]) => tileToWorld(i, j));
  const segs = [];
  let length = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segs.push({ a, b, len, start: length, angle: Math.atan2(b.x - a.x, b.z - a.z) });
    length += len;
  }
  const pathTiles = new Set();
  for (let k = 0; k < m.path.length - 1; k++) {
    let [i, j] = m.path[k];
    const [ti, tj] = m.path[k + 1];
    const di = Math.sign(ti - i), dj = Math.sign(tj - j);
    pathTiles.add(tileKey(i, j));
    while (i !== ti || j !== tj) { i += di; j += dj; pathTiles.add(tileKey(i, j)); }
  }
  const rng = seededRng(mapId);
  const blocked = new Set();
  const deco = [];
  let tries = 0;
  while (deco.length < 26 && tries++ < 500) {
    const i = Math.floor(rng() * GRID_W), j = Math.floor(rng() * GRID_H);
    const k = tileKey(i, j);
    if (pathTiles.has(k) || blocked.has(k)) continue;
    blocked.add(k);
    deco.push({ i, j, kind: m.theme.deco[Math.floor(rng() * m.theme.deco.length)], rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5 });
  }
  const end = m.path[m.path.length - 1];
  return { ...m, pts, segs, length, pathTiles, blocked, deco, start: m.path[0], end };
}

export function pathPos(map, d) {
  if (d <= 0) { const s = map.segs[0]; return { x: s.a.x, z: s.a.z, angle: s.angle }; }
  for (const s of map.segs) {
    if (d <= s.start + s.len) {
      const t = (d - s.start) / s.len;
      return { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t, angle: s.angle };
    }
  }
  const s = map.segs[map.segs.length - 1];
  return { x: s.b.x, z: s.b.z, angle: s.angle };
}

export function canBuild(map, i, j, occupied) {
  if (i < 0 || j < 0 || i >= GRID_W || j >= GRID_H) return false;
  const k = tileKey(i, j);
  return !map.pathTiles.has(k) && !map.blocked.has(k) && !occupied.has(k);
}
