/* ============================================================================
 * EMBERFELL — enemies.js  (Combat dept, Cycle 2)
 * Pooled enemies from data/enemyTypes.js. States: idle/wander/chase/attack/
 * dead. One AI wrinkle per type (wolves circle, skeletons slow+tanky, bandits
 * kite then lunge, troll rare high-HP wanderer). Attacks telegraph with a
 * wind-up pose. Health bars billboard via the parent-inverse quaternion trick.
 * Spawn zones by biome; respawn away from the player.
 *
 * Ownership boundary (Contract v1.1 §5 + Cycle 2 pitfall):
 *   - enemies.js owns kinematics, AI, models, hp-bar rendering, spawn/respawn,
 *     and lifecycle events (enemy:spawned / enemy:died).
 *   - combat.js owns ALL hp mutation. Enemies never write e.hp; combat does.
 *     During an attack strike the enemy calls EF.combat.hurtPlayer(...) rather
 *     than touching player hp.
 *
 * No per-frame allocation in the AI loop: classic for-loops, module-scope
 * scratch objects, number math only.
 *
 * Load order: after engine.js and data/enemyTypes.js. Depends on THREE (r128),
 * EF.engine (bus/camera/time), EF.data.enemyTypes, EF.player (position),
 * EF.combat (hurtPlayer). Reads EF.world.terrainH if present, else flat.
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

  /* module-scope scratch — reused every frame, never reallocated */
  var _q = new THREE.Quaternion();
  var _camQ = new THREE.Quaternion();

  var pool = [];          // all enemy handles (fixed size, recycled)
  var idCounter = 0;

  /* -------------------------------------------------- hp bar builder ---- */
  function makeHpBar(width) {
    var g = new THREE.Group();
    var bg = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x1a0606, fog: false })
    );
    var fg = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xdd3333, fog: false })
    );
    fg.position.z = 0.01;
    g.add(bg); g.add(fg);
    return { group: g, fg: fg, width: width };
  }

  /* ------------------------------------------------------ spawn pos ----- */
  function spawnInZone(zone, awayFromPlayer) {
    var p = EF.player && EF.player.position;
    var px = p ? p.x : 0, pz = p ? p.z : 0;
    for (var k = 0; k < 24; k++) {
      var ang = Math.random() * Math.PI * 2;
      var rad = Math.sqrt(Math.random()) * zone.r;
      var x = zone.cx + Math.cos(ang) * rad;
      var z = zone.cz + Math.sin(ang) * rad;
      var dpx = x - px, dpz = z - pz;
      if (!awayFromPlayer || (dpx * dpx + dpz * dpz) > 32 * 32) return { x: x, z: z };
    }
    return { x: zone.cx, z: zone.cz };
  }

  /* biome gate: if world exposes biomeAt, prefer a matching spot; else use the
   * static zone. Keeps spawn logic forward-compatible with world.js. */
  function pickSpawn(def, zone, biome, away) {
    if (EF.world && typeof EF.world.biomeAt === 'function') {
      for (var k = 0; k < 12; k++) {
        var s = spawnInZone(zone, away);
        if (EF.world.biomeAt(s.x, s.z) === biome) return s;
      }
    }
    return spawnInZone(zone, away);
  }

  /* ---------------------------------------------------- create pool ----- */
  function createEnemy(typeId, zone, biome) {
    var def = EF.data.enemyTypes.get(typeId);
    var built = def.build();
    var bar = makeHpBar(def.contactRadius * 2.4);
    bar.group.position.y = def.barY;
    built.group.add(bar.group);

    var e = {
      id: typeId + '-' + (++idCounter),
      typeId: typeId, def: def,
      root: built.group, parts: built.parts, bar: bar,
      x: 0, z: 0, yaw: 0,
      hp: def.maxhp, maxhp: def.maxhp,
      alive: true, state: 'idle',
      // timers / ai scratch (all mutated in place)
      wanderT: 0, tx: 0, tz: 0,
      atkPhase: 'none', atkT: 0, cooldownT: 0, struck: false,
      orbitSign: Math.random() < 0.5 ? 1 : -1,
      lungeT: 0, lungeVX: 0, lungeVZ: 0,
      deadT: 0, walkPhase: Math.random() * 6,
      zone: zone, biome: biome,
      _hitSwing: -1               // last combat swing id that hit this enemy
    };
    EF.engine.scene.add(e.root);
    return e;
  }

  function respawn(e, initial) {
    var s = pickSpawn(e.def, e.zone, e.biome, true);
    e.x = s.x; e.z = s.z;
    e.hp = e.maxhp; e.alive = true; e.state = 'wander';
    e.atkPhase = 'none'; e.atkT = 0; e.cooldownT = 0; e.struck = false;
    e.lungeT = 0; e.deadT = 0;
    e.root.rotation.set(0, 0, 0);
    e.root.visible = true;
    e.bar.group.visible = true;
    e.bar.fg.scale.x = 1; e.bar.fg.position.x = 0;
    resetPose(e);
    e.root.position.set(e.x, groundAt(e.x, e.z), e.z);
    bus.emit('enemy:spawned', { type: e.typeId, id: e.id, position: { x: e.x, y: groundAt(e.x, e.z), z: e.z } });
  }

  function resetPose(e) {
    var p = e.parts;
    if (p.telegraph) { p.telegraph.rotation.x = 0; }
    if (p.legL) p.legL.rotation.x = 0;
    if (p.legR) p.legR.rotation.x = 0;
    if (p.legs) for (var i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = 0;
    if (p.armL) p.armL.rotation.x = 0;
  }

  /* ----------------------------------------------------- animation ------ */
  function animWalk(e, moveMag, dt) {
    var p = e.parts, def = e.def;
    e.walkPhase += dt * def.walkFreq * (0.4 + moveMag);
    var s = Math.sin(e.walkPhase) * 0.6 * (0.3 + moveMag);
    if (p.legs) {                       // quadruped: diagonal gait
      p.legs[0].rotation.x = s;  p.legs[3].rotation.x = s;
      p.legs[1].rotation.x = -s; p.legs[2].rotation.x = -s;
    } else if (p.legL) {                // biped
      p.legL.rotation.x = s; p.legR.rotation.x = -s;
      if (p.armL) p.armL.rotation.x = -s * 0.6;
    }
  }

  /* telegraph: rear the wind-up node back over the windup, snap through on the
   * strike, ease out on recover. t01 is 0..1 within the current sub-phase. */
  function animTelegraph(e) {
    var node = e.parts.telegraph;
    if (!node) return;
    if (e.atkPhase === 'windup') {
      node.rotation.x = -1.6 * e.atkT;             // rear back (up)
    } else if (e.atkPhase === 'strike') {
      node.rotation.x = -1.6 + 3.0 * e.atkT;       // chop down through
    } else if (e.atkPhase === 'recover') {
      node.rotation.x = 1.4 * (1 - e.atkT);        // settle
    } else {
      node.rotation.x *= 0.8;
    }
  }

  /* -------------------------------------------------- attack driver ----- */
  function startAttack(e) {
    e.state = 'attack';
    e.atkPhase = 'windup'; e.atkT = 0; e.struck = false;
  }

  function updateAttack(e, dt, dToPlayer) {
    var def = e.def;
    if (e.atkPhase === 'windup') {
      e.atkT += dt / def.windup;
      if (e.atkT >= 1) { e.atkPhase = 'strike'; e.atkT = 0; }
    } else if (e.atkPhase === 'strike') {
      e.atkT += dt / def.strike;
      if (!e.struck && e.atkT >= 0.4) {
        e.struck = true;
        // landing check: only connects if player is still in range
        if (dToPlayer <= def.attackRange + 0.4 && EF.combat && EF.combat.hurtPlayer) {
          EF.combat.hurtPlayer(def.damage, e.typeId);
        }
      }
      if (e.atkT >= 1) { e.atkPhase = 'recover'; e.atkT = 0; }
    } else if (e.atkPhase === 'recover') {
      e.atkT += dt / def.recover;
      if (e.atkT >= 1) {
        e.atkPhase = 'none';
        e.cooldownT = def.cooldown;
        e.state = 'chase';
      }
    }
    animTelegraph(e);
  }

  /* --------------------------------------------------- AI wrinkles ------ *
   * All wrinkles operate on numbers (e.x/e.z) — no vector allocation. Return
   * the intended move magnitude for the walk animation. */
  function aiChaseWolf(e, dt, px, pz, d) {
    var def = e.def;
    if (d <= def.lungeRange && e.cooldownT <= 0) { startAttack(e); return 0; }
    // orbit at radius, then close: blend a tangential component with radial
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    var tx = -nz * e.orbitSign, tz = nx * e.orbitSign;         // tangent
    var pull = d > def.orbitRadius ? 1 : 0.15;                 // close in if far
    var mx = nx * pull + tx * (1 - pull) * 1.4;
    var mz = nz * pull + tz * (1 - pull) * 1.4;
    var mlen = Math.sqrt(mx * mx + mz * mz) || 1;
    e.x += (mx / mlen) * def.speed * dt;
    e.z += (mz / mlen) * def.speed * dt;
    e.yaw = Math.atan2(px - e.x, pz - e.z);
    return 1;
  }

  function aiChaseTank(e, dt, px, pz, d) {          // skeleton: plodding line
    var def = e.def;
    if (d <= def.attackRange && e.cooldownT <= 0) { startAttack(e); return 0; }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    e.x += nx * def.speed * dt;
    e.z += nz * def.speed * dt;
    e.yaw = Math.atan2(nx, nz);
    return 0.7;
  }

  function aiChaseKite(e, dt, px, pz, d) {           // bandit: keep distance, lunge
    var def = e.def;
    if (e.lungeT > 0) {                              // mid-lunge dash
      e.lungeT -= dt;
      e.x += e.lungeVX * dt; e.z += e.lungeVZ * dt;
      e.yaw = Math.atan2(px - e.x, pz - e.z);
      if (d <= def.attackRange && e.cooldownT <= 0) { e.lungeT = 0; startAttack(e); }
      return 1;
    }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    if (d < def.keepDistance - 0.5) {               // too close -> retreat
      e.x -= nx * def.retreatSpeed * dt;
      e.z -= nz * def.retreatSpeed * dt;
      e.yaw = Math.atan2(nx, nz);                    // still face player
      return 1;
    } else if (d > def.lungeRange) {                 // too far -> approach
      e.x += nx * def.speed * dt;
      e.z += nz * def.speed * dt;
      e.yaw = Math.atan2(nx, nz);
      return 0.8;
    } else if (e.cooldownT <= 0) {                   // in the pocket -> lunge
      e.lungeT = def.lungeTime;
      e.lungeVX = nx * def.lungeSpeed; e.lungeVZ = nz * def.lungeSpeed;
      return 1;
    }
    e.yaw = Math.atan2(nx, nz);
    return 0;
  }

  function aiChaseWander(e, dt, px, pz, d) {          // troll: heavy, slow close
    var def = e.def;
    if (d <= def.attackRange && e.cooldownT <= 0) { startAttack(e); return 0; }
    var nx = (px - e.x) / (d || 1), nz = (pz - e.z) / (d || 1);
    e.x += nx * def.speed * dt;
    e.z += nz * def.speed * dt;
    e.yaw = Math.atan2(nx, nz);
    return 0.6;
  }

  function doWander(e, dt) {
    var def = e.def;
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
      e.wanderT = 2 + Math.random() * 4;
      e.tx = e.x + (Math.random() * 2 - 1) * 14;
      e.tz = e.z + (Math.random() * 2 - 1) * 14;
    }
    var wx = e.tx - e.x, wz = e.tz - e.z, wd = Math.sqrt(wx * wx + wz * wz);
    if (wd > 0.5) {
      var sp = def.speed * 0.4;
      e.x += (wx / wd) * sp * dt;
      e.z += (wz / wd) * sp * dt;
      e.yaw = Math.atan2(wx, wz);
      return 0.5;
    }
    return 0;
  }

  /* ------------------------------------------------------- per tick ----- */
  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    if (pool.length === 0) return;
    var dt = t.dt;
    var p = EF.player && EF.player.position;
    var px = p ? p.x : 0, pz = p ? p.z : 0;
    _camQ.copy(EF.engine.camera.object.quaternion);
    var playerDead = EF.combat && EF.combat.isPlayerDead && EF.combat.isPlayerDead();

    for (var i = 0; i < pool.length; i++) {
      var e = pool[i];

      if (!e.alive) {                          // dead: topple, sink, respawn
        e.deadT += dt;
        e.bar.group.visible = false;
        e.root.rotation.z = Math.min(Math.PI / 2, e.deadT * 3.5);
        var sink = Math.min(1.2, Math.max(0, e.deadT - 1.6) * 0.7);
        e.root.position.y = groundAt(e.x, e.z) - sink;
        if (e.deadT > 7) { respawn(e, false); }
        continue;
      }

      if (e.cooldownT > 0) e.cooldownT -= dt;

      var dx = px - e.x, dz = pz - e.z, d = Math.sqrt(dx * dx + dz * dz);
      var moveMag = 0;

      if (e.state === 'attack') {
        updateAttack(e, dt, d);
        moveMag = 0;
      } else if (!playerDead && d < e.def.aggro) {
        e.state = 'chase';
        switch (e.def.wrinkle) {
          case 'circle': moveMag = aiChaseWolf(e, dt, px, pz, d); break;
          case 'tank':   moveMag = aiChaseTank(e, dt, px, pz, d); break;
          case 'kite':   moveMag = aiChaseKite(e, dt, px, pz, d); break;
          default:       moveMag = aiChaseWander(e, dt, px, pz, d); break;
        }
      } else {
        e.state = 'wander';
        moveMag = doWander(e, dt);
      }

      // commit transform
      e.root.position.set(e.x, groundAt(e.x, e.z), e.z);
      e.root.rotation.y = e.yaw;

      // leg/telegraph animation
      if (e.state !== 'attack') animWalk(e, moveMag, dt);

      // hp bar fill from current hp (combat is the writer; we only render)
      var r = e.maxhp > 0 ? Math.max(0, e.hp / e.maxhp) : 0;
      e.bar.fg.scale.x = Math.max(0.001, r);
      e.bar.fg.position.x = -(1 - r) * (e.bar.width * 0.5);
      // billboard: parent group is rotated, so undo it then face camera
      e.bar.group.quaternion.copy(e.root.quaternion).invert().multiply(_camQ);
    }
  });

  /* --------------------------------------------------- boot the pool ---- */
  bus.on('game:booted', function (bp) {
    if (bp && bp.__selfTest) return;
    var roster = EF.data.enemyTypes.roster;
    for (var r = 0; r < roster.length; r++) {
      var entry = roster[r];
      for (var n = 0; n < entry.count; n++) {
        var e = createEnemy(entry.type, entry.zone, entry.biome);
        pool.push(e);
        respawn(e, true);
      }
    }
    console.log('[EF.enemies] pool ready: ' + pool.length + ' enemies across ' + roster.length + ' zones');
  });

  /* ----------------------------------------------------- public API ----- *
   * combat.js is the only writer of e.hp. It calls kill(e) when hp hits 0. */
  EF.enemies = {
    pool: pool,
    each: function (fn) { for (var i = 0; i < pool.length; i++) fn(pool[i], i); },
    applyKnockback: function (e, nx, nz, impulse) {
      // nx,nz should be a unit vector from player -> enemy
      e.x += nx * impulse * 0.18;
      e.z += nz * impulse * 0.18;
    },
    kill: function (e) {
      if (!e.alive) return;
      e.alive = false; e.state = 'dead'; e.deadT = 0;
      e.atkPhase = 'none';
      e.bar.group.visible = false;
      bus.emit('enemy:died', { type: e.typeId, id: e.id });
    }
  };
})();
