// Supernatural Tower Defense — web server + party/lobby system.
// Serves the game website and runs every match on the server so all friends see the same thing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './server/game.js';
import { MAPS, DIFFICULTIES, TOWERS, MAX_PARTY, PLAYER_COLORS, MAP_ORDER } from './public/shared/data.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const PORT = Number(process.env.PORT) || 3000;
const OFFLINE_GRACE_MS = 30_000;

// ---------- admin key ----------
// Anyone who enters this key in the in-game Settings becomes an Admin: their map/difficulty pick overrules party votes.
function loadAdminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY.trim();
  const file = path.join(ROOT, 'admin-key.txt');
  try { const k = fs.readFileSync(file, 'utf8').trim(); if (k) return k; } catch {}
  const k = crypto.randomBytes(5).toString('hex');
  try { fs.writeFileSync(file, k + '\n'); } catch {}
  return k;
}
const ADMIN_KEY = loadAdminKey();
function isAdminKey(key) {
  if (typeof key !== 'string' || !key) return false;
  const a = Buffer.from(key.trim()), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function resolveStatic(urlPath) {
  let base = PUBLIC_DIR, rel = urlPath;
  if (urlPath.startsWith('/vendor/three/')) {
    base = THREE_DIR;
    rel = urlPath.slice('/vendor/three'.length);
    if (!rel.startsWith('/build/') && !rel.startsWith('/examples/jsm/')) return null;
  }
  if (rel === '/') rel = '/index.html';
  const full = path.normalize(path.join(base, rel));
  return full.startsWith(base + path.sep) ? full : null;
}
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (urlPath === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return; }
  const file = resolveStatic(urlPath);
  if (!file) { res.writeHead(404).end('Not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': file.startsWith(THREE_DIR) ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- sessions & parties ----------
const sessions = new Map(); // client id (secret, per browser tab) -> session
const byPid = new Map();    // public player id -> session
const parties = new Map();  // 5-digit code -> party

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function send(s, msg) { if (s && s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(msg)); }
function partyBroadcast(p, msg) {
  const str = JSON.stringify(msg);
  for (const cid of p.members) { const s = sessions.get(cid); if (s && s.ws && s.ws.readyState === 1) s.ws.send(str); }
}
function cleanName(n) {
  n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return n || 'Wizard' + Math.floor(1000 + Math.random() * 9000);
}
function cleanOwned(arr) { return Array.isArray(arr) ? [...new Set(arr.filter((t) => typeof t === 'string' && TOWERS[t]))] : []; }
function newCode() { let c; do { c = String(Math.floor(10000 + Math.random() * 90000)); } while (parties.has(c)); return c; }
function memberColor(p, cid) { return PLAYER_COLORS[Math.max(0, p.members.indexOf(cid)) % PLAYER_COLORS.length]; }

// An admin pick only counts while that admin is still in the party.
function activeAdminPick(p) {
  const pick = {};
  for (const key of ['map', 'diff']) {
    const by = p.adminPick[key + 'By'];
    const s = by && sessions.get(by);
    if (s && s.admin && p.members.includes(by)) pick[key] = p.adminPick[key];
  }
  return pick;
}

function partyState(p) {
  return {
    t: 'party', code: p.code, solo: p.solo, status: p.game ? 'ingame' : 'lobby',
    leader: sessions.get(p.leader)?.pid,
    adminPick: activeAdminPick(p),
    members: p.members.map((cid) => {
      const s = sessions.get(cid);
      return { id: s.pid, name: s.name, admin: s.admin, online: !!s.ws, color: memberColor(p, cid), vote: p.votes.get(cid) || {} };
    }),
  };
}
const syncParty = (p) => partyBroadcast(p, partyState(p));
function systemChat(p, text) { partyBroadcast(p, { t: 'chat', system: true, text }); }

function createParty(s, solo) {
  leaveParty(s, true);
  const p = { code: newCode(), solo: !!solo, leader: s.cid, members: [s.cid], votes: new Map(), adminPick: {}, game: null };
  parties.set(p.code, p);
  s.party = p.code;
  log(`[${p.code}] ${solo ? 'solo game' : 'party'} created by ${s.name}`);
  syncParty(p);
}

function joinParty(s, code) {
  code = String(code || '').trim();
  if (!/^\d{5}$/.test(code)) return send(s, { t: 'error', text: 'Party codes are 5 numbers.' });
  const p = parties.get(code);
  if (!p || p.solo) return send(s, { t: 'error', text: `No party found with code ${code}.` });
  if (s.party === code) return syncParty(p);
  if (p.game) return send(s, { t: 'error', text: 'That party is in the middle of a match. Try again when it ends.' });
  if (p.members.length >= MAX_PARTY) return send(s, { t: 'error', text: `That party is full (${MAX_PARTY} players).` });
  leaveParty(s, true);
  p.members.push(s.cid);
  s.party = code;
  log(`[${code}] ${s.name} joined (${p.members.length} players)`);
  syncParty(p);
  systemChat(p, `${s.name} joined the party.`);
}

// switching = moving straight into another party, so the client should not bounce to the title screen
function leaveParty(s, switching = false) {
  const p = s.party && parties.get(s.party);
  s.party = null;
  if (!p) return;
  p.members = p.members.filter((c) => c !== s.cid);
  p.votes.delete(s.cid);
  if (p.game) p.game.setConnected(s.pid, false);
  if (!switching) send(s, { t: 'partyLeft' });
  log(`[${p.code}] ${s.name} left`);
  if (!p.members.length) {
    if (p.game) p.game.destroy();
    parties.delete(p.code);
    log(`[${p.code}] closed`);
    return;
  }
  if (p.leader === s.cid) p.leader = p.members[0];
  syncParty(p);
  systemChat(p, `${s.name} left the party.`);
}

function vote(s, msg) {
  const p = parties.get(s.party);
  if (!p || p.game) return;
  const v = { ...(p.votes.get(s.cid) || {}) };
  if (MAPS[msg.map]) { v.map = msg.map; if (s.admin) { p.adminPick.map = msg.map; p.adminPick.mapBy = s.cid; } }
  if (DIFFICULTIES[msg.diff]) { v.diff = msg.diff; if (s.admin) { p.adminPick.diff = msg.diff; p.adminPick.diffBy = s.cid; } }
  p.votes.set(s.cid, v);
  syncParty(p);
}

function resolveChoice(p, key, options, fallback) {
  const admin = activeAdminPick(p)[key];
  if (admin) return admin;
  const tally = new Map();
  for (const v of p.votes.values()) if (v[key]) tally.set(v[key], (tally.get(v[key]) || 0) + 1);
  if (!tally.size) return fallback ?? options[Math.floor(Math.random() * options.length)];
  const top = Math.max(...tally.values());
  const tied = [...tally].filter(([, n]) => n === top).map(([k]) => k);
  return tied[Math.floor(Math.random() * tied.length)];
}

function startMatch(s) {
  const p = parties.get(s.party);
  if (!p || p.game) return;
  if (p.leader !== s.cid) return send(s, { t: 'error', text: 'Only the party leader can start the match.' });
  const mapId = resolveChoice(p, 'map', MAP_ORDER);
  const diffId = resolveChoice(p, 'diff', Object.keys(DIFFICULTIES), 'medium');
  const players = p.members.map((cid) => {
    const m = sessions.get(cid);
    return { id: m.pid, name: m.name, color: memberColor(p, cid), owned: m.owned, isNew: m.isNew };
  });
  p.game = new Game({
    mapId, diffId, players,
    broadcast: (msg) => partyBroadcast(p, msg),
    sendTo: (pid, msg) => send(byPid.get(pid), msg),
    onEnd: (r) => { log(`[${p.code}] match ended: ${r.won ? 'VICTORY' : 'defeat'} on round ${r.round}`); p.game = null; syncParty(p); },
  });
  for (const cid of p.members) { const m = sessions.get(cid); if (!m.ws) p.game.setConnected(m.pid, false); }
  log(`[${p.code}] match started: ${MAPS[mapId].name}, ${DIFFICULTIES[diffId].name}, ${players.length} player(s)`);
  partyBroadcast(p, p.game.startInfo());
  syncParty(p);
}

function hello(ws, msg) {
  const cid = typeof msg.cid === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(msg.cid) ? msg.cid : null;
  if (!cid) return ws.close(4001, 'bad client id');
  let s = sessions.get(cid);
  if (s) {
    if (s.ws && s.ws !== ws) { try { s.ws.close(4000, 'replaced'); } catch {} }
  } else {
    s = { cid, pid: crypto.randomBytes(4).toString('hex'), party: null, lastChat: 0 };
    sessions.set(cid, s);
    byPid.set(s.pid, s);
  }
  s.ws = ws;
  ws.session = s;
  applyProfile(s, msg);
  log(`${s.name} connected${s.party ? ` (back in party ${s.party})` : ''}`);
  s.isNew = !!msg.isNew;
  const p = s.party && parties.get(s.party);
  send(s, { t: 'me', id: s.pid, name: s.name, admin: s.admin, adminRejected: !!msg.adminKey && !s.admin, inParty: !!p, inGame: !!(p && p.game && p.game.players.has(s.pid)) });
  if (p) {
    syncParty(p);
    if (p.game && p.game.players.has(s.pid)) {
      p.game.setConnected(s.pid, true);
      send(s, p.game.startInfo());
      send(s, p.game.snapshot(true));
    }
  }
}

function applyProfile(s, msg) {
  s.name = cleanName(msg.name);
  s.owned = cleanOwned(msg.owned);
  s.admin = isAdminKey(msg.adminKey);
}

function onMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'hello') return hello(ws, msg);
  const s = ws.session;
  if (!s) return;
  switch (msg.t) {
    case 'profile': {
      applyProfile(s, msg);
      send(s, { t: 'me', id: s.pid, name: s.name, admin: s.admin, adminRejected: !!msg.adminKey && !s.admin });
      const p = parties.get(s.party);
      if (p) syncParty(p);
      break;
    }
    case 'createParty': return createParty(s, msg.solo);
    case 'joinParty': return joinParty(s, msg.code);
    case 'leaveParty': return leaveParty(s);
    case 'vote': return vote(s, msg);
    case 'start': return startMatch(s);
    case 'chat': {
      const p = parties.get(s.party);
      const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
      if (!p || !text || Date.now() - s.lastChat < 400) return;
      s.lastChat = Date.now();
      partyBroadcast(p, { t: 'chat', from: s.name, color: memberColor(p, s.cid), text });
      break;
    }
    case 'g': {
      const p = parties.get(s.party);
      if (p && p.game) p.game.command(s.pid, msg);
      break;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => onMessage(ws, data.toString()));
  ws.on('close', () => {
    const s = ws.session;
    if (!s || s.ws !== ws) return;
    s.ws = null;
    s.lastSeen = Date.now();
    log(`${s.name} disconnected`);
    const p = parties.get(s.party);
    if (p) { if (p.game) p.game.setConnected(s.pid, false); syncParty(p); }
  });
});

// Keep connections alive behind proxies, and clean up players who closed their tab.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25_000);
setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (s.ws || now - s.lastSeen < OFFLINE_GRACE_MS) continue;
    const p = parties.get(s.party);
    if (p && p.game) {
      const allGone = p.members.every((cid) => { const m = sessions.get(cid); return !m.ws && now - m.lastSeen > 60_000; });
      if (!allGone) continue;
    }
    leaveParty(s);
    sessions.delete(s.cid);
    byPid.delete(s.pid);
  }
}, 5_000);

server.listen(PORT, () => {
  console.log(`\n  🧙 Supernatural Tower Defense is running!`);
  console.log(`  ➜  Open http://localhost:${PORT} in your browser`);
  console.log(`  ➜  Admin key: ${ADMIN_KEY}  (enter it in Settings ⚙ to become an Admin)\n`);
});
