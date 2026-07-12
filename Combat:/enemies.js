/* ============================================================================
 * EMBERFELL — enemies.js  (Combat dept)  [CR-5 draw-call patch]
 * ----------------------------------------------------------------------------
 * WHAT CHANGED (Cycle 2 -> patch): the v1 build spawned every enemy as a bag
 * of individual THREE.Mesh primitives (~170 draw calls for the 14-enemy pool).
 * This patch collapses the whole pool onto InstancedMesh batches:
 *   - each enemy TYPE's static body is ONE merged, vertex-colored geometry,
 *     drawn as ONE InstancedMesh across every enemy of that type;
 *   - only the animated pieces (legs, swinging arm, telegraph limb) stay
 *     separate, and even those are batched: one InstancedMesh per (type, part),
 *     with per-instance matrices updated each frame;
 *   - all 14 HP bars share TWO InstancedMeshes (background + fill).
 * Result: 16 draw calls for the entire enemy pool (was ~170).
 *
 * Everything else is unchanged: same AI wrinkles, same states, same telegraph
 * timing, same billboarding (now baked into the bar instance matrix), same
 * public API, same ownership boundary (combat.js is still the sole writer of
 * hp; enemies never touch e.hp). No per-frame allocation: build-time geometry
 * merge, tick-time uses only module-scope scratch objects + setMatrixAt writes.
 *
 * Depends on THREE (r128: BufferGeometry / InstancedMesh / Matrix4 are core, no
 * BufferGeometryUtils needed), EF.engine (bus/camera/time), EF.data.enemyTypes,
 * EF.player, EF.combat. Reads EF.world.terrainH if present, else flat.
 * Delivery: raw .js text, ASCII quotes only (Contract v1.1 §2.5).
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.engine) { console.error('[EF.enemies] engine.js must load before enemies.js'); return; }
  var bus = EF.engine.bus;

  function groundAt(x, z) {
    if (EF.world && typeof EF.world.terrainH === 'function') return EF.world.terrainH(x, z);
    if (EF.engine && typeof EF.engine.groundAt === 'function') return EF.engine.groundAt(x, z);
    return 0;
  }

  /* one shared material for every batched body/limb; colors ride on geometry */
  var BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
  var BAR_BG_MAT = new THREE.MeshBasicMaterial({ color: 0x1a0606, fog: false });
  var BAR_FG_MAT = new THREE.MeshBasicMaterial({ color: 0xdd3333, fog: false });

  /* ===================== geometry merge helpers (build-time only) ======== */
  var _mM = new THREE.Matrix4(), _mR = new THREE.Matrix4();
  var _mEul = new THREE.Euler();

  // a positioned primitive: box translated (and optionally rotated) into place
  function prim(w, h, d, color, tx, ty, tz, rx, ry, rz) {
    var g = new THREE.BoxGeometry(w, h, d);
    _mM.makeTranslation(tx || 0, ty || 0, tz || 0);
    if (rx || ry || rz) { _mEul.set(rx || 0, ry || 0, rz || 0); _mR.makeRotationFromEuler(_mEul); _mM.multiply(_mR); }
    g.applyMatrix4(_mM);
    return { geo: g, color: color };
  }

  // merge positioned prims into one vertex-colored BufferGeometry
  function merge(entries) {
    var i, v, total = 0, geos = [];
    for (i = 0; i < entries.length; i++) {
      var g = entries[i].geo;
      geos.push(g.index ? g.toNonIndexed() : g);
      total += geos[i].attributes.position.count;
    }
    var pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
    var o = 0;
    for (i = 0; i < geos.length; i++) {
      var gg = geos[i], c = entries[i].color;
      var pa = gg.attributes.position.array;
      var na = gg.attributes.normal ? gg.attributes.normal.array : null;
      var n = gg.attributes.position.count;
      for (v = 0; v < n; v++) {
        var k = (o + v) * 3, s = v * 3;
        pos[k] = pa[s]; pos[k + 1] = pa[s + 1]; pos[k + 2] = pa[s + 2];
        if (na) { nrm[k] = na[s]; nrm[k + 1] = na[s + 1]; nrm[k + 2] = na[s + 2]; }
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
      o += n;
    }
    var m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return m;
  }

  // limb geometry (built ONCE, shared by every slot that uses it so the boot
  // step can pack them into a single InstancedMesh across all enemies).
  function limbGeo(entries) { return merge(entries); }
  // a slot references a shared limb geo + its pivot offset + animation role.
  function slot(geo, ox, oy, oz, role, sign) {
    return { geo: geo, ox: ox, oy: oy, oz: oz, role: role, sign: sign == null ? 1 : sign };
  }

  var C = {};
  function col(hex) { return (C[hex] || (C[hex] = new THREE.Color(hex))); }

  /* ===================== per-type rig blueprints ========================= *
   * returns { body: <merged geo>, limbs: [limb, ...] }. Body is static; limbs
   * are the only animated pieces (Contract CR-5: keep leg/telegraph separate). */
  function rigWolf() {
    var fur = col(0x53504e), dark = col(0x393735);
    var body = merge([
      prim(1.30, 0.60, 0.55, fur, 0, 0.70, 0),
      prim(0.16, 0.16, 0.52, dark, 0, 0.78, -0.80, 0.5, 0, 0)
    ]);
    // shared geos: one head + one leg, reused across all 4 legs
    var headGeo = limbGeo([
      prim(0.46, 0.42, 0.46, fur, 0, 0.00, 0.18),
      prim(0.22, 0.20, 0.26, dark, 0, -0.06, 0.42),
      prim(0.10, 0.16, 0.06, dark, -0.14, 0.24, 0.12),
      prim(0.10, 0.16, 0.06, dark, 0.14, 0.24, 0.12)
    ]);
    var legG = limbGeo([prim(0.16, 0.44, 0.16, dark, 0, -0.22, 0)]);
    return { body: body, slots: [
      slot(headGeo, 0, 0.86, 0.58, 'telegraph', 1),
      slot(legG, -0.34, 0.42, 0.42, 'leg', 1), slot(legG, 0.34, 0.42, 0.42, 'leg', -1),
      slot(legG, -0.34, 0.42, -0.42, 'leg', -1), slot(legG, 0.34, 0.42, -0.42, 'leg', 1)
    ] };
  }

  function rigSkeleton() {
    var bone = col(0xd9d4c4), boneD = col(0x9c988a), eye = col(0xffcf5a);
    var bodyEntries = [
      prim(0.42, 0.10, 0.26, bone, 0, 1.55, 0),
      prim(0.10, 0.44, 0.10, bone, 0, 1.10, 0),
      prim(0.20, 0.16, 0.16, bone, 0, 0.94, 0),
      prim(0.30, 0.34, 0.30, bone, 0, 1.82, 0),
      prim(0.06, 0.06, 0.04, eye, -0.07, 1.84, 0.16),
      prim(0.06, 0.06, 0.04, eye, 0.07, 1.84, 0.16)
    ];
    for (var i = 0; i < 3; i++) bodyEntries.push(prim(0.36, 0.06, 0.22, boneD, 0, 1.30 - i * 0.16, 0));
    var armG = limbGeo([prim(0.12, 0.70, 0.12, bone, 0, -0.35, 0)]);   // shared L+R
    var legG = limbGeo([prim(0.12, 0.86, 0.12, boneD, 0, -0.43, 0)]);  // shared L+R
    return { body: merge(bodyEntries), slots: [
      slot(legG, -0.14, 0.92, 0, 'leg', 1), slot(legG, 0.14, 0.92, 0, 'leg', -1),
      slot(armG, -0.30, 1.52, 0, 'armSwing', 1), slot(armG, 0.30, 1.52, 0, 'telegraph', 1)
    ] };
  }

  function rigBandit() {
    var cloak = col(0x3a2d24), skin = col(0xc79a70), steel = col(0xb8c2cc);
    var body = merge([
      prim(0.62, 0.90, 0.38, cloak, 0, 1.20, 0),
      prim(0.40, 0.40, 0.40, cloak, 0, 1.80, 0),
      prim(0.24, 0.14, 0.10, skin, 0, 1.72, 0.20),
      prim(0.72, 0.50, 0.12, cloak, 0, 0.85, -0.14)
    ]);
    var legG = limbGeo([prim(0.16, 0.80, 0.16, cloak, 0, -0.40, 0)]);       // shared L+R
    var plainArm = limbGeo([prim(0.16, 0.72, 0.16, cloak, 0, -0.36, 0)]);   // left hand
    var daggerArm = limbGeo([prim(0.16, 0.72, 0.16, cloak, 0, -0.36, 0),    // right hand (weapon)
                             prim(0.06, 0.42, 0.05, steel, 0, -0.85, 0.06)]);
    return { body: body, slots: [
      slot(legG, -0.18, 0.80, 0, 'leg', 1), slot(legG, 0.18, 0.80, 0, 'leg', -1),
      slot(plainArm, -0.42, 1.60, 0, 'armSwing', 1), slot(daggerArm, 0.42, 1.60, 0, 'telegraph', 1)
    ] };
  }

  function rigTroll() {
    var hide = col(0x5c6e46), dark = col(0x44532f), club = col(0x6b4a2b);
    var body = merge([
      prim(1.50, 1.60, 1.10, hide, 0, 2.10, 0, 0.18, 0, 0),
      prim(0.80, 0.72, 0.80, hide, 0, 3.05, 0.30),
      prim(0.60, 0.30, 0.20, dark, 0, 2.90, 0.66)
    ]);
    var legG = limbGeo([prim(0.46, 1.30, 0.46, dark, 0, -0.65, 0)]);        // shared L+R
    var plainArm = limbGeo([prim(0.40, 1.50, 0.40, hide, 0, -0.75, 0)]);    // left hand
    var clubArm = limbGeo([prim(0.40, 1.50, 0.40, hide, 0, -0.75, 0),       // right hand (club)
                           prim(0.24, 1.30, 0.24, club, 0, -2.05, 0), prim(0.52, 0.52, 0.52, dark, 0, -2.70, 0)]);
    return { body: body, slots: [
      slot(legG, -0.42, 1.30, 0, 'leg', 1), slot(legG, 0.42, 1.30, 0, 'leg', -1),
      slot(plainArm, -0.95, 2.70, 0, 'armSwing', 1), slot(clubArm, 0.95, 2.70, 0, 'telegraph', 1)
    ] };
  }

  var RIGS = { wolf: rigWolf, skeleton: rigSkeleton, bandit: rigBandit, troll: rigTroll };

  /* ===================== state ===================== */
  var pool = [];          // flat logical enemies (no per-enemy Object3D anymore)
  var bodyIMs = [];       // one InstancedMesh per type (static body)
  var limbIMs = [];       // InstancedMeshes for animated limbs
  var animLimbs = [];     // flat records {im, idx, e, ox,oy,oz, role, sign}
  var allIMs = [];        // every body/limb InstancedMesh, for needsUpdate sweep
  var barBg = null, barFg = null;
  var idCounter = 0;

  /* scratch — reused every frame, never reallocated */
  var _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _eul = new THREE.Euler();
  var _one = new THREE.Vector3(1, 1, 1);
  var _axisX = new THREE.Vector3(1, 0, 0), _qx = new THREE.Quaternion();
  var _mLocal = new THREE.Matrix4(), _mWorld = new THREE.Matrix4();
  var _mBill = new THREE.Matrix4(), _mL = new THREE.Matrix4(), _mHidden = new THREE.Matrix4();
  var _camQ = new THREE.Quaternion();
  _mHidden.makeScale(0, 0, 0);

  /* ===================== spawn placement ===================== */
  /* [build-03 integrator patch, re-applied to the CR-5 rewrite for build-04;
   * Contract s1 addendum rev A] terrainH is ANALYTIC -- it answers for any
   * (x,z) -- but the terrain mesh only spans EF.worldData.terrain.size.
   * Spawns and per-frame AI movement are clamped to the mesh. The literal
   * fallback applies ONLY to module-standalone harnesses without World. */
  var EDGE_MARGIN = 4;
  var HALF = 100; // refreshed from world data at boot; harness-only fallback
  function refreshWorldBounds() {
    var wd = EF.worldData;
    if (wd && wd.terrain && wd.terrain.size) HALF = wd.terrain.size * 0.5 - EDGE_MARGIN;
  }

  function spawnInZone(zone, away) {
    var p = EF.player && EF.player.position;
    var px = p ? p.x : 0, pz = p ? p.z : 0;
    for (var k = 0; k < 24; k++) {
      var ang = Math.random() * Math.PI * 2;
      var rad = Math.sqrt(Math.random()) * zone.r;
      var x = zone.cx + Math.cos(ang) * rad, z = zone.cz + Math.sin(ang) * rad;
      if (x < -HALF || x > HALF || z < -HALF || z > HALF) continue; // off-mesh
      var dx = x - px, dz = z - pz;
      if (!away || (dx * dx + dz * dz) > 32 * 32) return { x: x, z: z };
    }
    return {
      x: Math.max(-HALF, Math.min(HALF, zone.cx)),
      z: Math.max(-HALF, Math.min(HALF, zone.cz))
    };
  }
  function pickSpawn(zone, biome, away) {
    if (EF.world && typeof EF.world.biomeAt === 'function') {
      for (var k = 0; k < 12; k++) { var s = spawnInZone(zone, away); if (EF.world.biomeAt(s.x, s.z) === biome) return s; }
    }
    return spawnInZone(zone, away);
  }

  /* ===================== respawn / pose reset ===================== */
  function respawn(e) {
    var s = pickSpawn(e.zone, e.biome, true);
    e.x = s.x; e.z = s.z;
    e.hp = e.maxhp; e.alive = true; e.state = 'wander';
    e.atkPhase = 'none'; e.atkT = 0; e.cooldownT = 0; e.struck = false;
    e.lungeT = 0; e.deadT = 0; e.rollZ = 0; e.sinkY = 0;
    e.legSwing = 0; e.armSwing = 0; e.telePose = 0;
    var gy = groundAt(e.x, e.z);
    bus.emit('enemy:spawned', { type: e.typeId, id: e.id, position: { x: e.x, y: gy, z: e.z } });
  }

  /* ===================== animation (now scalars, applied via matrices) === */
  function animWalk(e, moveMag, dt) {
    e.walkPhase += dt * e.def.walkFreq * (0.4 + moveMag);
    var s = Math.sin(e.walkPhase) * 0.6 * (0.3 + moveMag);
    e.legSwing = s;
    e.armSwing = -s * 0.6;
  }
  function animTelegraph(e) {
    if (e.atkPhase === 'windup') e.telePose = -1.6 * e.atkT;
    else if (e.atkPhase === 'strike') e.telePose = -1.6 + 3.0 * e.atkT;
    else if (e.atkPhase === 'recover') e.telePose = 1.4 * (1 - e.atkT);
    else e.telePose *= 0.8;
  }

  /* ===================== attack driver ===================== */
  function startAttack(e) { e.state = 'attack'; e.atkPhase = 'windup'; e.atkT = 0; e.struck = false; }
  function updateAttack(e, dt, d) {
    var def = e.def;
    if (e.atkPhase === 'windup') { e.atkT += dt / def.windup; if (e.atkT >= 1) { e.atkPhase = 'strike'; e.atkT = 0; } }
    else if (e.atkPhase === 'strike') {
      e.atkT += dt / def.strike;
      if (!e.struck && e.atkT >= 0.4) {
        e.struck = true;
        if (d <= def.attackRange + 0.4 && EF.combat && EF.combat.hurtPlayer) EF.combat.hurtPlayer(def.damage, e.typeId);
      }
      if (e.atkT >= 1) { e.atkPhase = 'recover'; e.atkT = 0; }
    } else if (e.atkPhase === 'recover') {
      e.atkT += dt / def.recover;
      if (e.atkT >= 1) { e.atkPhase = 'none'; e.cooldownT = def.cooldown; e.state = 'chase'; }
    }
    animTelegraph(e);
  }

  /* ===================== AI wrinkles (numbers only, no alloc) ============ */
  function aiChaseWolf(e, dt, px, pz, d) {
    var def = e.def;
    if (d <= def.lungeRange && e.cooldownT <= 0) { startAttack(e); return 0; }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    var tx = -nz * e.orbitSign, tz = nx * e.orbitSign;
    var pull = d > def.orbitRadius ? 1 : 0.15;
    var mx = nx * pull + tx * (1 - pull) * 1.4, mz = nz * pull + tz * (1 - pull) * 1.4;
    var ml = Math.sqrt(mx * mx + mz * mz) || 1;
    e.x += (mx / ml) * def.speed * dt; e.z += (mz / ml) * def.speed * dt;
    e.yaw = Math.atan2(px - e.x, pz - e.z); return 1;
  }
  function aiChaseTank(e, dt, px, pz, d) {
    var def = e.def;
    if (d <= def.attackRange && e.cooldownT <= 0) { startAttack(e); return 0; }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    e.x += nx * def.speed * dt; e.z += nz * def.speed * dt; e.yaw = Math.atan2(nx, nz); return 0.7;
  }
  function aiChaseKite(e, dt, px, pz, d) {
    var def = e.def;
    if (e.lungeT > 0) {
      e.lungeT -= dt; e.x += e.lungeVX * dt; e.z += e.lungeVZ * dt; e.yaw = Math.atan2(px - e.x, pz - e.z);
      if (d <= def.attackRange && e.cooldownT <= 0) { e.lungeT = 0; startAttack(e); } return 1;
    }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    if (d < def.keepDistance - 0.5) { e.x -= nx * def.retreatSpeed * dt; e.z -= nz * def.retreatSpeed * dt; e.yaw = Math.atan2(nx, nz); return 1; }
    if (d > def.lungeRange) { e.x += nx * def.speed * dt; e.z += nz * def.speed * dt; e.yaw = Math.atan2(nx, nz); return 0.8; }
    if (e.cooldownT <= 0) { e.lungeT = def.lungeTime; e.lungeVX = nx * def.lungeSpeed; e.lungeVZ = nz * def.lungeSpeed; return 1; }
    e.yaw = Math.atan2(nx, nz); return 0;
  }
  function aiChaseWander(e, dt, px, pz, d) {
    var def = e.def;
    if (d <= def.attackRange && e.cooldownT <= 0) { startAttack(e); return 0; }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    e.x += nx * def.speed * dt; e.z += nz * def.speed * dt; e.yaw = Math.atan2(nx, nz); return 0.6;
  }
  function doWander(e, dt) {
    var def = e.def; e.wanderT -= dt;
    if (e.wanderT <= 0) { e.wanderT = 2 + Math.random() * 4; e.tx = e.x + (Math.random() * 2 - 1) * 14; e.tz = e.z + (Math.random() * 2 - 1) * 14; }
    var wx = e.tx - e.x, wz = e.tz - e.z, wd = Math.sqrt(wx * wx + wz * wz);
    if (wd > 0.5) { var sp = def.speed * 0.4; e.x += (wx / wd) * sp * dt; e.z += (wz / wd) * sp * dt; e.yaw = Math.atan2(wx, wz); return 0.5; }
    return 0;
  }

  /* limb angle selector */
  function limbAngle(e, role, sign) {
    if (role === 'leg') return e.legSwing * sign;
    if (role === 'armSwing') return e.armSwing * sign;
    if (role === 'telegraph') return e.telePose * sign;
    return 0;
  }

  /* ===================== per-tick ===================== */
  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    if (pool.length === 0) return;
    var dt = t.dt, i;
    var p = EF.player && EF.player.position;
    var px = p ? p.x : 0, pz = p ? p.z : 0;
    _camQ.copy(EF.engine.camera.object.quaternion);
    var playerDead = EF.combat && EF.combat.isPlayerDead && EF.combat.isPlayerDead();
    /* [build-09] enemies do not target the player while inside the village
     * wall (buildings.js sets EF.village.playerSafe). They fall back to wander. */
    var playerSafe = EF.village && EF.village.playerSafe;

    /* --- 1. AI + logical state, then bake each enemy's base world matrix --- */
    for (i = 0; i < pool.length; i++) {
      var e = pool[i];

      if (!e.alive) {                                    // dead: topple + sink
        e.deadT += dt;
        e.rollZ = Math.min(Math.PI / 2, e.deadT * 3.5);
        e.sinkY = Math.min(1.2, Math.max(0, e.deadT - 1.6) * 0.7);
        if (e.deadT > 7) respawn(e);
      } else {
        if (e.cooldownT > 0) e.cooldownT -= dt;
        var dx = px - e.x, dz = pz - e.z, d = Math.sqrt(dx * dx + dz * dz), moveMag = 0;
        if (e.state === 'attack') { updateAttack(e, dt, d); moveMag = 0; }
        else if (!playerDead && !playerSafe && d < e.def.aggro) {
          e.state = 'chase';
          switch (e.def.wrinkle) {
            case 'circle': moveMag = aiChaseWolf(e, dt, px, pz, d); break;
            case 'tank':   moveMag = aiChaseTank(e, dt, px, pz, d); break;
            case 'kite':   moveMag = aiChaseKite(e, dt, px, pz, d); break;
            default:       moveMag = aiChaseWander(e, dt, px, pz, d); break;
          }
        } else { e.state = 'wander'; moveMag = doWander(e, dt); }
        if (e.state !== 'attack') animWalk(e, moveMag, dt);
      }

      // [build-04] keep AI movement (chase/lunge/knockback/wander) on the mesh
      if (e.x < -HALF) e.x = -HALF; else if (e.x > HALF) e.x = HALF;
      if (e.z < -HALF) e.z = -HALF; else if (e.z > HALF) e.z = HALF;

      e.groundY = groundAt(e.x, e.z);
      _pos.set(e.x, e.groundY - e.sinkY, e.z);
      _eul.set(0, e.yaw, e.rollZ);
      _quat.setFromEuler(_eul);
      e._m.compose(_pos, _quat, _one);
      e.bodyIM.setMatrixAt(e.bodyIdx, e._m);            // body draw (batched)
    }

    /* --- 2. animated limbs: world = enemyBase * (offset * rotX(angle)) --- */
    for (i = 0; i < animLimbs.length; i++) {
      var L = animLimbs[i], en = L.e;
      var ang = limbAngle(en, L.role, L.sign);
      _pos.set(L.ox, L.oy, L.oz);
      _qx.setFromAxisAngle(_axisX, ang);
      _mLocal.compose(_pos, _qx, _one);
      _mWorld.multiplyMatrices(en._m, _mLocal);
      L.im.setMatrixAt(L.idx, _mWorld);
    }

    /* --- 3. HP bars: billboarded, left-anchored fill, batched --- */
    for (i = 0; i < pool.length; i++) {
      var b = pool[i];
      if (!b.alive) { barBg.setMatrixAt(b.barIdx, _mHidden); barFg.setMatrixAt(b.barIdx, _mHidden); continue; }
      var W = b.def.contactRadius * 2.4;
      var r = b.maxhp > 0 ? Math.max(0, b.hp / b.maxhp) : 0;
      _pos.set(b.x, b.groundY + b.def.barY, b.z);
      _mBill.compose(_pos, _camQ, _one);
      _mL.makeScale(W, 1, 1);
      _mWorld.multiplyMatrices(_mBill, _mL);
      barBg.setMatrixAt(b.barIdx, _mWorld);
      _mL.makeScale(W * r, 1, 1); _mL.elements[12] = -W * 0.5 * (1 - r);
      _mWorld.multiplyMatrices(_mBill, _mL);
      barFg.setMatrixAt(b.barIdx, _mWorld);
    }

    for (i = 0; i < allIMs.length; i++) allIMs[i].instanceMatrix.needsUpdate = true;
    barBg.instanceMatrix.needsUpdate = true;
    barFg.instanceMatrix.needsUpdate = true;
  });

  /* ===================== boot: build batches + pool ===================== */
  bus.on('game:booted', function (bp) {
    if (bp && bp.__selfTest) return;
    var scene = EF.engine.scene;
    refreshWorldBounds(); // [build-04] before any spawn math
    var roster = EF.data.enemyTypes.roster;
    var barIdx = 0, totalCount = 0, r;
    for (r = 0; r < roster.length; r++) totalCount += roster[r].count;

    // shared unit-width bar plane, scaled per instance
    var barGeo = new THREE.PlaneGeometry(1, 0.14);
    barBg = new THREE.InstancedMesh(barGeo, BAR_BG_MAT, totalCount);
    barFg = new THREE.InstancedMesh(barGeo, BAR_FG_MAT, totalCount);
    barBg.frustumCulled = false; barFg.frustumCulled = false;
    scene.add(barBg); scene.add(barFg);

    for (r = 0; r < roster.length; r++) {
      var entry = roster[r], typeId = entry.type, count = entry.count;
      var def = EF.data.enemyTypes.get(typeId);
      var rig = RIGS[typeId]();

      // one InstancedMesh for this type's static body
      var bodyIM = new THREE.InstancedMesh(rig.body, BODY_MAT, count);
      bodyIM.frustumCulled = false; scene.add(bodyIM);
      bodyIMs.push(bodyIM); allIMs.push(bodyIM);

      // pack slots that share a geometry into ONE InstancedMesh (e.g. a wolf's
      // 4 legs -> a single batch of count*4 instances)
      var groups = [], gi, sl;
      for (sl = 0; sl < rig.slots.length; sl++) {
        var sd = rig.slots[sl], grp = null;
        for (gi = 0; gi < groups.length; gi++) { if (groups[gi].geo === sd.geo) { grp = groups[gi]; break; } }
        if (!grp) { grp = { geo: sd.geo, members: [] }; groups.push(grp); }
        grp.members.push(sd);
      }
      for (gi = 0; gi < groups.length; gi++) {
        var g = groups[gi];
        g.im = new THREE.InstancedMesh(g.geo, BODY_MAT, count * g.members.length);
        g.im.frustumCulled = false; scene.add(g.im);
        limbIMs.push(g.im); allIMs.push(g.im);
      }

      // create the logical enemies for this type
      for (var n = 0; n < count; n++) {
        var e = {
          id: typeId + '-' + (++idCounter), typeId: typeId, def: def,
          x: 0, z: 0, yaw: 0, groundY: 0,
          hp: def.maxhp, maxhp: def.maxhp, alive: true, state: 'idle',
          wanderT: 0, tx: 0, tz: 0,
          atkPhase: 'none', atkT: 0, cooldownT: 0, struck: false,
          orbitSign: Math.random() < 0.5 ? 1 : -1,
          lungeT: 0, lungeVX: 0, lungeVZ: 0,
          deadT: 0, rollZ: 0, sinkY: 0, walkPhase: Math.random() * 6,
          legSwing: 0, armSwing: 0, telePose: 0,
          zone: entry.zone, biome: entry.biome, _hitSwing: -1,
          bodyIM: bodyIM, bodyIdx: n, barIdx: barIdx++,
          _m: new THREE.Matrix4()
        };
        // register this enemy's animated limbs; instance index packs
        // (enemyIndex, memberIndex) within each group's InstancedMesh
        for (gi = 0; gi < groups.length; gi++) {
          var gr = groups[gi], gl = gr.members.length;
          for (var mi = 0; mi < gl; mi++) {
            var lm = gr.members[mi];
            animLimbs.push({ im: gr.im, idx: n * gl + mi, e: e, ox: lm.ox, oy: lm.oy, oz: lm.oz, role: lm.role, sign: lm.sign });
          }
        }
        pool.push(e);
        respawn(e);
      }
    }
    console.log('[EF.enemies] pool ready: ' + pool.length + ' enemies, ' +
      (allIMs.length + 2) + ' draw calls (' + bodyIMs.length + ' bodies + ' +
      limbIMs.length + ' limb batches + 2 bars)');
  });

  /* ===================== public API (unchanged surface) ===================== */
  EF.enemies = {
    pool: pool,
    each: function (fn) { for (var i = 0; i < pool.length; i++) fn(pool[i], i); },
    applyKnockback: function (e, nx, nz, impulse) { e.x += nx * impulse * 0.18; e.z += nz * impulse * 0.18; },
    kill: function (e) {
      if (!e.alive) return;
      e.alive = false; e.state = 'dead'; e.deadT = 0; e.atkPhase = 'none';
      bus.emit('enemy:died', { type: e.typeId, id: e.id });
    },
    drawCalls: function () { return allIMs.length + 2; }
  };
})();
