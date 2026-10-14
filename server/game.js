// Authoritative match simulation. One Game instance runs per party while a match is in progress.
import {
  TOWERS, ENEMIES, WAVES, DIFFICULTIES, ROUND_TIME, TOTAL_ROUNDS, SELL_REFUND, FREE_TOWERS_FOR_NEW,
  STARTER_TOWERS, TARGET_MODES, buildMap, pathPos, towerStats, upgradeCost, tileToWorld, tileKey, canBuild, roundBonus,
} from '../public/shared/data.js';

const TICK = 0.05;          // 20 simulation steps per second
const SNAP_EVERY = 2;       // broadcast state 10 times per second
const MAX_TOWERS = 60;
const CHAIN_JUMP = 5;

export class Game {
  constructor({ mapId, diffId, players, broadcast, sendTo, onEnd }) {
    this.gid = Math.random().toString(36).slice(2, 10);
    this.mapId = mapId;
    this.diffId = diffId;
    this.map = buildMap(mapId);
    this.diff = DIFFICULTIES[diffId];
    this.broadcast = broadcast;
    this.sendTo = sendTo;
    this.onEnd = onEnd;

    this.players = new Map();
    players.forEach((p) => {
      const owned = new Set(STARTER_TOWERS);
      (p.owned || []).forEach((t) => TOWERS[t] && owned.add(t));
      this.players.set(p.id, {
        id: p.id, name: p.name, color: p.color, owned,
        mana: this.diff.startMana, free: p.isNew ? FREE_TOWERS_FOR_NEW : 0,
        skip: false, connected: true,
      });
    });
    // every player earns mana from every kill, so enemies get tougher for each extra player
    this.hpScale = this.diff.hpMult * (1 + 0.8 * (players.length - 1));
    this.maxHp = this.baseHp = this.diff.baseHp;
    this.time = 0;
    this.tickCount = 0;
    this.nextId = 1;
    this.enemies = [];
    this.towers = new Map();
    this.occupied = new Set();
    this.towerVersion = 1;
    this.events = [];
    this.phase = 'playing';
    this.buffs = new Map();
    this.stats = { kills: 0, leaks: 0 };

    this.startRound(1);
    this.interval = setInterval(() => this.step(), TICK * 1000);
  }

  destroy() { clearInterval(this.interval); }

  startRound(n) {
    this.round = n;
    this.roundLeft = ROUND_TIME;
    this.roundElapsed = 0;
    const wave = WAVES[n - 1];
    this.spawnQueue = [];
    for (const g of wave.groups) for (let k = 0; k < g.n; k++) this.spawnQueue.push({ t: g.at + k * g.gap, e: g.e });
    this.spawnQueue.sort((a, b) => a.t - b.t);
    if (n > 1) for (const p of this.players.values()) p.mana += roundBonus(n);
    for (const p of this.players.values()) p.skip = false;
    this.events.push(['round', n]);
  }

  spawn(type, d = 0) {
    const def = ENEMIES[type];
    const roundScale = 1 + 0.06 * (this.round - 1);
    const hp = Math.round(def.hp * this.hpScale * roundScale);
    this.enemies.push({
      id: this.nextId++, type, d, hp, maxHp: hp, armor: def.armor || 0, speed: def.speed,
      slowRes: def.slowRes || 0, hidden: !!def.hidden, slowAmt: 0, slowUntil: 0,
      burnDps: 0, burnUntil: 0, curse: 0, x: 0, z: 0, dead: false,
      summonT: def.summon ? def.summon.every : 0,
    });
  }

  // ---------- commands from players ----------
  command(pid, msg) {
    const p = this.players.get(pid);
    if (!p || this.phase !== 'playing') return;
    const toast = (text) => this.sendTo(pid, { t: 'toast', text });
    switch (msg.a) {
      case 'place': {
        const def = TOWERS[msg.tower];
        const i = msg.i | 0, j = msg.j | 0;
        if (!def || !p.owned.has(msg.tower)) return toast("You don't own that tower.");
        if (this.towers.size >= MAX_TOWERS) return toast('Tower limit reached for this match.');
        if (!canBuild(this.map, i, j, this.occupied)) return toast("Can't build there.");
        const free = p.free > 0 && STARTER_TOWERS.includes(msg.tower);
        if (!free && p.mana < def.cost) return toast('Not enough mana.');
        if (free) p.free--; else p.mana -= def.cost;
        const { x, z } = tileToWorld(i, j);
        const t = { id: this.nextId++, type: msg.tower, owner: pid, i, j, x, z, level: 0, cd: 0.3, mode: 0, spent: free ? 0 : def.cost };
        this.towers.set(t.id, t);
        this.occupied.add(tileKey(i, j));
        this.towersChanged();
        this.events.push(['place', t.id]);
        break;
      }
      case 'upgrade': {
        const t = this.towers.get(msg.id);
        if (!t || t.owner !== pid) return toast('You can only upgrade your own towers.');
        const cost = upgradeCost(t.type, t.level);
        if (cost == null) return toast('Already max level.');
        if (p.mana < cost) return toast('Not enough mana.');
        p.mana -= cost;
        t.spent += cost;
        t.level++;
        this.towersChanged();
        this.events.push(['upgrade', t.id]);
        break;
      }
      case 'sell': {
        const t = this.towers.get(msg.id);
        if (!t || t.owner !== pid) return toast('You can only sell your own towers.');
        p.mana += Math.floor(t.spent * SELL_REFUND);
        this.towers.delete(t.id);
        this.occupied.delete(tileKey(t.i, t.j));
        this.towersChanged();
        this.events.push(['sell', t.id]);
        break;
      }
      case 'target': {
        const t = this.towers.get(msg.id);
        if (!t || t.owner !== pid) return;
        t.mode = (t.mode + 1) % TARGET_MODES.length;
        this.towersChanged();
        break;
      }
      case 'skip': {
        if (!this.canSkip()) return toast('You can skip once every enemy of this wave has spawned.');
        p.skip = !p.skip;
        break;
      }
    }
  }

  setConnected(pid, on) {
    const p = this.players.get(pid);
    if (p) { p.connected = on; if (!on) p.skip = false; }
  }

  canSkip() { return this.phase === 'playing' && this.round < TOTAL_ROUNDS && this.spawnQueue.length === 0; }

  towersChanged() {
    this.towerVersion++;
    // Recompute obelisk buffs (they only change when towers change).
    this.buffs.clear();
    for (const t of this.towers.values()) {
      if (TOWERS[t.type].attack !== 'aura') continue;
      const s = towerStats(t.type, t.level);
      for (const o of this.towers.values()) {
        if (o === t || TOWERS[o.type].attack === 'aura') continue;
        if (Math.hypot(o.x - t.x, o.z - t.z) > s.range) continue;
        const b = this.buffs.get(o.id) || { dmg: 0, range: 0, sight: false };
        b.dmg = Math.max(b.dmg, s.buff);
        b.range = Math.max(b.range, s.rangeBuff);
        b.sight = true;
        this.buffs.set(o.id, b);
      }
    }
  }

  // ---------- simulation ----------
  step() {
    if (this.phase !== 'playing') return;
    const dt = TICK;
    this.time += dt;
    this.roundElapsed += dt;
    this.roundLeft = Math.max(0, this.roundLeft - dt);
    this.tickCount++;

    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.roundElapsed) this.spawn(this.spawnQueue.shift().e);

    // Necromancer curses (re-applied every tick)
    for (const e of this.enemies) e.curse = 0;
    const towerList = [...this.towers.values()];
    for (const t of towerList) {
      if (t.type !== 'necro') continue;
      const s = towerStats(t.type, t.level);
      const r2 = s.range * s.range;
      for (const e of this.enemies) if ((e.x - t.x) ** 2 + (e.z - t.z) ** 2 <= r2) e.curse = Math.max(e.curse, s.curse);
    }

    // Move enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      let speed = e.speed;
      if (this.time < e.slowUntil) speed *= 1 - e.slowAmt * (1 - e.slowRes);
      if (this.time < e.burnUntil) this.damage(e, e.burnDps * dt, null, 1);
      e.d += speed * dt;
      const def = ENEMIES[e.type];
      if (def.summon) {
        e.summonT -= dt;
        if (e.summonT <= 0) {
          e.summonT = def.summon.every;
          for (let k = 0; k < def.summon.n; k++) this.spawn(def.summon.e, Math.max(0, e.d - 1.5 - k * 1.5));
          this.events.push(['summon', e.id]);
        }
      }
      if (e.d >= this.map.length) {
        e.dead = true; e.leaked = true;
        this.baseHp = Math.max(0, this.baseHp - def.dmg);
        this.stats.leaks++;
        this.events.push(['leak', e.id, def.dmg]);
      } else {
        const pos = pathPos(this.map, e.d);
        e.x = pos.x; e.z = pos.z;
      }
    }

    // Towers attack
    for (const t of towerList) {
      const def = TOWERS[t.type];
      if (def.attack === 'aura') continue;
      t.cd -= dt;
      if (t.cd > 0) continue;
      const s = towerStats(t.type, t.level);
      const buff = this.buffs.get(t.id);
      const range = s.range * (1 + (buff ? buff.range : 0));
      const sight = s.trueSight || (buff && buff.sight);
      const target = this.pickTarget(t, range, sight);
      if (!target) continue;
      t.cd = s.cd;
      this.fire(t, def, s, target, sight, buff ? 1 + buff.dmg : 1);
    }

    // Resolve deaths
    if (this.enemies.some((e) => e.dead)) {
      const alive = [];
      for (const e of this.enemies) {
        if (!e.dead) { alive.push(e); continue; }
        if (e.leaked) continue;
        this.stats.kills++;
        const bounty = ENEMIES[e.type].bounty;
        for (const p of this.players.values()) p.mana += bounty;
        for (const t of towerList) {
          if (t.type !== 'necro') continue;
          const s = towerStats(t.type, t.level);
          if ((e.x - t.x) ** 2 + (e.z - t.z) ** 2 <= s.range * s.range) {
            const owner = this.players.get(t.owner);
            if (owner) owner.mana += s.harvest;
          }
        }
        this.events.push(['die', e.id]);
      }
      this.enemies = alive;
    }

    // Round flow
    if (this.baseHp <= 0) return this.finish(false);
    const waveDone = this.spawnQueue.length === 0;
    if (this.round === TOTAL_ROUNDS) {
      if (waveDone && this.enemies.length === 0) return this.finish(true);
    } else if (this.roundLeft <= 0) {
      this.startRound(this.round + 1);
    } else if (waveDone) {
      const online = [...this.players.values()].filter((p) => p.connected);
      const votes = online.filter((p) => p.skip).length;
      if (online.length && votes > online.length / 2) {
        this.events.push(['skipped', this.round]);
        this.startRound(this.round + 1);
      }
    }

    if (this.tickCount % SNAP_EVERY === 0) this.broadcast(this.snapshot());
  }

  pickTarget(t, range, sight) {
    const r2 = range * range;
    const mode = TARGET_MODES[t.mode];
    let best = null, bestScore = -Infinity;
    for (const e of this.enemies) {
      if (e.dead || (e.hidden && !sight)) continue;
      const d2 = (e.x - t.x) ** 2 + (e.z - t.z) ** 2;
      if (d2 > r2) continue;
      const score = mode === 'first' ? e.d : mode === 'last' ? -e.d : mode === 'strong' ? e.hp : -d2;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  fire(t, def, s, target, sight, mult) {
    const dmg = s.dmg * mult;
    switch (def.attack) {
      case 'bolt': case 'arrow': case 'shadow':
        this.damage(target, dmg, t, 0, s.pierce);
        this.events.push(['shot', t.id, target.id]);
        break;
      case 'frost':
      case 'fire':
      case 'dragon': {
        const r2 = s.splash * s.splash;
        for (const e of this.enemies) {
          if (e.dead || (e.x - target.x) ** 2 + (e.z - target.z) ** 2 > r2) continue;
          this.damage(e, e === target ? dmg : dmg * 0.7, t, 0, s.pierce);
          if (s.slow) {
            if (this.time >= e.slowUntil || s.slow >= e.slowAmt) e.slowAmt = s.slow;
            e.slowUntil = this.time + s.slowTime;
          }
          if (s.burn) {
            e.burnDps = this.time < e.burnUntil ? Math.max(e.burnDps, s.burn * mult) : s.burn * mult;
            e.burnUntil = this.time + s.burnTime;
          }
        }
        this.events.push(['shot', t.id, target.id]);
        break;
      }
      case 'chain': {
        const hit = [target];
        let cur = target;
        while (hit.length < s.chains) {
          let next = null, nd = CHAIN_JUMP * CHAIN_JUMP;
          for (const e of this.enemies) {
            if (e.dead || hit.includes(e) || (e.hidden && !sight)) continue;
            const d2 = (e.x - cur.x) ** 2 + (e.z - cur.z) ** 2;
            if (d2 < nd) { nd = d2; next = e; }
          }
          if (!next) break;
          hit.push(next); cur = next;
        }
        hit.forEach((e, k) => this.damage(e, dmg * Math.pow(0.85, k), t, 0, 0));
        this.events.push(['shot', t.id, ...hit.map((e) => e.id)]);
        break;
      }
    }
  }

  // pure = 1 for burn ticks (armor already accounted for in tick damage scale)
  damage(e, raw, tower, pure, pierce = 0) {
    if (e.dead) return;
    let dmg = raw;
    if (!pure) {
      const armor = e.armor * (1 - (pierce || 0));
      dmg = Math.max(raw * 0.2, raw - armor);
    }
    dmg *= 1 + e.curse;
    e.hp -= dmg;
    if (e.hp <= 0) e.dead = true;
  }

  finish(won) {
    this.phase = won ? 'won' : 'lost';
    this.broadcast(this.snapshot());
    this.destroy();
    const result = {
      t: 'gameOver', gid: this.gid, won, round: this.round, diff: this.diffId, map: this.mapId,
      coins: won ? this.diff.coins : 0, kills: this.stats.kills,
    };
    this.broadcast(result);
    this.onEnd(result);
  }

  // ---------- network state ----------
  towerList() {
    return [...this.towers.values()].map((t) => [t.id, t.type, t.i, t.j, t.level, t.owner, t.mode, t.spent]);
  }

  // full = a one-off snapshot for a (re)joining player; it must not consume shared events or tower diffs.
  snapshot(full = false) {
    let ev = [];
    if (!full) { ev = this.events; this.events = []; }
    const snap = {
      t: 'snap', r: this.round, rl: Math.ceil(this.roundLeft * 10) / 10, hp: this.baseHp, mhp: this.maxHp,
      ph: this.phase, cs: this.canSkip() ? 1 : 0, tv: this.towerVersion,
      pl: [...this.players.values()].map((p) => [p.id, Math.floor(p.mana), p.free, p.skip ? 1 : 0, p.connected ? 1 : 0]),
      en: this.enemies.map((e) => [
        e.id, e.type, Math.round(e.d * 100) / 100, Math.round((e.hp / e.maxHp) * 100) / 100,
        (this.time < e.slowUntil ? 1 : 0) | (this.time < e.burnUntil ? 2 : 0) | (e.curse > 0 ? 4 : 0),
      ]),
      ev,
    };
    if (full) snap.tw = this.towerList();
    else if (this._lastTv !== this.towerVersion) { snap.tw = this.towerList(); this._lastTv = this.towerVersion; }
    return snap;
  }

  startInfo() {
    return {
      t: 'gameStart', gid: this.gid, map: this.mapId, diff: this.diffId,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, owned: [...p.owned] })),
    };
  }
}
