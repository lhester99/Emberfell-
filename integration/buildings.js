/* ============================================================================
 * EMBERFELL -- integration/buildings.js  (Integrator feature module, build-07)
 * Adds: (1) an EF.engine.collision registry + cylinder-vs-AABB/circle resolver
 * that the player and NPCs resolve against every move tick; (2) an expanded
 * village -- tavern (warm interior light + Bram), blacksmith (forge + anvil),
 * three market stalls with vendors, a notice board -- all registered in
 * EF.world.pois with collision; (3) enterable interiors via a roof-reveal
 * layer: buildings are hollow with a real door gap in geometry AND collision,
 * and their roof hides while the player is inside so the third-person camera
 * sees in (the existing world.js camera occlusion pulls the view past walls).
 *
 * WHY A SELF-CONTAINED MODULE (not edits to engine/world/player/npcs): every
 * cycle so far, department re-uploads have reverted integrator edits. This
 * module installs EF.engine.collision, builds all new geometry, injects the
 * new NPCs + their dialogue, and does the per-tick collision/animation work
 * WITHOUT editing any department file. It must load LAST (after ui/map) so its
 * game:tick handler runs after player.js and npcs.js have moved -- it then
 * corrects positions in the same frame, before the engine's camera update.
 *
 * Contract compliance: THREE r128 core only; ASCII quotes (SS2.5);
 * console.log/warn/error only; no <style>; no private rAF (rides game:tick);
 * per-frame work is number math + reused scratch (SS7). All static building
 * geometry merges into ONE vertex-colored mesh; roofs (2) + hearth/forge
 * glows (2) + NPCs (4, one merged mesh each) are the only extra draw calls.
 *
 * OWNERSHIP NOTE: EF.engine.collision is an engine-level primitive that should
 * migrate into engine.js proper (CR-9). NPC batching for the 4 vendors follows
 * the CR-5/CR-6 single-merged-mesh pattern.
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (typeof THREE === 'undefined') { console.error('[EF.buildings] THREE r128 must load first'); return; }
  if (!EF.engine || !EF.bus) { console.error('[EF.buildings] engine.js must load first'); return; }
  var bus = EF.bus;

  /* =====================================================================
   * 1. COLLISION REGISTRY  (EF.engine.collision) -- cylinder vs AABB/circle
   * ===================================================================== */
  var colliders = [];
  var _cid = 0;
  var collision = {
    colliders: colliders,
    register: function (spec) { spec.id = spec.id || ('c' + (_cid++)); colliders.push(spec); return spec; },
    box: function (minX, maxX, minZ, maxZ, tag) {
      return collision.register({ type: 'box', minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, tag: tag });
    },
    circle: function (x, z, r, tag) {
      return collision.register({ type: 'circle', x: x, z: z, r: r, tag: tag });
    },
    clear: function () { colliders.length = 0; },
    /* push a cylinder of radius r at (x,z) out of every collider. Two
     * relaxation passes so wall corners resolve cleanly. No allocation
     * beyond the returned pair (caller reuses it). */
    resolve: function (x, z, r, out) {
      out = out || { x: 0, z: 0 };
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < colliders.length; i++) {
          var c = colliders[i];
          if (c.type === 'circle') {
            var dx = x - c.x, dz = z - c.z, d = Math.sqrt(dx * dx + dz * dz), rr = r + c.r;
            if (d < rr) {
              if (d > 1e-4) { x = c.x + dx / d * rr; z = c.z + dz / d * rr; }
              else { x = c.x + rr; }
            }
          } else { // box (AABB)
            var qx = x < c.minX ? c.minX : (x > c.maxX ? c.maxX : x);
            var qz = z < c.minZ ? c.minZ : (z > c.maxZ ? c.maxZ : z);
            var bx = x - qx, bz = z - qz, b2 = bx * bx + bz * bz;
            if (b2 < r * r) {
              if (b2 > 1e-6) { var bd = Math.sqrt(b2); x = qx + bx / bd * r; z = qz + bz / bd * r; }
              else { // centre is inside the box: eject along least-penetration axis
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
   * 2. GEOMETRY MERGE HELPERS  (self-contained; mirrors world.js pattern)
   * ===================================================================== */
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  var _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m3 = new THREE.Matrix3();
  var UNIT = new THREE.BoxGeometry(1, 1, 1);
  var UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
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
  function end(acc, name) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
    var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.name = name;
    return mesh;
  }
  function box(acc, col, cx, cy, cz, sx, sy, sz, ry) { push(acc, UNIT, col, mat(cx, cy, cz, sx, sy, sz, ry)); }
  function cyl(acc, col, cx, cy, cz, r, h) { push(acc, UNIT_CYL, col, mat(cx, cy, cz, r * 2, h, r * 2, 0)); }

  var COL = {
    tFloor: 0x4a3524, tWall: 0x8a6a44, tBeam: 0x5a4028, tRoof: 0x6e3f2a,
    bFloor: 0x3a3630, bWall: 0x6f6f78, bStone: 0x565660, bRoof: 0x3f4652,
    wood: 0x6b4a33, woodDk: 0x4a3120, cloth: 0x9a4a3a,
    iron: 0x40434a, coal: 0x241a12, board: 0x7a5a38, paper: 0xe8e0c4
  };

  /* =====================================================================
   * 3. GENERIC ENTERABLE BUILDING  (hollow box, door gap, collision walls,
   *    separate toggleable roof)
   * ===================================================================== */
  var groundAt = function (x, z) {
    if (EF.world && typeof EF.world.terrainH === 'function') return EF.world.terrainH(x, z);
    return EF.engine.groundAt ? EF.engine.groundAt(x, z) : 0;
  };

  var WALL_T = 0.3;      // visual wall thickness
  // Collision volume is THICKER than the visible wall so a single move step
  // can never tunnel through it. The engine clamps dt to 0.05 s; at run speed
  // (~7.4 m/s) that is a 0.37 m step, so a >=0.8 m thick collider (0.4 each
  // side of the wall plane) is caught every frame even at low frame rates.
  var COLL_HALF = 0.42;
  var enterables = []; // { b, roof } for roof-reveal

  // one straight wall run along 'x' (z fixed) or 'z' (x fixed), from a..b,
  // minus a centered door gap [doorC-doorW/2 .. doorC+doorW/2]. Emits geometry
  // + registers a collision AABB per solid segment.
  function wallRun(acc, col, axis, fixed, y, H, a0, a1, doorC, doorW) {
    var segs = [];
    if (doorC == null) segs.push([a0, a1]);
    else { segs.push([a0, doorC - doorW / 2]); segs.push([doorC + doorW / 2, a1]); }
    for (var s = 0; s < segs.length; s++) {
      var s0 = segs[s][0], s1 = segs[s][1];
      if (s1 - s0 < 0.02) continue;
      var mid = (s0 + s1) / 2, len = s1 - s0;
      if (axis === 'x') {
        box(acc, col, mid, y + H / 2, fixed, len, H, WALL_T, 0);
        collision.box(s0, s1, fixed - COLL_HALF, fixed + COLL_HALF, 'wall');
      } else {
        box(acc, col, fixed, y + H / 2, mid, WALL_T, H, len, 0);
        collision.box(fixed - COLL_HALF, fixed + COLL_HALF, s0, s1, 'wall');
      }
    }
  }

  function buildShell(acc, b) {
    var y = groundAt(b.cx, b.cz);
    var hw = b.w / 2, hd = b.d / 2, H = b.wallH;
    b._y = y;
    // floor
    box(acc, b.floorCol, b.cx, y + 0.06, b.cz, b.w, 0.12, b.d, 0);
    // four walls; door side gets the gap
    var xW = b.cx - hw, xE = b.cx + hw, zS = b.cz - hd, zN = b.cz + hd;
    wallRun(acc, b.wallCol, 'x', zN, y, H, xW, xE, b.door === 'N' ? b.cx : null, b.doorW); // north (+z)
    wallRun(acc, b.wallCol, 'x', zS, y, H, xW, xE, b.door === 'S' ? b.cx : null, b.doorW); // south (-z)
    wallRun(acc, b.wallCol, 'z', xE, y, H, zS, zN, b.door === 'E' ? b.cz : null, b.doorW); // east (+x)
    wallRun(acc, b.wallCol, 'z', xW, y, H, zS, zN, b.door === 'W' ? b.cz : null, b.doorW); // west (-x)
    // corner posts (visual)
    box(acc, b.beamCol, xW, y + H / 2, zS, 0.34, H, 0.34, 0);
    box(acc, b.beamCol, xE, y + H / 2, zS, 0.34, H, 0.34, 0);
    box(acc, b.beamCol, xW, y + H / 2, zN, 0.34, H, 0.34, 0);
    box(acc, b.beamCol, xE, y + H / 2, zN, 0.34, H, 0.34, 0);
    if (b.interior) b.interior(acc, b, y);
  }

  // separate pyramid roof mesh so it can be hidden while the player is inside
  function buildRoof(b) {
    var y = b._y, H = b.wallH;
    var acc = begin();
    push(acc, UNIT_CONE, b.roofCol, mat(b.cx, y + H + b.roofH / 2, b.cz,
      Math.max(b.w, b.d) + 1.2, b.roofH, Math.max(b.w, b.d) + 1.2, Math.PI / 4));
    var mesh = end(acc, 'ef-roof-' + b.id);
    return mesh;
  }

  /* =====================================================================
   * 4. INTERIORS
   * ===================================================================== */
  var glows = []; // MeshBasicMaterial glow meshes (flicker in tick)

  function glowMesh(col, x, y, z, r) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6),
      new THREE.MeshBasicMaterial({ color: col, fog: false }));
    m.position.set(x, y, z);
    glows.push({ mesh: m, base: r, phase: Math.random() * 6.28 });
    return m;
  }

  function tavernInterior(acc, b, y) {
    // fireplace on the west inner wall
    var fx = b.cx - b.w / 2 + 0.5;
    box(acc, COL.bStone, fx, y + 0.9, b.cz, 0.5, 1.8, 2.0, 0);
    box(acc, COL.coal, fx + 0.05, y + 0.35, b.cz, 0.4, 0.35, 1.2, 0);
    collision.box(fx - 0.35, fx + 0.35, b.cz - 1.0, b.cz + 1.0, 'hearth');
    // two tables + stools
    function table(tx, tz) {
      box(acc, COL.wood, tx, y + 0.72, tz, 1.3, 0.12, 0.9, 0);        // top
      box(acc, COL.woodDk, tx, y + 0.36, tz, 0.15, 0.72, 0.15, 0);    // leg
      collision.box(tx - 0.65, tx + 0.65, tz - 0.45, tz + 0.45, 'table');
      var st = [[tx - 0.95, tz], [tx + 0.95, tz], [tx, tz - 0.75]];
      for (var s = 0; s < st.length; s++) box(acc, COL.woodDk, st[s][0], y + 0.28, st[s][1], 0.34, 0.56, 0.34, 0);
    }
    table(b.cx + 0.6, b.cz + 1.1);
    table(b.cx + 0.4, b.cz - 1.2);
    // bar counter along the north inner wall
    box(acc, COL.woodDk, b.cx + 0.2, y + 0.6, b.cz + b.d / 2 - 0.7, b.w - 1.6, 1.2, 0.5, 0);
    collision.box(b.cx + 0.2 - (b.w - 1.6) / 2, b.cx + 0.2 + (b.w - 1.6) / 2,
      b.cz + b.d / 2 - 0.95, b.cz + b.d / 2 - 0.45, 'bar');
  }

  function blacksmithInterior(acc, b, y) {
    // forge block against the back (north) wall
    var gx = b.cx, gz = b.cz + b.d / 2 - 0.8;
    box(acc, COL.bStone, gx, y + 0.6, gz, 1.8, 1.2, 1.1, 0);
    box(acc, COL.coal, gx, y + 1.25, gz, 1.2, 0.25, 0.7, 0);
    collision.box(gx - 0.9, gx + 0.9, gz - 0.55, gz + 0.55, 'forge');
    // chimney hood
    box(acc, COL.bStone, gx, y + b.wallH - 0.3, gz, 1.0, 0.8, 0.9, 0);
    // anvil on a stump, front-centre
    var ax = b.cx, az = b.cz - 0.6;
    box(acc, COL.woodDk, ax, y + 0.3, az, 0.6, 0.6, 0.6, 0);          // stump
    box(acc, COL.iron, ax, y + 0.78, az, 0.7, 0.28, 0.34, 0);        // anvil body
    box(acc, COL.iron, ax + 0.42, y + 0.82, az, 0.34, 0.2, 0.3, 0);  // horn
    collision.box(ax - 0.45, ax + 0.55, az - 0.25, az + 0.25, 'anvil');
    // rack of tools by the west wall
    box(acc, COL.wood, b.cx - b.w / 2 + 0.35, y + 1.0, b.cz - 0.6, 0.15, 1.6, 1.4, 0);
  }

  /* =====================================================================
   * 5. OPEN PROPS: market stalls + notice board
   * ===================================================================== */
  function buildStall(acc, sx, sz, canvasCol) {
    var y = groundAt(sx, sz);
    // four posts
    var px = 0.9, pz = 0.6;
    var posts = [[sx - px, sz - pz], [sx + px, sz - pz], [sx - px, sz + pz], [sx + px, sz + pz]];
    for (var i = 0; i < posts.length; i++) box(acc, COL.woodDk, posts[i][0], y + 1.0, posts[i][1], 0.12, 2.0, 0.12, 0);
    // counter (south-facing) -- solid
    box(acc, COL.wood, sx, y + 0.7, sz - pz, px * 2 + 0.2, 0.6, 0.4, 0);
    collision.box(sx - px - 0.1, sx + px + 0.1, sz - pz - 0.25, sz - pz + 0.25, 'stall');
    // goods on the counter
    box(acc, 0x8a5a2a, sx - 0.5, y + 1.05, sz - pz, 0.4, 0.25, 0.3, 0);
    box(acc, 0x6a8a3a, sx + 0.4, y + 1.05, sz - pz, 0.4, 0.22, 0.3, 0);
    // slanted canvas awning
    push(acc, UNIT, canvasCol, mat(sx, y + 2.05, sz + 0.1, px * 2 + 0.6, 0.08, pz * 2 + 0.8, 0));
  }

  function buildNotice(acc, nx, nz) {
    var y = groundAt(nx, nz);
    box(acc, COL.woodDk, nx - 0.7, y + 0.8, nz, 0.16, 1.6, 0.16, 0);
    box(acc, COL.woodDk, nx + 0.7, y + 0.8, nz, 0.16, 1.6, 0.16, 0);
    box(acc, COL.board, nx, y + 1.3, nz, 1.7, 1.1, 0.12, 0);
    box(acc, COL.paper, nx - 0.35, y + 1.4, nz + 0.08, 0.4, 0.5, 0.02, 0);
    box(acc, COL.paper, nx + 0.35, y + 1.25, nz + 0.08, 0.4, 0.55, 0.02, 0);
    collision.box(nx - 0.85, nx + 0.85, nz - 0.12, nz + 0.12, 'notice');
  }

  /* =====================================================================
   * 6. NEW NPCs  (one merged mesh each = 1 draw call; interactable through
   *    the existing EF.npcs system via a nearest() wrap + injected dialogue)
   * ===================================================================== */
  var myNpcs = []; // { id, name, group, mesh, x, z, yaw, bob }

  function buildNpcMesh(pal) {
    var acc = begin();
    box(acc, pal.cloth, 0, 1.16, 0, 0.5, 0.72, 0.28, 0);              // torso
    box(acc, pal.trim, 0, 0.86, 0, 0.54, 0.12, 0.32, 0);             // belt
    box(acc, pal.skin, 0, 1.62, 0, 0.32, 0.32, 0.30, 0);             // head
    box(acc, pal.hair, 0, 1.78, 0, 0.36, 0.14, 0.34, 0);             // hair
    box(acc, pal.cloth, -0.33, 0.86, 0, 0.15, 0.6, 0.15, 0);         // arm L
    box(acc, pal.cloth, 0.33, 0.86, 0, 0.15, 0.6, 0.15, 0);          // arm R
    box(acc, pal.skin, -0.33, 0.52, 0, 0.16, 0.14, 0.16, 0);         // hand L
    box(acc, pal.skin, 0.33, 0.52, 0, 0.16, 0.14, 0.16, 0);          // hand R
    box(acc, pal.trim, -0.13, 0.3, 0, 0.17, 0.62, 0.17, 0);          // leg L
    box(acc, pal.trim, 0.13, 0.3, 0, 0.17, 0.62, 0.17, 0);           // leg R
    if (pal.apron) box(acc, pal.apron, 0, 1.02, 0.16, 0.46, 0.5, 0.06, 0);
    return end(acc, 'ef-npc');
  }

  function placeMyNpc(id, name, x, z, faceYaw, pal, dialogue) {
    var y = groundAt(x, z);
    var mesh = buildNpcMesh(pal);
    var group = new THREE.Group();
    group.add(mesh);
    group.position.set(x, y, z);
    group.rotation.y = faceYaw;
    EF.engine.scene.add(group);
    myNpcs.push({ id: id, name: name, group: group, mesh: mesh, x: x, z: z,
      yaw: faceYaw, baseYaw: faceYaw, bob: Math.random() * 6.28 });
    if (EF.dialogue && EF.dialogue.npc) EF.dialogue.npc[id] = dialogue;
    if (EF.npcs && EF.npcs.list && EF.npcs.list.indexOf(id) < 0) EF.npcs.list.push(id);
  }

  // include my NPCs in EF.npcs.nearest() so TALK + dialogue work unchanged
  function wrapNearest() {
    if (!EF.npcs || EF.npcs.__bldWrapped) return;
    var orig = EF.npcs.nearest;
    EF.npcs.nearest = function () {
      var best = orig ? orig.call(EF.npcs) : null;
      var bestD = best ? best.dist : Infinity;
      var pos = EF.player && EF.player.position;
      if (pos) {
        for (var i = 0; i < myNpcs.length; i++) {
          var n = myNpcs[i], dx = pos.x - n.x, dz = pos.z - n.z, d = Math.sqrt(dx * dx + dz * dz);
          if (d < bestD) { bestD = d; best = { id: n.id, dist: d }; }
        }
      }
      return best;
    };
    EF.npcs.__bldWrapped = true;
  }

  function simpleDialogue(name, text, extraNode) {
    var nodes = { greet: { text: text, choices: [{ label: 'Farewell', action: 'close' }] } };
    if (extraNode) {
      nodes.greet.choices.unshift({ label: extraNode.label, action: 'goto', node: 'more' });
      nodes.more = { text: extraNode.text, choices: [{ label: 'Back', action: 'goto', node: 'greet' }, { label: 'Farewell', action: 'close' }] };
    }
    return { name: name, branches: [], fallback: 'greet', nodes: nodes };
  }

  /* =====================================================================
   * 7. VILLAGE LAYOUT + BUILD
   * ===================================================================== */
  var BUILDINGS = [
    { id: 'tavern', label: 'The Emberfell Tavern', cx: -10.5, cz: 9.0, w: 6.2, d: 5.2,
      wallH: 3.2, roofH: 2.2, door: 'E', doorW: 1.9, radius: 4.2,
      floorCol: COL.tFloor, wallCol: COL.tWall, beamCol: COL.tBeam, roofCol: COL.tRoof,
      interior: tavernInterior, warmLight: { col: 0xffb066, x: -10.5, y: 2.2, z: 9.0, dist: 11, int: 1.5 } },
    { id: 'blacksmith', label: 'The Forge', cx: 10.0, cz: 8.5, w: 5.0, d: 5.0,
      wallH: 3.0, roofH: 1.9, door: 'W', doorW: 1.9, radius: 3.8,
      floorCol: COL.bFloor, wallCol: COL.bWall, beamCol: COL.bStone, roofCol: COL.bRoof,
      interior: blacksmithInterior, forgeLight: { col: 0xff7a2a, x: 10.0, y: 1.4, z: 11.2, dist: 8, int: 1.8 } }
  ];

  var STALLS = [
    { x: -5.6, z: 5.0, canvas: 0xcaa85a, npc: { id: 'sella', name: 'Sella', text: 'Fresh roots and river fish, love. Best prices this side of the pines.' } },
    { x: -3.3, z: 5.0, canvas: 0xa85a4a, npc: { id: 'tomas', name: 'Tomas', text: 'Leather, cord, and good boots. You will want the boots out in the moor.' } },
    { x: -1.0, z: 5.0, canvas: 0x5a7a9a, npc: { id: 'wend', name: 'Wend', text: 'Charms and oddments. Some of them even work. Mostly.' } }
  ];

  var NOTICE = { x: 3.6, z: 7.4 };

  /* =====================================================================
   * 8. BOOT: build everything, register POIs + collision, add NPCs
   * ===================================================================== */
  bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    var scene = EF.engine.scene;
    var acc = begin();

    // existing huts + well collision (recomputed from the village POI, matching
    // world.js buildVillage: huts at angles [0.7,2.8,4.9]*7.2, well at +4.6/-4.2)
    var v = null, pois = (EF.world && EF.world.pois) || [];
    for (var i = 0; i < pois.length; i++) if (pois[i].id === 'village') v = pois[i];
    if (v) {
      var ha = [0.7, 2.8, 4.9];
      for (i = 0; i < ha.length; i++) collision.circle(v.x + Math.cos(ha[i]) * 7.2, v.z + Math.sin(ha[i]) * 7.2, 1.9, 'hut');
      collision.circle(v.x + 4.6, v.z - 4.2, 1.25, 'well');
      collision.circle(v.x, v.z, 2.1, 'firepit');
    }

    // enterable buildings
    for (i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      buildShell(acc, b);
      var roof = buildRoof(b);
      scene.add(roof);
      enterables.push({ b: b, roof: roof, inside: false });
      if (EF.world && EF.world.occluders) EF.world.occluders.push(roof);
      // interior warm light
      var L = b.warmLight || b.forgeLight;
      if (L) { var pl = new THREE.PointLight(L.col, L.int, L.dist, 2); pl.position.set(L.x, L.y, L.z); scene.add(pl); b._light = pl; }
      // glow prop
      if (b.warmLight) scene.add(glowMesh(0xff9a44, b.cx - b.w / 2 + 0.55, b._y + 0.55, b.cz, 0.32)); // hearth fire
      if (b.forgeLight) scene.add(glowMesh(0xff6a1a, b.cx, b._y + 1.35, b.cz + b.d / 2 - 0.8, 0.3));   // forge coals
      // POI + map marker
      pushPoi(b.id, b.label, b.cx, b.cz, b.radius);
    }

    // market stalls + vendors
    for (i = 0; i < STALLS.length; i++) {
      var s = STALLS[i];
      buildStall(acc, s.x, s.z, s.canvas);
      placeMyNpc(s.npc.id, s.npc.name, s.x, s.z + 0.55, Math.PI, // face south toward customers
        { cloth: 0x4a5a3a, trim: 0x6a5a3a, skin: 0xd0a878, hair: 0x3a2a1a, apron: 0x8a7a5a },
        simpleDialogue(s.npc.name, s.npc.text));
    }
    pushPoi('market', 'Market Row', -3.3, 5.0, 3.6);

    // notice board
    buildNotice(acc, NOTICE.x, NOTICE.z);
    pushPoi('notice', 'Notice Board', NOTICE.x, NOTICE.z, 1.4);

    // Bram inside the tavern
    var tav = BUILDINGS[0];
    placeMyNpc('bram', 'Bram', tav.cx + 0.2, tav.cz + tav.d / 2 - 1.4, Math.PI, // behind the bar, facing the room
      { cloth: 0x5a3a2a, trim: 0x7a5a3a, skin: 0xcea47a, hair: 0x2a1e14, apron: 0xb0a084 },
      simpleDialogue('Bram', 'Welcome to the Emberfell, stranger. Pull up a stool -- the fire is warm and the ale is honest.',
        { label: 'Any news?', text: 'Wolves in the pines, bones on the tower road, and Maren fretting by the fire as always. Same as ever.' }));

    // one merged static mesh for the whole expansion
    var mesh = end(acc, 'ef-buildings');
    scene.add(mesh);
    if (EF.world && EF.world.occluders) EF.world.occluders.push(mesh);

    wrapNearest();
    console.log('[EF.buildings] village expanded: ' + BUILDINGS.length + ' buildings, ' +
      STALLS.length + ' stalls, ' + myNpcs.length + ' new NPCs, ' +
      colliders.length + ' colliders');
  });

  function pushPoi(id, label, x, z, radius) {
    if (!EF.world || !EF.world.pois) return;
    for (var i = 0; i < EF.world.pois.length; i++) if (EF.world.pois[i].id === id) return;
    EF.world.pois.push({ id: id, label: label, x: x, z: z, y: groundAt(x, z), radius: radius });
  }

  /* =====================================================================
   * 9. PER-TICK  (loaded LAST -> runs after player.js + npcs.js moved)
   *    resolve collision, animate new NPCs, reveal interiors.
   * ===================================================================== */
  var PLAYER_R = 0.45, NPC_R = 0.4, _out = { x: 0, z: 0 };

  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    var dt = t.dt, elapsed = t.elapsed;

    // --- player collision (correct pstate + root in the same frame) ---
    var pp = EF.player && EF.player.position;
    if (pp && EF.player.root) {
      collision.resolve(pp.x, pp.z, PLAYER_R, _out);
      if (_out.x !== pp.x || _out.z !== pp.z) {
        pp.x = _out.x; pp.z = _out.z;
        EF.player.root.position.x = _out.x; EF.player.root.position.z = _out.z;
      }
    }

    // --- existing dept NPCs collision ---
    if (EF.npcs && EF.npcs._npcs) {
      for (var id in EF.npcs._npcs) {
        var g = EF.npcs._npcs[id].group.position;
        collision.resolve(g.x, g.z, NPC_R, _out);
        g.x = _out.x; g.z = _out.z;
      }
    }

    // --- my NPCs: face player when near, gentle idle bob ---
    var px = pp ? pp.x : 0, pz = pp ? pp.z : 0;
    for (var i = 0; i < myNpcs.length; i++) {
      var n = myNpcs[i];
      var dx = px - n.x, dz = pz - n.z, d2 = dx * dx + dz * dz;
      var want = (d2 < 36) ? Math.atan2(dx, dz) : n.baseYaw;
      var diff = want - n.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      n.yaw += diff * Math.min(1, dt * 3);
      n.group.rotation.y = n.yaw;
      n.mesh.position.y = Math.sin(elapsed * 1.5 + n.bob) * 0.02;
    }

    // --- interior reveal: hide the roof while the player stands inside ---
    for (i = 0; i < enterables.length; i++) {
      var e = enterables[i], b = e.b;
      var inside = pp && Math.abs(pp.x - b.cx) < b.w / 2 + 0.2 && Math.abs(pp.z - b.cz) < b.d / 2 + 0.2;
      if (inside !== e.inside) {
        e.inside = inside;
        e.roof.visible = !inside;
        if (b._light) b._light.intensity = inside ? (b.warmLight || b.forgeLight).int * 1.4 : (b.warmLight || b.forgeLight).int;
        if (inside) bus.emit('ui:toast', { text: 'Entered ' + b.label });
      }
    }

    // glow flicker
    for (i = 0; i < glows.length; i++) {
      var gl = glows[i];
      var s = gl.base * (1 + 0.12 * Math.sin(elapsed * 9 + gl.phase) + 0.06 * Math.sin(elapsed * 17));
      gl.mesh.scale.setScalar(s / gl.base);
    }
  });

  console.log('[EF.buildings] collision registry + village expansion module ready');
})();
