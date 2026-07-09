/* ============================================================================
 * EMBERFELL — combat.js  (Combat dept, Cycle 2)
 * THE math authority (Contract v1.1 §5): ALL damage, xp, gold, and level math
 * live here, and combat.js is the ONLY writer of hp — both the player's and
 * every enemy's. Owns swing timing (wind-up / active hit window / recover),
 * arc test, knockback, level-scaled crit, player:levelup with stat growth, and
 * damage-number emission for UI popups.
 *
 * Reads swing input, player pose/weapon, and enemy pool; writes hp and stats;
 * tells enemies.js to kill(), tells player.js to respawnAt(). Emits:
 *   enemy:died (via enemies.kill), player:damaged, player:died, player:levelup,
 *   loot:collected, ui:toast, camera:shake, audio:play, and combat:damage
 *   (floating damage numbers — pre-approval pending; warns once until Engine
 *   Core adds it to CANONICAL_EVENTS).
 *
 * Load order: LAST (after player.js and enemies.js). Depends on THREE (r128),
 * EF.engine (bus/input/audio/time/camera), EF.player, EF.enemies,
 * EF.data.weapons.
 * A-1 note: attack is tap-triggered via wasPressed('attack'); no hold/charge.
 * Delivery: raw .js text, ASCII quotes only (Contract v1.1 §2.5).
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.engine) { console.error('[EF.combat] engine.js must load before combat.js'); return; }
  var bus = EF.engine.bus, input = EF.engine.input;

  /* register combat sfx (engine ships jump/hit/hurt/pickup/ui.click already) */
  (function registerSfx() {
    var A = EF.engine.audio;
    A.register('swing.light', { type: 'sawtooth', freq: 520, freqEnd: 300, duration: 0.10, gain: 0.10 });
    A.register('swing.mid',   { type: 'sawtooth', freq: 300, freqEnd: 150, duration: 0.14, gain: 0.14 });
    A.register('swing.heavy', { type: 'sawtooth', freq: 180, freqEnd: 80,  duration: 0.22, gain: 0.18 });
    A.register('enemy.hit',   { type: 'square',   freq: 160, freqEnd: 70,  duration: 0.12, gain: 0.16 });
    A.register('crit',        { type: 'square',   freq: 900, freqEnd: 300, duration: 0.16, gain: 0.20 });
    A.register('levelup',     { type: 'triangle', freq: 440, freqEnd: 880, duration: 0.30, gain: 0.20 });
    A.register('loot.gold',   { type: 'square',   freq: 880, freqEnd: 1320,duration: 0.10, gain: 0.14 });
  })();

  function sfx(name) { bus.emit('audio:play', { sfx: name }); }

  /* ==================== LEVEL / STAT MATH ==================== */
  var CRIT_PER_LEVEL = 0.02, CRIT_CAP = 0.5, CRIT_MULT = 2.0;

  function critChance(weaponDef) {
    var s = EF.player.stats;
    var base = CRIT_PER_LEVEL * (s.lvl - 1) + (weaponDef ? weaponDef.critBonus : 0);
    return Math.max(0, Math.min(CRIT_CAP, base));
  }

  function rollDamage(weaponDef, crit) {
    var s = EF.player.stats;
    var lo = weaponDef.damage[0], hi = weaponDef.damage[1];
    var base = lo + Math.random() * (hi - lo);
    // player attack power (s.dmg) scales the weapon's base band
    var scaled = base * (s.dmg / 20);
    if (crit) scaled *= CRIT_MULT;
    return Math.round(scaled);
  }

  function gainXp(n) {
    var s = EF.player.stats;
    s.xp += n;
    while (s.xp >= s.xpNext) {
      s.xp -= s.xpNext;
      s.lvl++;
      s.xpNext = Math.floor(s.xpNext * 1.5);
      // stat growth
      s.maxhp += 20; s.hp = s.maxhp;          // heal to full on level
      s.maxst += 5;  s.st = s.maxst;
      s.dmg += 6;
      sfx('levelup');
      bus.emit('player:levelup', { level: s.lvl });
      bus.emit('ui:toast', { text: 'Level ' + s.lvl + '!' });
    }
  }

  function awardGold(min, max) {
    var s = EF.player.stats;
    var g = Math.floor(min + Math.random() * (max - min + 1));
    s.gold += g;
    sfx('loot.gold');
    bus.emit('loot:collected', { item: 'gold', count: g });
    return g;
  }

  /* ==================== ENEMY HP (combat is sole writer) ==================== */
  function damageEnemy(e, amount, crit, nx, nz, weaponDef) {
    e.hp -= amount;                             // <-- the ONLY enemy hp write
    bus.emit('combat:damage', {
      amount: amount, crit: !!crit, target: 'enemy',
      position: { x: e.x, y: groundAt(e.x, e.z) + (e.def.barY + 0.3), z: e.z }
    });
    EF.enemies.applyKnockback(e, nx, nz, weaponDef.knockback * (crit ? 1.5 : 1));
    if (e.hp <= 0 && e.alive) {
      EF.enemies.kill(e);                       // enemies.kill emits enemy:died
      gainXp(e.def.xp);
      awardGold(e.def.gold[0], e.def.gold[1]);
      if (Math.random() < e.def.potionChance) {
        bus.emit('loot:collected', { item: 'potion', count: 1 });
        bus.emit('ui:toast', { text: '+1 Potion' });
      }
    }
  }

  function groundAt(x, z) {
    if (EF.world && typeof EF.world.terrainH === 'function') return EF.world.terrainH(x, z);
    if (EF.engine && typeof EF.engine.groundAt === 'function') return EF.engine.groundAt(x, z);
    return 0;
  }

  /* ==================== SWING STATE MACHINE ==================== */
  var swing = { active: false, phase: 'idle', t: 0, t01: 0, weapon: null, id: 0, hitDone: false };

  function tryStartSwing() {
    if (swing.active || isPlayerDead) return;
    var w = EF.player.getWeapon();
    if (!w) return;
    if (!EF.player.trySpendStamina(w.stamina)) return;   // player owns stamina
    swing.active = true;
    swing.phase = 'windup';
    swing.t = 0; swing.t01 = 0;
    swing.weapon = w;
    swing.id++;
    swing.hitDone = false;
    sfx(w.sfx);
  }

  function updateSwing(dt) {
    if (!swing.active) return;
    var w = swing.weapon;
    var total = w.windup + w.active + w.recover;
    swing.t += dt;
    swing.t01 = Math.min(1, swing.t / total);

    if (swing.t < w.windup) {
      swing.phase = 'windup';
    } else if (swing.t < w.windup + w.active) {
      swing.phase = 'active';
      if (!swing.hitDone) { swing.hitDone = true; resolveHit(w); }  // hit window
    } else if (swing.t < total) {
      swing.phase = 'recover';
    } else {
      swing.active = false; swing.phase = 'idle'; swing.weapon = null;
    }
  }

  /* arc + reach test against the enemy pool. No allocation. */
  function resolveHit(w) {
    var pp = EF.player.position;
    var px = pp.x, pz = pp.z, yaw = pp.yaw;
    var fx = Math.sin(yaw), fz = Math.cos(yaw);       // player forward
    var cosHalf = Math.cos(w.arc * 0.5);
    var crit = Math.random() < critChance(w);
    var hitAny = false;
    var pool = EF.enemies.pool;

    for (var i = 0; i < pool.length; i++) {
      var e = pool[i];
      if (!e.alive || e._hitSwing === swing.id) continue;
      var dx = e.x - px, dz = e.z - pz;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > w.reach + e.def.contactRadius) continue;
      var nx = dx / (d || 1), nz = dz / (d || 1);
      var dot = nx * fx + nz * fz;
      if (dot < cosHalf) continue;                    // outside the arc
      e._hitSwing = swing.id;
      var dmg = rollDamage(w, crit);
      damageEnemy(e, dmg, crit, nx, nz, w);
      hitAny = true;
    }

    if (hitAny) {
      sfx(crit ? 'crit' : 'enemy.hit');
      // heavier weapons and crits sell weight with a small camera shake
      var shake = (crit ? 0.28 : 0.12) + w.knockback * 0.02;
      bus.emit('camera:shake', { intensity: Math.min(0.5, shake), duration: 0.18 });
    }
  }

  /* ==================== PLAYER HP (combat is sole writer) ==================== */
  var isPlayerDead = false;
  var hurtCd = 0;
  var IFRAMES = 0.6;

  function hurtPlayer(amount, sourceType) {
    if (isPlayerDead || hurtCd > 0) return;
    var s = EF.player.stats;
    hurtCd = IFRAMES;
    s.hp -= amount;                              // <-- the ONLY player hp write
    bus.emit('player:damaged', { amount: amount, source: sourceType || 'unknown' });
    bus.emit('combat:damage', {
      amount: amount, crit: false, target: 'player',
      position: { x: EF.player.position.x, y: EF.player.position.y + 2.2, z: EF.player.position.z }
    });
    sfx('hurt');
    if (s.hp <= 0) {
      s.hp = 0;
      isPlayerDead = true;
      bus.emit('player:died', { cause: sourceType || 'unknown' });
      bus.emit('ui:toast', { text: 'You died' });
    }
  }

  function respawn(x, z) {
    var s = EF.player.stats;
    isPlayerDead = false; hurtCd = IFRAMES + 0.6;
    s.hp = s.maxhp; s.st = s.maxst;
    EF.player.respawnAt(x != null ? x : 0, z != null ? z : 8);
  }

  function heal(amount) {
    if (isPlayerDead) return;
    var s = EF.player.stats;
    s.hp = Math.min(s.maxhp, s.hp + amount);
    bus.emit('combat:damage', {
      amount: amount, crit: false, target: 'heal',
      position: { x: EF.player.position.x, y: EF.player.position.y + 2.2, z: EF.player.position.z }
    });
  }

  /* ==================== TICK ==================== */
  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    var dt = t.dt;
    if (hurtCd > 0) hurtCd -= dt;
    if (input.buttons.wasPressed('attack')) tryStartSwing();
    updateSwing(dt);
  });

  /* ==================== PUBLIC API ==================== */
  EF.combat = {
    // read model for player.js arm animation (returns stable object, no alloc)
    getSwing: function () { return swing; },
    isPlayerDead: function () { return isPlayerDead; },
    // enemies.js calls this on a landed strike instead of touching player hp
    hurtPlayer: hurtPlayer,
    heal: heal,
    respawn: respawn,
    // exposed for UI/inventory hooks
    gainXp: gainXp,
    critChance: critChance
  };
})();
