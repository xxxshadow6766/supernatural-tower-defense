// The in-match 3D view: renders the server's game state, the HUD, and sends player actions.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  TILE, GRID_W, GRID_H, TOWERS, TOWER_ORDER, DIFFICULTIES, WAVES, TOTAL_ROUNDS, TARGET_MODES, SELL_REFUND, STARTER_TOWERS,
  buildMap, pathPos, tileToWorld, worldToTile, tileKey, canBuild, towerStats, upgradeCost, seededRng,
} from '/shared/data.js';
import { makeTower, makeGhostTower, makeEnemy, makeDeco, makePortal, makeSanctum, disposeObject } from './models.js';

const PI = Math.PI;
const PATH_Y = -0.15;
const SNAP_DT = 0.1;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const lerpAngle = (a, b, t) => { let d = ((b - a + PI) % (2 * PI)) - PI; if (d < -PI) d += 2 * PI; return a + d * t; };
const PARTICLES = { graveyard: 'wisps', forest: 'fireflies', frost: 'snow', inferno: 'embers' };
const MODE_LABEL = { first: 'First', last: 'Last', strong: 'Strongest', close: 'Closest' };

const STAT_ROWS = [
  ['dmg', 'Damage', (v) => Math.round(v)],
  ['range', 'Range', (v) => v],
  ['cd', 'Attacks / sec', (v) => (1 / v).toFixed(2)],
  ['splash', 'Splash radius', (v) => v],
  ['slow', 'Slow', (v) => Math.round(v * 100) + '%'],
  ['burn', 'Burn / sec', (v) => v],
  ['chains', 'Chain targets', (v) => v],
  ['curse', 'Curse (+dmg taken)', (v) => '+' + Math.round(v * 100) + '%'],
  ['harvest', 'Soul harvest', (v) => '+' + v + ' mana/kill'],
  ['buff', 'Ally damage', (v) => '+' + Math.round(v * 100) + '%'],
  ['rangeBuff', 'Ally range', (v) => '+' + Math.round(v * 100) + '%'],
  ['pierce', 'Armor pierce', (v) => Math.round(v * 100) + '%'],
  ['trueSight', 'True Sight', (v) => (v ? '✔' : '—')],
];

// Shared effect resources
const shared = (g) => { g.userData.shared = true; return g; };
const FXG = {
  sphere: shared(new THREE.SphereGeometry(1, 12, 8)),
  octa: shared(new THREE.OctahedronGeometry(1, 0)),
  box: shared(new THREE.BoxGeometry(1, 1, 1)),
  ring: shared(new THREE.RingGeometry(0.965, 1, 72)),
  thickRing: shared(new THREE.RingGeometry(0.7, 1, 32)),
  disc: shared(new THREE.CircleGeometry(1, 48)),
  barBg: shared(new THREE.PlaneGeometry(1.4, 0.2)),
  barFg: shared(new THREE.PlaneGeometry(1.3, 0.12).translate(0.65, 0, 0)),
};
const glowMat = (hex, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
const PROJ = {
  bolt: { mat: glowMat(0xb794ff, 3), geo: 'sphere', size: 0.28, dur: 0.22 },
  arrow: { mat: glowMat(0xa5f3fc, 3), geo: 'box', size: [0.08, 0.08, 0.9], dur: 0.14 },
  shadow: { mat: glowMat(0x4ade80, 2.6), geo: 'sphere', size: 0.26, dur: 0.25 },
  frost: { mat: glowMat(0x8ff3ff, 3), geo: 'octa', size: 0.3, dur: 0.25, burst: 0x8ff3ff },
  fire: { mat: glowMat(0xff7a1a, 3), geo: 'sphere', size: 0.42, dur: 0.38, arc: 2.5, burst: 0xff7a1a },
  dragon: { mat: glowMat(0xff5a1a, 3.2), geo: 'sphere', size: 0.7, dur: 0.42, arc: 3, burst: 0xff5a1a },
};
const LIGHTNING_MAT = glowMat(0xbfe6ff, 3.5);
const SOUL_MAT = glowMat(0xe9d5ff, 2.2);
const HP_MATS = {
  bg: new THREE.MeshBasicMaterial({ color: 0x0b0716, transparent: true, opacity: 0.7, depthTest: false }),
  g: new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false }),
  y: new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }),
  r: new THREE.MeshBasicMaterial({ color: 0xf87171, depthTest: false }),
};
const STATUS_MATS = {
  slow: glowMat(0x7dd3fc, 1.8), burn: glowMat(0xff7a1a, 1.8), curse: glowMat(0x4ade80, 1.6),
};
const DEBRIS_COLORS = { zombie: 0x86a85d, bat: 0x5b2170, skeleton: 0xe7e2d3, phantom: 0x9fe8ff, golem: 0x7d7468, lich: 0x7c3aed };
const DEBRIS_MATS = Object.fromEntries(Object.entries(DEBRIS_COLORS).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, flatShading: true })]));

export class GameView {
  constructor({ root, start, myId, send, sendChat, toast, gfx, onLeave, onContinue, onGfxChange }) {
    Object.assign(this, { root, myId, send, sendChat, toast, gfx: { ...gfx }, onLeave, onContinue, onGfxChange });
    this.mapId = start.map;
    this.map = buildMap(start.map);
    this.theme = this.map.theme;
    this.diff = DIFFICULTIES[start.diff];
    this.players = new Map(start.players.map((p) => [p.id, { ...p, mana: 0, free: 0, skip: 0, online: 1 }]));
    const me = this.players.get(myId);
    this.owned = TOWER_ORDER.filter((t) => me && me.owned.includes(t));
    this.towers = new Map();
    this.enemies = new Map();
    this.effects = [];
    this.occupied = new Set();
    this.placing = null;
    this.selected = null;
    this.hover = null;
    this.round = 1;
    this.roundLeft = 120;
    this.hp = this.maxHp = this.diff.baseHp;
    this.canSkip = 0;
    this.time = 0;
    this.shake = 0;
    this.keys = new Set();
    this.over = false;
    this.mouse = new THREE.Vector2(-9, -9);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ghosts = {};

    this.buildDom();
    this.initThree();
    this.buildWorld();
    this.bindInput();
    this.clock = new THREE.Clock();
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ DOM / HUD
  buildDom() {
    const d = this.diff;
    this.root.innerHTML = `
      <div class="g-canvas"></div>
      <div class="hud">
        <div class="hud-top">
          <div class="hud-card hud-left">
            <div class="map-name">${esc(this.map.name)} <span class="diff-badge" style="--c:${d.color}">${d.name}</span></div>
            <ul class="hud-players"></ul>
          </div>
          <div class="hud-center">
            <div class="round-row"><span class="round">ROUND <b class="r-num">1</b><small>/${TOTAL_ROUNDS}</small></span><span class="timer">2:00</span></div>
            <div class="hp"><div class="hp-fill"></div><span class="hp-text"></span></div>
            <button class="skip-btn" hidden></button>
            <div class="boss-bar" hidden><span>☠ THE LICH KING</span><div class="boss-fill"></div></div>
          </div>
          <div class="hud-right">
            <button class="hud-btn" data-act="help" title="How to play">?</button>
            <button class="hud-btn" data-act="leave">Leave</button>
          </div>
        </div>
        <div class="banner"><h2></h2><p></p></div>
        <div class="hud-bottom">
          <div class="chatbox">
            <div class="chat-log"></div>
            <input class="chat-input" maxlength="140" placeholder="Press Enter to chat" autocomplete="off">
          </div>
          <div class="dock">
            <div class="mana-row">
              <span class="mana">🔮 <b class="mana-num">0</b> Mana</span>
              <span class="free-badge" hidden>🎁 <b class="free-num">0</b> free starter towers (new player bonus)</span>
            </div>
            <div class="tower-bar">${this.owned.map((t, k) => `
              <button class="tb" data-t="${t}" title="${esc(TOWERS[t].name)}: ${esc(TOWERS[t].desc)}">
                <span class="tb-key">${k + 1}</span><span class="tb-icon">${TOWERS[t].icon}</span>
                <span class="tb-name">${esc(TOWERS[t].name)}</span><span class="tb-cost"></span>
              </button>`).join('')}
            </div>
            <div class="hint">Pick a tower, click a glowing tile · Right-drag rotate · Scroll zoom · WASD move · Shift+click to place several</div>
          </div>
          <div class="tower-panel" hidden></div>
        </div>
        <div class="help-overlay" hidden>
          <div class="help-card">
            <h2>How to play</h2>
            <ul>
              <li><b>Goal:</b> survive ${TOTAL_ROUNDS} rounds and defeat the Lich King. Each round lasts 2 minutes.</li>
              <li><b>Mana 🔮</b> is your in-match currency. Every kill gives mana to <i>everyone</i>, plus a bonus each round.</li>
              <li><b>Build:</b> choose a tower below (or press 1–${this.owned.length}), then click a free tile.</li>
              <li><b>Upgrade / sell:</b> click one of your towers. Hotkeys: U upgrade · T target mode · X sell.</li>
              <li><b>Phantoms</b> are invisible — only towers with <b>True Sight</b> can hit them (Spectral Archer, Storm Mage, level 3 Wizard, or any tower near a Celestial Obelisk).</li>
              <li><b>Armored</b> foes shrug off weak hits. Upgrade, or use fire that pierces armor.</li>
              <li><b>Skip:</b> once a wave has fully spawned, vote to start the next round early.</li>
              <li><b>Camera:</b> right-drag to rotate, scroll to zoom, middle-drag or WASD to move, Q/E to spin.</li>
            </ul>
            <button class="btn primary" data-act="help">Got it</button>
          </div>
        </div>
        <div class="gameover" hidden></div>
      </div>`;
    const q = (s) => this.root.querySelector(s);
    this.el = {
      canvasWrap: q('.g-canvas'), players: q('.hud-players'), rnum: q('.r-num'), timer: q('.timer'),
      hpFill: q('.hp-fill'), hpText: q('.hp-text'), hpBox: q('.hp'), skip: q('.skip-btn'), boss: q('.boss-bar'), bossFill: q('.boss-fill'),
      banner: q('.banner'), mana: q('.mana-num'), freeBadge: q('.free-badge'), freeNum: q('.free-num'),
      bar: q('.tower-bar'), panel: q('.tower-panel'), chatLog: q('.chat-log'), chatInput: q('.chat-input'),
      help: q('.help-overlay'), gameover: q('.gameover'),
    };
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act],[data-t]');
      if (!btn) return;
      if (btn.dataset.t) return this.setPlacing(this.placing === btn.dataset.t ? null : btn.dataset.t);
      const act = btn.dataset.act;
      if (act === 'help') this.el.help.hidden = !this.el.help.hidden;
      else if (act === 'leave') { if (this.over || confirm('Leave this match? Your towers will keep fighting for your friends.')) this.onLeave(); }
      else if (act === 'continue') this.onContinue();
      else if (act === 'upgrade') this.send({ a: 'upgrade', id: this.selected });
      else if (act === 'target') this.send({ a: 'target', id: this.selected });
      else if (act === 'sell') this.sellSelected(btn);
      else if (act === 'close') this.select(null);
    });
    this.el.skip.addEventListener('click', () => this.send({ a: 'skip' }));
    this.el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.el.chatInput.value.trim();
        if (text) this.sendChat(text);
        this.el.chatInput.value = '';
        this.el.chatInput.blur();
      } else if (e.key === 'Escape') this.el.chatInput.blur();
      e.stopPropagation();
    });
  }

  addChat(m) {
    const div = document.createElement('div');
    div.className = 'chat-line' + (m.system ? ' system' : '');
    if (m.system) div.textContent = m.text;
    else {
      const who = document.createElement('b');
      who.textContent = m.from + ': ';
      who.style.color = m.color;
      div.append(who, document.createTextNode(m.text));
    }
    this.el.chatLog.append(div);
    while (this.el.chatLog.children.length > 30) this.el.chatLog.firstChild.remove();
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
  }

  showBanner(title, text, boss = false) {
    const b = this.el.banner;
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = text || '';
    b.classList.toggle('boss', boss);
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // ------------------------------------------------------------------ three.js setup
  initThree() {
    const th = this.theme;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.gfx.lowRes ? 1 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = th.exposure || 1.1;
    r.shadowMap.enabled = !!this.gfx.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.canvasWrap.append(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(th.sky);
    scene.fog = new THREE.Fog(th.fog, 60, 150);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
    this.camera.position.set(0, 42, 36);
    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.target.set(0, 0, 2);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.maxPolarAngle = 1.28;
    c.minDistance = 12;
    c.maxDistance = 90;
    c.screenSpacePanning = false;
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    scene.add(new THREE.HemisphereLight(th.hemi, th.ground, 1.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(th.sun, th.sunI);
    sun.position.set(-22, 40, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 26, bottom: -26, near: 5, far: 110 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    this.sun = sun;
    sun.castShadow = !!this.gfx.shadows;

    if (this.gfx.bloom) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.mapId === 'frost' ? 0.45 : 0.65, 0.4, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.frameBoard();
  }

  onResize() {
    const w = this.root.clientWidth || window.innerWidth, h = this.root.clientHeight || window.innerHeight;
    if (!w || !h) return; // minimized / hidden tab: keep the last good size
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 60 : 45;
    this.camera.updateProjectionMatrix();
  }

  // Start with a camera distance that fits the whole board on this screen shape.
  frameBoard() {
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = Number.isFinite(this.camera.aspect) && this.camera.aspect > 0 ? this.camera.aspect : 16 / 9;
    const tanH = tanV * aspect;
    const d = THREE.MathUtils.clamp(Math.max(27 / tanH, 22 / tanV), 34, 85);
    const dir = new THREE.Vector3(0, 0.78, 0.63).normalize();
    this.controls.target.set(0, 0, 1.5);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
    this.controls.update();
  }

  buildWorld() {
    const th = this.theme, scene = this.scene;
    // Board tiles
    const tileGeo = new THREE.BoxGeometry(TILE * 0.96, 0.6, TILE * 0.96);
    const inst = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), GRID_W * GRID_H);
    const rng = seededRng(this.mapId + ':tiles');
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < GRID_W; i++) for (let j = 0; j < GRID_H; j++) {
      const { x, z } = tileToWorld(i, j);
      const isPath = this.map.pathTiles.has(tileKey(i, j));
      m4.makeTranslation(x, (isPath ? PATH_Y : 0) - 0.3, z);
      inst.setMatrixAt(n, m4);
      col.set(isPath ? th.path : th.ground).offsetHSL(0, 0, (rng() - 0.5) * 0.06);
      inst.setColorAt(n++, col);
    }
    inst.receiveShadow = true;
    scene.add(inst);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(GRID_W * TILE + 1.4, 1.4, GRID_H * TILE + 1.4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(th.ground).multiplyScalar(0.5), roughness: 1 }),
    );
    slab.position.y = -0.95;
    slab.receiveShadow = true;
    scene.add(slab);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: new THREE.Color(th.ground).multiplyScalar(0.62), roughness: 1 }));
    outer.rotation.x = -PI / 2;
    outer.position.y = -1.4;
    outer.receiveShadow = true;
    scene.add(outer);

    // Decorations on the board (they block building) and around it (scenery)
    for (const d of this.map.deco) {
      const o = makeDeco(d.kind);
      const { x, z } = tileToWorld(d.i, d.j);
      o.position.set(x, 0, z);
      o.rotation.y = d.rot;
      o.scale.setScalar(d.scale);
      scene.add(o);
    }
    const orng = seededRng(this.mapId + ':outer');
    const halfW = (GRID_W * TILE) / 2 + 2, halfH = (GRID_H * TILE) / 2 + 2;
    for (let k = 0, placed = 0; k < 400 && placed < 80; k++) {
      const x = (orng() - 0.5) * 140, z = (orng() - 0.5) * 110;
      if (Math.abs(x) < halfW && Math.abs(z) < halfH) continue;
      const kinds = th.deco;
      const o = makeDeco(kinds[Math.floor(orng() * kinds.length)]);
      o.position.set(x, -1.4, z);
      o.rotation.y = orng() * PI * 2;
      o.scale.setScalar(1.2 + orng() * 1.3);
      scene.add(o);
      placed++;
    }

    // Spawn portal and the Sanctum you defend
    const sp = tileToWorld(...this.map.start), ep = tileToWorld(...this.map.end);
    this.portal = makePortal();
    this.portal.group.position.set(sp.x, PATH_Y, sp.z);
    this.portal.group.rotation.y = this.map.segs[0].angle;
    scene.add(this.portal.group);
    this.sanctum = makeSanctum();
    this.sanctum.group.position.set(ep.x, PATH_Y, ep.z);
    scene.add(this.sanctum.group);

    if (this.mapId === 'graveyard') {
      const moon = new THREE.Mesh(FXG.sphere, glowMat(0xff6b6b, 1.6));
      moon.scale.setScalar(9);
      moon.position.set(-70, 55, -110);
      scene.add(moon);
    }

    // Ambient particles
    const N = 280, pos = new Float32Array(N * 3);
    const prng = seededRng(7);
    for (let k = 0; k < N; k++) { pos[k * 3] = (prng() - 0.5) * 64; pos[k * 3 + 1] = prng() * 14; pos[k * 3 + 2] = (prng() - 0.5) * 44; }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const kind = PARTICLES[this.mapId];
    const pm = new THREE.PointsMaterial({
      color: new THREE.Color(th.particles).multiplyScalar(kind === 'snow' ? 1 : 2.2), size: kind === 'snow' ? 0.28 : 0.2,
      transparent: true, opacity: 0.9, depthWrite: false, toneMapped: kind === 'snow',
      blending: kind === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.particles = { points: new THREE.Points(pg, pm), kind, pos, N };
    scene.add(this.particles.points);

    // Placement helpers
    this.hoverTile = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.96, TILE * 0.96), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.45, depthWrite: false }));
    this.hoverTile.rotation.x = -PI / 2;
    this.hoverTile.visible = false;
    scene.add(this.hoverTile);
    this.rangeRing = new THREE.Group();
    this.rangeRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.rangeDiscMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false });
    this.rangeRing.add(new THREE.Mesh(FXG.ring, this.rangeRingMat), new THREE.Mesh(FXG.disc, this.rangeDiscMat));
    this.rangeRing.rotation.x = -PI / 2;
    this.rangeRing.visible = false;
    scene.add(this.rangeRing);
    this.buildHighlight();
  }

  // Faint glow on every free buildable tile while placing a tower
  buildHighlight() {
    if (this.highlight) { this.scene.remove(this.highlight); this.highlight.geometry.dispose(); }
    const tiles = [];
    for (let i = 0; i < GRID_W; i++) for (let j = 0; j < GRID_H; j++) if (canBuild(this.map, i, j, this.occupied)) tiles.push(tileToWorld(i, j));
    const g = new THREE.PlaneGeometry(TILE * 0.8, TILE * 0.8).rotateX(-PI / 2);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }), Math.max(1, tiles.length));
    const m4 = new THREE.Matrix4();
    tiles.forEach((t, k) => mesh.setMatrixAt(k, m4.makeTranslation(t.x, 0.02, t.z)));
    mesh.count = tiles.length;
    mesh.visible = !!this.placing;
    this.highlight = mesh;
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const c = this.renderer.domElement;
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerdown', (e) => { if (e.button === 0) this.down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 8) { this.onPointerMove(e); this.onClick(e); }
      this.down = null;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.onKeyDown = (e) => this.onKey(e, true);
    this.onKeyUp = (e) => this.onKey(e, false);
    this.onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  onPointerMove(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, p)) {
      const t = worldToTile(p.x, p.z);
      this.hover = t.i >= 0 && t.j >= 0 && t.i < GRID_W && t.j < GRID_H ? t : null;
    } else this.hover = null;
    this.updatePreview();
  }

  onClick(e) {
    if (this.over) return;
    if (this.placing) {
      if (!this.hover) return;
      const { i, j } = this.hover;
      if (!canBuild(this.map, i, j, this.occupied)) return this.toast("Can't build there.");
      if (!this.affordable(this.placing)) return this.toast('Not enough mana.');
      this.send({ a: 'place', tower: this.placing, i, j });
      this.occupied.add(tileKey(i, j)); // optimistic, corrected by the next snapshot
      if (!e.shiftKey) this.setPlacing(null); else this.updatePreview();
      return;
    }
    const objs = [...this.towers.values()].map((t) => t.obj).filter(Boolean);
    const hit = this.raycaster.intersectObjects(objs, true)[0];
    if (hit) {
      let o = hit.object;
      while (o && o.userData.towerId == null) o = o.parent;
      if (o) return this.select(o.userData.towerId);
    }
    if (this.hover) {
      const t = [...this.towers.values()].find((t) => t.i === this.hover.i && t.j === this.hover.j);
      if (t) return this.select(t.id);
    }
    this.select(null);
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (!down) { this.keys.delete(k); return; }
    this.keys.add(k);
    if (this.over) return;
    if (k === 'enter') { e.preventDefault(); this.el.chatInput.focus(); }
    else if (/^[1-9]$/.test(k)) { const t = this.owned[+k - 1]; if (t) this.setPlacing(this.placing === t ? null : t); }
    else if (k === 'escape') { if (!this.el.help.hidden) this.el.help.hidden = true; else if (this.placing) this.setPlacing(null); else this.select(null); }
    else if (k === 'u' && this.selected) this.send({ a: 'upgrade', id: this.selected });
    else if ((k === 'x' || k === 'delete') && this.selected) this.sellSelected();
    else if (k === 't' && this.selected) this.send({ a: 'target', id: this.selected });
  }

  sellSelected(btn) {
    const t = this.towers.get(this.selected);
    if (!t || t.owner !== this.myId) return;
    if (btn && !btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'Click again to sell';
      setTimeout(() => this.renderPanel(true), 2500);
      return;
    }
    this.send({ a: 'sell', id: t.id });
  }

  myPlayer() { return this.players.get(this.myId); }
  isFree(type) { const p = this.myPlayer(); return !!p && p.free > 0 && STARTER_TOWERS.includes(type); }
  affordable(type) { const p = this.myPlayer(); return !!p && (this.isFree(type) || p.mana >= TOWERS[type].cost); }

  setPlacing(type) {
    if (this.over) type = null;
    if (this.ghost) { this.scene.remove(this.ghost.group); this.ghost = null; }
    this.placing = type;
    if (type) {
      this.select(null);
      this.ghost = this.ghosts[type] || (this.ghosts[type] = makeGhostTower(type));
      this.scene.add(this.ghost.group);
    }
    this.highlight.visible = !!type;
    this.el.bar.querySelectorAll('.tb').forEach((b) => b.classList.toggle('active', b.dataset.t === type));
    this.updatePreview();
  }

  updatePreview() {
    if (!this.placing) {
      this.hoverTile.visible = false;
      if (!this.selected) this.rangeRing.visible = false;
      return;
    }
    if (!this.hover) { this.hoverTile.visible = false; this.rangeRing.visible = false; if (this.ghost) this.ghost.group.visible = false; return; }
    const { x, z } = tileToWorld(this.hover.i, this.hover.j);
    const ok = canBuild(this.map, this.hover.i, this.hover.j, this.occupied) && this.affordable(this.placing);
    this.hoverTile.visible = true;
    this.hoverTile.position.set(x, 0.03, z);
    this.hoverTile.material.color.set(ok ? 0x4ade80 : 0xf87171);
    this.ghost.group.visible = true;
    this.ghost.group.position.set(x, 0, z);
    this.showRange(x, z, towerStats(this.placing, 0).range, ok ? 0xffffff : 0xf87171);
  }

  showRange(x, z, r, color = 0xffffff) {
    this.rangeRing.visible = true;
    this.rangeRing.position.set(x, 0.05, z);
    this.rangeRing.scale.setScalar(r);
    this.rangeRingMat.color.set(color);
    this.rangeDiscMat.color.set(color);
  }

  select(id) {
    this.selected = id && this.towers.has(id) ? id : null;
    if (this.selected) {
      const t = this.towers.get(this.selected);
      this.showRange(t.x, t.z, towerStats(t.type, t.level).range, t.owner === this.myId ? 0xffffff : 0xa5b4fc);
    } else if (!this.placing) this.rangeRing.visible = false;
    this.renderPanel(true);
  }

  renderPanel(force) {
    const el = this.el.panel;
    const t = this.selected && this.towers.get(this.selected);
    if (!t) { el.hidden = true; this.panelKey = null; return; }
    const me = this.myPlayer();
    const mine = t.owner === this.myId;
    const cost = upgradeCost(t.type, t.level);
    const key = [t.id, t.level, t.mode, mine && me ? me.mana >= (cost || 0) : 0].join('|');
    if (!force && key === this.panelKey) return;
    this.panelKey = key;
    const def = TOWERS[t.type];
    const s = towerStats(t.type, t.level);
    const nx = cost != null ? towerStats(t.type, t.level + 1) : null;
    const owner = this.players.get(t.owner);
    const rows = STAT_ROWS.filter(([k]) => s[k] != null || (nx && nx[k] != null)).map(([k, label, f]) => {
      const a = s[k] != null ? f(s[k]) : '—';
      const b = nx && nx[k] != null ? f(nx[k]) : null;
      return `<tr><td>${label}</td><td>${a}${b != null && b !== a ? ` <span class="up">→ ${b}</span>` : ''}</td></tr>`;
    }).join('');
    const stars = '★'.repeat(t.level) + '☆'.repeat(3 - t.level);
    el.hidden = false;
    el.innerHTML = `
      <div class="tp-head"><span class="tp-icon">${def.icon}</span>
        <div><b>${esc(def.name)}</b><div class="tp-lvl">${stars} <span>Level ${t.level}</span></div></div>
        <button class="tp-close" data-act="close" title="Close">✕</button></div>
      <div class="tp-owner">Owner: <b style="color:${owner ? owner.color : '#fff'}">${esc(owner ? owner.name : '?')}</b>${mine ? ' (you)' : ''}</div>
      <table class="tp-stats">${rows}</table>
      <p class="tp-perk">${esc(def.perk)}</p>
      ${mine ? `<div class="tp-actions">
        <button class="btn primary" data-act="upgrade" ${cost == null || me.mana < cost ? 'disabled' : ''}>${cost == null ? 'Max level' : `Upgrade · 🔮${cost}`}</button>
        ${def.attack !== 'aura' ? `<button class="btn" data-act="target">Target: ${MODE_LABEL[TARGET_MODES[t.mode]]}</button>` : ''}
        <button class="btn danger" data-act="sell">Sell · +${Math.floor(t.spent * SELL_REFUND)}</button>
      </div>` : `<p class="muted small">Only ${esc(owner ? owner.name : 'the owner')} can upgrade this tower.</p>`}`;
  }

  // ------------------------------------------------------------------ network state
  onSnap(s) {
    for (const [id, mana, free, skip, online] of s.pl) {
      const p = this.players.get(id);
      if (p) Object.assign(p, { mana, free, skip, online });
    }
    if (s.tw) this.syncTowers(s.tw);
    const seen = new Set();
    for (const [id, type, d, hp, flags] of s.en) {
      seen.add(id);
      let e = this.enemies.get(id);
      if (!e) e = this.addEnemy(id, type, d);
      else { e.fromD = e.d; e.toD = d; e.t = 0; }
      e.hp = hp;
      e.flags = flags;
    }
    for (const ev of s.ev) this.handleEvent(ev);
    for (const id of [...this.enemies.keys()]) if (!seen.has(id)) this.removeEnemy(id);
    if (s.r !== this.round && !s.ev.some((e) => e[0] === 'round')) this.round = s.r;
    this.roundLeft = s.rl;
    this.hp = s.hp;
    this.maxHp = s.mhp;
    this.canSkip = s.cs;
    this.updateHud();
  }

  handleEvent(ev) {
    switch (ev[0]) {
      case 'shot': this.fxShot(ev[1], ev.slice(2)); break;
      case 'die': { const e = this.enemies.get(ev[1]); if (e) { this.fxDeath(e); this.removeEnemy(ev[1]); } break; }
      case 'leak': {
        this.sanctum.hit();
        this.shake = Math.min(0.6, this.shake + 0.25);
        this.el.hpBox.classList.remove('hurt'); void this.el.hpBox.offsetWidth; this.el.hpBox.classList.add('hurt');
        this.removeEnemy(ev[1]);
        break;
      }
      case 'round': {
        this.round = ev[1];
        const w = WAVES[ev[1] - 1];
        this.showBanner(ev[1] === TOTAL_ROUNDS ? 'FINAL ROUND' : `Round ${ev[1]}`, w.msg, !!w.boss);
        break;
      }
      case 'skipped': this.toast('Wave skipped — next round!'); break;
      case 'summon': { const e = this.enemies.get(ev[1]); if (e) this.fxBurst(e.obj.position, 0x4ade80, 3); break; }
      case 'place': case 'upgrade': { const t = this.towers.get(ev[1]); if (t) this.fxBurst(new THREE.Vector3(t.x, 0.3, t.z), 0xfde68a, 1.6, true); break; }
    }
  }

  syncTowers(list) {
    const seen = new Set();
    for (const [id, type, i, j, level, owner, mode, spent] of list) {
      seen.add(id);
      let t = this.towers.get(id);
      if (t && t.level !== level) { this.scene.remove(t.obj); disposeObject(t.obj); t.obj = null; }
      if (!t) {
        const { x, z } = tileToWorld(i, j);
        t = { id, type, i, j, x, z, aim: Math.random() * PI * 2, obj: null };
        this.towers.set(id, t);
      }
      Object.assign(t, { level, owner, mode, spent });
      if (!t.obj) {
        const p = this.players.get(owner);
        const m = makeTower(type, level, p ? p.color : '#ffffff');
        m.group.position.set(t.x, 0, t.z);
        m.group.userData.towerId = id;
        m.head.rotation.y = t.aim;
        t.model = m;
        t.obj = m.group;
        this.scene.add(t.obj);
      }
    }
    for (const [id, t] of [...this.towers]) {
      if (seen.has(id)) continue;
      this.fxBurst(new THREE.Vector3(t.x, 0.5, t.z), 0xc4b5fd, 1.4, true);
      this.scene.remove(t.obj);
      disposeObject(t.obj);
      this.towers.delete(id);
    }
    this.occupied = new Set([...this.towers.values()].map((t) => tileKey(t.i, t.j)));
    this.buildHighlight();
    if (this.selected && !this.towers.has(this.selected)) this.select(null);
    else if (this.selected) this.select(this.selected);
    this.updatePreview();
  }

  addEnemy(id, type, d) {
    const m = makeEnemy(type);
    const obj = m.group;
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(FXG.barBg, HP_MATS.bg);
    const fg = new THREE.Mesh(FXG.barFg, HP_MATS.g);
    fg.position.set(-0.65, 0, 0.01);
    bg.renderOrder = 998;
    fg.renderOrder = 999;
    bar.add(bg, fg);
    bar.position.y = m.height;
    bar.visible = false;
    const ring = new THREE.Mesh(FXG.thickRing, STATUS_MATS.slow);
    ring.rotation.x = -PI / 2;
    ring.position.y = 0.06;
    ring.scale.setScalar(m.ring);
    ring.visible = false;
    obj.add(bar, ring);
    const p = pathPos(this.map, d);
    obj.position.set(p.x, PATH_Y, p.z);
    obj.rotation.y = p.angle;
    this.scene.add(obj);
    const e = { id, type, obj, m, bar, fg, ring, d, fromD: d, toD: d, t: 1, hp: 1, flags: 0, phase: Math.random() * 10 };
    this.enemies.set(id, e);
    return e;
  }

  removeEnemy(id) {
    const e = this.enemies.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    disposeObject(e.obj);
    this.enemies.delete(id);
  }

  updateHud() {
    const me = this.myPlayer();
    this.el.rnum.textContent = this.round;
    const frac = Math.max(0, this.hp / this.maxHp);
    this.el.hpFill.style.width = frac * 100 + '%';
    this.el.hpFill.style.background = frac > 0.5 ? 'var(--ok)' : frac > 0.25 ? 'var(--gold)' : 'var(--danger)';
    this.el.hpText.textContent = `Sanctum ${Math.ceil(this.hp)} / ${this.maxHp}`;

    const players = [...this.players.values()];
    const online = players.filter((p) => p.online);
    this.el.players.innerHTML = players.map((p) => `
      <li class="${p.online ? '' : 'offline'}"><span class="dot" style="background:${p.color}"></span>
      <span class="pname">${esc(p.name)}${p.id === this.myId ? ' (you)' : ''}</span>
      <span class="pmana">🔮${p.mana}</span>${this.canSkip && p.skip ? '<span class="pskip">⏭</span>' : ''}</li>`).join('');

    if (me) {
      this.el.mana.textContent = me.mana;
      this.el.freeBadge.hidden = !(me.free > 0);
      this.el.freeNum.textContent = me.free;
      this.el.bar.querySelectorAll('.tb').forEach((b) => {
        const t = b.dataset.t;
        b.querySelector('.tb-cost').textContent = this.isFree(t) ? 'FREE' : `🔮${TOWERS[t].cost}`;
        b.classList.toggle('poor', !this.affordable(t));
      });
    }
    const votes = players.filter((p) => p.online && p.skip).length;
    const needed = Math.floor(online.length / 2) + 1;
    this.el.skip.hidden = !this.canSkip || this.over;
    this.el.skip.textContent = `${me && me.skip ? '✔ Voted to skip' : 'Skip to next round ⏭'} (${votes}/${needed})`;
    this.el.skip.classList.toggle('voted', !!(me && me.skip));

    let boss = null;
    for (const e of this.enemies.values()) if (e.type === 'lich') boss = e;
    this.el.boss.hidden = !boss;
    if (boss) this.el.bossFill.style.width = boss.hp * 100 + '%';
    this.renderPanel(false);
    if (this.placing) this.updatePreview();
  }

  // ------------------------------------------------------------------ effects
  addFx(dur, update, objs = [], onEnd) {
    objs.forEach((o) => this.scene.add(o));
    this.effects.push({ t: 0, dur, update, objs, onEnd });
  }

  enemyAim(e) { return e.obj.position.clone().add(new THREE.Vector3(0, e.m.fly ? 0 : Math.min(1.3, e.m.height * 0.45), 0)); }

  fxShot(towerId, ids) {
    const t = this.towers.get(towerId);
    if (!t || !t.model) return;
    const targets = ids.map((id) => this.enemies.get(id)).filter(Boolean);
    if (!targets.length) return;
    const first = targets[0];
    t.aim = Math.atan2(first.obj.position.x - t.x, first.obj.position.z - t.z);
    t.model.head.rotation.y = lerpAngle(t.model.head.rotation.y, t.aim, 0.6);
    t.obj.updateMatrixWorld(true);
    const from = t.model.head.localToWorld(t.model.muzzle.clone());
    const atk = TOWERS[t.type].attack;

    if (atk === 'chain') {
      const pts = [from, ...targets.map((e) => this.enemyAim(e))];
      const path = new THREE.CurvePath();
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const segs = 5;
        let prev = a.clone();
        for (let s = 1; s <= segs; s++) {
          const p = a.clone().lerp(b, s / segs);
          if (s < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
          path.add(new THREE.LineCurve3(prev, p));
          prev = p;
        }
      }
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(4, path.curves.length * 2), 0.07, 4, false), LIGHTNING_MAT);
      this.addFx(0.18, (k) => { mesh.visible = k < 0.35 || (k > 0.5 && k < 0.8); }, [mesh], () => mesh.geometry.dispose());
      targets.forEach((e) => this.fxBurst(this.enemyAim(e), 0xbfe6ff, 0.8));
      return;
    }
    const spec = PROJ[atk];
    if (!spec) return;
    const mesh = new THREE.Mesh(FXG[spec.geo], spec.mat);
    if (Array.isArray(spec.size)) mesh.scale.set(...spec.size); else mesh.scale.setScalar(spec.size);
    mesh.position.copy(from);
    let to = this.enemyAim(first);
    const tid = first.id;
    const splash = towerStats(t.type, t.level).splash;
    this.addFx(spec.dur, (k) => {
      const e = this.enemies.get(tid);
      if (e) to = this.enemyAim(e);
      mesh.position.lerpVectors(from, to, k);
      if (spec.arc) mesh.position.y += Math.sin(k * PI) * spec.arc;
      if (atk === 'arrow') mesh.lookAt(to);
      else mesh.rotation.y += 0.3;
    }, [mesh], () => { if (spec.burst) this.fxBurst(to, spec.burst, splash || 1.2); });
  }

  fxBurst(pos, color, radius, flat = false) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(flat ? FXG.thickRing : FXG.sphere, mat);
    mesh.position.copy(pos);
    if (flat) mesh.rotation.x = -PI / 2;
    this.addFx(0.4, (k) => {
      mesh.scale.setScalar(radius * (0.25 + 0.75 * Math.sqrt(k)));
      mat.opacity = 0.6 * (1 - k);
    }, [mesh], () => mat.dispose());
  }

  fxDeath(e) {
    const origin = this.enemyAim(e);
    const bits = [];
    const mat = DEBRIS_MATS[e.type] || DEBRIS_MATS.zombie;
    const size = e.type === 'lich' ? 0.5 : e.type === 'golem' ? 0.35 : 0.18;
    const count = e.type === 'lich' ? 18 : 7;
    for (let k = 0; k < count; k++) {
      const b = new THREE.Mesh(FXG.box, mat);
      b.position.copy(origin);
      b.scale.setScalar(size);
      b.userData.v = new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6);
      bits.push(b);
    }
    const soul = new THREE.Mesh(FXG.sphere, SOUL_MAT);
    soul.position.copy(origin);
    bits.push(soul);
    this.addFx(0.7, (k, dt) => {
      for (const b of bits) {
        if (b === soul) { soul.position.y += dt * 4; soul.scale.setScalar(0.35 * (1 - k)); continue; }
        b.userData.v.y -= 18 * dt;
        b.position.addScaledVector(b.userData.v, dt);
        if (b.position.y < PATH_Y) { b.position.y = PATH_Y; b.userData.v.multiplyScalar(0.4); }
        b.scale.setScalar(size * (1 - k * 0.8));
        b.rotation.x += dt * 8;
      }
    }, bits);
    if (e.type === 'lich') { this.fxBurst(origin, 0x4ade80, 8); this.shake = 0.8; }
  }

  // ------------------------------------------------------------------ main loop
  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    this.watchPerformance(rawDt);
    this.time += dt;
    const time = this.time;

    // round timer
    this.roundLeft = Math.max(0, this.roundLeft - dt);
    const timerText = this.round === TOTAL_ROUNDS && this.roundLeft <= 0 ? 'FINAL' : fmtTime(this.roundLeft);
    if (timerText !== this.lastTimer) { this.el.timer.textContent = timerText; this.lastTimer = timerText; this.el.timer.classList.toggle('low', this.roundLeft < 15); }

    // keyboard camera
    const c = this.controls;
    if (!Number.isFinite(this.camera.position.x + this.camera.position.y + this.camera.position.z)) { this.onResize(); this.frameBoard(); }
    const pan = new THREE.Vector3();
    const fwd = new THREE.Vector3().subVectors(c.target, this.camera.position).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (this.keys.has('w') || this.keys.has('arrowup')) pan.add(fwd);
    if (this.keys.has('s') || this.keys.has('arrowdown')) pan.sub(fwd);
    if (this.keys.has('d') || this.keys.has('arrowright')) pan.add(right);
    if (this.keys.has('a') || this.keys.has('arrowleft')) pan.sub(right);
    if (pan.lengthSq()) {
      pan.normalize().multiplyScalar(dt * 28);
      c.target.add(pan);
      this.camera.position.add(pan);
    }
    if (this.keys.has('q') || this.keys.has('e')) {
      const ang = (this.keys.has('q') ? 1 : -1) * dt * 1.6;
      const off = this.camera.position.clone().sub(c.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      this.camera.position.copy(c.target).add(off);
    }
    const clampX = (GRID_W * TILE) / 2, clampZ = (GRID_H * TILE) / 2;
    const tx = THREE.MathUtils.clamp(c.target.x, -clampX, clampX), tz = THREE.MathUtils.clamp(c.target.z, -clampZ, clampZ);
    if (tx !== c.target.x || tz !== c.target.z) {
      this.camera.position.x += tx - c.target.x;
      this.camera.position.z += tz - c.target.z;
      c.target.x = tx; c.target.z = tz;
    }
    c.update();

    // enemies
    const camQ = this.camera.quaternion;
    for (const e of this.enemies.values()) {
      e.t += dt / SNAP_DT;
      e.d = e.fromD + (e.toD - e.fromD) * Math.min(e.t, 1.5);
      const p = pathPos(this.map, Math.min(e.d, this.map.length));
      const m = e.m;
      let y = PATH_Y;
      if (m.fly) y += m.fly + Math.sin(time * 4 + e.phase) * 0.25;
      else if (m.float) y += m.float + Math.sin(time * 2 + e.phase) * 0.18;
      else { m.body.position.y = Math.abs(Math.sin(time * 7 + e.phase)) * 0.08; m.body.rotation.z = Math.sin(time * 7 + e.phase) * 0.06; }
      if (m.wings) { const f = Math.sin(time * 18 + e.phase) * 0.8; m.wings[0].rotation.z = f; m.wings[1].rotation.z = -f; }
      e.obj.position.set(p.x, y, p.z);
      e.obj.rotation.y = lerpAngle(e.obj.rotation.y, p.angle, Math.min(1, dt * 10));
      const showBar = e.hp < 0.999 || e.type === 'lich';
      e.bar.visible = showBar;
      if (showBar) {
        e.fg.scale.x = Math.max(0.001, e.hp);
        e.fg.material = e.hp > 0.5 ? HP_MATS.g : e.hp > 0.25 ? HP_MATS.y : HP_MATS.r;
        e.bar.quaternion.copy(e.obj.quaternion).invert().multiply(camQ);
      }
      e.ring.visible = !!e.flags;
      if (e.flags) { e.ring.material = e.flags & 2 ? STATUS_MATS.burn : e.flags & 1 ? STATUS_MATS.slow : STATUS_MATS.curse; e.ring.rotation.z = time * 2; }
    }

    // towers
    for (const t of this.towers.values()) {
      if (!t.model) continue;
      t.model.update(time);
      t.model.head.rotation.y = lerpAngle(t.model.head.rotation.y, t.aim, Math.min(1, dt * 10));
    }
    if (this.ghost) this.ghost.update(time);
    this.portal.update(time);
    this.sanctum.update(time, dt, Math.max(0, this.hp / this.maxHp));
    if (this.highlight.visible) this.highlight.material.opacity = 0.06 + Math.sin(time * 4) * 0.03;

    // particles
    const P = this.particles, pos = P.pos;
    for (let k = 0; k < P.N; k++) {
      const ix = k * 3;
      if (P.kind === 'snow') { pos[ix + 1] -= dt * 2.2; pos[ix] += Math.sin(time + k) * dt * 0.6; if (pos[ix + 1] < 0) pos[ix + 1] = 14; }
      else if (P.kind === 'embers') { pos[ix + 1] += dt * (1 + (k % 5) * 0.3); pos[ix] += Math.sin(time * 2 + k) * dt * 0.4; if (pos[ix + 1] > 14) pos[ix + 1] = 0; }
      else { pos[ix] += Math.sin(time * 0.7 + k) * dt * 0.7; pos[ix + 1] += Math.cos(time * 0.9 + k * 1.3) * dt * 0.35; pos[ix + 2] += Math.cos(time * 0.6 + k) * dt * 0.7; }
    }
    P.points.geometry.attributes.position.needsUpdate = true;

    // effects
    for (let k = this.effects.length - 1; k >= 0; k--) {
      const fx = this.effects[k];
      fx.t += dt;
      if (fx.t >= fx.dur) {
        fx.objs.forEach((o) => this.scene.remove(o));
        if (fx.onEnd) fx.onEnd();
        this.effects.splice(k, 1);
      } else fx.update(fx.t / fx.dur, dt);
    }

    // render (with a little camera shake when the sanctum is hit)
    let off = null;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      off = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shake);
      this.camera.position.add(off);
    }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    if (off) this.camera.position.sub(off);
  }

  // On slow computers (e.g. school Chromebooks), step graphics down until the game runs smoothly.
  watchPerformance(rawDt) {
    if (document.hidden || rawDt > 0.5) return; // ignore background tabs and hiccups
    const p = (this.perf ||= { frames: 0, time: 0, warmup: 3 });
    if (p.warmup > 0) { p.warmup -= rawDt; return; }
    p.frames++;
    p.time += rawDt;
    if (p.time < 4) return;
    const fps = p.frames / p.time;
    p.frames = 0;
    p.time = 0;
    if (fps >= 28) return;
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.gfx.bloom = false;
    } else if (this.sun.castShadow) {
      this.sun.castShadow = false;
      this.gfx.shadows = false;
    } else if (this.renderer.getPixelRatio() > 0.75) {
      this.renderer.setPixelRatio(Math.max(0.75, this.renderer.getPixelRatio() - 0.5));
      this.gfx.lowRes = true;
      this.onResize();
    } else return;
    this.toast('Graphics lowered so the game runs smoother.');
    if (this.onGfxChange) this.onGfxChange({ ...this.gfx });
  }

  onGameOver(r) {
    this.over = true;
    this.setPlacing(null);
    this.select(null);
    this.el.skip.hidden = true;
    const lich = r.won ? 'The Lich King has fallen and the Sanctum is safe!' : `The Sanctum fell on round ${r.round}.`;
    this.el.gameover.hidden = false;
    this.el.gameover.innerHTML = `
      <div class="go-card ${r.won ? 'win' : 'lose'}">
        <h1>${r.won ? 'Victory!' : 'Defeat'}</h1>
        <p>${lich}</p>
        <div class="go-stats">
          <div><span>Map</span><b>${esc(this.map.name)}</b></div>
          <div><span>Difficulty</span><b style="color:${this.diff.color}">${this.diff.name}</b></div>
          <div><span>Enemies defeated</span><b>${r.kills}</b></div>
        </div>
        <div class="go-coins">${r.won ? `+${r.coins} 🪙 coins earned!` : 'Win a match to earn coins — harder difficulty pays more.'}</div>
        <button class="btn primary big" data-act="continue">Continue</button>
      </div>`;
  }

  destroy() {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.controls.dispose();
    this.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    if (this.composer) this.composer.dispose();
    this.renderer.dispose();
    this.root.innerHTML = '';
  }
}
