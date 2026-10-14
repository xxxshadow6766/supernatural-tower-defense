// Menus, party lobby, shop, networking and the animated 2D title background.
import {
  TOWERS, TOWER_ORDER, MAPS, MAP_ORDER, DIFFICULTIES, STARTER_TOWERS, MAX_PARTY, TILE, GRID_W, GRID_H,
  buildMap, towerStats,
} from '/shared/data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ profile (saved in this browser, no account)
const PROFILE_KEY = 'std_profile_v1';
const ADJ = ['Mystic', 'Shadow', 'Arcane', 'Frosty', 'Blazing', 'Ghostly', 'Lunar', 'Storm', 'Hex', 'Rune'];
const NOUN = ['Wizard', 'Witch', 'Warlock', 'Druid', 'Seer', 'Mage', 'Shaman', 'Oracle'];
function randomName() {
  const n = ADJ[Math.floor(Math.random() * ADJ.length)] + NOUN[Math.floor(Math.random() * NOUN.length)];
  return n.length <= 14 ? n + Math.floor(10 + Math.random() * 90) : n;
}
// Weak laptops (like most school Chromebooks) start in performance mode.
function defaultGfx() {
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || /CrOS/.test(navigator.userAgent);
  return { bloom: !weak, shadows: !weak, lowRes: weak };
}
function loadProfile() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch {}
  return {
    name: typeof p.name === 'string' && p.name ? p.name : randomName(),
    coins: Number.isFinite(p.coins) ? p.coins : 0,
    owned: Array.isArray(p.owned) ? p.owned.filter((t) => TOWERS[t]) : [],
    gamesPlayed: p.gamesPlayed | 0,
    wins: p.wins | 0,
    adminKey: typeof p.adminKey === 'string' ? p.adminKey : '',
    gfx: p.gfx ? { bloom: !!p.gfx.bloom, shadows: !!p.gfx.shadows, lowRes: !!p.gfx.lowRes } : defaultGfx(),
    seenGames: Array.isArray(p.seenGames) ? p.seenGames : [],
    paidGames: Array.isArray(p.paidGames) ? p.paidGames : [],
  };
}
const profile = loadProfile();
function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {} }
saveProfile();
const ownedTowers = () => TOWER_ORDER.filter((t) => STARTER_TOWERS.includes(t) || profile.owned.includes(t));

// A per-tab id lets you refresh the page mid-match and rejoin, while two tabs still count as two players.
function newCid() { return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
let cid;
try { cid = sessionStorage.getItem('std_cid') || newCid(); sessionStorage.setItem('std_cid', cid); } catch { cid = newCid(); }

// ------------------------------------------------------------------ toasts
function toast(text, kind = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.textContent = text;
  $('#toasts').append(d);
  setTimeout(() => d.classList.add('out'), 2600);
  setTimeout(() => d.remove(), 3100);
}

// ------------------------------------------------------------------ networking
const net = {
  ws: null, open: false, retry: 0,
  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    setConn('connecting');
    ws.onopen = () => {
      this.open = true;
      this.retry = 0;
      setConn('online');
      this.send({ t: 'hello', cid, name: profile.name, owned: ownedTowers(), isNew: profile.gamesPlayed === 0, adminKey: profile.adminKey });
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m); };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.open = false;
      setConn('offline');
      if (ev.code === 4000) {
        // this tab was duplicated: become a separate player
        cid = newCid();
        try { sessionStorage.setItem('std_cid', cid); } catch {}
      }
      setTimeout(() => this.connect(), Math.min(5000, 600 * ++this.retry));
    };
  },
  send(m) {
    if (this.open) { this.ws.send(JSON.stringify(m)); return true; }
    toast('Not connected to the server yet — retrying…', 'error');
    return false;
  },
};
function setConn(s) {
  const el = $('#conn');
  el.dataset.state = s;
  el.textContent = s === 'online' ? 'Online' : s === 'offline' ? 'Reconnecting…' : 'Connecting…';
}
const sendProfile = () => net.open && net.send({ t: 'profile', name: profile.name, owned: ownedTowers(), adminKey: profile.adminKey });

// ------------------------------------------------------------------ app state
const state = { me: null, party: null, screen: 'title', game: null, gameId: null, chat: [], pendingLobby: false };
window.__std = state; // handy for debugging from the browser console

function handle(m) {
  switch (m.t) {
    case 'me':
      state.me = m;
      renderTopbar();
      if (m.adminRejected) toast('That admin key was not accepted.', 'error');
      if (m.inParty === false && state.party) { state.party = null; renderTitle(); if (state.screen === 'lobby') show('title'); }
      if (m.inGame === false && state.game && !state.game.over) {
        closeGame();
        toast('That match is no longer running (the server may have restarted).', 'error');
      }
      break;
    case 'party':
      state.party = m;
      if (state.pendingLobby) { state.pendingLobby = false; if (!state.game) show('lobby'); }
      renderLobby();
      renderTitle();
      break;
    case 'partyLeft':
      state.party = null;
      state.chat = [];
      $('#lobby-chat').innerHTML = '';
      if (state.screen === 'lobby') show('title');
      renderTitle();
      break;
    case 'error': state.pendingLobby = false; toast(m.text, 'error'); break;
    case 'toast': toast(m.text); break;
    case 'chat': addChat(m); break;
    case 'gameStart': startGame(m); break;
    case 'snap':
      if (state.game) state.game.onSnap(m);
      else if (state.loadingGame) state.snapQueue.push(m); // 3D engine still loading
      break;
    case 'gameOver': onGameOver(m); break;
  }
}

// ------------------------------------------------------------------ screens
function show(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
  if (name === 'shop') renderShop();
  if (name === 'lobby') renderLobby();
  if (name === 'title') renderTitle();
  if (name === 'party') setTimeout(() => $('#join-code').focus(), 50);
}

function renderTopbar() {
  $('#me-name').textContent = state.me ? state.me.name : profile.name;
  $('#me-admin').hidden = !(state.me && state.me.admin);
  $('#me-coins').textContent = profile.coins;
}

function renderTitle() {
  const pill = $('#title-party');
  const p = state.party;
  pill.hidden = !p || p.solo;
  if (p && !p.solo) pill.textContent = `👥 In party ${p.code} · ${p.members.length} player${p.members.length === 1 ? '' : 's'} — open lobby`;
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (!nav) return;
  const to = nav.dataset.nav;
  if (to === 'party') show(state.party && !state.party.solo ? 'lobby' : 'party');
  else if (to === 'play') {
    if (state.party) show('lobby');
    else if (net.send({ t: 'createParty', solo: true })) state.pendingLobby = true;
  } else show(to);
});
$('#title-party').onclick = () => show('lobby');
$('#btn-create').onclick = () => { if (net.send({ t: 'createParty' })) state.pendingLobby = true; };
$('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinParty(); });
$('#btn-join').onclick = joinParty;
function joinParty() {
  const code = $('#join-code').value.trim();
  if (!/^\d{5}$/.test(code)) return toast('Party codes are exactly 5 numbers.', 'error');
  if (net.send({ t: 'joinParty', code })) state.pendingLobby = true;
}
$('#lobby-back').onclick = () => {
  if (state.party && state.party.solo) net.send({ t: 'leaveParty' });
  show('title');
};
$('#btn-leave').onclick = () => net.send({ t: 'leaveParty' });
$('#btn-start').onclick = () => net.send({ t: 'start' });
$('#btn-copy').onclick = async () => {
  const code = state.party ? state.party.code : '';
  try { await navigator.clipboard.writeText(code); toast(`Copied party code ${code}`, 'good'); }
  catch { toast(`Your party code is ${code}`); }
};
$('#map-cards').addEventListener('click', (e) => { const c = e.target.closest('[data-map]'); if (c) net.send({ t: 'vote', map: c.dataset.map }); });
$('#diff-buttons').addEventListener('click', (e) => { const c = e.target.closest('[data-diff]'); if (c) net.send({ t: 'vote', diff: c.dataset.diff }); });
$('#lobby-chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#lobby-chat-input');
  const text = input.value.trim();
  if (text) net.send({ t: 'chat', text });
  input.value = '';
});

// ------------------------------------------------------------------ lobby
const svgCache = {};
function mapSvg(id) {
  if (svgCache[id]) return svgCache[id];
  const m = buildMap(id), th = m.theme;
  const pts = m.path.map(([i, j]) => `${i + 0.5},${j + 0.5}`).join(' ');
  const deco = m.deco.map((d) => `<circle cx="${d.i + 0.5}" cy="${d.j + 0.5}" r="0.33" fill="${hex(th.particles)}" opacity="0.4"/>`).join('');
  const [ex, ey] = m.end;
  return (svgCache[id] = `<svg class="mc-svg" viewBox="0 0 ${GRID_W} ${GRID_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="${GRID_W}" height="${GRID_H}" fill="${hex(th.ground)}"/>${deco}
    <polyline points="${pts}" fill="none" stroke="${hex(th.path)}" stroke-width="1" stroke-linejoin="miter" stroke-linecap="square"/>
    <circle cx="${m.start[0] + 0.5}" cy="${m.start[1] + 0.5}" r="0.75" fill="#a855f7"/>
    <rect x="${ex + 0.15}" y="${ey + 0.15}" width="0.7" height="0.7" fill="#67e8f9" transform="rotate(45 ${ex + 0.5} ${ey + 0.5})"/>
  </svg>`);
}
function pathLabel(id) {
  const tiles = buildMap(id).length / TILE;
  return tiles > 60 ? 'Long path · easier' : tiles > 47 ? 'Medium path' : 'Short path · harder';
}
const votersHtml = (list) => `${list.map((v) => `<i style="background:${v.color}" title="${esc(v.name)}"></i>`).join('')}<b>${list.length || ''}</b>`;

function renderLobby() {
  const p = state.party;
  if (!p || !state.me) return;
  const meId = state.me.id;
  const isLeader = p.leader === meId;
  $('#lobby-title').textContent = p.solo ? 'Quick Play' : 'Party Lobby';
  $('#lobby-sub').textContent = p.solo
    ? 'Choose a map and difficulty, then start. Want to play with friends? Use PARTY on the main menu.'
    : 'Everyone votes for a map and difficulty. The highest vote wins — unless an Admin is in the party, then the Admin’s pick wins.';
  $('#code-box').hidden = p.solo;
  $('#party-code').textContent = p.code;
  $('#lobby-chat-panel').hidden = p.solo;
  $('.lobby-grid').classList.toggle('solo', p.solo);
  $('#btn-leave').hidden = p.solo;
  $('#member-count').textContent = `${p.members.length}/${MAX_PARTY}`;
  $('#member-list').innerHTML = p.members.map((m) => `
    <li><span class="dot" style="background:${m.color};color:${m.color}"></span>
      <span class="mname">${esc(m.name)}${m.id === meId ? ' <small class="muted">(you)</small>' : ''}</span>
      ${m.id === p.leader ? '<span class="badge leader" title="Party leader — starts the match">👑 Leader</span>' : ''}
      ${m.admin ? '<span class="badge admin" title="Admin — their pick overrules votes">🛡 Admin</span>' : ''}
      ${!m.online ? '<span class="badge off">offline</span>' : ''}</li>`).join('');

  const tally = (key) => { const t = {}; for (const m of p.members) if (m.vote[key]) (t[m.vote[key]] ||= []).push(m); return t; };
  const leaders = (t) => { const max = Math.max(0, ...Object.values(t).map((l) => l.length)); return max ? Object.keys(t).filter((k) => t[k].length === max) : []; };
  const mapT = tally('map'), diffT = tally('diff');
  const mapLead = leaders(mapT), diffLead = leaders(diffT);
  const mine = (p.members.find((m) => m.id === meId) || {}).vote || {};
  const admin = p.adminPick || {};

  $('#map-cards').innerHTML = MAP_ORDER.map((id) => {
    const m = MAPS[id];
    const cls = [mine.map === id && 'mine', admin.map === id && 'admin-pick', !admin.map && mapLead.length === 1 && mapLead[0] === id && 'leading'].filter(Boolean).join(' ');
    return `<button class="map-card ${cls}" data-map="${id}" aria-pressed="${mine.map === id}">
      ${mapSvg(id)}
      <div class="mc-body"><div class="mc-title">${esc(m.name)}</div><div class="mc-desc">${esc(m.desc)}</div>
      <div class="mc-foot"><span class="len">${pathLabel(id)}</span><span class="voters">${votersHtml(mapT[id] || [])}</span></div></div>
      ${admin.map === id ? '<span class="ribbon">ADMIN PICK</span>' : ''}</button>`;
  }).join('');

  $('#diff-buttons').innerHTML = Object.values(DIFFICULTIES).map((d) => {
    const cls = [mine.diff === d.id && 'mine', admin.diff === d.id && 'admin-pick'].filter(Boolean).join(' ');
    return `<button class="diff-btn ${cls}" data-diff="${d.id}" style="--c:${d.color}" aria-pressed="${mine.diff === d.id}">
      <div class="dname">${d.name}</div>
      <div class="dinfo">Win: +${d.coins} 🪙 · Sanctum ${d.baseHp} HP</div>
      <div class="voters">${votersHtml(diffT[d.id] || [])}</div>
      ${admin.diff === d.id ? '<span class="ribbon">ADMIN</span>' : ''}</button>`;
  }).join('');

  const describe = (key, lead, t, names, fallback) => {
    if (admin[key]) return `${names(admin[key])} <em>(Admin pick)</em>`;
    if (lead.length === 1) return `${names(lead[0])} <em>(${t[lead[0]].length} vote${t[lead[0]].length === 1 ? '' : 's'})</em>`;
    if (lead.length > 1) return `Tie — random: ${lead.map(names).join(' / ')}`;
    return fallback;
  };
  $('#pick-summary').innerHTML = `
    <div><span>Map</span>${describe('map', mapLead, mapT, (k) => esc(MAPS[k].name), 'No votes yet — random map')}</div>
    <div><span>Difficulty</span>${describe('diff', diffLead, diffT, (k) => DIFFICULTIES[k].name, 'No votes yet — Medium')}</div>`;

  const start = $('#btn-start');
  start.disabled = !isLeader || p.status === 'ingame';
  start.textContent = p.status === 'ingame' ? 'Match in progress…' : isLeader ? 'Start Match' : 'Waiting for the leader…';
}

function addChat(m) {
  state.chat.push(m);
  if (state.chat.length > 60) state.chat.shift();
  const log = $('#lobby-chat');
  const div = document.createElement('div');
  div.className = 'chat-line' + (m.system ? ' system' : '');
  if (m.system) div.textContent = m.text;
  else {
    const who = document.createElement('b');
    who.style.color = m.color;
    who.textContent = m.from + ': ';
    div.append(who, document.createTextNode(m.text));
  }
  log.append(div);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  if (state.game) state.game.addChat(m);
}

// ------------------------------------------------------------------ shop
function renderShop() {
  const own = ownedTowers();
  $('#shop-grid').innerHTML = TOWER_ORDER.map((id) => {
    const t = TOWERS[id];
    const s = towerStats(id, 0);
    const has = own.includes(id);
    const starter = STARTER_TOWERS.includes(id);
    const stats = [
      s.dmg != null && ['Damage', s.dmg],
      ['Range', s.range],
      s.cd && ['Speed', (1 / s.cd).toFixed(1) + '/s'],
      s.splash && ['Splash', s.splash],
      s.slow && ['Slow', Math.round(s.slow * 100) + '%'],
      s.chains && ['Chains', s.chains],
      s.curse && ['Curse', '+' + Math.round(s.curse * 100) + '%'],
      s.buff && ['Ally dmg', '+' + Math.round(s.buff * 100) + '%'],
      s.trueSight && ['True Sight', '✔'],
    ].filter(Boolean).slice(0, 6);
    return `<div class="shop-card ${has ? 'owned' : ''}">
      <div class="sc-top"><span class="sc-icon">${t.icon}</span>
        <div><h3>${esc(t.name)}</h3><span class="sc-tag">${starter ? 'Starter — free for everyone' : has ? 'Unlocked' : 'Shop exclusive'}</span></div></div>
      <p>${esc(t.desc)}</p>
      <p class="perk">✦ ${esc(t.perk)}</p>
      <div class="sc-stats">${stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="sc-foot"><span class="mana-cost">In a match: 🔮${t.cost} mana</span>
        ${has ? '<span class="owned-tag">✔ Owned</span>' : `<button class="btn primary" data-buy="${id}" ${profile.coins < t.shopPrice ? 'disabled' : ''}>Buy · 🪙${t.shopPrice}</button>`}
      </div></div>`;
  }).join('');
}
$('#shop-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-buy]');
  if (!b) return;
  const t = TOWERS[b.dataset.buy];
  if (profile.coins < t.shopPrice) return toast('Not enough coins — win matches to earn more!', 'error');
  profile.coins -= t.shopPrice;
  profile.owned.push(t.id);
  saveProfile();
  sendProfile();
  renderShop();
  renderTopbar();
  toast(`${t.icon} ${t.name} unlocked!`, 'good');
});

// ------------------------------------------------------------------ settings
function openSettings() {
  $('#set-name').value = profile.name;
  $('#set-admin').value = profile.adminKey;
  $('#set-bloom').checked = profile.gfx.bloom;
  $('#set-shadows').checked = profile.gfx.shadows;
  $('#set-lowres').checked = profile.gfx.lowRes;
  $('#admin-status').textContent = state.me && state.me.admin
    ? '✔ You are an Admin on this server — your map and difficulty picks overrule party votes.'
    : 'Admins overrule party votes for map and difficulty. The key is shown in the server window when the game starts.';
  $('#settings-modal').hidden = false;
  $('#set-name').focus();
}
$('#btn-settings').onclick = openSettings;
$('#btn-name').onclick = openSettings;
$('#set-cancel').onclick = () => { $('#settings-modal').hidden = true; };
$('#settings-modal').addEventListener('click', (e) => { if (e.target.id === 'settings-modal') $('#settings-modal').hidden = true; });
$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  profile.name = $('#set-name').value.replace(/[<>]/g, '').trim().slice(0, 16) || profile.name;
  profile.adminKey = $('#set-admin').value.trim();
  profile.gfx = { bloom: $('#set-bloom').checked, shadows: $('#set-shadows').checked, lowRes: $('#set-lowres').checked };
  saveProfile();
  sendProfile();
  renderTopbar();
  $('#settings-modal').hidden = true;
  toast('Settings saved', 'good');
});

// ------------------------------------------------------------------ matches
let GameViewClass = null;
async function startGame(m) {
  if (state.game && state.gameId === m.gid) return; // reconnect: keep the current view
  if (!GameViewClass) {
    state.loadingGame = true;
    state.snapQueue = [];
    try { GameViewClass = (await import('./game3d.js')).GameView; }
    catch (err) { console.error(err); state.loadingGame = false; toast('Could not load the 3D engine.', 'error'); return; }
  }
  if (state.game) state.game.destroy();
  if (!profile.seenGames.includes(m.gid)) {
    profile.seenGames = [...profile.seenGames, m.gid].slice(-20);
    profile.gamesPlayed++;
    saveProfile();
  }
  $('#settings-modal').hidden = true;
  document.body.classList.add('in-game');
  $('#game').hidden = false;
  stopBg();
  state.gameId = m.gid;
  try {
    state.game = new GameViewClass({
      root: $('#game'), start: m, myId: state.me.id, gfx: profile.gfx, toast,
      send: (a) => net.send({ t: 'g', ...a }),
      sendChat: (text) => net.send({ t: 'chat', text }),
      onLeave: () => { net.send({ t: 'leaveParty' }); closeGame('title'); },
      onContinue: () => closeGame(),
      onGfxChange: (gfx) => { profile.gfx = gfx; saveProfile(); },
    });
    for (const s of state.snapQueue || []) state.game.onSnap(s);
  } catch (err) {
    console.error(err);
    toast('3D graphics are not available in this browser (WebGL failed).', 'error');
    closeGame();
  }
  state.loadingGame = false;
  state.snapQueue = [];
}
function closeGame(to) {
  if (state.game) state.game.destroy();
  state.game = null;
  state.gameId = null;
  $('#game').hidden = true;
  document.body.classList.remove('in-game');
  startBg();
  show(to || (state.party ? 'lobby' : 'title'));
  renderTopbar();
}
function onGameOver(m) {
  if (m.won && !profile.paidGames.includes(m.gid)) {
    profile.paidGames = [...profile.paidGames, m.gid].slice(-20);
    profile.coins += m.coins;
    profile.wins++;
    saveProfile();
    renderTopbar();
  }
  if (state.game) state.game.onGameOver(m);
}

// ------------------------------------------------------------------ animated 2D title background
const bg = { canvas: $('#menu-bg'), raf: 0, stars: [], sparks: [], t: 0 };
bg.ctx = bg.canvas.getContext('2d');
function sizeBg() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  bg.w = window.innerWidth; bg.h = window.innerHeight;
  bg.canvas.width = bg.w * dpr; bg.canvas.height = bg.h * dpr;
  bg.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bg.stars = Array.from({ length: Math.round((bg.w * bg.h) / 9000) }, () => ({ x: Math.random() * bg.w, y: Math.random() * bg.h * 0.7, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6 }));
  bg.sparks = Array.from({ length: 70 }, () => newSpark(true));
}
function newSpark(anyY) {
  const hues = ['#c084fc', '#67e8f9', '#fde68a', '#f0abfc'];
  return { x: Math.random() * bg.w, y: anyY ? Math.random() * bg.h : bg.h + 10, v: 12 + Math.random() * 30, r: Math.random() * 2 + 0.6, c: hues[Math.floor(Math.random() * hues.length)], p: Math.random() * 6 };
}
function ridge(ctx, w, h, base, amp, seed, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h - base - Math.sin(x * 0.004 + seed) * amp - Math.sin(x * 0.011 + seed * 2) * amp * 0.4);
  ctx.lineTo(w, h);
  ctx.fill();
}
function drawTower(ctx, x, groundY, s, t) {
  ctx.fillStyle = '#0a0518';
  ctx.fillRect(x - 18 * s, groundY - 150 * s, 36 * s, 150 * s);
  ctx.fillRect(x + 18 * s, groundY - 90 * s, 30 * s, 90 * s);
  ctx.fillRect(x - 48 * s, groundY - 70 * s, 30 * s, 70 * s);
  const roof = (cx, top, wdt, ht) => { ctx.beginPath(); ctx.moveTo(cx - wdt, top); ctx.lineTo(cx, top - ht); ctx.lineTo(cx + wdt, top); ctx.fill(); };
  roof(x, groundY - 150 * s, 26 * s, 70 * s);
  roof(x + 33 * s, groundY - 90 * s, 20 * s, 45 * s);
  roof(x - 33 * s, groundY - 70 * s, 20 * s, 40 * s);
  const flicker = 0.75 + Math.sin(t * 6) * 0.15 + Math.sin(t * 13) * 0.1;
  ctx.fillStyle = `rgba(253, 230, 138, ${flicker})`;
  ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 14;
  ctx.fillRect(x - 5 * s, groundY - 120 * s, 10 * s, 16 * s);
  ctx.fillRect(x + 28 * s, groundY - 66 * s, 8 * s, 12 * s);
  ctx.shadowBlur = 0;
  // glowing orb on the spire
  const g = ctx.createRadialGradient(x, groundY - 228 * s, 0, x, groundY - 228 * s, 26 * s);
  g.addColorStop(0, 'rgba(216, 180, 254, 0.95)'); g.addColorStop(1, 'rgba(168, 85, 247, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, groundY - 228 * s, 26 * s * (0.9 + Math.sin(t * 2) * 0.1), 0, Math.PI * 2); ctx.fill();
}
function drawBg(now) {
  const { ctx, w, h } = bg;
  const t = (bg.t = now / 1000);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#07030f'); sky.addColorStop(0.5, '#1b0d3a'); sky.addColorStop(1, '#3a1458');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  for (const s of bg.stars) {
    ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.8 + s.p));
    ctx.fillStyle = '#fff';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
  const mx = w * 0.8, my = h * 0.2, mr = Math.min(w, h) * 0.075;
  const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4);
  halo.addColorStop(0, 'rgba(240, 171, 252, 0.35)'); halo.addColorStop(1, 'rgba(240, 171, 252, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  ctx.fillStyle = '#fbe7ff';
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(200, 160, 230, 0.35)';
  ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2); ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.15, 0, Math.PI * 2); ctx.fill();
  ridge(ctx, w, h, h * 0.22, 40, 1.3, '#1a0b33');
  const s = Math.max(0.6, Math.min(1.3, w / 1200));
  drawTower(ctx, w * 0.14, h - h * 0.16, s, t);
  ridge(ctx, w, h, h * 0.12, 28, 4.1, '#110723');
  ridge(ctx, w, h, h * 0.04, 16, 7.7, '#08030f');
  for (let k = 0; k < 4; k++) {
    const fx = ((t * 18 * (k + 1) * 0.4 + k * 400) % (w + 600)) - 300, fy = h * (0.62 + k * 0.08);
    const fog = ctx.createRadialGradient(fx, fy, 0, fx, fy, 320);
    fog.addColorStop(0, 'rgba(147, 51, 234, 0.12)'); fog.addColorStop(1, 'rgba(147, 51, 234, 0)');
    ctx.fillStyle = fog;
    ctx.fillRect(fx - 320, fy - 320, 640, 640);
  }
  for (const p of bg.sparks) {
    p.y -= p.v / 60;
    p.x += Math.sin(t + p.p) * 0.3;
    if (p.y < -10) Object.assign(p, newSpark(false));
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + p.p);
    ctx.fillStyle = p.c;
    ctx.shadowColor = p.c; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  bg.raf = requestAnimationFrame(drawBg);
}
function startBg() { if (!bg.raf) { sizeBg(); bg.raf = requestAnimationFrame(drawBg); } }
function stopBg() { cancelAnimationFrame(bg.raf); bg.raf = 0; }
window.addEventListener('resize', () => { if (bg.raf) sizeBg(); });

// ------------------------------------------------------------------ boot
renderTopbar();
startBg();
net.connect();
