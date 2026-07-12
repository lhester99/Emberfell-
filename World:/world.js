/* ============================================================================
 * EMBERFELL — world.js  (v1.0, Cycle 2)
 * Department: World Builder. Owns: terrain, biomes/scatter, POIs, day/night
 * sky, water, fire, pickups. Owns NOTHING about the player or combat.
 *
 * Requires (in load order): THREE r128, engine.js (EF.bus/EF.engine),
 * data/biomes.js (EF.worldData).
 *
 * Contract v1.1 compliance:
 *   SS5  — terrainH registered via EF.engine.setGroundSampler inside the
 *          'game:booted' handler; all animation runs off 'game:tick';
 *          no private rAF loops.
 *   SS4  — emits only canonical events: 'loot:collected', 'audio:play'.
 *          NOTE: dept spec said "item:pickup"; SS4 renamed it. See
 *          delivery notes. All handlers ignore __selfTest payloads.
 *   SS2  — ASCII quotes only; console.log/warn/error only; WebGL1-safe
 *          geometry; no per-frame allocation in tick paths (CR-2 spirit).
 *
 * Public surface (EF.world):
 *   terrainH(x,z)            canonical analytic height (matches mesh)
 *   pois                     [{id,label,x,z,y,radius}]
 *   getTimePhase()           'dawn' | 'day' | 'dusk' | 'night'
 *   time01 / setTime01(t) / setDayLength(seconds)
 *   spawnPickup(itemId,x,z)  -> {remove()}
 *   setPlayerObject(object3D)  register player root for pickup proximity
 *                              (Combat: call this from your spawn path)
 * ========================================================================= */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    console.error('[EF.world] THREE (r128) must be loaded before world.js');
    return;
  }
  var EF = (window.EF = window.EF || {});
  if (!EF.worldData) {
    console.error('[EF.world] data/biomes.js must be loaded before world.js');
    return;
  }

  var D = EF.worldData;
  var T = D.terrain;

  /* Registering EF.world before window 'load' keeps the engine's
   * standalone harness from booting (engine.js checks !EF.world). */
  var world = { pois: [], ready: false, time01: 0.35, occluders: [] };
  EF.world = world;

  /* ===================== 1. NOISE + HEIGHT FIELD ===================== */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function smoothstep(a, b, x) { return smooth(clamp01((x - a) / (b - a))); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function hash2(ix, iz) {
    var s = Math.sin(ix * 127.1 + iz * 311.7 + D.seed * 0.013) * 43758.5453123;
    return s - Math.floor(s);
  }

  function vnoise(x, z) {
    var ix = Math.floor(x), iz = Math.floor(z);
    var fx = x - ix, fz = z - iz;
    var a = hash2(ix, iz), b = hash2(ix + 1, iz);
    var c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    var ux = smooth(fx), uz = smooth(fz);
    return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
  }

  function fbm(x, z, oct, lac, gain) {
    var amp = 1, f = 1, sum = 0, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += vnoise(x * f, z * f) * amp;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm; // 0..1
  }

  /* Raw field: rolling hills + northern ridge. */
  function rawH(x, z) {
    var h = (fbm(x * T.baseFreq, z * T.baseFreq, T.octaves, T.lacunarity, T.gain) * 2 - 1) * T.baseAmp;
    var m = T.mountain;
    var mm = smooth(clamp01((m.start - z) / (m.start - m.full)));
    if (mm > 0) {
      h += mm * m.height * (0.55 + 0.45 * fbm(x * m.freq + 100, z * m.freq - 70, m.octaves, 2.1, 0.5));
    }
    return h;
  }

  /* POI flattening baked into the canonical sampler. Each flattening POI
   * becomes a plateau at (raw height at center + drop); fully flat inside
   * 55% of the radius, blended smoothly to raw terrain at the rim. */
  var flatteners = [];
  (function initPois() {
    for (var i = 0; i < D.pois.length; i++) {
      var p = D.pois[i];
      var flatY = rawH(p.x, p.z) + (p.drop || 0);
      if (p.flatten) {
        flatteners.push({ x: p.x, z: p.z, radius: p.radius, flatY: flatY });
      }
      world.pois.push({
        id: p.id, label: p.label, x: p.x, z: p.z,
        y: flatY, radius: p.radius
      });
    }
  })();

  function terrainH(x, z) {
    var h = rawH(x, z);
    for (var i = 0; i < flatteners.length; i++) {
      var p = flatteners[i];
      var dx = x - p.x, dz = z - p.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < p.radius * p.radius) {
        var d = Math.sqrt(d2);
        var w = 1 - smoothstep(p.radius * 0.55, p.radius, d);
        h = lerp(h, p.flatY, w);
      }
    }
    return h;
  }
  world.terrainH = terrainH;

  function slopeAt(x, z) {
    var e = 0.45;
    var hx = terrainH(x + e, z) - terrainH(x - e, z);
    var hz = terrainH(x, z + e) - terrainH(x, z - e);
    return Math.sqrt(hx * hx + hz * hz) / (2 * e);
  }

  /* ===================== 2. TERRAIN MESH (vertex colored) ============= */

  function buildTerrain(scene) {
    var geo = new THREE.PlaneGeometry(T.size, T.size, T.segments, T.segments);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var cGrass = new THREE.Color(T.colors.grass);
    var cDry = new THREE.Color(T.colors.grassDry);
    var cDirt = new THREE.Color(T.colors.dirt);
    var cRock = new THREE.Color(T.colors.rock);
    var cSnow = new THREE.Color(T.colors.snow);
    var tmp = new THREE.Color();

    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var h = terrainH(x, z);
      pos.setY(i, h);
      var s = slopeAt(x, z);

      tmp.copy(cGrass).lerp(cDry, vnoise(x * 0.12 + 31, z * 0.12 - 17)); // patchy meadow
      tmp.lerp(cDirt, smoothstep(0.35, 0.62, s) * 0.85);                 // dirt on grades
      tmp.lerp(cRock, smoothstep(T.rockSlope, T.rockSlope + 0.35, s));   // rock on cliffs
      var sn = smoothstep(T.snowHeight, T.snowHeight + 2.5, h) *
               (1 - smoothstep(0.95, 1.35, s));                          // snow caps
      tmp.lerp(cSnow, sn);

      /* subtle elevation + local-relief shading: hollows darker, ridges
       * lighter, so the ground reads as landform instead of flat green.
       * relief = center minus mean of neighbors (concavity); elevF = absolute
       * height band. Both kept gentle and clamped. */
      var e2 = 0.9;
      var hMean = (terrainH(x - e2, z) + terrainH(x + e2, z) +
                   terrainH(x, z - e2) + terrainH(x, z + e2)) * 0.25;
      var relief = h - hMean;                 // >0 bumps/ridges, <0 hollows
      var elevF = clamp01((h + 3) / 18);      // ~0 low ground .. 1 high ground
      var bright = 1 + (elevF - 0.5) * 0.16 + relief * 0.5;
      if (bright < 0.82) bright = 0.82; else if (bright > 1.12) bright = 1.12;
      tmp.multiplyScalar(bright);

      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.name = 'ef-terrain';
    scene.add(mesh);
    return mesh;
  }

  /* ===================== 3. GEOMETRY MERGE HELPERS ==================== */
  /* All static POI dressing merges into ONE mesh (1 draw call). Build-time
   * allocation only. */

  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  var _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m3 = new THREE.Matrix3();

  function mat(px, py, pz, sx, sy, sz, ry, rx, rz) {
    _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0));
    return new THREE.Matrix4().compose(_v1.set(px, py, pz), _q, _v2.set(sx, sy, sz));
  }

  function beginMerge() { return { pos: [], nor: [], col: [] }; }

  function pushGeom(acc, geom, colorHex, matrix) {
    var g = geom.index ? geom.toNonIndexed() : geom;
    var p = g.attributes.position, n = g.attributes.normal;
    _m3.getNormalMatrix(matrix);
    var c = new THREE.Color(colorHex);
    for (var i = 0; i < p.count; i++) {
      _v3.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(matrix);
      acc.pos.push(_v3.x, _v3.y, _v3.z);
      _v3.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(_m3).normalize();
      acc.nor.push(_v3.x, _v3.y, _v3.z);
      acc.col.push(c.r, c.g, c.b);
    }
    if (g !== geom) g.dispose();
  }

  function endMerge(acc, name) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
    var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.name = name;
    return mesh;
  }

  /* Primitive library (unit-ish shapes, scaled via matrices). */
  var GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    cone: new THREE.ConeGeometry(0.5, 1, 10),
    ico: new THREE.IcosahedronGeometry(1, 0)
  };

  function poiById(id) {
    for (var i = 0; i < world.pois.length; i++) {
      if (world.pois[i].id === id) return world.pois[i];
    }
    return null;
  }

  /* ===================== 4. POINTS OF INTEREST ======================== */

  var COL = {
    wood: 0x6b4a33, woodDark: 0x503526, wall: 0x8f7350, roof: 0x5e4531,
    stone: 0x75767e, stoneDark: 0x54555c, slate: 0x3f4652, sealed: 0x1a1a20,
    coal: 0x2a2018, monolith: 0x7b7e88
  };

  function buildVillage(acc, rng) {
    var v = poiById('village');
    var y = v.y, cx = v.x, cz = v.z;

    /* fire pit (old Maren's spot) */
    for (var i = 0; i < 9; i++) {
      var a = (i / 9) * Math.PI * 2;
      pushGeom(acc, GEO.box, COL.stone,
        mat(cx + Math.cos(a) * 1.15, y + 0.18, cz + Math.sin(a) * 1.15,
            0.46, 0.34, 0.32, a, 0, 0));
    }
    pushGeom(acc, GEO.cyl, COL.coal, mat(cx, y + 0.07, cz, 1.9, 0.14, 1.9, 0));

    /* [build-08 integrator: the three solid decorative huts were REMOVED from
     * here. They are now built as spaced-out, ENTERABLE huts (hollow, door gap,
     * roof-reveal, interior) in integration/buildings.js alongside the tavern,
     * blacksmith, and market -- so no village structure is impassable
     * (requirement 8). The fire pit and well below stay world-owned. */

    /* well */
    var wx = cx + 4.6, wz = cz - 4.2;
    pushGeom(acc, GEO.cyl, COL.stone, mat(wx, y + 0.45, wz, 2.1, 0.9, 2.1, 0));
    pushGeom(acc, GEO.cyl, COL.coal, mat(wx, y + 0.86, wz, 1.5, 0.1, 1.5, 0));
    pushGeom(acc, GEO.box, COL.wood, mat(wx - 0.95, y + 1.45, wz, 0.15, 1.5, 0.15, 0));
    pushGeom(acc, GEO.box, COL.wood, mat(wx + 0.95, y + 1.45, wz, 0.15, 1.5, 0.15, 0));
    pushGeom(acc, GEO.cone, COL.roof, mat(wx, y + 2.5, wz, 2.7, 0.75, 2.7, 0.4));

    /* [build-08 integrator: the south-approach fence was REMOVED -- it cut
     * across the now much wider settlement (requirement 7, ~60-unit village).
     * Fire pit + well remain; all buildings are placed by buildings.js. */
  }

  function buildTower(acc) {
    var p = poiById('tower');
    var y = p.y, x = p.x, z = p.z;
    pushGeom(acc, GEO.cyl, COL.stoneDark, mat(x, y + 4.5, z, 5.2, 9.0, 5.2, 0));
    pushGeom(acc, GEO.cyl, COL.stone, mat(x, y + 3.0, z, 5.5, 0.3, 5.5, 0));   // band
    pushGeom(acc, GEO.cyl, COL.stone, mat(x, y + 6.2, z, 5.5, 0.3, 5.5, 0));   // band
    pushGeom(acc, GEO.cone, COL.slate, mat(x, y + 10.2, z, 6.6, 2.4, 6.6, 0));
    pushGeom(acc, GEO.box, COL.sealed, mat(x, y + 1.05, z + 2.55, 1.25, 2.1, 0.28, 0)); // the seal

    /* weathered boulders slumped around the base (atmosphere) */
    var boulders = [[5.0, -1.4, 2.0, 1.5], [-3.4, 4.2, 2.5, 1.8],
                    [1.6, -5.2, 1.7, 1.1], [-4.8, -2.6, 2.1, 1.3], [3.8, 4.4, 1.5, 1.0]];
    for (var bi = 0; bi < boulders.length; bi++) {
      var bx = x + boulders[bi][0], bz = z + boulders[bi][1];
      var bw = boulders[bi][2], bh = boulders[bi][3];
      pushGeom(acc, GEO.ico, COL.stoneDark,
        mat(bx, terrainH(bx, bz) + bh * 0.32, bz, bw, bh, bw * 0.9, bi * 1.27, 0.14, 0.1));
    }
  }

  function buildStones(acc, rng) {
    var p = poiById('stones');
    var y = p.y, n = 7;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var sx = p.x + Math.cos(a) * 5.6, sz = p.z + Math.sin(a) * 5.6;
      var h = 2.7 + rng() * 1.1;
      pushGeom(acc, GEO.box, COL.monolith,
        mat(sx, y + h / 2, sz, 0.95, h, 0.6, a + rng() * 0.4,
            (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.14));
    }
    pushGeom(acc, GEO.box, COL.stoneDark, mat(p.x, y + 0.28, p.z, 2.4, 0.56, 1.7, 0.5));
  }

  function buildArch(acc, rng) {
    var p = poiById('arch');
    var y = p.y;
    pushGeom(acc, GEO.box, COL.stone, mat(p.x - 2.6, y + 2.1, p.z, 1.25, 4.2, 1.25, 0.08));
    pushGeom(acc, GEO.box, COL.stone, mat(p.x + 2.6, y + 1.4, p.z, 1.25, 2.8, 1.25, -0.05)); // broken side
    pushGeom(acc, GEO.box, COL.stoneDark,
      mat(p.x - 0.6, y + 4.45, p.z, 4.6, 0.9, 1.35, 0, 0, 0.12));            // tilted lintel
    pushGeom(acc, GEO.box, COL.stoneDark,
      mat(p.x + 3.4, y + 0.35, p.z + 1.7, 2.1, 0.7, 1.2, 0.7, 0, 0.2));      // fallen slab
    for (var i = 0; i < 5; i++) {
      pushGeom(acc, GEO.box, COL.stone,
        mat(p.x + (rng() - 0.5) * 8, y + 0.2, p.z + (rng() - 0.5) * 8,
            0.5 + rng() * 0.5, 0.4, 0.5 + rng() * 0.4, rng() * 3));
    }
  }

  /* ===================== 5. BIOME SCATTER (InstancedMesh) ============= */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Baked vertex-colored scatter geometries (one merged geometry each,
   * so one InstancedMesh == one draw call per species). */
  function makeScatterGeos() {
    var out = {};
    var acc;

    /* Cycle 2 polish: trunks lengthened ~1.5-2x so the canopy sits above the
     * close third-person camera sightline (~1.4-2.5 m eye band). Same tri
     * count / draw calls; only matrices at merge time changed. */
    acc = beginMerge();  // pine: taller trunk, two canopy cones lifted clear
    pushGeom(acc, GEO.cyl, COL.wood, mat(0, 1.3, 0, 0.5, 2.6, 0.5, 0));    // trunk 0..2.6
    pushGeom(acc, GEO.cone, 0x2f5d3a, mat(0, 3.6, 0, 2.6, 3.0, 2.6, 0));   // canopy 2.1..5.1
    pushGeom(acc, GEO.cone, 0x386842, mat(0, 5.6, 0, 1.7, 2.2, 1.7, 0.5)); // cap 4.5..6.7
    out.pine = endMerge(acc, 'pine').geometry;

    acc = beginMerge();  // birch: pale trunk raised, ellipsoid canopy lifted
    pushGeom(acc, GEO.cyl, 0xdfe0d6, mat(0, 1.7, 0, 0.32, 3.4, 0.32, 0));   // trunk 0..3.4
    pushGeom(acc, GEO.ico, 0x86a84e, mat(0, 4.3, 0, 1.35, 1.7, 1.35, 0.4)); // canopy 3.45..5.15
    out.birch = endMerge(acc, 'birch').geometry;

    acc = beginMerge();  // rock: white-baked, tinted per instance
    pushGeom(acc, GEO.ico, 0xffffff, mat(0, 0.35, 0, 1, 0.8, 1, 0));
    out.rock = endMerge(acc, 'rock').geometry;

    acc = beginMerge();  // grass tuft
    pushGeom(acc, GEO.cone, 0x5b8a3c, mat(0, 0.22, 0, 0.5, 0.45, 0.5, 0));
    pushGeom(acc, GEO.cone, 0x6f9a44, mat(0.16, 0.18, 0.1, 0.38, 0.36, 0.38, 1.2));
    out.tuft = endMerge(acc, 'tuft').geometry;

    return out;
  }

  function insideRegion(r, x, z) {
    if (r.kind === 'circle') {
      var dx = x - r.x, dz = z - r.z;
      return dx * dx + dz * dz <= r.r * r.r;
    }
    if (r.kind === 'ring') {
      var dx2 = x - r.x, dz2 = z - r.z;
      var d2 = dx2 * dx2 + dz2 * dz2;
      return d2 >= r.rMin * r.rMin && d2 <= r.rMax * r.rMax;
    }
    if (r.kind === 'zband') return z >= r.zMin && z <= r.zMax;
    return false;
  }

  function regionBounds(r, half) {
    if (r.kind === 'circle') return [r.x - r.r, r.x + r.r, r.z - r.r, r.z + r.r];
    if (r.kind === 'ring') return [r.x - r.rMax, r.x + r.rMax, r.z - r.rMax, r.z + r.rMax];
    return [-half, half, r.zMin, r.zMax];
  }

  function inAnyPoi(x, z, margin) {
    for (var i = 0; i < world.pois.length; i++) {
      var p = world.pois[i];
      var dx = x - p.x, dz = z - p.z;
      var r = p.radius + margin;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  function buildScatter(scene) {
    var rng = mulberry32(D.seed);
    var geos = makeScatterGeos();
    var half = T.size / 2 - 4;
    var placed = { pine: [], birch: [], rock: [], tuft: [] };

    for (var b = 0; b < D.biomes.length; b++) {
      var biome = D.biomes[b];
      for (var s = 0; s < biome.scatter.length; s++) {
        var rule = biome.scatter[s];
        var bounds = regionBounds(biome.region, half);
        var accepted = 0, attempts = 0, maxAttempts = rule.count * 6;
        var tint = new THREE.Color(rule.tint == null ? 0xffffff : rule.tint);
        while (accepted < rule.count && attempts < maxAttempts) {
          attempts++;
          var x = bounds[0] + rng() * (bounds[1] - bounds[0]);
          var z = bounds[2] + rng() * (bounds[3] - bounds[2]);
          if (Math.abs(x) > half || Math.abs(z) > half) continue;
          if (!insideRegion(biome.region, x, z)) continue;
          if (inAnyPoi(x, z, 1.5)) continue;
          var h = terrainH(x, z);
          if (h < (rule.minH == null ? -1e9 : rule.minH)) continue;
          if (h > (rule.maxH == null ? 1e9 : rule.maxH)) continue;
          if (slopeAt(x, z) > (rule.maxSlope == null ? 1e9 : rule.maxSlope)) continue;
          var sc = rule.minScale + rng() * (rule.maxScale - rule.minScale);
          var j = 1 - (rule.jitter || 0) * rng();
          placed[rule.mesh].push({
            x: x, y: h, z: z, s: sc, ry: rng() * Math.PI * 2,
            r: tint.r * j, g: tint.g * j, b: tint.b * j
          });
          accepted++;
        }
      }
    }

    var kinds = ['pine', 'birch', 'rock', 'tuft'];
    var tmpC = new THREE.Color();
    var drawCalls = 0;
    for (var k = 0; k < kinds.length; k++) {
      var kind = kinds[k];
      var list = placed[kind];
      if (!list.length) continue;
      var mesh = new THREE.InstancedMesh(
        geos[kind],
        new THREE.MeshLambertMaterial({ vertexColors: true }),
        list.length
      );
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        mesh.setMatrixAt(i, mat(it.x, it.y, it.z, it.s, it.s, it.s, it.ry));
        mesh.setColorAt(i, tmpC.setRGB(it.r, it.g, it.b));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;  // instances span the world; skip bad sphere cull
      mesh.name = 'ef-scatter-' + kind;
      scene.add(mesh);
      if (kind !== 'tuft') world.occluders.push(mesh); // solid scenery only; grass shouldn't zoom the camera
      drawCalls++;
    }
    console.log('[EF.world] scatter: ' +
      kinds.map(function (kk) { return kk + '=' + placed[kk].length; }).join(' ') +
      ' in ' + drawCalls + ' draw calls');
  }

  /* ===================== 6. SKY / DAY-NIGHT ============================ */

  var SKY_R = 100;
  var dayLength = 240; // seconds per full day
  var sky = null, skyGeo = null, skyMix = null;
  var sunMesh = null, moonMesh = null, stars = null, starMat = null;
  var dirLight = null, hemiLight = null;
  var scene = null;

  /* palette keyframes: [t, top, horizon, fog] */
  var PAL_SRC = [
    [0.00, 0x0a1020, 0x141e30, 0x101823],
    [0.20, 0x121a2e, 0x3a3550, 0x232434],
    [0.27, 0x35507a, 0xe08b52, 0x8f6b58],
    [0.35, 0x4f7fc0, 0xbcd4e6, 0x9db8c6],
    [0.50, 0x3f74c4, 0xcfe3ee, 0xaac4d0],
    [0.68, 0x4a6fae, 0xd9c9a8, 0xb0b3a8],
    [0.75, 0x314064, 0xe07b46, 0x7d5e55],
    [0.82, 0x141c32, 0x4a3a56, 0x2c2c3e],
    [0.90, 0x0a1020, 0x141e30, 0x101823],
    [1.00, 0x0a1020, 0x141e30, 0x101823]
  ];
  var PAL = [];
  for (var pi = 0; pi < PAL_SRC.length; pi++) {
    PAL.push({
      t: PAL_SRC[pi][0],
      top: new THREE.Color(PAL_SRC[pi][1]),
      hor: new THREE.Color(PAL_SRC[pi][2]),
      fog: new THREE.Color(PAL_SRC[pi][3])
    });
  }
  var curTop = new THREE.Color(), curHor = new THREE.Color(), curFog = new THREE.Color();
  var sunColor = new THREE.Color(), _warm = new THREE.Color(0xffe2b0),
      _amber = new THREE.Color(0xff9a55), _moonlight = new THREE.Color(0x93a7c8);

  function samplePalette(t) {
    var i = 0;
    while (i < PAL.length - 2 && t > PAL[i + 1].t) i++;
    var a = PAL[i], b = PAL[i + 1];
    var f = (t - a.t) / (b.t - a.t);
    curTop.copy(a.top).lerp(b.top, f);
    curHor.copy(a.hor).lerp(b.hor, f);
    curFog.copy(a.fog).lerp(b.fog, f);
  }

  function buildSky(sc) {
    sky = new THREE.Group();
    sky.name = 'ef-sky';

    skyGeo = new THREE.SphereGeometry(SKY_R, 16, 10);
    var count = skyGeo.attributes.position.count;
    skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    skyMix = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      skyMix[i] = smoothstep(-0.05, 0.45, skyGeo.attributes.position.getY(i) / SKY_R);
    }
    var dome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    }));
    dome.renderOrder = -10;
    sky.add(dome);

    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, fog: false }));
    moonMesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xd7e2f2, fog: false }));
    sky.add(sunMesh, moonMesh);

    var starCount = 350;
    var sp = new Float32Array(starCount * 3);
    var rng = mulberry32(D.seed + 99);
    for (i = 0; i < starCount; i++) {
      var a = rng() * Math.PI * 2, el = Math.asin(rng()); // upper hemisphere
      sp[i * 3] = Math.cos(a) * Math.cos(el) * 97;
      sp[i * 3 + 1] = Math.sin(el) * 97;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(el) * 97;
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, fog: false, depthWrite: false
    });
    stars = new THREE.Points(sg, starMat);
    stars.renderOrder = -9;
    sky.add(stars);

    sc.add(sky);

    /* borrow the engine's lights rather than adding shader cost */
    sc.traverse(function (o) {
      if (o.isDirectionalLight) dirLight = o;
      if (o.isHemisphereLight) hemiLight = o;
    });
  }

  world.getTimePhase = function () {
    var t = world.time01;
    if (t >= 0.22 && t < 0.32) return 'dawn';
    if (t >= 0.32 && t < 0.70) return 'day';
    if (t >= 0.70 && t < 0.80) return 'dusk';
    return 'night';
  };
  world.setTime01 = function (t) { world.time01 = ((t % 1) + 1) % 1; };
  world.setDayLength = function (s) { if (s > 0) dayLength = s; };

  var _sunDir = new THREE.Vector3();
  function updateSky(dt) {
    world.time01 = (world.time01 + dt / dayLength) % 1;
    var t = world.time01;
    var th = (t - 0.25) * Math.PI * 2;         // 0.25 = sunrise, 0.5 = noon
    var sinEl = Math.sin(th);
    var dayF = smoothstep(-0.06, 0.16, sinEl);

    samplePalette(t);

    /* dome vertex recolor (187 verts; write in place, no allocation) */
    var col = skyGeo.attributes.color;
    var arr = col.array;
    for (var i = 0; i < skyMix.length; i++) {
      var f = skyMix[i];
      arr[i * 3] = curHor.r + (curTop.r - curHor.r) * f;
      arr[i * 3 + 1] = curHor.g + (curTop.g - curHor.g) * f;
      arr[i * 3 + 2] = curHor.b + (curTop.b - curHor.b) * f;
    }
    col.needsUpdate = true;

    /* fog + clear color sync */
    if (scene.fog) {
      scene.fog.color.copy(curFog);
      scene.fog.near = lerp(14, 18, dayF);
      scene.fog.far = lerp(46, 60, dayF);   // documented deviation, see notes
    }
    if (scene.background && scene.background.isColor) scene.background.copy(curFog);

    /* sun / moon transit */
    _sunDir.set(Math.cos(th), sinEl, 0.28).normalize();
    sunMesh.position.set(_sunDir.x * 88, _sunDir.y * 88, _sunDir.z * 88);
    moonMesh.position.set(-_sunDir.x * 88, -_sunDir.y * 88, -_sunDir.z * 88);
    sunMesh.visible = sinEl > -0.12;
    moonMesh.visible = sinEl < 0.12;
    starMat.opacity = 0.9 * (1 - smoothstep(-0.18, -0.02, sinEl));

    /* drive the engine's lights */
    if (dirLight) {
      if (dayF > 0.03) {
        sunColor.copy(_amber).lerp(_warm, smoothstep(0.0, 0.5, sinEl));
        dirLight.color.copy(sunColor);
        dirLight.position.set(_sunDir.x * 30, Math.max(2, _sunDir.y * 30), _sunDir.z * 30);
        dirLight.intensity = 0.12 + 0.62 * dayF;
      } else {
        dirLight.color.copy(_moonlight);
        dirLight.position.set(-_sunDir.x * 30, Math.max(4, -_sunDir.y * 30), -_sunDir.z * 30);
        dirLight.intensity = 0.14;
      }
    }
    if (hemiLight) hemiLight.intensity = 0.28 + 0.62 * dayF;

    /* dome follows the camera on x/z so the horizon never slides */
    var cam = EF.engine.camera.object;
    sky.position.set(cam.position.x, 0, cam.position.z);
  }

  /* ===================== 7. WATER + FIRE =============================== */

  var water = null, waterBase = null, flame = null;

  function buildWater(sc) {
    var lake = poiById('lake');
    if (!lake) return;
    var p = D.pois.filter(function (q) { return q.id === 'lake'; })[0];
    var geo = new THREE.CircleGeometry(lake.radius - 1.2, 40);
    geo.rotateX(-Math.PI / 2);
    water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: 0x2e5d6e, transparent: true, opacity: 0.82
    }));
    water.position.set(lake.x, lake.y + (p.water || 1.2), lake.z);
    water.name = 'ef-water';
    waterBase = new Float32Array(geo.attributes.position.array); // snapshot
    sc.add(water);
  }

  function buildFlame(sc) {
    var v = poiById('village');
    flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.95, 7),
      new THREE.MeshBasicMaterial({ color: 0xff9c3f, transparent: true, opacity: 0.92 }));
    flame.position.set(v.x, v.y + 0.6, v.z);
    flame.name = 'ef-flame';
    sc.add(flame);
  }

  function updateWaterFire(elapsed) {
    if (water) {
      var pos = water.geometry.attributes.position;
      var arr = pos.array;
      for (var i = 0; i < pos.count; i++) {
        var bx = waterBase[i * 3], bz = waterBase[i * 3 + 2];
        arr[i * 3 + 1] = Math.sin(elapsed * 1.6 + bx * 0.55 + bz * 0.4) * 0.06;
      }
      pos.needsUpdate = true;
    }
    if (flame) {
      var f = 0.85 + 0.22 * Math.abs(Math.sin(elapsed * 7.1)) + 0.08 * Math.sin(elapsed * 13.7);
      flame.scale.set(1 + 0.12 * Math.sin(elapsed * 11.3), f, 1 + 0.12 * Math.cos(elapsed * 9.7));
    }
  }

  /* ===================== 8. PICKUPS ==================================== */

  var pickups = [];
  var pickupGeo = null;
  var pickupMats = {};
  var playerObj = null;

  world.setPlayerObject = function (obj) { playerObj = obj || null; };

  function pickupMat(itemId) {
    var hex = D.pickups.colors[itemId] != null ? D.pickups.colors[itemId]
                                               : D.pickups.colors['default'];
    var key = String(hex);
    if (!pickupMats[key]) {
      pickupMats[key] = new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.35 });
    }
    return pickupMats[key];
  }

  world.spawnPickup = function (itemId, x, z) {
    if (!world.ready) { console.warn('[EF.world] spawnPickup before world ready'); return null; }
    if (!pickupGeo) pickupGeo = new THREE.OctahedronGeometry(0.28, 0);
    var m = new THREE.Mesh(pickupGeo, pickupMat(itemId));
    var baseY = terrainH(x, z) + 0.65;
    m.position.set(x, baseY, z);
    scene.add(m);
    var rec = { item: itemId, mesh: m, baseY: baseY, phase: Math.random() * 6.28, dead: false };
    pickups.push(rec);
    return {
      remove: function () { rec.dead = true; }
    };
  };

  function updatePickups(elapsed) {
    for (var i = pickups.length - 1; i >= 0; i--) {
      var p = pickups[i];
      if (p.dead) {
        scene.remove(p.mesh);
        pickups.splice(i, 1);
        continue;
      }
      p.mesh.rotation.y = elapsed * 2.2 + p.phase;
      p.mesh.position.y = p.baseY + Math.sin(elapsed * 2 + p.phase) * D.pickups.bobHeight;
      if (playerObj) {
        var dx = playerObj.position.x - p.mesh.position.x;
        var dz = playerObj.position.z - p.mesh.position.z;
        var r = D.pickups.radius;
        if (dx * dx + dz * dz < r * r) {
          scene.remove(p.mesh);
          pickups.splice(i, 1);
          /* SS4: canonical name is loot:collected (renamed from item:pickup) */
          EF.bus.emit('loot:collected', { item: p.item, count: 1 });
          EF.bus.emit('audio:play', { sfx: 'pickup' });
        }
      }
    }
  }

  /* ===================== 8b. CAMERA OCCLUSION ========================= */
  /* When solid scenery sits between player and camera, pull the rig's
   * distance in so we look past it instead of clipping through. game:tick
   * fires BEFORE cameraRig.update in the engine loop, so the reduced
   * distance lands the same frame -- no engine.js edit; we use the rig's
   * public setDistance() only.
   *
   * Seam: the engine's wheel handler writes rig.distance directly, so we
   * track the user's intended distance separately and detect a wheel change
   * by comparing against what we last wrote. (Phones have no wheel, so this
   * only matters on desktop.) A rig-native version -- CR-W2 -- would drop
   * this bookkeeping, but the world-side version needs no engine fork. */
  var camRay = new THREE.Raycaster();
  var _occTarget = new THREE.Vector3();
  var _occDir = new THREE.Vector3();
  var occDesired = -1, occApplied = -1, occCurrent = -1, occFrame = 0, occHit = Infinity;
  var OCC_BUFFER = 0.35, OCC_EVERY = 3;

  function updateCameraOcclusion(dt) {
    var rig = EF.engine.camera;
    if (!playerObj || world.occluders.length === 0) return;
    if (occDesired < 0) { occDesired = occCurrent = occApplied = rig.distance; }

    /* a wheel zoom mutates rig.distance out from under us -> adopt it */
    if (Math.abs(rig.distance - occApplied) > 1e-4) occDesired = rig.distance;

    var head = rig.headOffset != null ? rig.headOffset : 1.4;
    _occTarget.set(playerObj.position.x, playerObj.position.y + head, playerObj.position.z);

    /* throttle the raycast; reuse last hit between casts, lerp every frame */
    if ((occFrame++ % OCC_EVERY) === 0) {
      var cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
      _occDir.set(
        occDesired * cp * Math.sin(rig.yaw),
        occDesired * sp,
        occDesired * cp * Math.cos(rig.yaw)
      );
      var full = _occDir.length();
      if (full > 1e-3) {
        _occDir.multiplyScalar(1 / full);
        camRay.set(_occTarget, _occDir);
        camRay.far = full;
        var hits = camRay.intersectObjects(world.occluders, false);
        occHit = hits.length ? hits[0].distance : Infinity;
      } else {
        occHit = Infinity;
      }
    }

    var target = (occHit < occDesired) ? Math.max(rig.minDistance, occHit - OCC_BUFFER)
                                       : occDesired;
    /* snap in fast to avoid a frame of clip; ease back out gently */
    var rate = (target < occCurrent) ? 20 : 6;
    occCurrent += (target - occCurrent) * (1 - Math.exp(-rate * dt));
    if (occCurrent < rig.minDistance) occCurrent = rig.minDistance;
    if (occCurrent > rig.maxDistance) occCurrent = rig.maxDistance;

    rig.setDistance(occCurrent);
    occApplied = rig.distance;
  }

  /* ===================== 9. BOOT + TICK ================================ */

  EF.bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    if (world.ready) return;
    scene = p.scene;

    /* Contract SS5: the canonical ground sampler is terrainH. */
    EF.engine.setGroundSampler(terrainH);

    buildTerrain(scene);
    buildSky(scene);

    var acc = beginMerge();
    var rng = mulberry32(D.seed + 7);
    buildVillage(acc, rng);
    buildTower(acc);
    buildStones(acc, rng);
    buildArch(acc, rng);
    var poiMesh = endMerge(acc, 'ef-pois');
    scene.add(poiMesh);
    world.occluders.push(poiMesh);

    buildWater(scene);
    buildFlame(scene);
    buildScatter(scene);

    world.ready = true;
    console.log('[EF.world] world ready — pois: ' +
      world.pois.map(function (q) { return q.id; }).join(', '));
  });

  EF.bus.on('game:tick', function (t) {
    if (!world.ready || (t && t.__selfTest)) return;
    updateSky(t.dt);
    updateWaterFire(t.elapsed);
    updatePickups(t.elapsed);
    updateCameraOcclusion(t.dt);
  });
})();
