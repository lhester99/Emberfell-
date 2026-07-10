/* ============================================================================
 * EMBERFELL — player.js  (Combat dept, Cycle 2)
 * Owns: the player rig (grouped low-poly primitives, distinct silhouette:
 * cloak + pauldrons), locomotion (idle/walk/run/jump/fall state machine),
 * gravity against terrain, facing, and the weapon attach point that re-parents
 * the equipped model on `weapon:equip`. Also owns the stamina resource.
 *
 * Does NOT own damage/xp/gold/level math or hp mutation — that is combat.js
 * (Contract v1.1 §5). player.stats.hp is written ONLY by combat.js.
 *
 * Load order: after engine.js and data/weapons.js, before combat.js/enemies.js.
 * Depends on: THREE (r128), EF.engine (bus/input/camera/audio/time),
 *             EF.data.weapons. Reads EF.world.terrainH if present, else flat.
 *
 * A-1 note: pointerleave releases held buttons, so run is driven by analog
 * stick magnitude (not a hold-to-sprint button). No hold/charge mechanics.
 * Delivery: raw .js text, ASCII quotes only (Contract v1.1 §2.5).
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.engine) { console.error('[EF.player] engine.js must load before player.js'); return; }
  var bus = EF.engine.bus, input = EF.engine.input;

  /* flat terrain stub: prefer world terrain when it arrives, else engine
   * ground sampler (0 in module builds), else 0. */
  function groundAt(x, z) {
    if (EF.world && typeof EF.world.terrainH === 'function') return EF.world.terrainH(x, z);
    if (EF.engine && typeof EF.engine.groundAt === 'function') return EF.engine.groundAt(x, z);
    return 0;
  }

  /* tuning */
  var WALK_SPEED = 4.2, RUN_SPEED = 7.4;
  var GRAVITY = 22, JUMP_VELOCITY = 8.6, JUMP_STAMINA = 10;
  var RUN_STICK = 0.85;          // stick magnitude above this = run
  var MOVE_DEADZONE = 0.12;
  var STAMINA_REGEN = 16;        // per second

  /* mutable stats (hp/xp/gold/lvl/dmg written by combat.js only) */
  var stats = {
    hp: 100, maxhp: 100,
    st: 100, maxst: 100,
    xp: 0, lvl: 1, xpNext: 100,
    gold: 0, dmg: 20
  };

  /* ------------------------------------------------------------ rig ----- */
  function lam(hex, extra) {
    var o = { color: hex };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new THREE.MeshLambertMaterial(o);
  }
  var M = {
    tunic:    lam(0x39506e),
    cloak:    lam(0x6a2233),
    cloakIn:  lam(0x431622),
    pauldron: lam(0x9aa4ad),
    skin:     lam(0xd8a878),
    hair:     lam(0x2c2018),
    pants:    lam(0x3a2c1c),
    boot:     lam(0x24190f)
  };

  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }
  function pivot(x, y, z) {
    var g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g;
  }

  var root, rig, attach;      // attach = weapon mount point (child of right forearm)
  var parts = {};

  function buildRig() {
    root = new THREE.Group();          // world transform lives here
    rig = new THREE.Group();           // body; bobbed/leaned locally
    root.add(rig);

    rig.add(box(0.82, 1.02, 0.46, M.tunic, 0, 1.26, 0));          // torso
    // head
    var head = box(0.34, 0.36, 0.34, M.skin, 0, 2.02, 0);
    rig.add(head);
    rig.add(box(0.36, 0.12, 0.36, M.hair, 0, 2.22, 0));           // hair cap
    parts.head = head;

    // pauldrons — angular shoulder plates give the distinct silhouette
    var plL = box(0.30, 0.20, 0.42, M.pauldron, -0.52, 1.66, 0);
    var plR = box(0.30, 0.20, 0.42, M.pauldron, 0.52, 1.66, 0);
    plL.rotation.z = 0.25; plR.rotation.z = -0.25;
    rig.add(plL); rig.add(plR);

    // cloak — a tapered slab hanging off the back, sways with motion
    var cloak = pivot(0, 1.72, -0.24);
    var cloakMesh = box(0.78, 1.35, 0.06, M.cloak, 0, -0.62, 0);
    var cloakLine = box(0.72, 1.28, 0.02, M.cloakIn, 0, -0.60, 0.04);
    cloak.add(cloakMesh); cloak.add(cloakLine);
    rig.add(cloak); parts.cloak = cloak;

    // arms (shoulder pivots, upper+fore so the sword swings from the elbow-ish)
    function arm(x) {
      var sh = pivot(x, 1.68, 0);
      sh.add(box(0.20, 0.80, 0.20, M.tunic, 0, -0.40, 0));
      var hand = box(0.16, 0.16, 0.16, M.skin, 0, -0.82, 0);
      sh.add(hand);
      rig.add(sh); return sh;
    }
    parts.armL = arm(-0.54);
    parts.armR = arm(0.54);

    // legs (hip pivots)
    function leg(x) {
      var hip = pivot(x, 0.86, 0);
      hip.add(box(0.22, 0.80, 0.22, M.pants, 0, -0.40, 0));
      hip.add(box(0.24, 0.16, 0.30, M.boot, 0, -0.84, 0.04));
      rig.add(hip); return hip;
    }
    parts.legL = leg(-0.22);
    parts.legR = leg(0.22);

    // weapon mount at the right hand/wrist.
    // Weapon models are built grip-at-origin with the blade along local +Y
    // (data/weapons.js). At the wrist the arm's own +Y points back up toward the
    // shoulder, so a mount with no offset/rotation drives the blade straight up
    // THROUGH the forearm. Two corrections seat it in the fist and make it
    // protrude:
    //   1) HAND_FORWARD pushes the mount forward along the hand's local +Z so
    //      the grip clears the arm volume and sits at the front of the fist;
    //   2) the tilt rotates the blade's +Y so it points forward-and-down out of
    //      the fist rather than up the arm.
    // Both are constants so the pose can be tuned without touching weapon models.
    var HAND_FORWARD = 0.22;          // metres along hand local +Z into the fist
    var HAND_DROP = -0.84;            // y at the fist
    var HAND_TILT = Math.PI * 0.55;   // blade +Y -> points forward (slightly down)
    attach = pivot(0, HAND_DROP, HAND_FORWARD);
    attach.rotation.x = HAND_TILT;
    parts.armR.add(attach);
    parts.attach = attach;

    // soft contact shadow
    var blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    blob.rotation.x = -Math.PI / 2;
    root.add(blob); parts.blob = blob;
  }

  /* --------------------------------------------------- weapon equip ----- */
  var currentWeaponId = null, currentWeaponDef = null, weaponModel = null;

  function equip(id) {
    var def = EF.data.weapons.get(id);
    if (!def) { console.warn('[EF.player] cannot equip unknown weapon "' + id + '"'); return; }
    if (weaponModel) { attach.remove(weaponModel); weaponModel = null; }
    weaponModel = EF.data.weapons.build(id);
    if (weaponModel) attach.add(weaponModel);
    currentWeaponId = id;
    currentWeaponDef = def;
  }

  /* single path: everything equips through the pre-approved weapon:equip
   * event (Contract v1.1 §4). Emitting it warns once until Engine Core adds
   * it to CANONICAL_EVENTS; that is expected. */
  bus.on('weapon:equip', function (p) {
    if (p && p.__selfTest) return;
    var id = p && (p.id || p.weapon);
    if (id) equip(id);
  });

  /* ----------------------------------------------- locomotion state ----- */
  var pstate = {
    x: 0, y: 0, z: 8, vy: 0, yaw: Math.PI,
    onGround: true, moving: false, speed: 0, walkPhase: 0,
    anim: 'idle'
  };

  function trySpendStamina(cost) {
    if (stats.st < cost) return false;
    stats.st -= cost;
    return true;
  }

  function alive() {
    return !(EF.combat && EF.combat.isPlayerDead && EF.combat.isPlayerDead());
  }

  function computeMove() {
    // engine input: move.y = +1 forward, camera-relative like the engine harness
    var mv = input.move, mx = mv.x, my = mv.y;
    var mag = Math.sqrt(mx * mx + my * my);
    pstate.moving = mag > MOVE_DEADZONE && alive();
    if (!pstate.moving) { pstate.speed = 0; return; }
    if (mag > 1) { mx /= mag; my /= mag; mag = 1; }
    var run = mag >= RUN_STICK;
    var spd = run ? RUN_SPEED : WALK_SPEED;
    pstate.speed = spd;

    var yaw = EF.engine.camera.yaw;
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // camera forward
    var rx = Math.cos(yaw), rz = -Math.sin(yaw);    // camera right
    var wx = fx * my + rx * mx;
    var wz = fz * my + rz * mx;
    var wlen = Math.sqrt(wx * wx + wz * wz) || 1;
    var dt = EF.engine.time.dt;
    pstate.x += (wx) * spd * dt;
    pstate.z += (wz) * spd * dt;
    pstate.x = Math.max(-200, Math.min(200, pstate.x));
    pstate.z = Math.max(-200, Math.min(200, pstate.z));
    pstate.yaw = Math.atan2(wx / wlen, wz / wlen);
    return run;
  }

  function jump() {
    if (!pstate.onGround || !alive()) return;
    if (!trySpendStamina(JUMP_STAMINA)) return;
    pstate.vy = JUMP_VELOCITY;
    pstate.onGround = false;
    bus.emit('audio:play', { sfx: 'jump' });
  }

  /* small state machine: pick state, then animate that state */
  function pickState(run) {
    if (!pstate.onGround) return pstate.vy > 0 ? 'jump' : 'fall';
    if (pstate.moving) return run ? 'run' : 'walk';
    return 'idle';
  }

  function animate(dt) {
    var a = pstate.anim;
    var armR = parts.armR, armL = parts.armL, legL = parts.legL, legR = parts.legR;
    var swing = EF.combat && EF.combat.getSwing ? EF.combat.getSwing() : null;

    if (a === 'walk' || a === 'run') {
      var freq = (a === 'run') ? 14 : 9;
      var amp = (a === 'run') ? 0.9 : 0.55;
      pstate.walkPhase += dt * freq;
      var s = Math.sin(pstate.walkPhase) * amp;
      legL.rotation.x = s; legR.rotation.x = -s;
      armL.rotation.x = -s * 0.8;
      if (!swing || !swing.active) armR.rotation.x = s * 0.8;
      parts.cloak.rotation.x = 0.12 + Math.abs(Math.cos(pstate.walkPhase)) * 0.10;
    } else if (a === 'jump' || a === 'fall') {
      var tuck = a === 'jump' ? 0.5 : -0.3;
      legL.rotation.x = tuck; legR.rotation.x = tuck * 0.6;
      armL.rotation.x = -0.6;
      if (!swing || !swing.active) armR.rotation.x = -0.4;
      parts.cloak.rotation.x = a === 'fall' ? 0.45 : -0.15;
    } else { // idle
      pstate.walkPhase *= 0.9;
      var breathe = Math.sin(EF.engine.time.elapsed * 1.6) * 0.04;
      legL.rotation.x *= 0.8; legR.rotation.x *= 0.8;
      armL.rotation.x = breathe;
      if (!swing || !swing.active) armR.rotation.x = -breathe;
      parts.cloak.rotation.x = 0.12 + breathe;
    }

    // combat drives the right arm during an active swing (overrides the above)
    if (swing && swing.active) {
      // swing.t01 runs 0..1 across the whole swing; chop peaks mid-active
      armR.rotation.x = -2.5 * Math.sin(Math.min(1, swing.t01) * Math.PI);
      armR.rotation.z = 0.15 * Math.sin(Math.min(1, swing.t01) * Math.PI);
    } else {
      armR.rotation.z *= 0.7;
    }
  }

  /* ------------------------------------------------------- per tick ----- */
  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    if (!root) return;
    var dt = t.dt;

    var run = computeMove();
    if (input.buttons.wasPressed('jump')) jump();

    // gravity
    var gh = groundAt(pstate.x, pstate.z);
    pstate.vy -= GRAVITY * dt;
    pstate.y += pstate.vy * dt;
    if (pstate.y <= gh) { pstate.y = gh; pstate.vy = 0; pstate.onGround = true; }

    // stamina regen
    if (stats.st < stats.maxst) stats.st = Math.min(stats.maxst, stats.st + STAMINA_REGEN * dt);

    // transform
    root.position.set(pstate.x, pstate.y, pstate.z);
    rig.rotation.y = pstate.yaw;
    parts.blob.position.y = gh - pstate.y + 0.03; // blob is child of root
    parts.blob.position.x = 0; parts.blob.position.z = 0;

    pstate.anim = pickState(run);
    animate(dt);
  });

  /* ----------------------------------------------------- spawn/boot ----- */
  function respawnAt(x, z) {
    pstate.x = x; pstate.z = z; pstate.vy = 0;
    pstate.y = groundAt(x, z); pstate.onGround = true;
    if (root) root.position.set(pstate.x, pstate.y, pstate.z);
    bus.emit('player:spawned', { position: { x: pstate.x, y: pstate.y, z: pstate.z } });
  }

  bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    buildRig();
    EF.engine.scene.add(root);
    equip('sword');                              // default weapon
    EF.engine.camera.setTarget(root);            // Combat: camera on player root
    pstate.y = groundAt(pstate.x, pstate.z);
    root.position.set(pstate.x, pstate.y, pstate.z);
    respawnAt(pstate.x, pstate.z);
  });

  /* ---------------------------------------------------- public API ------ */
  EF.player = {
    stats: stats,
    get root() { return root; },
    get position() { return pstate; },     // {x,y,z,yaw,...} read model
    getYaw: function () { return pstate.yaw; },
    isMoving: function () { return pstate.moving; },
    isAirborne: function () { return !pstate.onGround; },
    getWeapon: function () { return currentWeaponDef; },
    getWeaponId: function () { return currentWeaponId; },
    equip: function (id) { bus.emit('weapon:equip', { id: id }); },
    trySpendStamina: trySpendStamina,
    respawnAt: respawnAt
  };
})();
