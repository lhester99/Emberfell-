/* ============================================================================
 * EMBERFELL — data/enemyTypes.js  (Combat dept, Cycle 2)
 * Four enemy types + reusable low-poly mesh factories, one AI wrinkle each.
 *
 *   wolf      — circles the player, darts in.        (pack skirmisher)
 *   skeleton  — slow, tanky, heavy telegraph.        (attrition)
 *   bandit    — keeps distance, then lunges.          (kiter)
 *   troll     — rare, huge HP, slow wander, big hit.  (miniboss)
 *
 * Each factory returns { group, parts } where `parts` names the nodes
 * enemies.js animates (leg pivots for the walk cycle, a `telegraph` node it
 * rotates during wind-up). Grip/leg convention: models stand on y=0, face +Z
 * before enemies.js applies yaw. No engine dependency; pure data + factories.
 * Delivery: raw .js text, ASCII quotes only (Contract v1.1 §2.5).
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  EF.data = EF.data || {};

  function lam(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }
  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }
  function pivot(x, y, z) {
    var g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    return g;
  }

  /* shared materials (built once, reused across every instance in the pool) */
  var MAT = {
    wolfFur:  lam(0x53504e),
    wolfDark: lam(0x393735),
    bone:     lam(0xd9d4c4),
    boneDark: lam(0x9c988a),
    banditCloak: lam(0x3a2d24),
    banditSkin:  lam(0xc79a70),
    steel:    lam(0xb8c2cc),
    trollHide: lam(0x5c6e46),
    trollDark: lam(0x44532f),
    club:     lam(0x6b4a2b),
    eye:      lam(0xffcf5a)
  };

  /* -------------------------------------------------------------- wolf --- */
  function buildWolf() {
    var g = new THREE.Group();
    var body = box(1.30, 0.60, 0.55, MAT.wolfFur, 0, 0.70, 0);
    g.add(body);
    // head faces +Z (forward)
    var head = box(0.46, 0.42, 0.46, MAT.wolfFur, 0, 0.86, 0.78);
    var snout = box(0.22, 0.20, 0.26, MAT.wolfDark, 0, 0.80, 1.02);
    var earL = box(0.10, 0.16, 0.06, MAT.wolfDark, -0.14, 1.10, 0.72);
    var earR = box(0.10, 0.16, 0.06, MAT.wolfDark, 0.14, 1.10, 0.72);
    g.add(head); g.add(snout); g.add(earL); g.add(earR);
    var tail = box(0.16, 0.16, 0.52, MAT.wolfDark, 0, 0.78, -0.80);
    tail.rotation.x = 0.5; g.add(tail);
    // four leg pivots at the hips, legs hang -Y
    function leg(x, z) {
      var p = pivot(x, 0.44, z);
      p.add(box(0.16, 0.44, 0.16, MAT.wolfDark, 0, -0.22, 0));
      g.add(p); return p;
    }
    var fl = leg(-0.34, 0.42), fr = leg(0.34, 0.42),
        bl = leg(-0.34, -0.42), br = leg(0.34, -0.42);
    return { group: g, parts: { legs: [fl, fr, bl, br], head: head, telegraph: head } };
  }

  /* ---------------------------------------------------------- skeleton --- */
  function buildSkeleton() {
    var g = new THREE.Group();
    g.add(box(0.42, 0.10, 0.26, MAT.bone, 0, 1.55, 0));        // shoulders
    // ribcage as stacked thin slats
    var i;
    for (i = 0; i < 3; i++) g.add(box(0.36, 0.06, 0.22, MAT.boneDark, 0, 1.30 - i * 0.16, 0));
    g.add(box(0.10, 0.44, 0.10, MAT.bone, 0, 1.10, 0));        // spine
    g.add(box(0.20, 0.16, 0.16, MAT.bone, 0, 0.94, 0));        // pelvis
    var skull = box(0.30, 0.34, 0.30, MAT.bone, 0, 1.82, 0);
    g.add(skull);
    g.add(box(0.06, 0.06, 0.04, MAT.eye, -0.07, 1.84, 0.16));  // eye glints
    g.add(box(0.06, 0.06, 0.04, MAT.eye, 0.07, 1.84, 0.16));
    function limb(x, y, len, mat) {
      var p = pivot(x, y, 0);
      p.add(box(0.12, len, 0.12, mat, 0, -len / 2, 0));
      g.add(p); return p;
    }
    var armL = limb(-0.30, 1.52, 0.70, MAT.bone),
        armR = limb(0.30, 1.52, 0.70, MAT.bone),
        legL = limb(-0.14, 0.92, 0.86, MAT.boneDark),
        legR = limb(0.14, 0.92, 0.86, MAT.boneDark);
    return { group: g, parts: { legL: legL, legR: legR, armL: armL, armR: armR, telegraph: armR } };
  }

  /* ------------------------------------------------------------ bandit --- */
  function buildBandit() {
    var g = new THREE.Group();
    var torso = box(0.62, 0.90, 0.38, MAT.banditCloak, 0, 1.20, 0);
    g.add(torso);
    var hood = box(0.40, 0.40, 0.40, MAT.banditCloak, 0, 1.80, 0);
    g.add(hood);
    g.add(box(0.24, 0.14, 0.10, MAT.banditSkin, 0, 1.72, 0.20)); // shadowed face
    // cloak flare (widens the silhouette)
    var flare = box(0.72, 0.50, 0.12, MAT.banditCloak, 0, 0.85, -0.14);
    g.add(flare);
    function limb(x, y, len, mat) {
      var p = pivot(x, y, 0);
      p.add(box(0.16, len, 0.16, mat, 0, -len / 2, 0));
      g.add(p); return p;
    }
    var armL = limb(-0.42, 1.60, 0.72, MAT.banditCloak),
        armR = limb(0.42, 1.60, 0.72, MAT.banditCloak),
        legL = limb(-0.18, 0.80, 0.80, MAT.banditCloak),
        legR = limb(0.18, 0.80, 0.80, MAT.banditCloak);
    // dagger in right hand
    var dag = box(0.06, 0.42, 0.05, MAT.steel, 0, -0.85, 0.06);
    armR.add(dag);
    return { group: g, parts: { legL: legL, legR: legR, armL: armL, armR: armR, telegraph: armR } };
  }

  /* ------------------------------------------------------------- troll --- */
  function buildTroll() {
    var g = new THREE.Group();
    var torso = box(1.50, 1.60, 1.10, MAT.trollHide, 0, 2.10, 0);
    torso.rotation.x = 0.18; g.add(torso);                     // hunched
    var head = box(0.80, 0.72, 0.80, MAT.trollHide, 0, 3.05, 0.30);
    g.add(head);
    g.add(box(0.60, 0.30, 0.20, MAT.trollDark, 0, 2.90, 0.66)); // heavy brow/jaw
    function limb(x, y, w, len, mat) {
      var p = pivot(x, y, 0);
      p.add(box(w, len, w, mat, 0, -len / 2, 0));
      g.add(p); return p;
    }
    var armL = limb(-0.95, 2.70, 0.40, 1.50, MAT.trollHide),
        armR = limb(0.95, 2.70, 0.40, 1.50, MAT.trollHide),
        legL = limb(-0.42, 1.30, 0.46, 1.30, MAT.trollDark),
        legR = limb(0.42, 1.30, 0.46, 1.30, MAT.trollDark);
    // big club in right fist
    var club = new THREE.Group();
    club.add(box(0.24, 1.30, 0.24, MAT.club, 0, -1.05, 0));
    club.add(box(0.52, 0.52, 0.52, MAT.trollDark, 0, -1.70, 0));
    club.position.y = -1.50; armR.add(club);
    return { group: g, parts: { legL: legL, legR: legR, armL: armL, armR: armR, telegraph: armR } };
  }

  /* -------------------------------------------------------------- defs --- *
   * Combat reads: maxhp, contactRadius, xp, gold[], damage, attackRange,
   * windup/strike/recover/cooldown (telegraph timing), aggro, speed, wrinkle.
   * enemies.js reads: build, speeds, ranges, wrinkle, walkFreq, bar offset.
   * -------------------------------------------------------------------- */
  var DEFS = {
    wolf: {
      id: 'wolf', name: 'Timber Wolf', build: buildWolf,
      maxhp: 40, contactRadius: 0.8, speed: 4.4, aggro: 17,
      attackRange: 2.0, damage: 8, windup: 0.30, strike: 0.10, recover: 0.25, cooldown: 0.9,
      xp: 20, gold: [5, 15], potionChance: 0.20,
      walkFreq: 12, barY: 1.7, wrinkle: 'circle',
      // wrinkle params
      orbitRadius: 3.4, orbitSpeed: 1.6, lungeRange: 3.0
    },
    skeleton: {
      id: 'skeleton', name: 'Risen Bones', build: buildSkeleton,
      maxhp: 90, contactRadius: 0.55, speed: 1.9, aggro: 15,
      attackRange: 2.1, damage: 14, windup: 0.55, strike: 0.14, recover: 0.35, cooldown: 1.3,
      xp: 35, gold: [8, 20], potionChance: 0.30,
      walkFreq: 5, barY: 2.15, wrinkle: 'tank'
    },
    bandit: {
      id: 'bandit', name: 'Road Bandit', build: buildBandit,
      maxhp: 55, contactRadius: 0.55, speed: 3.6, aggro: 18,
      attackRange: 2.0, damage: 11, windup: 0.22, strike: 0.10, recover: 0.30, cooldown: 1.1,
      xp: 30, gold: [12, 26], potionChance: 0.25,
      walkFreq: 9, barY: 2.05, wrinkle: 'kite',
      // wrinkle params
      keepDistance: 6.0, lungeRange: 7.0, lungeSpeed: 11.0, lungeTime: 0.35, retreatSpeed: 4.2
    },
    troll: {
      id: 'troll', name: 'Fellmoor Troll', build: buildTroll,
      maxhp: 320, contactRadius: 1.2, speed: 2.2, aggro: 20,
      attackRange: 3.0, damage: 28, windup: 0.80, strike: 0.18, recover: 0.55, cooldown: 1.6,
      xp: 150, gold: [60, 120], potionChance: 0.9,
      walkFreq: 4, barY: 3.5, wrinkle: 'wander'
    }
  };

  /* ---- spawn roster / zones by biome ----
   * count = how many instances live in the pool (this is the pool size per
   * type; respawn recycles in place, never allocates). Zones are circular
   * regions tagged by biome; if EF.world.biomeAt(x,z) exists later, enemies.js
   * can filter by live biome, otherwise it uses these static zones. Troll is
   * rare: a single instance with a wide, remote zone. */
  var ROSTER = [
    { type: 'wolf',     count: 6, biome: 'pineForest', zone: { cx: 0,   cz: -60, r: 90 } },
    { type: 'skeleton', count: 4, biome: 'barrows',    zone: { cx: 60,  cz: -70, r: 55 } },
    { type: 'bandit',   count: 3, biome: 'road',       zone: { cx: -50, cz: 20,  r: 70 } },
    { type: 'troll',    count: 1, biome: 'fellmoor',   zone: { cx: 110, cz: -110, r: 60 } }
  ];

  EF.data.enemyTypes = {
    order: ['wolf', 'skeleton', 'bandit', 'troll'],
    roster: ROSTER,
    get: function (id) { return DEFS[id] || null; },
    build: function (id) {
      var d = DEFS[id];
      if (!d) { console.warn('[EF.enemyTypes] unknown type "' + id + '"'); return null; }
      return d.build();
    }
  };
})();
