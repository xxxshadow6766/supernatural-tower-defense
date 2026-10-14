// Procedural low-poly models. Every model is assembled from primitives and merged into
// a few meshes (solid / glowing / ghostly) so the scene stays fast even with many enemies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;

function strip(g) {
  const n = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', n.getAttribute('position'));
  out.setAttribute('normal', n.getAttribute('normal'));
  return out;
}
const GEO = {
  box: strip(new THREE.BoxGeometry(1, 1, 1)),
  sph: strip(new THREE.SphereGeometry(0.5, 12, 9)),
  cyl: strip(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)),
  cone: strip(new THREE.ConeGeometry(0.5, 1, 10)),
  torus: strip(new THREE.TorusGeometry(0.5, 0.08, 6, 24)),
  arc: strip(new THREE.TorusGeometry(0.5, 0.06, 5, 14, PI)),
  octa: strip(new THREE.OctahedronGeometry(0.5, 0)),
  dodeca: strip(new THREE.DodecahedronGeometry(0.5, 0)),
  ico: strip(new THREE.IcosahedronGeometry(0.5, 0)),
};
const taperCache = new Map();
function taper(rt, rb, seg = 10) {
  const k = `${rt}_${rb}_${seg}`;
  if (!taperCache.has(k)) taperCache.set(k, strip(new THREE.CylinderGeometry(rt, rb, 1, seg)));
  return taperCache.get(k);
}

export const MATS = {
  std: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  ghost: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.5, roughness: 0.2, depthWrite: false, emissive: 0x16303a }),
};
const GHOST_MATS = {
  std: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
  ghost: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false }),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class Builder {
  constructor() { this.parts = { std: [], glow: [], ghost: [] }; }
  // geo: GEO key or a geometry; scale: number or [x,y,z]; rot: euler [x,y,z]
  add(geo, color, pos = [0, 0, 0], scale = 1, rot = [0, 0, 0], mat = 'std', intensity = 1) {
    const g = (typeof geo === 'string' ? GEO[geo] : geo).clone();
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    const sc = typeof scale === 'number' ? [scale, scale, scale] : scale;
    g.applyMatrix4(_m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(sc[0], sc[1], sc[2])));
    _c.set(color);
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = _c.r * intensity; arr[i * 3 + 1] = _c.g * intensity; arr[i * 3 + 2] = _c.b * intensity; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts[mat].push(g);
    return this;
  }
  glow(geo, color, pos, scale, rot, intensity = 2) { return this.add(geo, color, pos, scale, rot, 'glow', intensity); }
  ghost(geo, color, pos, scale, rot) { return this.add(geo, color, pos, scale, rot, 'ghost'); }
  build(shadows = true) {
    const group = new THREE.Group();
    for (const [k, list] of Object.entries(this.parts)) {
      if (!list.length) continue;
      const geo = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, MATS[k]);
      mesh.castShadow = shadows && k === 'std';
      mesh.receiveShadow = k === 'std';
      group.add(mesh);
    }
    return group;
  }
}

export function disposeObject(obj) {
  obj.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
}

// ---------------------------------------------------------------- towers
function pedestal(b, ownerColor, stone = 0x6b6880) {
  b.add(taper(0.82, 0.95, 8), stone, [0, 0.25, 0], [1, 0.5, 1]);
  b.add(taper(0.68, 0.82, 8), 0x8a879c, [0, 0.6, 0], [1, 0.2, 1]);
  b.glow('torus', ownerColor, [0, 0.5, 0], [1.72, 1.72, 0.7], [PI / 2, 0, 0], 1.25);
}
function levelBling(level, color) {
  // small glowing runes orbiting the tower, one per upgrade level, plus a halo at max level
  if (!level) return null;
  const b = new Builder();
  for (let k = 0; k < level; k++) {
    const a = (k / level) * PI * 2;
    b.glow('octa', color, [Math.cos(a) * 1.0, 1.0, Math.sin(a) * 1.0], [0.16, 0.26, 0.16], [0, 0, 0], 2.2);
  }
  return b.build(false);
}
function robe(b, color, trim, h = 1.3) {
  b.add(taper(0.2, 0.62), color, [0, 0.7 + h / 2, 0], [1, h, 1]);
  b.add(taper(0.62, 0.64), trim, [0, 0.74, 0], [1, 0.08, 1]);
}
function sleeve(b, color, side, toY = 1.6) {
  b.add('cyl', color, [side * 0.33, toY, 0.15], [0.18, 0.55, 0.18], [0.5, 0, -side * 0.9]);
}

const TOWER_BUILDERS = {
  wizard(h, ex) {
    robe(h, 0x5b3fd6, 0xfcd34d);
    sleeve(h, 0x5b3fd6, 1, 1.7);
    h.add('sph', 0xf1c9a5, [0, 2.2, 0], 0.62);
    h.add('cone', 0xf3f4f6, [0, 1.95, 0.2], [0.36, 0.55, 0.3], [PI, 0, 0]);
    h.add('cyl', 0x2e1f7a, [0, 2.4, 0], [1.1, 0.05, 1.1]);
    h.add('cone', 0x3b2a9e, [0, 2.9, -0.06], [0.66, 1.0, 0.66], [-0.15, 0, 0]);
    h.glow('octa', 0xfde68a, [0.14, 2.75, 0.24], 0.15);
    h.add('cyl', 0x6b4423, [0.55, 1.65, 0.25], [0.09, 2.1, 0.09]);
    h.glow('sph', 0xb794ff, [0.55, 2.8, 0.25], 0.42, [0, 0, 0], 1.9);
    ex.muzzle = [0.55, 2.8, 0.25];
  },
  witch(h, ex) {
    robe(h, 0x1d5f7a, 0x7dd3fc);
    sleeve(h, 0x1d5f7a, -1, 1.7);
    h.add('sph', 0x1a1a2e, [0, 2.24, -0.07], 0.68);
    h.add('sph', 0xe9d5c4, [0, 2.2, 0.02], 0.6);
    h.add('cyl', 0x15151f, [0, 2.42, 0], [1.25, 0.05, 1.25]);
    h.add('cone', 0x15151f, [0, 3.05, -0.12], [0.6, 1.35, 0.6], [-0.28, 0, 0]);
    h.add('cyl', 0x7c3aed, [0, 2.52, -0.02], [0.62, 0.1, 0.62]);
    h.add('cyl', 0x5b4636, [-0.55, 1.65, 0.25], [0.08, 2.1, 0.08]);
    h.glow('octa', 0x8ff3ff, [-0.55, 2.85, 0.25], [0.36, 0.62, 0.36], [0, 0, 0], 1.8);
    ex.muzzle = [-0.55, 2.85, 0.25];
    ex.orbit = { geo: 'octa', color: 0xa5f3fc, n: 3, r: 0.95, y: 1.7, size: [0.14, 0.3, 0.14] };
  },
  archer(h, ex) {
    h.ghost(taper(0.28, 0.55), 0x67e8f9, [0, 1.35, 0], [1, 1.3, 1]);
    h.ghost('cone', 0x22d3ee, [0, 2.32, -0.02], [0.78, 0.95, 0.78]);
    h.add('sph', 0x0b1324, [0, 2.14, 0.1], 0.44);
    h.glow('sph', 0xe0ffff, [0.09, 2.17, 0.31], 0.08, [0, 0, 0], 3);
    h.glow('sph', 0xe0ffff, [-0.09, 2.17, 0.31], 0.08, [0, 0, 0], 3);
    h.glow('arc', 0xa5f3fc, [0, 1.75, 0.35], [1.25, 1.25, 1], [0, -PI / 2, -PI / 2], 2.2);
    h.glow('cyl', 0xe0ffff, [0, 1.75, 0.35], [0.03, 1.25, 0.03], [0, 0, 0], 2);
    ex.muzzle = [0, 1.75, 0.9];
  },
  pyro(h, ex) {
    robe(h, 0x9f1d1d, 0xf59e0b);
    sleeve(h, 0x9f1d1d, 1, 1.9);
    sleeve(h, 0x9f1d1d, -1, 1.9);
    h.add('sph', 0xe0b394, [0, 2.2, 0.02], 0.6);
    h.add('cone', 0x5c0f0f, [0, 2.55, -0.05], [0.8, 0.95, 0.8]);
    h.glow('sph', 0xff7a1a, [0, 3.15, 0.15], 0.62, [0, 0, 0], 1.9);
    h.glow('sph', 0xffe08a, [0, 3.15, 0.15], 0.36, [0, 0, 0], 2.3);
    h.glow('cone', 0xff9a3d, [0.42, 2.05, 0], [0.16, 0.35, 0.16], [0, 0, 0], 2.2);
    h.glow('cone', 0xff9a3d, [-0.42, 2.05, 0], [0.16, 0.35, 0.16], [0, 0, 0], 2.2);
    ex.muzzle = [0, 3.15, 0.15];
  },
  storm(h, ex) {
    robe(h, 0x1e3a8a, 0x93c5fd, 1.4);
    sleeve(h, 0x1e3a8a, 1, 1.85);
    h.add('cyl', 0x60a5fa, [0, 2.0, 0], [0.75, 0.12, 0.75]);
    h.add('sph', 0xe0c3a5, [0, 2.32, 0.02], 0.58);
    h.add('cone', 0x172554, [0, 3.0, -0.05], [0.58, 1.15, 0.58], [-0.1, 0, 0]);
    h.glow('octa', 0x93c5fd, [0, 2.95, 0.22], 0.14);
    h.add('cyl', 0x9ca3af, [0.55, 1.95, 0.25], [0.08, 2.6, 0.08]);
    h.glow('sph', 0x9fd3ff, [0.55, 3.35, 0.25], 0.46, [0, 0, 0], 1.9);
    ex.muzzle = [0.55, 3.35, 0.25];
    ex.ring = { color: 0x7dd3fc, pos: [0.55, 3.35, 0.25], r: 0.7 };
  },
  necro(h, ex) {
    robe(h, 0x18181b, 0x166534);
    sleeve(h, 0x18181b, 1, 1.7);
    h.add('cone', 0x09090b, [0, 2.45, -0.06], [0.82, 1.05, 0.82]);
    h.add('sph', 0xe7e5e4, [0, 2.2, 0.06], 0.58);
    h.glow('sph', 0x4ade80, [0.1, 2.24, 0.3], 0.1, [0, 0, 0], 3);
    h.glow('sph', 0x4ade80, [-0.1, 2.24, 0.3], 0.1, [0, 0, 0], 3);
    h.add('cyl', 0xd6d3d1, [0.55, 1.65, 0.25], [0.08, 2.1, 0.08]);
    h.add('sph', 0xe7e5e4, [0.55, 2.72, 0.25], 0.32);
    h.glow('sph', 0x4ade80, [0.55, 3.0, 0.25], 0.32, [0, 0, 0], 2.6);
    ex.muzzle = [0.55, 3.0, 0.25];
    ex.orbit = { geo: 'sph', color: 0x86efac, n: 3, r: 1.0, y: 2.0, size: 0.2 };
  },
  obelisk(h, ex, b) {
    const body = new THREE.CylinderGeometry(0.3, 0.52, 1, 4);
    b.add(strip(body), 0xe8e1c9, [0, 2.2, 0], [1, 3, 1], [0, PI / 4, 0]);
    for (const y of [1.0, 2.0, 3.0]) b.add(strip(new THREE.CylinderGeometry(0.5 - (y - 1) * 0.07, 0.52 - (y - 1) * 0.07, 1, 4)), 0xfbbf24, [0, y, 0], [1.06, 0.1, 1.06], [0, PI / 4, 0]);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * PI * 2;
      b.glow('box', 0xffe27a, [Math.sin(a) * 0.42, 1.5, Math.cos(a) * 0.42], [0.12, 0.35, 0.12], [0, a, 0], 2.4);
    }
    ex.muzzle = [0, 4.3, 0];
    ex.crystal = { color: 0xffe27a, y: 4.3 };
  },
  dragon(h, ex, b) {
    b.add('dodeca', 0x4b4453, [0, 0.55, 0], [1.9, 1.1, 1.9]);
    b.add('dodeca', 0x5d5566, [0, 1.15, 0], [1.6, 0.5, 1.6]);
    b.glow('torus', 0xff7a1a, [0, 0.9, 0], [1.9, 1.9, 0.5], [PI / 2, 0, 0], 1.6);
    const R = 0xb91c1c;
    h.add('sph', R, [0, 1.95, 0], [1.0, 0.9, 1.7]);
    h.add('sph', 0xf59e0b, [0, 1.82, 0.12], [0.75, 0.65, 1.4]);
    h.add(taper(0.18, 0.28), R, [0, 2.55, 0.72], [1, 0.95, 1], [0.6, 0, 0]);
    h.add('box', R, [0, 3.1, 1.12], [0.55, 0.48, 0.72]);
    h.add('box', 0x991b1b, [0, 2.98, 1.55], [0.4, 0.28, 0.5]);
    h.add('cone', 0xfef3c7, [0.18, 3.48, 0.95], [0.12, 0.45, 0.12], [-0.6, 0, 0]);
    h.add('cone', 0xfef3c7, [-0.18, 3.48, 0.95], [0.12, 0.45, 0.12], [-0.6, 0, 0]);
    h.glow('sph', 0xfde047, [0.2, 3.22, 1.4], 0.11, [0, 0, 0], 3);
    h.glow('sph', 0xfde047, [-0.2, 3.22, 1.4], 0.11, [0, 0, 0], 3);
    h.glow('sph', 0xff7a1a, [0, 2.95, 1.82], 0.16, [0, 0, 0], 3);
    h.add('cone', R, [0, 1.85, -1.45], [0.35, 1.4, 0.35], [-PI / 2 - 0.25, 0, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) h.add('box', 0x7f1d1d, [sx * 0.35, 1.45, sz * 0.45], [0.22, 0.5, 0.22]);
    for (let k = 0; k < 4; k++) h.add('cone', 0xfef3c7, [0, 2.45 - k * 0.05, 0.4 - k * 0.45], [0.1, 0.3, 0.1]);
    ex.muzzle = [0, 2.95, 1.85];
    ex.wings = { color: 0x7f1d1d, bone: R, y: 2.35, z: 0.1, span: 1.9 };
  },
};

function orbitGroup(o) {
  const b = new Builder();
  for (let k = 0; k < o.n; k++) {
    const a = (k / o.n) * PI * 2;
    b.glow(o.geo, o.color, [Math.cos(a) * o.r, 0, Math.sin(a) * o.r], o.size, [0, 0, 0], 2.2);
  }
  const g = b.build(false);
  g.position.y = o.y;
  return g;
}

// A triangular membrane wing (a flattened cone) whose base sits at the pivot and tip points outward.
function wingShape(b, side, span, depth, color, y = 0) {
  b.add('cone', color, [side * span * 0.5, y, 0], [0.06, span, depth], [0, 0, -side * PI / 2]);
}
function wing(side, w) {
  const b = new Builder();
  wingShape(b, side, w.span, 1.5, w.color);
  wingShape(b, side, w.span * 0.7, 0.9, w.bone, 0.03);
  b.add('cone', 0xfef3c7, [side * (w.span + 0.1), 0, 0], [0.08, 0.3, 0.08], [0, 0, -side * PI / 2]);
  const g = b.build();
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.4, w.y, w.z);
  pivot.add(g);
  return pivot;
}

// Returns { group, head, muzzle (local to head), update(t) }
export function makeTower(type, level, ownerColor = 0xffffff) {
  const base = new Builder();
  const headB = new Builder();
  const ex = {};
  pedestal(base, ownerColor);
  TOWER_BUILDERS[type](headB, ex, base);
  const group = new THREE.Group();
  group.add(base.build());
  const head = headB.build();
  group.add(head);
  const anims = [];
  const bling = levelBling(level, ownerColor);
  if (bling) { group.add(bling); anims.push((t) => { bling.rotation.y = t * 0.8; bling.position.y = Math.sin(t * 2) * 0.08; }); }
  if (level >= 3) {
    const halo = new Builder().glow('torus', 0xfde68a, [0, 0, 0], [1.1, 1.1, 0.5], [PI / 2, 0, 0], 2.4).build(false);
    const haloY = (ex.muzzle ? Math.max(ex.muzzle[1], 2.5) : 3) + 0.8;
    head.add(halo);
    anims.push((t) => { halo.position.y = haloY + Math.sin(t * 3) * 0.1; halo.rotation.z = Math.sin(t) * 0.15; });
  }
  if (ex.orbit) { const o = orbitGroup(ex.orbit); group.add(o); anims.push((t) => { o.rotation.y = t * 1.5; }); }
  if (ex.ring) {
    const r = new THREE.Group();
    r.position.set(...ex.ring.pos);
    const r1 = new Builder().glow('torus', ex.ring.color, [0, 0, 0], [ex.ring.r * 2, ex.ring.r * 2, 0.5], [0, 0, 0], 1.3).build(false);
    const r2 = new Builder().glow('torus', ex.ring.color, [0, 0, 0], [ex.ring.r * 1.6, ex.ring.r * 1.6, 0.5], [PI / 2, 0, 0], 1.3).build(false);
    r.add(r1, r2);
    head.add(r);
    anims.push((t) => { r1.rotation.y = t * 2; r2.rotation.x = t * 2.6; });
  }
  if (ex.crystal) {
    const c = new Builder().glow('octa', ex.crystal.color, [0, 0, 0], [0.5, 0.9, 0.5], [0, 0, 0], 1.7).build(false);
    const rings = new Builder()
      .glow('torus', 0xfbbf24, [0, 0, 0], [1.3, 1.3, 0.5], [PI / 2, 0, 0], 1.3)
      .glow('torus', 0xfbbf24, [0, 0, 0], [1.0, 1.0, 0.5], [PI / 2 + 0.5, 0, 0], 1.3).build(false);
    c.position.y = rings.position.y = ex.crystal.y;
    group.add(c, rings);
    anims.push((t) => { c.rotation.y = t * 1.2; c.position.y = ex.crystal.y + Math.sin(t * 2) * 0.12; rings.rotation.y = -t * 0.9; });
  }
  if (ex.wings) {
    const l = wing(-1, ex.wings), r = wing(1, ex.wings);
    head.add(l, r);
    anims.push((t) => { const f = Math.sin(t * 3) * 0.35; l.rotation.z = -f - 0.15; r.rotation.z = f + 0.15; });
  }
  group.scale.setScalar(1.12 + 0.06 * level);
  return {
    group, head,
    muzzle: new THREE.Vector3(...(ex.muzzle || [0, 2.5, 0])),
    update: (t) => anims.forEach((a) => a(t)),
  };
}

export function makeGhostTower(type) {
  const m = makeTower(type, 0, 0xffffff);
  m.group.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material === MATS.glow ? GHOST_MATS.glow : o.material === MATS.ghost ? GHOST_MATS.ghost : GHOST_MATS.std;
    o.castShadow = false;
  });
  return m;
}

// ---------------------------------------------------------------- enemies
const ENEMY_BUILDERS = {
  zombie(b) {
    b.add('box', 0x3f3a5a, [0.16, 0.4, 0], [0.24, 0.8, 0.26]);
    b.add('box', 0x3f3a5a, [-0.16, 0.4, 0], [0.24, 0.8, 0.26]);
    b.add('box', 0x56693f, [0, 1.15, 0], [0.62, 0.75, 0.36]);
    b.add('box', 0x3b2f2a, [0, 0.8, 0], [0.64, 0.08, 0.38]);
    b.add('box', 0x86a85d, [0.4, 1.32, 0.3], [0.18, 0.18, 0.72]);
    b.add('box', 0x86a85d, [-0.4, 1.25, 0.3], [0.18, 0.18, 0.72]);
    b.add('box', 0x8fb862, [0, 1.8, 0.02], [0.46, 0.46, 0.46]);
    b.glow('sph', 0xff3b3b, [0.1, 1.86, 0.25], 0.09, [0, 0, 0], 3);
    b.glow('sph', 0xff3b3b, [-0.1, 1.86, 0.25], 0.09, [0, 0, 0], 3);
    return { height: 2.3, ring: 0.55 };
  },
  bat(b, ex) {
    b.add('sph', 0x2b1836, [0, 0, 0], [0.5, 0.45, 0.65]);
    b.add('sph', 0x2b1836, [0, 0.12, 0.32], 0.36);
    b.add('cone', 0x2b1836, [0.1, 0.34, 0.3], [0.1, 0.22, 0.1]);
    b.add('cone', 0x2b1836, [-0.1, 0.34, 0.3], [0.1, 0.22, 0.1]);
    b.glow('sph', 0xff3b3b, [0.08, 0.16, 0.48], 0.07, [0, 0, 0], 3);
    b.glow('sph', 0xff3b3b, [-0.08, 0.16, 0.48], 0.07, [0, 0, 0], 3);
    ex.wings = { color: 0x5b2170, span: 0.9 };
    return { height: 0.8, ring: 0.45, fly: 2.4 };
  },
  skeleton(b) {
    const B = 0xe7e2d3;
    b.add('box', B, [0.14, 0.42, 0], [0.1, 0.84, 0.1]);
    b.add('box', B, [-0.14, 0.42, 0], [0.1, 0.84, 0.1]);
    b.add('box', B, [0, 0.86, 0], [0.36, 0.12, 0.2]);
    b.add('cyl', B, [0, 1.1, 0], [0.08, 0.5, 0.08]);
    b.add('box', 0x64748b, [0, 1.3, 0.02], [0.56, 0.44, 0.32]);
    b.add('box', B, [0.34, 1.2, 0.1], [0.08, 0.5, 0.08]);
    b.add('sph', 0xf5f5f4, [0, 1.76, 0], 0.42);
    b.add('sph', 0x475569, [0, 1.86, -0.02], [0.48, 0.3, 0.48]);
    b.glow('sph', 0x67e8f9, [0.08, 1.77, 0.18], 0.07, [0, 0, 0], 3);
    b.glow('sph', 0x67e8f9, [-0.08, 1.77, 0.18], 0.07, [0, 0, 0], 3);
    b.add('cyl', 0x52525b, [-0.36, 1.15, 0.22], [0.6, 0.08, 0.6], [PI / 2, 0, 0]);
    b.add('box', 0xb91c1c, [-0.36, 1.15, 0.27], [0.18, 0.18, 0.04]);
    b.add('box', 0xcbd5e1, [0.36, 1.0, 0.45], [0.06, 0.06, 0.9]);
    return { height: 2.3, ring: 0.55 };
  },
  phantom(b) {
    b.ghost(taper(0.25, 0.6), 0x9fe8ff, [0, 1.0, 0], [1, 1.4, 1]);
    b.ghost('sph', 0xbff4ff, [0, 1.95, 0], 0.62);
    b.ghost('cone', 0x9fe8ff, [0.35, 1.45, 0.3], [0.16, 0.6, 0.16], [PI / 2 - 0.3, 0, 0]);
    b.ghost('cone', 0x9fe8ff, [-0.35, 1.45, 0.3], [0.16, 0.6, 0.16], [PI / 2 - 0.3, 0, 0]);
    b.glow('sph', 0xe0ffff, [0.11, 2.0, 0.25], 0.1, [0, 0, 0], 3);
    b.glow('sph', 0xe0ffff, [-0.11, 2.0, 0.25], 0.1, [0, 0, 0], 3);
    return { height: 2.5, ring: 0.6, float: 0.5 };
  },
  golem(b) {
    const S = 0x7d7468;
    b.add('dodeca', 0x6b6157, [0.38, 0.45, 0], [0.55, 0.9, 0.55]);
    b.add('dodeca', 0x6b6157, [-0.38, 0.45, 0], [0.55, 0.9, 0.55]);
    b.add('dodeca', S, [0, 1.6, 0], [1.5, 1.4, 1.1]);
    b.add('dodeca', 0x4d7c0f, [0.4, 2.1, -0.2], 0.4);
    b.glow('octa', 0xff8a3d, [0, 1.68, 0.52], [0.32, 0.32, 0.12], [0, 0, 0], 2.6);
    b.add('dodeca', S, [0, 2.55, 0.1], 0.62);
    b.glow('sph', 0xff8a3d, [0.13, 2.6, 0.38], 0.1, [0, 0, 0], 3);
    b.glow('sph', 0xff8a3d, [-0.13, 2.6, 0.38], 0.1, [0, 0, 0], 3);
    b.add('dodeca', S, [0.95, 1.45, 0.1], [0.55, 1.2, 0.55]);
    b.add('dodeca', S, [-0.95, 1.45, 0.1], [0.55, 1.2, 0.55]);
    b.add('dodeca', 0x6b6157, [1.0, 0.75, 0.15], 0.55);
    b.add('dodeca', 0x6b6157, [-1.0, 0.75, 0.15], 0.55);
    return { height: 3.3, ring: 1.1 };
  },
  lich(b) {
    b.add(taper(0.35, 0.95), 0x2e1065, [0, 1.3, 0], [1, 2.2, 1]);
    b.glow(taper(0.95, 0.97), 0x7c3aed, [0, 0.24, 0], [1, 0.08, 1], [0, 0, 0], 2);
    b.add('cone', 0x1e1b4b, [0.55, 2.45, 0], [0.3, 0.7, 0.3], [0, 0, -0.6]);
    b.add('cone', 0x1e1b4b, [-0.55, 2.45, 0], [0.3, 0.7, 0.3], [0, 0, 0.6]);
    b.add('sph', 0x1e1b4b, [0, 2.5, -0.05], [1.2, 0.5, 0.8]);
    b.add('sph', 0xe7e5e4, [0, 2.95, 0.02], 0.7);
    b.glow('sph', 0x4ade80, [0.13, 3.0, 0.3], 0.12, [0, 0, 0], 3.5);
    b.glow('sph', 0x4ade80, [-0.13, 3.0, 0.3], 0.12, [0, 0, 0], 3.5);
    b.add(taper(0.38, 0.36), 0xfbbf24, [0, 3.3, 0], [1, 0.2, 1]);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * PI * 2; b.add('cone', 0xfbbf24, [Math.sin(a) * 0.32, 3.55, Math.cos(a) * 0.32], [0.12, 0.35, 0.12]); }
    b.add('cyl', 0x3f3f46, [0.8, 1.9, 0.25], [0.1, 3.2, 0.1]);
    b.glow('sph', 0x4ade80, [0.8, 3.65, 0.25], 0.6, [0, 0, 0], 2.8);
    b.glow('torus', 0x4ade80, [0, 0.05, 0], [2.6, 2.6, 0.5], [PI / 2, 0, 0], 2);
    return { height: 4.3, ring: 1.2, scale: 1.45, float: 0.3 };
  },
};

export function makeEnemy(type) {
  const b = new Builder();
  const ex = {};
  const info = ENEMY_BUILDERS[type](b, ex);
  const group = new THREE.Group();
  const body = b.build();
  group.add(body);
  let wings = null;
  if (ex.wings) {
    wings = [-1, 1].map((side) => {
      const wb = new Builder();
      wingShape(wb, side, ex.wings.span, 0.8, ex.wings.color);
      const w = wb.build();
      const p = new THREE.Group();
      p.position.x = side * 0.18;
      p.add(w);
      group.add(p);
      return p;
    });
  }
  if (info.scale) group.scale.setScalar(info.scale);
  return { group, body, wings, ...info };
}

// ---------------------------------------------------------------- decorations
const DECOS = {
  tomb(b) {
    b.add('box', 0x8b8fa3, [0, 0.55, 0], [0.8, 1.1, 0.25]);
    b.add('cyl', 0x8b8fa3, [0, 1.1, 0], [0.8, 0.25, 0.8], [PI / 2, 0, 0]);
    b.add('box', 0x5d6172, [0, 0.08, 0.35], [1.0, 0.16, 0.9]);
  },
  cross(b) {
    b.add('box', 0x6f7385, [0, 0.8, 0], [0.18, 1.6, 0.18]);
    b.add('box', 0x6f7385, [0, 1.15, 0], [0.8, 0.18, 0.18]);
    b.add('box', 0x4b4f5e, [0, 0.08, 0], [0.6, 0.16, 0.6]);
  },
  deadtree(b) {
    const W = 0x3a2c25;
    b.add(taper(0.12, 0.28, 6), W, [0, 1.2, 0], [1, 2.4, 1]);
    b.add(taper(0.04, 0.1, 5), W, [0.4, 2.1, 0], [1, 1.1, 1], [0, 0, -0.9]);
    b.add(taper(0.04, 0.1, 5), W, [-0.35, 1.7, 0.1], [1, 0.9, 1], [0.2, 0, 1.0]);
    b.add(taper(0.03, 0.08, 5), W, [0.05, 2.6, 0.3], [1, 0.8, 1], [0.7, 0, 0]);
  },
  pumpkin(b) {
    b.add('sph', 0xea580c, [0, 0.35, 0], [0.9, 0.65, 0.9]);
    b.add('cyl', 0x3f6212, [0, 0.72, 0], [0.08, 0.2, 0.08]);
    b.glow('box', 0xffb020, [0.15, 0.42, 0.42], [0.12, 0.1, 0.05], [0, 0, 0], 2.4);
    b.glow('box', 0xffb020, [-0.15, 0.42, 0.42], [0.12, 0.1, 0.05], [0, 0, 0], 2.4);
    b.glow('box', 0xffb020, [0, 0.25, 0.43], [0.32, 0.06, 0.05], [0, 0, 0], 2.4);
  },
  tree(b) {
    b.add(taper(0.2, 0.3, 7), 0x6b4423, [0, 0.8, 0], [1, 1.6, 1]);
    b.add('ico', 0x2f7d32, [0, 2.0, 0], [1.7, 1.4, 1.7]);
    b.add('ico', 0x3c9a40, [0.2, 2.7, 0.1], [1.2, 1.1, 1.2]);
    b.add('ico', 0x4caf50, [-0.1, 3.25, -0.05], [0.8, 0.8, 0.8]);
  },
  mushroom(b) {
    b.add(taper(0.12, 0.16, 7), 0xf5f0e6, [0, 0.4, 0], [1, 0.8, 1]);
    b.glow('sph', 0xe879f9, [0, 0.85, 0], [1.0, 0.5, 1.0], [0, 0, 0], 1.6);
    b.add(taper(0.08, 0.1, 6), 0xf5f0e6, [0.45, 0.22, 0.2], [1, 0.45, 1]);
    b.glow('sph', 0x67e8f9, [0.45, 0.48, 0.2], [0.5, 0.26, 0.5], [0, 0, 0], 1.6);
  },
  rock(b) {
    b.add('dodeca', 0x6b7280, [0, 0.35, 0], [1.1, 0.7, 0.9]);
    b.add('dodeca', 0x7c8592, [0.45, 0.2, 0.3], 0.5);
  },
  pine(b) {
    b.add(taper(0.14, 0.2, 6), 0x5b3a1e, [0, 0.5, 0], [1, 1, 1]);
    [[1.6, 1.1, 1.6], [1.25, 1.0, 2.3], [0.85, 0.9, 2.95]].forEach(([w, h, y]) => {
      b.add('cone', 0x1f5f3f, [0, y, 0], [w, h, w]);
      b.add('cone', 0xf8fafc, [0, y + h * 0.28, 0], [w * 0.55, h * 0.45, w * 0.55]);
    });
  },
  icecrystal(b) {
    b.glow('octa', 0x7dd3fc, [0, 0.9, 0], [0.5, 1.8, 0.5], [0, 0, 0.1], 1.5);
    b.glow('octa', 0xa5f3fc, [0.35, 0.55, 0.15], [0.3, 1.1, 0.3], [0.3, 0, -0.4], 1.5);
    b.glow('octa', 0xbae6fd, [-0.3, 0.45, -0.1], [0.28, 0.9, 0.28], [-0.2, 0, 0.5], 1.5);
  },
  snowrock(b) {
    b.add('dodeca', 0x94a3b8, [0, 0.35, 0], [1.2, 0.7, 1.0]);
    b.add('dodeca', 0xf1f5f9, [0, 0.62, 0], [0.9, 0.3, 0.75]);
  },
  lavarock(b) {
    b.add('dodeca', 0x292524, [0, 0.4, 0], [1.2, 0.8, 1.0]);
    b.glow('box', 0xff5a1a, [0, 0.42, 0.42], [0.7, 0.06, 0.1], [0, 0, 0.3], 2);
    b.add('dodeca', 0x1c1917, [0.5, 0.25, 0.3], 0.5);
  },
  spike(b) {
    b.add('cone', 0x1c1917, [0, 1.0, 0], [0.55, 2.0, 0.55], [0.05, 0, 0.05]);
    b.add('cone', 0x292524, [0.35, 0.55, 0.2], [0.35, 1.1, 0.35], [0, 0, -0.25]);
    b.glow('cone', 0xff7a1a, [0, 0.2, 0], [0.7, 0.15, 0.7], [0, 0, 0], 1.4);
  },
  lavapool(b) {
    b.add('cyl', 0x1c1917, [0, 0.05, 0], [1.8, 0.1, 1.6]);
    b.glow('cyl', 0xff6a1a, [0, 0.09, 0], [1.5, 0.06, 1.3], [0, 0, 0], 1.8);
  },
};
export function makeDeco(kind) {
  const b = new Builder();
  DECOS[kind](b);
  return b.build();
}

export function makePortal() {
  const g = new THREE.Group();
  const b = new Builder();
  b.glow('torus', 0xa855f7, [0, 1.7, 0], [2.4, 2.9, 1.6], [0, 0, 0], 2.4);
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * PI;
    b.add('dodeca', 0x3b3346, [Math.cos(a) * 1.35, 1.7 + Math.sin(a) * 1.6, 0], 0.5);
  }
  b.add('dodeca', 0x3b3346, [1.4, 0.4, 0], 0.7).add('dodeca', 0x3b3346, [-1.4, 0.4, 0], 0.7);
  g.add(b.build());
  const swirl = new Builder()
    .ghost('cyl', 0x581c87, [0, 0, 0], [2.3, 0.04, 2.8], [PI / 2, 0, 0])
    .glow('torus', 0xd8b4fe, [0, 0, 0], [1.2, 1.4, 0.4], [0, 0, 0], 2)
    .glow('torus', 0xc084fc, [0, 0, 0], [0.6, 0.7, 0.4], [0, 0, 0], 2.4).build(false);
  swirl.position.y = 1.7;
  g.add(swirl);
  return { group: g, update: (t) => { swirl.rotation.z = t * 2; } };
}

export function makeSanctum() {
  const g = new THREE.Group();
  const b = new Builder();
  b.add(taper(1.0, 1.15, 8), 0x9ca3af, [0, 0.2, 0], [1, 0.4, 1]);
  b.add(taper(0.8, 0.95, 8), 0xd1d5db, [0, 0.5, 0], [1, 0.25, 1]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI * 2 + PI / 4;
    b.add('cyl', 0xe5e7eb, [Math.cos(a) * 0.85, 1.3, Math.sin(a) * 0.85], [0.18, 1.8, 0.18]);
    b.glow('sph', 0x7dd3fc, [Math.cos(a) * 0.85, 2.3, Math.sin(a) * 0.85], 0.22);
  }
  g.add(b.build());
  const crystalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x67e8f9).multiplyScalar(1.5), toneMapped: false });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalMat);
  crystal.scale.set(1, 1.7, 1);
  crystal.position.y = 2.1;
  g.add(crystal);
  const ring = new Builder().glow('torus', 0xa5f3fc, [0, 0, 0], 1.7, [PI / 2, 0, 0], 1.4).build(false);
  ring.position.y = 2.1;
  g.add(ring);
  const healthy = new THREE.Color(0x67e8f9), hurt = new THREE.Color(0xff3b3b);
  let flash = 0;
  return {
    group: g,
    hit() { flash = 1; },
    update(t, dt, hpFrac) {
      flash = Math.max(0, flash - dt * 2.5);
      crystal.rotation.y = t;
      crystal.position.y = 2.1 + Math.sin(t * 1.6) * 0.15;
      ring.rotation.x = PI / 2 + Math.sin(t) * 0.3;
      ring.rotation.y = t * 0.7;
      crystalMat.color.copy(healthy).lerp(hurt, Math.max(1 - hpFrac, flash)).multiplyScalar(1.5);
    },
  };
}
