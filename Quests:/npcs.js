/* ============================================================================
 * EMBERFELL - npcs.js  (Quests & NPCs dept, Cycle 3)
 * NPC registry + a shared low-poly humanoid factory (palette + accessory
 * variation), idle behaviours (face the player when near, wander a leash
 * radius, sit by the fire at night), and the dialogue RUNNER that executes
 * data/dialogue.js and resolves choices against EF.quests.
 *
 * Requires (load order): THREE r128, engine.js, world.js (pois/terrainH/
 * getTimePhase), data/questData.js, data/dialogue.js, quests.js. Reads
 * EF.player.position for proximity (guarded - degrades gracefully if absent).
 *
 * Contract v1.1 compliance:
 *   SS4 - emits dialogue:open / dialogue:close and listens for dialogue:choice
 *         (pre-approved SS4 additions); also emits quest:offered when an offer
 *         node opens, dialogue:ambient for idle barks, and audio:play. Ignores
 *         __selfTest payloads.
 *
 * Idle animation: subtle weight shift (foot-to-foot lean), a breathing bob, and
 * an occasional head turn toward the player when nearby (clamped, eased - not a
 * stiff full-body snap). NPCs also mutter ambient lines from dialogue.ambient
 * when the player is within earshot.
 *   SS5 - no private rAF loop; all motion runs off 'game:tick'. Models are
 *         built on 'game:booted'.
 *   SS2 - ASCII quotes; console.log/warn/error only; POI-anchored placement -
 *         NO literal world coordinates (offsets are relative to EF.world.pois).
 *
 * PUBLIC API (EF.npcs):
 *   list                 [npcId, ...]
 *   get(id)              runtime record { id, group, home, ... } or null
 *   interact()           open dialogue with the nearest NPC in range (or false)
 *   openWith(id)         force-open a specific NPC's dialogue
 *   choose(choiceId)     pick a choice in the open dialogue
 *   nearest()            { id, dist } of the closest NPC to the player, or null
 *   INTERACT_RADIUS      metres
 * ========================================================================= */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    console.error('[EF.npcs] THREE (r128) must load before npcs.js');
    return;
  }
  var EF = (window.EF = window.EF || {});
  if (!EF.bus || !EF.engine) { console.error('[EF.npcs] engine.js must load first'); return; }
  if (!EF.dialogue) { console.error('[EF.npcs] data/dialogue.js must load first'); return; }
  if (!EF.quests) { console.error('[EF.npcs] quests.js must load first'); return; }

  var bus = EF.bus;

  /* ---- placement: every NPC anchored to a POI + a small local offset ---
   * dx/dz are relative to the POI centre from EF.world.pois, never absolute
   * world coordinates. seatA is a ring angle around the village fire for the
   * "sit by the fire at night" behaviour (village folk only). */
  var DEFS = {
    maren: {
      name: 'Maren', poi: 'village', dx: 1.8, dz: 1.0, leash: 2.2, firesit: true, seatA: 0.4,
      palette: { skin: 0xd9b48a, cloth: 0x6a5a48, trim: 0x9a8a63, hair: 0xcfcabf },
      accessory: ['shawl', 'stick']
    },
    odda: {
      name: 'Odda', poi: 'village', dx: 4.4, dz: -4.4, leash: 3.0, firesit: true, seatA: 2.0,
      palette: { skin: 0xcaa079, cloth: 0x40613f, trim: 0x8fae5a, hair: 0x5a4630 },
      accessory: ['apron', 'satchel']
    },
    gethin: {
      name: 'Gethin', poi: 'village', dx: -6.2, dz: 0.6, leash: 2.6, firesit: true, seatA: 3.5,
      palette: { skin: 0xc79a70, cloth: 0x3f4a63, trim: 0x6d7686, hair: 0x9a958c },
      accessory: ['staff']
    },
    corin: {
      name: 'Corin', poi: 'village', dx: 5.6, dz: 2.0, leash: 3.4, firesit: true, seatA: 5.1,
      palette: { skin: 0xd2a882, cloth: 0x7a6a3f, trim: 0xb0a05a, hair: 0x2f2822 },
      accessory: ['satchel']
    },
    talia: {
      name: 'Talia', poi: 'arch', dx: -1.4, dz: -1.2, leash: 2.4, firesit: false, seatA: 0,
      palette: { skin: 0xd8ac86, cloth: 0x7a4340, trim: 0xb06a4a, hair: 0x3a2a22 },
      accessory: ['hood', 'satchel']
    }
  };

  var ORDER = ['maren', 'odda', 'gethin', 'corin', 'talia'];

  var api = {
    list: ORDER.slice(),
    INTERACT_RADIUS: 4.0,
    _npcs: Object.create(null)
  };
  EF.npcs = api;

  /* ------------------------------------------------------- ground helper */
  function groundAt(x, z) {
    if (EF.world && typeof EF.world.terrainH === 'function') return EF.world.terrainH(x, z);
    return EF.engine.groundAt(x, z);
  }
  function poiById(id) {
    var pois = (EF.world && EF.world.pois) || [];
    for (var i = 0; i < pois.length; i++) if (pois[i].id === id) return pois[i];
    return null;
  }

  /* ===================================================================== *
   * HUMANOID FACTORY - one shared builder, palette + accessory variation.
   * Stands on y=0, faces +Z (same convention as enemyTypes). Returns
   * { group, parts:{legL, legR, armL, armR, torso, head} }.
   * ===================================================================== */
  var GEO = {
    torso: new THREE.BoxGeometry(0.52, 0.72, 0.30),
    head: new THREE.BoxGeometry(0.34, 0.34, 0.32),
    limb: new THREE.BoxGeometry(0.16, 0.62, 0.16),
    leg: new THREE.BoxGeometry(0.18, 0.66, 0.18),
    cap: new THREE.BoxGeometry(0.38, 0.16, 0.36),
    apron: new THREE.BoxGeometry(0.46, 0.5, 0.08),
    satchel: new THREE.BoxGeometry(0.26, 0.30, 0.14),
    shawl: new THREE.BoxGeometry(0.62, 0.24, 0.40),
    hood: new THREE.BoxGeometry(0.42, 0.40, 0.42),
    stick: new THREE.CylinderGeometry(0.035, 0.045, 1.5, 6),
    staff: new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6),
    strap: new THREE.BoxGeometry(0.05, 0.5, 0.05)
  };
  var ACC_COL = { satchel: 0x5a4632, strap: 0x3f3223, apronTrim: 0xece3d0, wood: 0x6b4a2b, steel: 0xb8c2cc };

  function lam(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }
  function mesh(geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }
  function pivot(x, y, z) { var g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g; }

  function buildHumanoid(pal, accessories) {
    var g = new THREE.Group();
    var mCloth = lam(pal.cloth), mSkin = lam(pal.skin), mTrim = lam(pal.trim), mHair = lam(pal.hair);

    // torso + belt trim
    g.add(mesh(GEO.torso, mCloth, 0, 1.16, 0));
    g.add(mesh(new THREE.BoxGeometry(0.54, 0.10, 0.32), mTrim, 0, 0.86, 0)); // belt

    // head + hair cap + face dab, all on a neck pivot so the head turns as one
    var headPivot = pivot(0, 1.66, 0);
    var head = mesh(GEO.head, mSkin, 0, 0, 0);
    headPivot.add(head);
    headPivot.add(mesh(GEO.cap, mHair, 0, 0.14, 0));                        // hair
    headPivot.add(mesh(new THREE.BoxGeometry(0.30, 0.10, 0.04), lam(0x2a2018), 0, -0.04, 0.16)); // brow shadow
    g.add(headPivot);

    // arms (shoulders ~1.5), hang -Y so a pivot at the shoulder swings them
    var armL = pivot(-0.34, 1.50, 0), armR = pivot(0.34, 1.50, 0);
    armL.add(mesh(GEO.limb, mCloth, 0, -0.31, 0));
    armR.add(mesh(GEO.limb, mCloth, 0, -0.31, 0));
    // hands
    armL.add(mesh(new THREE.BoxGeometry(0.17, 0.14, 0.17), mSkin, 0, -0.62, 0));
    armR.add(mesh(new THREE.BoxGeometry(0.17, 0.14, 0.17), mSkin, 0, -0.62, 0));
    g.add(armL); g.add(armR);

    // legs (hips ~0.82), pivots for the walk/idle sway
    var legL = pivot(-0.14, 0.82, 0), legR = pivot(0.14, 0.82, 0);
    legL.add(mesh(GEO.leg, mTrim, 0, -0.33, 0));
    legR.add(mesh(GEO.leg, mTrim, 0, -0.33, 0));
    g.add(legL); g.add(legR);

    // ---- accessories -----------------------------------------------------
    var acc = accessories || [];
    for (var i = 0; i < acc.length; i++) {
      switch (acc[i]) {
        case 'apron':
          g.add(mesh(GEO.apron, mTrim, 0, 1.02, 0.17));
          break;
        case 'shawl':
          g.add(mesh(GEO.shawl, mTrim, 0, 1.44, 0));
          break;
        case 'hood':
          g.add(mesh(GEO.hood, mCloth, 0, 1.72, -0.02));
          break;
        case 'satchel':
          g.add(mesh(GEO.satchel, lam(ACC_COL.satchel), 0.30, 1.06, -0.02));
          g.add(mesh(GEO.strap, lam(ACC_COL.strap), 0.02, 1.36, 0.10)); // diagonal-ish strap
          break;
        case 'stick':
          var st = mesh(GEO.stick, lam(ACC_COL.wood), 0, -0.14, 0);
          armR.add(st); // held in right hand
          break;
        case 'staff':
          var sf = mesh(GEO.staff, lam(ACC_COL.wood), 0, -0.28, 0);
          armR.add(sf);
          armR.add(mesh(new THREE.BoxGeometry(0.10, 0.14, 0.10), lam(ACC_COL.steel), 0, -1.22, 0)); // spearhead
          break;
      }
    }

    return { group: g, parts: { legL: legL, legR: legR, armL: armL, armR: armR, torso: g.children[0], head: headPivot } };
  }

  /* ===================================================================== *
   * REGISTRY + PLACEMENT
   * ===================================================================== */
  var TMP_TARGET = { x: 0, z: 0 };

  function placeNpc(id) {
    var d = DEFS[id];
    var poi = poiById(d.poi);
    if (!poi) { console.warn('[EF.npcs] no poi "' + d.poi + '" for ' + id); return null; }
    var hx = poi.x + d.dx, hz = poi.z + d.dz;

    var built = buildHumanoid(d.palette, d.accessory);
    var grp = built.group;
    grp.position.set(hx, groundAt(hx, hz), hz);
    grp.rotation.y = Math.atan2(poi.x - hx, poi.z - hz); // face the POI centre to start

    EF.engine.scene.add(grp);

    // fire seat (village folk) - ring around the flame at the village centre
    var vpoi = poiById('village');
    var seat = null;
    if (d.firesit && vpoi) {
      seat = { x: vpoi.x + Math.cos(d.seatA) * 2.3, z: vpoi.z + Math.sin(d.seatA) * 2.3, a: d.seatA };
    }

    return {
      id: id, name: d.name, def: d, group: grp, parts: built.parts,
      home: { x: hx, z: hz }, seat: seat, leash: d.leash,
      wander: { x: hx, z: hz }, waitT: 1 + Math.random() * 2,
      moving: false, sitting: false, swayPhase: Math.random() * 6.28,
      legAmt: 0, yaw: grp.rotation.y, talking: false,
      // idle animation state
      shiftPhase: Math.random() * 6.28,   // weight-shift oscillator
      headYaw: 0,                          // current eased head turn (local)
      glanceHold: 0,                       // seconds left in a head-glance
      glanceCd: 1 + Math.random() * 4,     // seconds until the next glance
      // ambient chatter
      ambientCd: 4 + Math.random() * 10
    };
  }

  /* ===================================================================== *
   * IDLE AI (per game:tick)
   * ===================================================================== */
  var MOVE_SPEED = 0.8;      // m/s stroll
  var NOTICE = 5.5;          // face-player radius
  var _v = { x: 0, z: 0 };

  function faceToward(n, tx, tz) {
    var dx = tx - n.group.position.x, dz = tz - n.group.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    var want = Math.atan2(dx, dz);
    // shortest-arc ease
    var diff = want - n.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    n.yaw += diff * 0.18;
    n.group.rotation.y = n.yaw;
  }

  function stepToward(n, tx, tz, dt) {
    var dx = tx - n.group.position.x, dz = tz - n.group.position.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.15) { n.moving = false; return true; }
    var s = MOVE_SPEED * dt;
    if (s > d) s = d;
    var nx = n.group.position.x + (dx / d) * s;
    var nz = n.group.position.z + (dz / d) * s;
    n.group.position.set(nx, groundAt(nx, nz), nz);
    faceToward(n, tx, tz);
    n.moving = true;
    return false;
  }

  function updateNpc(n, dt, elapsed) {
    var pos = EF.player && EF.player.position;
    var phase = EF.world && EF.world.getTimePhase ? EF.world.getTimePhase() : 'day';
    var night = (phase === 'night');

    var pdist2 = Infinity;
    if (pos) { var ax = pos.x - n.group.position.x, az = pos.z - n.group.position.z; pdist2 = ax * ax + az * az; }
    var near = pos && pdist2 < NOTICE * NOTICE;

    updateAmbient(n, dt, pos);

    if (n.talking && pos) {
      // frozen mid-conversation: face the player squarely, head centred
      faceToward(n, pos.x, pos.z);
      n.moving = false;
      updateHeadGlance(n, dt, pos, false);
      animateLimbs(n, dt, elapsed, false);
      return;
    }

    if (night && n.seat) {
      // head to the fire and sit; still glance up when the player is near
      var atSeat = stepToward(n, n.seat.x, n.seat.z, dt);
      if (atSeat) {
        if (!n.sitting) { n.sitting = true; sitPose(n, true); }
        faceToward(n, poiById('village').x, poiById('village').z);
      }
      updateHeadGlance(n, dt, pos, near && !!atSeat);
      animateLimbs(n, dt, elapsed, n.moving);
      return;
    }

    // daytime (or seat-less NPC at night): stand up if we were sitting
    if (n.sitting && !night) { n.sitting = false; sitPose(n, false); }

    if (near) {
      // player nearby: stop the stroll, stay in a relaxed idle, and let the
      // HEAD occasionally turn toward them (not a stiff full-body snap).
      n.moving = false;
      updateHeadGlance(n, dt, pos, true);
      animateLimbs(n, dt, elapsed, false);
      return;
    }

    // wander within the leash of home; head eases back to centre
    n.waitT -= dt;
    var tx = n.wander.x, tz = n.wander.z;
    var done = stepToward(n, tx, tz, dt);
    if (done) {
      if (n.waitT <= 0) {
        var a = Math.random() * Math.PI * 2;
        var r = Math.random() * n.leash;
        n.wander.x = n.home.x + Math.cos(a) * r;
        n.wander.z = n.home.z + Math.sin(a) * r;
        n.waitT = 1.5 + Math.random() * 3.5;
      }
    }
    updateHeadGlance(n, dt, pos, false);
    animateLimbs(n, dt, elapsed, n.moving);
  }

  /* Occasional head turn toward the player. While 'near', a glance fires every
   * few seconds and holds briefly; otherwise the head eases back to centre.
   * Head yaw is clamped so nobody cranes their neck past a natural look. */
  function updateHeadGlance(n, dt, pos, near) {
    if (near && pos) {
      if (n.glanceHold > 0) { n.glanceHold -= dt; }
      else {
        n.glanceCd -= dt;
        if (n.glanceCd <= 0) { n.glanceHold = 0.9 + Math.random() * 1.6; n.glanceCd = 3 + Math.random() * 5; }
      }
    } else {
      n.glanceHold = 0;
    }
    var target = 0;
    if (n.glanceHold > 0 && pos) {
      var want = Math.atan2(pos.x - n.group.position.x, pos.z - n.group.position.z);
      var local = want - n.yaw;
      while (local > Math.PI) local -= Math.PI * 2;
      while (local < -Math.PI) local += Math.PI * 2;
      if (local > 0.7) local = 0.7; else if (local < -0.7) local = -0.7;
      target = local;
    }
    n.headYaw += (target - n.headYaw) * Math.min(1, dt * 5);
    n.parts.head.rotation.y = n.headYaw;
  }

  /* Ambient chatter: when the player is within earshot, an NPC occasionally
   * mutters a line from its dialogue.ambient pool. Emitted as dialogue:ambient
   * (a UI bark hook); never fires over an open dialogue modal. */
  var HEAR = 7.0;
  function updateAmbient(n, dt, pos) {
    var tree = EF.dialogue.npc[n.id];
    if (!tree || !tree.ambient || !tree.ambient.length || _open || !pos) return;
    var dx = pos.x - n.group.position.x, dz = pos.z - n.group.position.z;
    if (dx * dx + dz * dz > HEAR * HEAR) return;
    n.ambientCd -= dt;
    if (n.ambientCd > 0) return;
    var line = tree.ambient[(Math.random() * tree.ambient.length) | 0];
    bus.emit('dialogue:ambient', { npc: n.id, speaker: tree.name, text: line });
    n.ambientCd = 9 + Math.random() * 10;
  }

  function animateLimbs(n, dt, elapsed, moving) {
    // ease leg-swing amplitude toward moving state
    var target = moving ? 1 : 0;
    n.legAmt += (target - n.legAmt) * Math.min(1, dt * 8);
    if (n.sitting) return; // sit pose owns the body
    n.swayPhase += dt * (moving ? 8 : 2.2);
    var s = Math.sin(n.swayPhase) * (0.5 * n.legAmt + 0.03);
    n.parts.legL.rotation.x = s;
    n.parts.legR.rotation.x = -s;
    n.parts.armL.rotation.x = -s * 0.7;
    n.parts.armR.rotation.x = s * 0.7;
    // subtle weight shift foot-to-foot (fades out while walking)
    n.shiftPhase += dt * 0.6;
    var wob = Math.sin(n.shiftPhase) * (1 - n.legAmt * 0.7);
    n.parts.torso.rotation.z = wob * 0.05;
    n.parts.torso.position.x = wob * 0.03;
    // gentle breathing bob
    n.parts.torso.position.y = 1.16 + Math.sin(elapsed * 1.6 + n.swayPhase * 0.1) * 0.012;
  }

  function sitPose(n, on) {
    if (on) {
      n.parts.legL.rotation.x = 1.25; n.parts.legR.rotation.x = 1.25;
      n.parts.armL.rotation.x = 0.4; n.parts.armR.rotation.x = 0.4;
      n.parts.torso.rotation.z = 0; n.parts.torso.position.x = 0;
      n.group.position.y = groundAt(n.group.position.x, n.group.position.z) - 0.32;
    } else {
      n.parts.legL.rotation.x = 0; n.parts.legR.rotation.x = 0;
      n.parts.armL.rotation.x = 0; n.parts.armR.rotation.x = 0;
      n.group.position.y = groundAt(n.group.position.x, n.group.position.z);
    }
  }

  /* ===================================================================== *
   * DIALOGUE RUNNER
   * ===================================================================== */
  var _open = null; // { npcId, nodeId, choices:[choiceObj] }

  function entryNode(npcId) {
    var tree = EF.dialogue.npc[npcId];
    if (!tree) return null;
    var br = tree.branches || [];
    for (var i = 0; i < br.length; i++) {
      if (EF.quests.getState(br[i].quest) === br[i].state) return br[i].node;
    }
    return tree.fallback;
  }

  function openNode(npcId, nodeId) {
    var tree = EF.dialogue.npc[npcId];
    var node = tree && tree.nodes[nodeId];
    if (!node) { console.warn('[EF.npcs] missing dialogue node ' + npcId + '/' + nodeId); return; }

    // announce an offer so UI/analytics can react
    for (var c = 0; c < node.choices.length; c++) {
      if (node.choices[c].action === 'accept' && node.choices[c].quest) {
        bus.emit('quest:offered', { id: node.choices[c].quest });
        break;
      }
    }

    _open = { npcId: npcId, nodeId: nodeId, choices: node.choices };
    var out = [];
    for (var i = 0; i < node.choices.length; i++) out.push({ id: i, label: node.choices[i].label });
    bus.emit('dialogue:open', { npc: npcId, speaker: tree.name, text: node.text, choices: out });
  }

  function closeDialogue() {
    var was = _open ? _open.npcId : null;
    _open = null;
    var n = was && api._npcs[was];
    if (n) n.talking = false;
    bus.emit('dialogue:close', { npc: was });
  }

  api.openWith = function (npcId) {
    var n = api._npcs[npcId];
    if (n) n.talking = true;
    openNode(npcId, entryNode(npcId));
  };

  api.nearest = function () {
    var pos = EF.player && EF.player.position;
    if (!pos) return null;
    var best = null, bestD = Infinity;
    for (var id in api._npcs) {
      var g = api._npcs[id].group.position;
      var dx = pos.x - g.x, dz = pos.z - g.z, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best ? { id: best, dist: Math.sqrt(bestD) } : null;
  };

  api.interact = function () {
    var near = api.nearest();
    if (!near || near.dist > api.INTERACT_RADIUS) return false;
    api.openWith(near.id);
    return true;
  };

  api.choose = function (choiceId) {
    if (!_open) return;
    var choice = _open.choices[choiceId];
    if (!choice) return;
    var npcId = _open.npcId;

    switch (choice.action) {
      case 'accept':
        EF.quests.accept(choice.quest);
        closeDialogue();
        break;
      case 'turnIn':
        EF.quests.turnIn(choice.quest, npcId);
        closeDialogue();
        break;
      case 'goto':
        openNode(npcId, choice.node); // gossip / branch walk, stays open
        break;
      case 'close':
      default:
        closeDialogue();
        break;
    }
  };

  // UI dept emits dialogue:choice; we also expose EF.npcs.choose directly.
  bus.on('dialogue:choice', function (p) {
    if (!p || p.__selfTest) return;
    api.choose(p.choiceId != null ? p.choiceId : p.id);
  });

  api.get = function (id) { return api._npcs[id] || null; };

  /* ===================================================================== *
   * BOOT + TICK
   * ===================================================================== */
  bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    if (!EF.world || !EF.world.pois || !EF.world.pois.length) {
      console.warn('[EF.npcs] world POIs not present at boot; NPCs not placed');
      return;
    }
    for (var i = 0; i < ORDER.length; i++) {
      var n = placeNpc(ORDER[i]);
      if (n) api._npcs[ORDER[i]] = n;
    }
    // desktop convenience: E opens the nearest NPC. UI should instead call
    // EF.npcs.interact() from its own interact button (or bindButton).
    try { EF.engine.input.bindKey('KeyE', 'interact'); } catch (e) { /* optional */ }
    console.log('[EF.npcs] placed ' + Object.keys(api._npcs).length + ' NPCs');
  });

  bus.on('game:tick', function (t) {
    if (!t || t.__selfTest) return;
    if (EF.engine.input && EF.engine.input.buttons &&
        EF.engine.input.buttons.wasPressed('interact')) {
      api.interact();
    }
    for (var id in api._npcs) updateNpc(api._npcs[id], t.dt, t.elapsed);
  });

  console.log('[EF.npcs] ready');
})();
