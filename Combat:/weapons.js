/* ============================================================================
 * EMBERFELL — data/weapons.js  (Combat dept, Cycle 2)
 * Five weapons across the schema. Grip convention: every model is built with
 * the GRIP AT THE ORIGIN and the business end extending along +Y. player.js
 * parents the built group under the right-hand attach point; the hand does
 * all the swinging.
 *
 * Feel notes (Definition of Done, one sentence each):
 *  - dagger:     you flick it — instant, cheap, tiny reach, fishing for crits.
 *  - sword:      the honest middle — quick enough to react with, wide enough
 *                to trust.
 *  - axe:        a beat of commitment, then a heavy bite that shoves things
 *                back.
 *  - greatsword: you wind up like a door closing and everything in front of
 *                you regrets standing there.
 *  - mace:       short, slow, and rude — smallest arc, biggest shove.
 *
 * Depends on: THREE (r128). No engine dependency; pure data + factories.
 * Delivery: raw .js text, ASCII quotes only (Contract v1.1 §2.5).
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  EF.data = EF.data || {};

  function deg(d) { return d * Math.PI / 180; }

  /* ---- tiny mesh helpers (build-time only, never per-frame) ---- */
  function lam(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }
  function box(w, h, d, hex, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(hex));
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }
  function cyl(rTop, rBot, h, hex, x, y, z, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg || 6), lam(hex));
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }

  var STEEL = 0xb8c2cc, DARKSTEEL = 0x77808a, WOOD = 0x6b4a2b,
      LEATHER = 0x4a3320, BRASS = 0xc9a24b, IRON = 0x555c63;

  /* ---- model factories ---- */
  function buildDagger() {
    var g = new THREE.Group();
    g.add(box(0.045, 0.16, 0.045, LEATHER, 0, 0.02, 0));       // grip
    g.add(box(0.16, 0.03, 0.05, BRASS, 0, 0.11, 0));           // guard
    var blade = box(0.055, 0.34, 0.014, STEEL, 0, 0.29, 0);
    blade.scale.set(1, 1, 1);
    g.add(blade);
    g.add(box(0.03, 0.06, 0.02, STEEL, 0, 0.475, 0));          // tip taper
    return g;
  }

  function buildSword() {
    var g = new THREE.Group();
    g.add(box(0.05, 0.22, 0.05, LEATHER, 0, 0.03, 0));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), lam(BRASS))); // pommel at origin-ish
    g.children[1].position.set(0, -0.09, 0);
    g.add(box(0.26, 0.035, 0.06, BRASS, 0, 0.155, 0));
    g.add(box(0.075, 0.72, 0.018, STEEL, 0, 0.53, 0));
    g.add(box(0.04, 0.08, 0.016, STEEL, 0, 0.92, 0));
    return g;
  }

  function buildAxe() {
    var g = new THREE.Group();
    g.add(cyl(0.028, 0.034, 0.95, WOOD, 0, 0.38, 0));
    // head: broad wedge offset to +X
    g.add(box(0.30, 0.26, 0.05, IRON, 0.16, 0.78, 0));
    g.add(box(0.10, 0.34, 0.045, DARKSTEEL, 0.30, 0.78, 0));   // cutting edge
    g.add(box(0.08, 0.10, 0.06, IRON, -0.07, 0.78, 0));        // back spike
    return g;
  }

  function buildGreatsword() {
    var g = new THREE.Group();
    g.add(box(0.055, 0.34, 0.055, LEATHER, 0, 0.05, 0));       // two-hand grip
    g.add(box(0.09, 0.06, 0.09, BRASS, 0, -0.14, 0));          // pommel block
    g.add(box(0.42, 0.045, 0.07, DARKSTEEL, 0, 0.26, 0));      // big crossguard
    g.add(box(0.13, 1.15, 0.022, STEEL, 0, 0.86, 0));
    g.add(box(0.06, 0.14, 0.02, STEEL, 0, 1.49, 0));
    return g;
  }

  function buildMace() {
    var g = new THREE.Group();
    g.add(cyl(0.03, 0.035, 0.62, WOOD, 0, 0.24, 0));
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), lam(IRON));
    head.position.set(0, 0.62, 0);
    g.add(head);
    // studs
    var i, s;
    for (i = 0; i < 6; i++) {
      s = box(0.05, 0.05, 0.05, DARKSTEEL, 0, 0.62, 0);
      s.position.x = Math.cos(i * Math.PI / 3) * 0.15;
      s.position.z = Math.sin(i * Math.PI / 3) * 0.15;
      s.rotation.y = -i * Math.PI / 3;
      g.add(s);
    }
    return g;
  }

  /* ---- weapon schema ----
   * reach:   metres from player origin to arc edge
   * arc:     total horizontal swing arc (radians)
   * windup / active / recover:  seconds; hits only land during 'active'
   * damage:  [min, max] before level multiplier
   * stamina: cost per swing
   * knockback: impulse applied to hit enemies (m/s)
   * critBonus: added to the level-derived crit chance for this weapon
   */
  var DEFS = {
    dagger: {
      id: 'dagger', name: 'Rustpick Dagger',
      reach: 1.6, arc: deg(70),
      windup: 0.08, active: 0.10, recover: 0.14,
      damage: [3, 5], stamina: 7, knockback: 1.2, critBonus: 0.10,
      sfx: 'swing.light', build: buildDagger
    },
    sword: {
      id: 'sword', name: 'Pinewatch Sword',
      reach: 2.2, arc: deg(95),
      windup: 0.15, active: 0.12, recover: 0.22,
      damage: [5, 8], stamina: 12, knockback: 2.4, critBonus: 0.02,
      sfx: 'swing.mid', build: buildSword
    },
    axe: {
      id: 'axe', name: 'Forester Axe',
      reach: 2.0, arc: deg(110),
      windup: 0.24, active: 0.12, recover: 0.28,
      damage: [7, 11], stamina: 16, knockback: 3.6, critBonus: 0.03,
      sfx: 'swing.mid', build: buildAxe
    },
    greatsword: {
      id: 'greatsword', name: 'Emberfell Greatsword',
      reach: 2.9, arc: deg(150),
      windup: 0.36, active: 0.16, recover: 0.40,
      damage: [11, 16], stamina: 24, knockback: 4.8, critBonus: 0.0,
      sfx: 'swing.heavy', build: buildGreatsword
    },
    mace: {
      id: 'mace', name: 'Toll Mace',
      reach: 1.9, arc: deg(75),
      windup: 0.28, active: 0.10, recover: 0.32,
      damage: [9, 13], stamina: 18, knockback: 6.0, critBonus: 0.0,
      sfx: 'swing.heavy', build: buildMace
    }
  };

  var ORDER = ['dagger', 'sword', 'axe', 'greatsword', 'mace'];

  EF.data.weapons = {
    order: ORDER,
    get: function (id) { return DEFS[id] || null; },
    build: function (id) {
      var d = DEFS[id];
      if (!d) { console.warn('[EF.weapons] unknown weapon "' + id + '"'); return null; }
      return d.build();
    }
  };
})();
