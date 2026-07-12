/* ============================================================================
 * EMBERFELL -- integration/buildings.js  (Integrator feature module)
 * build-07: EF.engine.collision registry + village expansion + enterable
 *           interiors (roof-reveal).
 * build-08: SPREAD-OUT settlement (req 7-12). All structures -- the 3 huts
 *           (relocated + rebuilt here, since world.js's solid huts were
 *           removed), tavern, blacksmith, market -- are ENTERABLE. Buildings
 *           sit on a ~38-unit ring inside a 60-unit clearing with >=15 units
 *           between the main buildings and a clear radial approach from the
 *           village centre to each. Scale hierarchy (req 12):
 *           stalls < huts < blacksmith (2x hut) < tavern (3.2x hut) < tower.
 *
 * Self-contained: installs EF.engine.collision, builds all geometry, injects
 * the new NPCs + dialogue, and does per-tick collision/animation/roof-reveal.
 * Loads LAST so its tick runs after player.js/npcs.js have moved.
 *
 * Contract: THREE r128 core only; ASCII quotes; console.log/warn/error only;
 * no <style>; no private rAF; per-frame work is number math + reused scratch.
 * Static geometry merges into ONE Lambert mesh + ONE MeshBasic glow mesh;
 * roofs (toggleable) + coal glows + NPCs are the only other draw calls.
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (typeof THREE === 'undefined') { console.error('[EF.buildings] THREE r128 must load first'); return; }
  if (!EF.engine || !EF.bus) { console.error('[EF.buildings] engine.js must load first'); return; }
  var bus = EF.bus;

  /* =====================================================================
   * 1. COLLISION REGISTRY  (EF.engine.collision)
   * ===================================================================== */
  var colliders = [];
  var _cid = 0;
  var collision = {
    colliders: colliders,
    register: function (spec) { spec.id = spec.id || ('c' + (_cid++)); colliders.push(spec); return spec; },
    box: function (minX, maxX, minZ, maxZ, tag) { return collision.register({ type: 'box', minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, tag: tag }); },
    circle: function (x, z, r, tag) { return collision.register({ type: 'circle', x: x, z: z, r: r, tag: tag }); },
    clear: function () { colliders.length = 0; },
    resolve: function (x, z, r, out) {
      out = out || { x: 0, z: 0 };
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < colliders.length; i++) {
          var c = colliders[i];
          if (c.type === 'circle') {
            var dx = x - c.x, dz = z - c.z, d = Math.sqrt(dx * dx + dz * dz), rr = r + c.r;
            if (d < rr) { if (d > 1e-4) { x = c.x + dx / d * rr; z = c.z + dz / d * rr; } else { x = c.x + rr; } }
          } else {
            var qx = x < c.minX ? c.minX : (x > c.maxX ? c.maxX : x);
            var qz = z < c.minZ ? c.minZ : (z > c.maxZ ? c.maxZ : z);
            var bx = x - qx, bz = z - qz, b2 = bx * bx + bz * bz;
            if (b2 < r * r) {
              if (b2 > 1e-6) { var bd = Math.sqrt(b2); x = qx + bx / bd * r; z = qz + bz / bd * r; }
              else {
                var pxm = x - c.minX, pxM = c.maxX - x, pzm = z - c.minZ, pzM = c.maxZ - z;
                var m = Math.min(pxm, pxM, pzm, pzM);
                if (m === pxm) x = c.minX - r; else if (m === pxM) x = c.maxX + r;
                else if (m === pzm) z = c.minZ - r; else z = c.maxZ + r;
              }
            }
          }
        }
      }
      out.x = x; out.z = z; return out;
    }
  };
  EF.engine.collision = collision;

  /* =====================================================================
   * 2. MERGE HELPERS
   * ===================================================================== */
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  var _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m3 = new THREE.Matrix3();
  var UNIT = new THREE.BoxGeometry(1, 1, 1);
  var UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 4);

  function mat(px, py, pz, sx, sy, sz, ry) {
    _q.setFromEuler(_e.set(0, ry || 0, 0));
    return new THREE.Matrix4().compose(_v1.set(px, py, pz), _q, _v2.set(sx, sy, sz));
  }
  function begin() { return { pos: [], nor: [], col: [] }; }
  function push(acc, geom, colorHex, matrix) {
    var g = geom.index ? geom.toNonIndexed() : geom;
    var p = g.attributes.position, n = g.attributes.normal;
    _m3.getNormalMatrix(matrix);
    var col = new THREE.Color(colorHex);
    for (var i = 0; i < p.count; i++) {
      _v3.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(matrix);
      acc.pos.push(_v3.x, _v3.y, _v3.z);
      _v3.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(_m3).normalize();
      acc.nor.push(_v3.x, _v3.y, _v3.z);
      acc.col.push(col.r, col.g, col.b);
    }
    if (g !== geom) g.dispose();
  }
  function endMat(acc, name, material) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
    var mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    return mesh;
  }
  function endLambert(acc, name) { return endMat(acc, name, new THREE.MeshLambertMaterial({ vertexColors: true })); }
  function endGlow(acc, name) { return endMat(acc, name, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })); }
  function box(acc, col, cx, cy, cz, sx, sy, sz, ry) { push(acc, UNIT, col, mat(cx, cy, cz, sx, sy, sz, ry)); }
  function cone(acc, col, cx, cy, cz, r, h, ry) { push(acc, UNIT_CONE, col, mat(cx, cy, cz, r * 2, h, r * 2, ry || 0)); }

  var COL = {
    hutFloor: 0x4a3a2a, hutWall: 0xb0a074, hutBeam: 0x5a4028, hutRoof: 0x6e4a30,
    tavFloor: 0x4a3524, tavWall: 0x8a6a44, tavBeam: 0x40301e, tavRoof: 0x5e3826, tavStone: 0x6a6a72,
    bsFloor: 0x3a3630, bsWall: 0x5f5f68, bsStone: 0x6f6f78, bsRoof: 0x39404a, bsTimber: 0x4a3120,
    wood: 0x6b4a33, woodDk: 0x4a3120, iron: 0x40434a, cloth: 0x8a4438,
    board: 0x7a5a38, paper: 0xe8e0c4, bed: 0x7a5a6a, foundation: 0x3a342c,
    windowGlow: 0xffcf7a, coalHot: 0xff8a3a, coalTav: 0xff9a44
  };

  var groundAt = function (x, z) {
    if (EF.world && typeof EF.world.terrainH === 'function') return EF.world.terrainH(x, z);
    return EF.engine.groundAt ? EF.engine.groundAt(x, z) : 0;
  };

  /* -------------------------------------------------------------------------
   * GROUND PADS (req 7,10,11): buildings spread onto gently rolling ground.
   * The analytic terrain rises toward the clearing rim, so a big flat floor
   * would have ground poke through it. Each building flattens the WALKABLE
   * ground under its footprint to the footprint's high point, and a foundation
   * skirt fills the downhill gap (reads as a stone plinth on a hillside). We
   * wrap EF.world.terrainH -- the sampler every gameplay system reads for
   * gravity -- so the player/NPCs stand level with the floor inside; the door
   * faces the (flat) village centre so the threshold step is negligible.
   * ------------------------------------------------------------------------- */
  var baseGround = (EF.world && typeof EF.world.terrainH === 'function') ? EF.world.terrainH : groundAt;
  var pads = [];
  var ramps = []; // door approaches: smooth walk-up from terrain to the raised floor
  function padAt(x, z) {
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return p.y;
    }
    for (i = 0; i < ramps.length; i++) {
      var r = ramps[i];
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        var along = (r.axis === 'z') ? Math.abs(z - r.edge) : Math.abs(x - r.edge);
        var f = along / r.depth; if (f < 0) f = 0; else if (f > 1) f = 1;
        return r.padY * (1 - f) + baseGround(x, z) * f; // floor at the door, terrain at the outer edge
      }
    }
    return null;
  }
  if (EF.world && typeof EF.world.terrainH === 'function') {
    EF.world.terrainH = function (x, z) { var p = padAt(x, z); return p != null ? p : baseGround(x, z); };
  }
  function padFor(cx, cz, w, d) {
    var mx = -Infinity, mn = Infinity;
    for (var ix = -1; ix <= 1; ix++) for (var iz = -1; iz <= 1; iz++) {
      var h = baseGround(cx + ix * w / 2, cz + iz * d / 2);
      if (h > mx) mx = h; if (h < mn) mn = h;
    }
    var pad = { minX: cx - w / 2 - 0.3, maxX: cx + w / 2 + 0.3, minZ: cz - d / 2 - 0.3, maxZ: cz + d / 2 + 0.3, y: mx, minY: mn };
    pads.push(pad); return pad;
  }

  /* =====================================================================
   * 3. BUILDING PRIMITIVES
   * ===================================================================== */
  var WALL_T = 0.3;
  var COLL_HALF = 0.42; // collider thicker than the wall so no step tunnels through
  var enterables = [];  // { name, cx, cz, w, d, roofs:[mesh], light, baseInt, inside }
  var _sa, _ga;         // active static + glow accumulators during build

  function wallRun(col, axis, fixed, y, H, a0, a1, doorC, doorW) {
    var segs = [];
    if (doorC == null) segs.push([a0, a1]);
    else { segs.push([a0, doorC - doorW / 2]); segs.push([doorC + doorW / 2, a1]); }
    for (var s = 0; s < segs.length; s++) {
      var s0 = segs[s][0], s1 = segs[s][1];
      if (s1 - s0 < 0.02) continue;
      var mid = (s0 + s1) / 2, len = s1 - s0;
      if (axis === 'x') {
        box(_sa, col, mid, y + H / 2, fixed, len, H, WALL_T, 0);
        collision.box(s0, s1, fixed - COLL_HALF, fixed + COLL_HALF, 'wall');
      } else {
        box(_sa, col, fixed, y + H / 2, mid, WALL_T, H, len, 0);
        collision.box(fixed - COLL_HALF, fixed + COLL_HALF, s0, s1, 'wall');
      }
    }
  }
  function band(col, cx, cz, w, d, y, t) {
    box(_sa, col, cx, y, cz - d / 2, w + 0.1, t, 0.12, 0);
    box(_sa, col, cx, y, cz + d / 2, w + 0.1, t, 0.12, 0);
    box(_sa, col, cx - w / 2, y, cz, 0.12, t, d + 0.1, 0);
    box(_sa, col, cx + w / 2, y, cz, 0.12, t, d + 0.1, 0);
  }
  function corners(col, cx, cz, w, d, y, H, s) {
    var xs = [cx - w / 2, cx + w / 2], zs = [cz - d / 2, cz + d / 2];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) box(_sa, col, xs[i], y + H / 2, zs[j], s, H, s, 0);
  }
  function foundation(cx, cz, w, d, padY, minY) {
    // stone plinth from the floor down past the lowest ground under the footprint
    var top = padY + 0.08, bot = minY - 0.5, h = top - bot;
    box(_sa, COL.foundation, cx, (top + bot) / 2, cz, w + 0.4, h, d + 0.4, 0);
  }
  function windowPane(cx, cz, w, d, side, along, yc, gw, gh) {
    var t = WALL_T / 2 + 0.03;
    if (side === 'N') box(_ga, COL.windowGlow, cx + along, yc, cz + d / 2 + t, gw, gh, 0.04, 0);
    else if (side === 'S') box(_ga, COL.windowGlow, cx + along, yc, cz - d / 2 - t, gw, gh, 0.04, 0);
    else if (side === 'E') box(_ga, COL.windowGlow, cx + w / 2 + t, yc, cz + along, 0.04, gh, gw, 0);
    else box(_ga, COL.windowGlow, cx - w / 2 - t, yc, cz + along, 0.04, gh, gw, 0);
  }
  function pyramidRoof(col, cx, cz, w, d, baseY, roofH, name) {
    var acc = begin();
    cone(acc, col, cx, baseY + roofH / 2, cz, Math.max(w, d) * 0.72 + 0.6, roofH, Math.PI / 4);
    return endLambert(acc, name);
  }
  function gableRoof(col, cx, cz, w, d, baseY, roofH, name) {
    var acc = begin();
    cone(acc, col, cx, baseY + roofH / 2, cz, Math.max(w, d) * 0.68 + 0.9, roofH, Math.PI / 4);
    return endLambert(acc, name);
  }
  // smooth ramp + visual steps from the ground up to a raised floor at the door
  function doorRamp(b, padY) {
    var cx = b.cx, cz = b.cz, w = b.w, d = b.d, dw = (b.doorW || 2.0) + 0.4, side = b.door || b.open;
    var depth = 2.0, z;
    if (side === 'S') z = { minX: cx - dw / 2, maxX: cx + dw / 2, minZ: cz - d / 2 - depth, maxZ: cz - d / 2 + 0.05, axis: 'z', edge: cz - d / 2, dir: -1 };
    else if (side === 'N') z = { minX: cx - dw / 2, maxX: cx + dw / 2, minZ: cz + d / 2 - 0.05, maxZ: cz + d / 2 + depth, axis: 'z', edge: cz + d / 2, dir: 1 };
    else if (side === 'E') z = { minX: cx + w / 2 - 0.05, maxX: cx + w / 2 + depth, minZ: cz - dw / 2, maxZ: cz + dw / 2, axis: 'x', edge: cx + w / 2, dir: 1 };
    else z = { minX: cx - w / 2 - depth, maxX: cx - w / 2 + 0.05, minZ: cz - dw / 2, maxZ: cz + dw / 2, axis: 'x', edge: cx - w / 2, dir: -1 };
    z.depth = depth; z.padY = padY; ramps.push(z);
    // three visual step slabs descending from the door out to the ground
    var outer = (z.axis === 'z') ? cz + z.dir * (d / 2 + depth) : cx + z.dir * (w / 2 + depth);
    var gOuter = baseGround((z.axis === 'x') ? outer : cx, (z.axis === 'z') ? outer : cz);
    for (var s = 0; s < 3; s++) {
      var f = (s + 0.5) / 3;
      var yy = padY * (1 - f) + gOuter * f;
      var off = (d / 2 + depth * f) , offw = (w / 2 + depth * f);
      if (z.axis === 'z') box(_sa, COL.foundation, cx, yy - 0.15, cz + z.dir * off, dw + 0.3, 0.5, depth / 3 + 0.1, 0);
      else box(_sa, COL.foundation, cx + z.dir * offw, yy - 0.15, cz, depth / 3 + 0.1, 0.5, dw + 0.3, 0);
    }
  }

  function pushRoof(mesh) {
    if (EF.engine.scene) EF.engine.scene.add(mesh);
    if (EF.world && EF.world.occluders) EF.world.occluders.push(mesh);
    return mesh;
  }
  function register(b, roofs) {
    enterables.push({ name: b.label, cx: b.cx, cz: b.cz, w: b.w, d: b.d, roofs: roofs, light: b._light || null, baseInt: b._baseInt || 0, inside: false });
  }

  /* =====================================================================
   * 4. ENCLOSED ENTERABLE BUILDING (huts, tavern)
   * ===================================================================== */
  function enclosed(b) {
    var w = b.w, d = b.d, H = b.wallH, cx = b.cx, cz = b.cz;
    var pad = padFor(cx, cz, w, d); var y = pad.y; b._y = y;
    var xW = cx - w / 2, xE = cx + w / 2, zS = cz - d / 2, zN = cz + d / 2;
    foundation(cx, cz, w, d, pad.y, pad.minY);
    box(_sa, b.floorCol, cx, y + 0.06, cz, w, 0.12, d, 0);
    wallRun(b.wallCol, 'x', zN, y, H, xW, xE, b.door === 'N' ? cx : null, b.doorW);
    wallRun(b.wallCol, 'x', zS, y, H, xW, xE, b.door === 'S' ? cx : null, b.doorW);
    wallRun(b.wallCol, 'z', xE, y, H, zS, zN, b.door === 'E' ? cz : null, b.doorW);
    wallRun(b.wallCol, 'z', xW, y, H, zS, zN, b.door === 'W' ? cz : null, b.doorW);
    corners(b.beamCol, cx, cz, w, d, y, H, 0.34);

    var roofs = [];
    if (b.twoStory) {
      band(b.beamCol, cx, cz, w, d, y + H * 0.52, 0.22);
      var rows = [y + 1.5, y + H * 0.52 + 1.3];
      var sides = ['N', 'S', 'E', 'W'];
      for (var r = 0; r < rows.length; r++) {
        for (var si = 0; si < sides.length; si++) {
          var side = sides[si]; if (side === b.door && r === 0) continue;
          var span = (side === 'N' || side === 'S') ? w : d;
          for (var o = -1; o <= 1; o += 2) windowPane(cx, cz, w, d, side, o * span * 0.24, rows[r], 0.9, 1.0);
        }
      }
      roofs.push(pushRoof(gableRoof(b.roofCol, cx, cz, w, d, y + H, b.roofH, 'ef-roof-' + b.id)));
      if (b.porch) buildPorch(b, y);
    } else {
      var hs = ['N', 'S', 'E', 'W'];
      for (var i = 0; i < hs.length; i++) if (hs[i] !== b.door) windowPane(cx, cz, w, d, hs[i], 0, y + 1.3, 0.8, 0.8);
      roofs.push(pushRoof(pyramidRoof(b.roofCol, cx, cz, w, d, y + H, b.roofH, 'ef-roof-' + b.id)));
    }
    if (b.interior) b.interior(b, y);
    doorRamp(b, y);
    register(b, roofs);
  }

  function buildPorch(b, y) {
    var cx = b.cx, cz = b.cz, w = b.w, d = b.d;
    var out = 2.4;
    var fz = (b.door === 'S') ? cz - d / 2 : cz + d / 2;
    var sign = (b.door === 'S') ? -1 : 1;
    var pz = fz + sign * out;
    box(_sa, b.beamCol, cx - w * 0.36, y + 1.4, pz, 0.28, 2.8, 0.28, 0);
    box(_sa, b.beamCol, cx + w * 0.36, y + 1.4, pz, 0.28, 2.8, 0.28, 0);
    collision.circle(cx - w * 0.36, pz, 0.35, 'post');
    collision.circle(cx + w * 0.36, pz, 0.35, 'post');
    var acc = begin();
    box(acc, b.roofCol, cx, y + 2.9, (fz + pz) / 2, w + 0.6, 0.24, out + 0.4, 0);
    var mesh = endLambert(acc, 'ef-porch-' + b.id);
    if (EF.engine.scene) EF.engine.scene.add(mesh);
    if (EF.world && EF.world.occluders) EF.world.occluders.push(mesh);
  }

  /* =====================================================================
   * 5. OPEN-FRONT BUILDING (blacksmith)
   * ===================================================================== */
  function openFront(b) {
    var w = b.w, d = b.d, H = b.wallH, cx = b.cx, cz = b.cz;
    var pad = padFor(cx, cz, w, d); var y = pad.y; b._y = y;
    var xW = cx - w / 2, xE = cx + w / 2, zS = cz - d / 2, zN = cz + d / 2;
    foundation(cx, cz, w, d, pad.y, pad.minY);
    box(_sa, b.floorCol, cx, y + 0.06, cz, w, 0.12, d, 0);
    if (b.open !== 'N') wallRun(b.wallCol, 'x', zN, y, H, xW, xE, null);
    if (b.open !== 'S') wallRun(b.wallCol, 'x', zS, y, H, xW, xE, null);
    if (b.open !== 'E') wallRun(b.wallCol, 'z', xE, y, H, zS, zN, null);
    if (b.open !== 'W') wallRun(b.wallCol, 'z', xW, y, H, zS, zN, null);
    corners(b.beamCol, cx, cz, w, d, y, H, 0.4);
    var sign = (b.open === 'W') ? -1 : (b.open === 'E') ? 1 : 0;
    var signz = (b.open === 'S') ? -1 : (b.open === 'N') ? 1 : 0;
    var p1x = (sign !== 0) ? cx + sign * (w / 2 + 1.6) : cx - w * 0.4;
    var p1z = (signz !== 0) ? cz + signz * (d / 2 + 1.6) : cz - d * 0.4;
    var p2x = (sign !== 0) ? cx + sign * (w / 2 + 1.6) : cx + w * 0.4;
    var p2z = (signz !== 0) ? cz + signz * (d / 2 + 1.6) : cz + d * 0.4;
    box(_sa, b.beamCol, p1x, y + 1.6, p1z, 0.32, 3.2, 0.32, 0);
    box(_sa, b.beamCol, p2x, y + 1.6, p2z, 0.32, 3.2, 0.32, 0);
    collision.circle(p1x, p1z, 0.35, 'post');
    collision.circle(p2x, p2z, 0.35, 'post');
    if (b.interior) b.interior(b, y);
    doorRamp(b, y);
    var acc = begin();
    cone(acc, b.roofCol, cx + sign * 0.9, y + H + b.roofH / 2, cz + signz * 0.9, Math.max(w, d) * 0.74 + 1.4, b.roofH, Math.PI / 4);
    register(b, [pushRoof(endLambert(acc, 'ef-roof-' + b.id))]);
  }

  /* =====================================================================
   * 6. INTERIORS
   * ===================================================================== */
  var coals = [];
  function coalMesh(col, x, y, z, r) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: col, fog: false }));
    m.position.set(x, y, z);
    if (EF.engine.scene) EF.engine.scene.add(m);
    coals.push({ mesh: m, base: r, phase: Math.random() * 6.28 });
    return m;
  }
  function tavernInterior(b, y) {
    var cx = b.cx, cz = b.cz, w = b.w, d = b.d;
    var fz = cz + d / 2 - 0.5;
    box(_sa, COL.tavStone, cx - w / 4, y + 1.1, fz, 1.8, 2.2, 0.6, 0);
    box(_sa, COL.tavStone, cx - w / 4, y + 2.4, fz - 0.1, 2.2, 0.3, 0.8, 0);
    coalMesh(COL.coalTav, cx - w / 4, y + 0.45, fz - 0.15, 0.34);
    collision.box(cx - w / 4 - 0.9, cx - w / 4 + 0.9, fz - 0.4, fz + 0.4, 'hearth');
    var bx = cx + w / 4;
    box(_sa, COL.woodDk, bx, y + 0.6, fz - 0.2, w / 2 - 0.6, 1.2, 0.6, 0);
    collision.box(bx - (w / 2 - 0.6) / 2, bx + (w / 2 - 0.6) / 2, fz - 0.5, fz + 0.1, 'bar');
    var tsp = [[cx - w * 0.22, cz - d * 0.12], [cx + w * 0.16, cz - d * 0.2], [cx, cz + d * 0.02]];
    for (var t = 0; t < tsp.length; t++) {
      var tx = tsp[t][0], tz = tsp[t][1];
      box(_sa, COL.wood, tx, y + 0.72, tz, 1.3, 0.12, 0.9, 0);
      box(_sa, COL.woodDk, tx, y + 0.36, tz, 0.16, 0.72, 0.16, 0);
      collision.box(tx - 0.65, tx + 0.65, tz - 0.45, tz + 0.45, 'table');
      box(_sa, COL.woodDk, tx - 0.95, y + 0.28, tz, 0.34, 0.56, 0.34, 0);
      box(_sa, COL.woodDk, tx + 0.95, y + 0.28, tz, 0.34, 0.56, 0.34, 0);
    }
    var pl = new THREE.PointLight(0xffb060, 1.6, 16, 2); pl.position.set(cx, y + 3.0, cz);
    if (EF.engine.scene) EF.engine.scene.add(pl); b._light = pl; b._baseInt = 1.6;
  }
  function blacksmithInterior(b, y) {
    var cx = b.cx, cz = b.cz, w = b.w, d = b.d;
    var sign = (b.open === 'W') ? 1 : (b.open === 'E') ? -1 : 0;
    var signz = (b.open === 'S') ? 1 : (b.open === 'N') ? -1 : 0;
    var gx = cx + sign * (w / 2 - 1.0), gz = cz + signz * (d / 2 - 1.0);
    box(_sa, COL.bsStone, gx, y + 0.7, gz, 1.8, 1.4, 1.4, 0);
    box(_sa, COL.bsStone, gx, y + b.wallH - 0.4, gz, 1.1, 1.0, 1.0, 0);
    coalMesh(COL.coalHot, gx, y + 1.5, gz, 0.32);
    collision.box(gx - 0.9, gx + 0.9, gz - 0.7, gz + 0.7, 'forge');
    box(_sa, COL.woodDk, cx, y + 0.3, cz, 0.6, 0.6, 0.6, 0);
    box(_sa, COL.iron, cx, y + 0.78, cz, 0.7, 0.28, 0.34, 0);
    box(_sa, COL.iron, cx + 0.42, y + 0.82, cz, 0.34, 0.2, 0.3, 0);
    collision.box(cx - 0.45, cx + 0.55, cz - 0.25, cz + 0.25, 'anvil');
    var rackx = cx - w / 2 + 0.4;
    box(_sa, COL.wood, rackx, y + 1.1, cz, 0.18, 1.8, 1.6, 0);
    box(_sa, 0xb8c2cc, rackx + 0.2, y + 1.3, cz - 0.5, 0.05, 1.1, 0.12, 0);
    box(_sa, 0xb8c2cc, rackx + 0.2, y + 1.3, cz + 0.5, 0.05, 1.3, 0.1, 0);
    var pl = new THREE.PointLight(0xff7a2a, 1.6, 12, 2); pl.position.set(gx, y + 1.6, gz);
    if (EF.engine.scene) EF.engine.scene.add(pl); b._light = pl; b._baseInt = 1.6;
  }
  function hutInterior(b, y) {
    var cx = b.cx, cz = b.cz, w = b.w, d = b.d;
    var bz = cz + d / 2 - 0.6;
    box(_sa, COL.woodDk, cx - w / 2 + 0.8, y + 0.28, bz, 1.0, 0.4, 1.8, 0);
    box(_sa, COL.bed, cx - w / 2 + 0.8, y + 0.52, bz, 0.9, 0.18, 1.7, 0);
    collision.box(cx - w / 2 + 0.3, cx - w / 2 + 1.3, bz - 0.9, bz + 0.9, 'bed');
    box(_sa, COL.wood, cx + w / 4, y + 0.6, cz - d / 4, 0.9, 0.1, 0.7, 0);
    box(_sa, COL.woodDk, cx + w / 4, y + 0.3, cz - d / 4, 0.14, 0.6, 0.14, 0);
    collision.box(cx + w / 4 - 0.45, cx + w / 4 + 0.45, cz - d / 4 - 0.35, cz - d / 4 + 0.35, 'table');
    box(_sa, COL.woodDk, cx + w / 4 + 0.7, y + 0.24, cz - d / 4, 0.3, 0.48, 0.3, 0);
    box(_sa, COL.tavStone, cx + w / 2 - 0.5, y + 0.5, cz + d / 2 - 0.5, 0.8, 1.0, 0.8, 0);
    coalMesh(COL.coalTav, cx + w / 2 - 0.5, y + 0.5, cz + d / 2 - 0.5, 0.16);
  }

  /* =====================================================================
   * 7. OPEN PROPS: market stalls + notice board
   * ===================================================================== */
  function buildStall(sx, sz, canvasCol) {
    var y = groundAt(sx, sz);
    var px = 0.9, pz = 0.55;
    var posts = [[sx - px, sz - pz], [sx + px, sz - pz], [sx - px, sz + pz], [sx + px, sz + pz]];
    for (var i = 0; i < posts.length; i++) box(_sa, COL.woodDk, posts[i][0], y + 1.0, posts[i][1], 0.12, 2.0, 0.12, 0);
    box(_sa, COL.wood, sx, y + 0.7, sz + pz, px * 2 + 0.2, 0.6, 0.4, 0);
    collision.box(sx - px - 0.1, sx + px + 0.1, sz + pz - 0.25, sz + pz + 0.25, 'stall');
    box(_sa, 0x8a5a2a, sx - 0.5, y + 1.05, sz + pz, 0.4, 0.25, 0.3, 0);
    box(_sa, 0x6a8a3a, sx + 0.4, y + 1.05, sz + pz, 0.4, 0.22, 0.3, 0);
    box(_sa, canvasCol, sx, y + 2.05, sz - 0.1, px * 2 + 0.6, 0.08, pz * 2 + 0.8, 0);
  }
  function buildNotice(nx, nz) {
    var y = groundAt(nx, nz);
    box(_sa, COL.woodDk, nx - 0.7, y + 0.8, nz, 0.16, 1.6, 0.16, 0);
    box(_sa, COL.woodDk, nx + 0.7, y + 0.8, nz, 0.16, 1.6, 0.16, 0);
    box(_sa, COL.board, nx, y + 1.3, nz, 1.7, 1.1, 0.12, 0);
    box(_sa, COL.paper, nx - 0.35, y + 1.4, nz + 0.08, 0.4, 0.5, 0.02, 0);
    box(_sa, COL.paper, nx + 0.35, y + 1.25, nz + 0.08, 0.4, 0.55, 0.02, 0);
    collision.box(nx - 0.85, nx + 0.85, nz - 0.12, nz + 0.12, 'notice');
  }

  /* =====================================================================
   * 8. NPCs
   * ===================================================================== */
  var myNpcs = [];
  function buildNpcMesh(pal) {
    var acc = begin();
    box(acc, pal.cloth, 0, 1.16, 0, 0.5, 0.72, 0.28, 0);
    box(acc, pal.trim, 0, 0.86, 0, 0.54, 0.12, 0.32, 0);
    box(acc, pal.skin, 0, 1.62, 0, 0.32, 0.32, 0.30, 0);
    box(acc, pal.hair, 0, 1.78, 0, 0.36, 0.14, 0.34, 0);
    box(acc, pal.cloth, -0.33, 0.86, 0, 0.15, 0.6, 0.15, 0);
    box(acc, pal.cloth, 0.33, 0.86, 0, 0.15, 0.6, 0.15, 0);
    box(acc, pal.skin, -0.33, 0.52, 0, 0.16, 0.14, 0.16, 0);
    box(acc, pal.skin, 0.33, 0.52, 0, 0.16, 0.14, 0.16, 0);
    box(acc, pal.trim, -0.13, 0.3, 0, 0.17, 0.62, 0.17, 0);
    box(acc, pal.trim, 0.13, 0.3, 0, 0.17, 0.62, 0.17, 0);
    if (pal.apron) box(acc, pal.apron, 0, 1.02, 0.16, 0.46, 0.5, 0.06, 0);
    return endLambert(acc, 'ef-npc');
  }
  function placeMyNpc(id, name, x, z, faceYaw, pal, dialogue) {
    var y = groundAt(x, z);
    var mesh = buildNpcMesh(pal);
    var group = new THREE.Group();
    group.add(mesh); group.position.set(x, y, z); group.rotation.y = faceYaw;
    EF.engine.scene.add(group);
    myNpcs.push({ id: id, name: name, group: group, mesh: mesh, x: x, z: z, yaw: faceYaw, baseYaw: faceYaw, bob: Math.random() * 6.28 });
    if (EF.dialogue && EF.dialogue.npc) EF.dialogue.npc[id] = dialogue;
    if (EF.npcs && EF.npcs.list && EF.npcs.list.indexOf(id) < 0) EF.npcs.list.push(id);
  }
  function wrapNearest() {
    if (!EF.npcs || EF.npcs.__bldWrapped) return;
    var orig = EF.npcs.nearest;
    EF.npcs.nearest = function () {
      var best = orig ? orig.call(EF.npcs) : null;
      var bestD = best ? best.dist : Infinity;
      var pos = EF.player && EF.player.position;
      if (pos) for (var i = 0; i < myNpcs.length; i++) {
        var n = myNpcs[i], dx = pos.x - n.x, dz = pos.z - n.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d < bestD) { bestD = d; best = { id: n.id, dist: d }; }
      }
      return best;
    };
    EF.npcs.__bldWrapped = true;
  }
  function simpleDialogue(name, text, extra) {
    var nodes = { greet: { text: text, choices: [{ label: 'Farewell', action: 'close' }] } };
    if (extra) {
      nodes.greet.choices.unshift({ label: extra.label, action: 'goto', node: 'more' });
      nodes.more = { text: extra.text, choices: [{ label: 'Back', action: 'goto', node: 'greet' }, { label: 'Farewell', action: 'close' }] };
    }
    return { name: name, branches: [], fallback: 'greet', nodes: nodes };
  }

  /* =====================================================================
   * 9. LAYOUT + BUILD
   * ===================================================================== */
  function poi(id) { var a = (EF.world && EF.world.pois) || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function pushPoi(id, label, x, z, radius) {
    if (!EF.world || !EF.world.pois) return;
    for (var i = 0; i < EF.world.pois.length; i++) if (EF.world.pois[i].id === id) return;
    EF.world.pois.push({ id: id, label: label, x: x, z: z, y: groundAt(x, z), radius: radius });
  }
  function spacingMin(list) {
    var min = Infinity;
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var dd = Math.hypot(list[i].cx - list[j].cx, list[i].cz - list[j].cz);
      if (dd < min) min = dd;
    }
    return min === Infinity ? 0 : min;
  }

  /* =====================================================================
   * 9b. VILLAGE WALL / PATHS / LAMPS / SMOKE / CANYON / DETAILS  [build-09]
   * ===================================================================== */
  var WALL_R = 35, GATE_DEG = 90, GATE_HALF = 12; // gate faces +z (south, open world)
  var lamps = [];                 // { light, base, on }
  var smoke = null, smokeData = null;
  EF.village = { playerSafe: false, cx: 0, cz: 10, r: WALL_R };
  function angDiff(a, b) { return ((a - b) % 360 + 540) % 360 - 180; }
  // box oriented so its FIRST dimension (length) lies along the chord (dx,dz)
  function chordBox(acc, col, x0, z0, x1, z1, thick, yc, hgt) {
    var mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.05) return;
    box(acc, col, mx, yc, mz, L, hgt, thick, Math.atan2(-dz, dx));
  }

  function buildWall(cx, cz) {
    EF.village.cx = cx; EF.village.cz = cz; EF.village.r = WALL_R;
    var stone = 0x7c7d84, stoneDk = 0x585962;
    var segs = 48;
    for (var i = 0; i < segs; i++) {
      var a0 = i / segs * 360, a1 = (i + 1) / segs * 360, am = (a0 + a1) / 2;
      if (Math.abs(angDiff(am, GATE_DEG)) < GATE_HALF) continue; // gate gap
      var r0 = a0 * Math.PI / 180, r1 = a1 * Math.PI / 180, rm = am * Math.PI / 180;
      var x0 = cx + Math.cos(r0) * WALL_R, z0 = cz + Math.sin(r0) * WALL_R;
      var x1 = cx + Math.cos(r1) * WALL_R, z1 = cz + Math.sin(r1) * WALL_R;
      var mx = cx + Math.cos(rm) * WALL_R, mz = cz + Math.sin(rm) * WALL_R;
      var y = groundAt(mx, mz);
      chordBox(_sa, stone, x0, z0, x1, z1, 1.1, y + 1.25, 2.5);       // wall body
      chordBox(_sa, stoneDk, x0, z0, x1, z1, 1.2, y + 2.65, 0.5);     // battlement cap
      // two merlons per segment (crenellation)
      var mrx = cx + Math.cos((a0 + am) / 2 * Math.PI / 180) * WALL_R, mrz = cz + Math.sin((a0 + am) / 2 * Math.PI / 180) * WALL_R;
      var mrx2 = cx + Math.cos((am + a1) / 2 * Math.PI / 180) * WALL_R, mrz2 = cz + Math.sin((am + a1) / 2 * Math.PI / 180) * WALL_R;
      box(_sa, stone, mrx, y + 3.05, mrz, 0.7, 0.5, 0.7, rm);
      box(_sa, stone, mrx2, y + 3.05, mrz2, 0.7, 0.5, 0.7, rm);
      // beads at BOTH the segment midpoint and its start vertex: midpoints alone
      // leave a thin radial gap on the E/W extremes (no sample lands on z=cz),
      // so the start-vertex bead (one lands exactly at 0 deg and 180 deg) seals it.
      collision.circle(mx, mz, 1.9, 'wall');
      collision.circle(x0, z0, 1.9, 'wall'); // overlapping beads -> solid ring, gate open
    }
    // gate towers flanking the opening
    for (var g = -1; g <= 1; g += 2) {
      var ga = (GATE_DEG + g * (GATE_HALF + 2.5)) * Math.PI / 180;
      var tx = cx + Math.cos(ga) * WALL_R, tz = cz + Math.sin(ga) * WALL_R, ty = groundAt(tx, tz);
      box(_sa, stoneDk, tx, ty + 2.1, tz, 2.4, 4.2, 2.4, 0);
      box(_sa, stone, tx, ty + 4.4, tz, 2.8, 0.5, 2.8, 0);
      box(_sa, 0x3a3b42, tx, ty + 4.85, tz, 1.2, 0.6, 1.2, Math.PI / 4); // pinnacle
      collision.circle(tx, tz, 1.5, 'gate');
    }
  }

  /* dirt paths: dark-brown flat strips that hug the ground (#5C3D1E) */
  function pathLine(pts, width) {
    for (var i = 0; i < pts.length - 1; i++) {
      var ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      var L = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(L / 3));
      for (var s = 0; s < steps; s++) {
        var t0 = s / steps, t1 = (s + 1) / steps;
        var x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
        var x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        var my = groundAt((x0 + x1) / 2, (z0 + z1) / 2);
        chordBox(_sa, 0x5c3d1e, x0, z0, x1, z1, width, my + 0.05, 0.06);
      }
    }
  }
  function pathRing(cx, cz, r, width) {
    var n = 28, prev = null;
    for (var i = 0; i <= n; i++) {
      var a = i / n * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (prev) { var my = groundAt((prev[0] + x) / 2, (prev[1] + z) / 2); chordBox(_sa, 0x5c3d1e, prev[0], prev[1], x, z, width, my + 0.05, 0.06); }
      prev = [x, z];
    }
  }

  /* lamp post: shared merged geometry; only KEY posts carry a point light
   * (total village point lights capped at 6: 2 interiors + up to 4 lamps). */
  function lampPost(x, z, withLight) {
    var y = groundAt(x, z);
    box(_sa, 0x5a5b62, x, y + 0.2, z, 0.7, 0.4, 0.7, 0);      // stone base
    box(_sa, 0x4a4b52, x, y + 1.5, z, 0.24, 2.6, 0.24, 0);    // post
    box(_sa, 0x3a3b42, x, y + 2.9, z, 0.6, 0.5, 0.6, 0);      // lantern housing
    box(_ga, 0xffb45a, x, y + 2.9, z, 0.34, 0.4, 0.34, 0);    // glowing pane (emissive)
    box(_sa, 0x3a3b42, x, y + 3.25, z, 0.5, 0.24, 0.5, 0);    // cap
    collision.circle(x, z, 0.5, 'lamp');
    if (withLight && lamps.length < 4) {
      var pl = new THREE.PointLight(0xff9a44, 0.0, 8, 2);
      pl.position.set(x, y + 2.9, z);
      if (EF.engine.scene) EF.engine.scene.add(pl);
      lamps.push({ light: pl, base: 1.5, on: false });
    }
  }

  function buildSmoke(x, y, z) {
    var N = 26;
    var pos = new Float32Array(N * 3);
    smokeData = [];
    for (var i = 0; i < N; i++) {
      var d = { x: (Math.random() - 0.5) * 0.4, y: Math.random() * 4, z: (Math.random() - 0.5) * 0.4, sp: 0.5 + Math.random() * 0.7 };
      smokeData.push(d);
      pos[i * 3] = x + d.x; pos[i * 3 + 1] = y + d.y; pos[i * 3 + 2] = z + d.z;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9a8a7a, size: 0.6, transparent: true, opacity: 0.5, sizeAttenuation: true, fog: true, depthWrite: false }));
    smoke.name = 'ef-forge-smoke'; smoke._x = x; smoke._y = y; smoke._z = z; smoke._top = 4.5;
    if (EF.engine.scene) EF.engine.scene.add(smoke);
  }

  function canyonColliders() {
    var cy = EF.worldData && EF.worldData.terrain && EF.worldData.terrain.canyon;
    if (!cy) return;
    var half = (EF.worldData.terrain.size / 2) - 2;
    for (var x = -half; x < half; x += 20) {
      collision.box(x, x + 20, cy.z - 2.2, cy.z + 2.2, 'canyon'); // uncrossable barrier along the river
    }
  }

  /* ---- small detail props (all merged into _sa) ---- */
  function barrel(x, z) { var y = groundAt(x, z); box(_sa, 0x6b4a2b, x, y + 0.38, z, 0.62, 0.76, 0.62, 0); box(_sa, 0x4a3120, x, y + 0.44, z, 0.68, 0.12, 0.68, 0); box(_sa, 0x4a3120, x, y + 0.12, z, 0.68, 0.12, 0.68, 0); collision.circle(x, z, 0.45, 'prop'); }
  function crate(x, z, ry) { var y = groundAt(x, z); box(_sa, 0x8a6a44, x, y + 0.32, z, 0.7, 0.64, 0.7, ry || 0.3); box(_sa, 0x6b4a2b, x, y + 0.32, z, 0.74, 0.12, 0.12, ry || 0.3); collision.circle(x, z, 0.5, 'prop'); }
  function gardenPatch(x, z) {
    var y = groundAt(x, z);
    box(_sa, 0x4a3222, x, y + 0.04, z, 2.2, 0.08, 1.5, 0);   // tilled soil
    for (var r = -1; r <= 1; r++) for (var c = -1; c <= 1; c++) box(_sa, 0x5f8a3c, x + c * 0.6, y + 0.2, z + r * 0.4, 0.18, 0.3, 0.18, 0); // sprouts
  }
  function hangingSign(x, z, faceDir, boardCol) {
    var y = groundAt(x, z);
    box(_sa, 0x3a2a1a, x, y + 1.4, z, 0.2, 2.8, 0.2, 0);            // post
    box(_sa, 0x3a2a1a, x + faceDir * 0.7, y + 2.6, z, 1.6, 0.16, 0.16, 0); // arm
    box(_sa, boardCol, x + faceDir * 1.3, y + 2.1, z, 1.1, 0.8, 0.08, 0);  // hanging board
    box(_ga, 0xffcf7a, x + faceDir * 1.3, y + 2.1, z + 0.06, 0.7, 0.4, 0.02, 0); // painted emblem glow
    collision.circle(x, z, 0.4, 'prop');
  }

  bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    var scene = EF.engine.scene;
    _sa = begin(); _ga = begin();

    var v = poi('village') || { x: 0, z: 10 };
    var cx = v.x, cz = v.z;
    collision.circle(cx, cz, 2.1, 'firepit');
    collision.circle(cx + 4.6, cz - 4.2, 1.25, 'well');

    var R = 20; // building ring radius: centres on a ~40-unit ring, ~50-unit built spread (pads keep it flat)
    function ring(deg) { var a = deg * Math.PI / 180; return { x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R }; }
    function doorSide(bx, bz) {
      var dx = cx - bx, dz = cz - bz;
      if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? 'E' : 'W';
      return dz > 0 ? 'N' : 'S';
    }

    var mains = [];

    var tv = ring(90);
    var tavern = { id: 'tavern', label: 'The Emberfell Tavern', cx: tv.x, cz: tv.z, w: 9.0, d: 7.2, wallH: 5.6, roofH: 2.8,
      doorW: 2.2, twoStory: true, porch: true, floorCol: COL.tavFloor, wallCol: COL.tavWall, beamCol: COL.tavBeam, roofCol: COL.tavRoof, interior: tavernInterior };
    tavern.door = doorSide(tavern.cx, tavern.cz);
    enclosed(tavern); mains.push(tavern);
    // [build-09] tavern exterior character: hanging sign + barrels by the door (door faces -z)
    hangingSign(tavern.cx - 3.4, tavern.cz - tavern.d / 2 - 0.4, 1, 0x6a3a24);
    barrel(tavern.cx + 2.6, tavern.cz - tavern.d / 2 - 0.9);
    barrel(tavern.cx + 3.5, tavern.cz - tavern.d / 2 - 0.6);

    var bs = ring(18);
    var black = { id: 'blacksmith', label: 'The Forge', cx: bs.x, cz: bs.z, w: 6.6, d: 6.4, wallH: 3.4, roofH: 2.0,
      floorCol: COL.bsFloor, wallCol: COL.bsWall, beamCol: COL.bsStone, roofCol: COL.bsRoof, interior: blacksmithInterior };
    black.open = doorSide(black.cx, black.cz);
    openFront(black); mains.push(black);
    // [build-09] forge chimney smoke/ember particles
    buildSmoke(black.cx + 2.0, black._y + black.wallH + 1.4, black.cz);

    var hutAngles = [162, 234, 306];
    var hutRoofs = [0x6e4a30, 0x7d5232, 0x5a4638];   // [build-09] each cottage a different roof
    var hutWalls = [0xb0a074, 0xa89a6a, 0xb8ac82];
    for (var h = 0; h < hutAngles.length; h++) {
      var hp = ring(hutAngles[h]);
      var hut = { id: 'hut' + (h + 1), label: 'Cottage', cx: hp.x, cz: hp.z, w: 4.5, d: 4.5, wallH: 2.8, roofH: 1.7,
        doorW: 1.8, floorCol: COL.hutFloor, wallCol: hutWalls[h], beamCol: COL.hutBeam, roofCol: hutRoofs[h], interior: hutInterior };
      hut.door = doorSide(hut.cx, hut.cz);
      enclosed(hut); mains.push(hut);
      // [build-09] a different prop outside each cottage, on the away-from-centre side
      var ox = hut.cx - cx, oz = hut.cz - cz, ol = Math.hypot(ox, oz) || 1;
      var sx = hut.cx + ox / ol * (hut.w / 2 + 1.3), sz = hut.cz + oz / ol * (hut.d / 2 + 1.3);
      if (h === 0) barrel(sx, sz);
      else if (h === 1) gardenPatch(sx, sz);
      else crate(sx, sz, 0.4);
    }

    var stalls = [
      { x: cx - 2.7, z: cz - 6.8, canvas: 0xcaa85a, npc: { id: 'sella', name: 'Sella', text: 'Fresh roots and river fish, love. Best prices this side of the pines.' } },
      { x: cx, z: cz - 6.8, canvas: 0xa85a4a, npc: { id: 'tomas', name: 'Tomas', text: 'Leather, cord, and good boots. You will want the boots out in the moor.' } },
      { x: cx + 2.7, z: cz - 6.8, canvas: 0x5a7a9a, npc: { id: 'wend', name: 'Wend', text: 'Charms and oddments. Some of them even work. Mostly.' } }
    ];
    for (var s = 0; s < stalls.length; s++) {
      buildStall(stalls[s].x, stalls[s].z, stalls[s].canvas);
      placeMyNpc(stalls[s].npc.id, stalls[s].npc.name, stalls[s].x, stalls[s].z - 0.7, 0,
        { cloth: 0x4a5a3a, trim: 0x6a5a3a, skin: 0xd0a878, hair: 0x3a2a1a, apron: 0x8a7a5a }, simpleDialogue(stalls[s].npc.name, stalls[s].npc.text));
    }
    pushPoi('market', 'Market Row', cx, cz - 6.8, 4.0);

    buildNotice(cx + 5.2, cz - 1.0);
    pushPoi('notice', 'Notice Board', cx + 5.2, cz - 1.0, 1.4);

    placeMyNpc('bram', 'Bram', tavern.cx + tavern.w / 4, tavern.cz + tavern.d / 2 - 1.3, Math.PI,
      { cloth: 0x5a3a2a, trim: 0x7a5a3a, skin: 0xcea47a, hair: 0x2a1e14, apron: 0xb0a084 },
      simpleDialogue('Bram', 'Welcome to the Emberfell, stranger. Biggest roof in the village bar the old tower -- pull up a stool.',
        { label: 'Any news?', text: 'Wolves in the pines, bones on the tower road, and Maren fretting by the fire. Same as ever.' }));

    pushPoi('tavern', tavern.label, tavern.cx, tavern.cz, 4.6);
    pushPoi('blacksmith', black.label, black.cx, black.cz, 4.0);

    /* [build-09] perimeter wall + gate, dirt paths, lamp posts, canyon barrier */
    buildWall(cx, cz);
    pathLine([[cx, cz + WALL_R - 1], [cx, cz]], 3.6);        // gate -> plaza
    pathRing(cx, cz, R, 3.0);                                // ring connecting buildings
    for (var mi = 0; mi < mains.length; mi++) pathLine([[cx, cz], [mains[mi].cx, mains[mi].cz]], 3.3); // plaza -> each building
    var lampSpots = [
      [cx, cz + WALL_R - 4.5, true], [cx, cz + 12, true], [cx + 16, cz + 2, true], [cx - 16, cz + 4, true],
      [cx + 11, cz - 6, false], [cx - 11, cz - 6, false], [cx + 5, cz + WALL_R - 4.5, false], [cx - 5, cz + WALL_R - 4.5, false]
    ];
    for (var li = 0; li < lampSpots.length; li++) lampPost(lampSpots[li][0], lampSpots[li][1], lampSpots[li][2]);
    canyonColliders();
    pushPoi('gate', 'Village Gate', cx, cz + WALL_R, 3.0);

    var stat = endLambert(_sa, 'ef-buildings'); scene.add(stat);
    if (EF.world && EF.world.occluders) EF.world.occluders.push(stat);
    if (_ga.pos.length) { scene.add(endGlow(_ga, 'ef-building-glow')); }

    wrapNearest();
    console.log('[EF.buildings] settlement: ' + enterables.length + ' buildings, ' +
      myNpcs.length + ' NPCs, ' + lamps.length + ' lamp lights, wall r' + WALL_R + ', ' +
      colliders.length + ' colliders, min main gap ' + spacingMin(mains).toFixed(1) + 'u');
  });

  /* =====================================================================
   * 10. PER-TICK
   * ===================================================================== */
  var PLAYER_R = 0.45, NPC_R = 0.4, _out = { x: 0, z: 0 };
  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    var dt = t.dt, elapsed = t.elapsed;

    var pp = EF.player && EF.player.position;
    if (pp && EF.player.root) {
      collision.resolve(pp.x, pp.z, PLAYER_R, _out);
      if (_out.x !== pp.x || _out.z !== pp.z) { pp.x = _out.x; pp.z = _out.z; EF.player.root.position.x = _out.x; EF.player.root.position.z = _out.z; }
    }
    if (EF.npcs && EF.npcs._npcs) {
      for (var id in EF.npcs._npcs) { var g = EF.npcs._npcs[id].group.position; collision.resolve(g.x, g.z, NPC_R, _out); g.x = _out.x; g.z = _out.z; }
    }
    var px = pp ? pp.x : 0, pz = pp ? pp.z : 0;
    for (var i = 0; i < myNpcs.length; i++) {
      var n = myNpcs[i];
      var dx = px - n.x, dz = pz - n.z;
      var want = (dx * dx + dz * dz < 36) ? Math.atan2(dx, dz) : n.baseYaw;
      var diff = want - n.yaw; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      n.yaw += diff * Math.min(1, dt * 3); n.group.rotation.y = n.yaw;
      n.mesh.position.y = Math.sin(elapsed * 1.5 + n.bob) * 0.02;
    }
    for (i = 0; i < enterables.length; i++) {
      var e = enterables[i];
      var inside = pp && Math.abs(pp.x - e.cx) < e.w / 2 + 0.25 && Math.abs(pp.z - e.cz) < e.d / 2 + 0.25;
      if (inside !== e.inside) {
        e.inside = inside;
        for (var r = 0; r < e.roofs.length; r++) e.roofs[r].visible = !inside;
        if (e.light) e.light.intensity = inside ? e.baseInt * 1.4 : e.baseInt;
        if (inside) bus.emit('ui:toast', { text: 'Entered ' + e.name });
      }
    }
    for (i = 0; i < coals.length; i++) {
      var c = coals[i]; c.mesh.scale.setScalar(1 + 0.14 * Math.sin(elapsed * 9 + c.phase) + 0.07 * Math.sin(elapsed * 17));
    }

    /* [build-09] player safety: inside the wall, enemies do not target you */
    if (pp) {
      var vdx = pp.x - EF.village.cx, vdz = pp.z - EF.village.cz;
      EF.village.playerSafe = (vdx * vdx + vdz * vdz) < (EF.village.r - 1.5) * (EF.village.r - 1.5);
    }

    /* [build-09] keep enemies OUTSIDE the wall (cheap circle exclusion; the
     * gate is player-only). One check per enemy -- no wall-collider sweep. */
    if (EF.enemies && EF.enemies.pool) {
      var pool = EF.enemies.pool, R2 = EF.village.r + 1.0;
      for (i = 0; i < pool.length; i++) {
        var en = pool[i]; if (!en.alive) continue;
        var ex = en.x - EF.village.cx, ez = en.z - EF.village.cz, ed = Math.sqrt(ex * ex + ez * ez);
        if (ed < R2) {
          if (ed < 1e-3) { ex = 1; ez = 0; ed = 1; } // degenerate: shove straight out
          en.x = EF.village.cx + ex / ed * R2; en.z = EF.village.cz + ez / ed * R2;
        }
      }
    }

    /* [build-09] lamps: on at dusk/night, off at dawn/day; subtle flicker */
    var phase = EF.world && EF.world.getTimePhase ? EF.world.getTimePhase() : 'day';
    var lampsOn = (phase === 'dusk' || phase === 'night');
    for (i = 0; i < lamps.length; i++) {
      var lp = lamps[i];
      var target = lampsOn ? lp.base * (0.88 + 0.12 * Math.sin(elapsed * 11 + i * 1.7) + 0.06 * Math.sin(elapsed * 23 + i)) : 0;
      lp.light.intensity += (target - lp.light.intensity) * Math.min(1, dt * 6);
    }

    /* [build-09] forge smoke: rise + recycle */
    if (smoke && smokeData) {
      var arr = smoke.geometry.attributes.position.array;
      for (i = 0; i < smokeData.length; i++) {
        var sd = smokeData[i]; sd.y += sd.sp * dt;
        if (sd.y > smoke._top) { sd.y = 0; sd.x = (Math.random() - 0.5) * 0.4; sd.z = (Math.random() - 0.5) * 0.4; }
        arr[i * 3] = smoke._x + sd.x + Math.sin(elapsed * 0.8 + i) * 0.15 * (sd.y / smoke._top);
        arr[i * 3 + 1] = smoke._y + sd.y;
        arr[i * 3 + 2] = smoke._z + sd.z;
      }
      smoke.geometry.attributes.position.needsUpdate = true;
    }
  });

  /* debug/QA surface: real building centres + sizes (roofs are baked-geometry
   * meshes at the origin, so their .position is not the footprint centre) */
  EF.buildings = { enterables: enterables, npcs: myNpcs, collision: collision };

  console.log('[EF.buildings] collision registry + spread-out village module ready');
})();
