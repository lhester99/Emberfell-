/* ============================================================================
 * EMBERFELL -- integration/state-adapter.js  (Integrator glue, build-05)
 * WHY THIS EXISTS: UI dept's ui.js/map.js READ an authoritative EF.state view
 * ({player, inventory, quests, tracked, interact}) that NO department
 * publishes, and ASK for changes via events (player:respawn, ui:track,
 * item:use) that NO department consumes. Without this adapter the HUD runs on
 * fallback dummy data, the map arrow never moves, and the death screen's
 * "Rise Again" button does nothing. This module bridges the two shipped
 * contracts using only public surfaces:
 *
 *   EF.state.player     <- EF.player.stats + EF.player.position (mirrored)
 *   EF.state.quests     <- EF.quests getState/progress/objectiveText,
 *                          rebuilt at EVENT rate (quest:*), not per frame
 *   EF.state.tracked    <- EF.quests.tracked
 *   EF.state.interact   <- EF.npcs.nearest() vs INTERACT_RADIUS (4 Hz)
 *   EF.state.inventory  <- ledger fed by loot:collected / item:use
 *   player:respawn      -> EF.combat.respawn()
 *   ui:track {id}       -> EF.quests.track(id)
 *   item:use {id|item}  -> potion: EF.combat.heal(POTION_HEAL) + decrement.
 *                          (heal() is combat.js's documented "UI/inventory
 *                          hook". POTION_HEAL=30 is a PLACEHOLDER constant --
 *                          Combat to ratify an item table in Cycle 4.)
 *
 * s7 discipline: per-tick work mutates the same objects (no allocation);
 * arrays are rebuilt only on quest/loot events. No rAF; rides game:tick.
 * OWNERSHIP: EF.state should belong to a gameplay dept (Player) -- this
 * module is TEMPORARY glue pending contract ratification (see CHANGELOG
 * AR-4/AR-5). Delete/replace when ownership lands.
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.bus || !EF.engine) { console.error('[EF.stateAdapter] engine.js must load first'); return; }
  var bus = EF.bus;

  var POTION_HEAL = 30; // placeholder -- Combat owns the real number (CR-7/AR-5)

  var state = {
    player: { hp: 100, maxhp: 100, st: 100, maxst: 100, xp: 0, xpNext: 100,
              lvl: 1, gold: 0, weapon: '-', x: 0, z: 8, yaw: 0 },
    inventory: [],
    equipped: null,
    quests: [],
    tracked: null,
    interact: { available: false, label: 'Talk' }
  };
  EF.state = state;

  /* ---------------- inventory ledger (event-fed) ------------------------- */
  var ITEM_NAMES = { potion: 'Healing Potion', herb: 'Glowing Herb',
                     pelt: 'Wolf Pelt', ember: 'Ember Shard' };
  function invFind(id) {
    for (var i = 0; i < state.inventory.length; i++) if (state.inventory[i].id === id) return state.inventory[i];
    return null;
  }
  function invAdd(id, n) {
    var it = invFind(id);
    if (it) { it.count += n; return; }
    state.inventory.push({
      id: id, name: ITEM_NAMES[id] || id,
      kind: id === 'potion' ? 'consumable' : 'material',
      count: n
    });
  }
  bus.on('loot:collected', function (p) {
    if (!p || p.__selfTest) return;
    if (p.item && p.item !== 'gold') invAdd(p.item, p.count || 1);
  });
  bus.on('item:use', function (p) {
    if (!p || p.__selfTest) return;
    var id = p.id || p.item;
    var it = id && invFind(id);
    if (!it || it.count < 1) return;
    if (id === 'potion') {
      if (EF.combat && EF.combat.isPlayerDead && EF.combat.isPlayerDead()) return;
      it.count--;
      if (EF.combat && EF.combat.heal) EF.combat.heal(POTION_HEAL);
      bus.emit('ui:toast', { text: '+' + POTION_HEAL + ' hp' });
      if (it.count <= 0) state.inventory.splice(state.inventory.indexOf(it), 1);
    }
    // other consumables: no gameplay owner yet -- ignored, counts preserved
  });

  /* ---------------- quest journal view (event-rate rebuild) -------------- */
  function questLine(id) {
    var lines = EF.quests.objectiveText(id);
    return lines.length ? lines.join(' | ') : (EF.questData.quests[id].blurb || '');
  }
  function rebuildQuests() {
    if (!EF.quests || !EF.questData) return;
    var out = [];
    var order = EF.questData.order;
    for (var i = 0; i < order.length; i++) {
      var id = order[i], st = EF.quests.getState(id);
      if (st === 'locked') continue;
      var q = EF.questData.quests[id];
      out.push({
        id: id, name: q.title,
        state: st === 'done' ? 'done' : (st === 'offerable' ? 'offered' : 'active'),
        progress: EF.quests.progress(id),
        line: st === 'offerable' ? (q.blurb || '') : questLine(id)
      });
    }
    state.quests = out;
  }
  ['quest:offered', 'quest:started', 'quest:updated', 'quest:completed'].forEach(function (ev) {
    bus.on(ev, function (p) { if (!p || !p.__selfTest) rebuildQuests(); });
  });

  /* ---------------- ASK-side glue ---------------------------------------- */
  bus.on('player:respawn', function (p) {
    if (p && p.__selfTest) return;
    if (EF.combat && EF.combat.respawn) EF.combat.respawn();
  });
  bus.on('ui:track', function (p) {
    if (!p || p.__selfTest || !p.id) return;
    if (EF.quests && EF.quests.track) EF.quests.track(p.id);
    rebuildQuests();
  });

  /* ---------------- per-tick mirror (mutate-in-place, no alloc) ----------- */
  var acc = 0;
  bus.on('game:tick', function (t) {
    if (t && t.__selfTest) return;
    var P = state.player;
    if (EF.player) {
      var s = EF.player.stats, pos = EF.player.position;
      P.hp = s.hp; P.maxhp = s.maxhp; P.st = s.st; P.maxst = s.maxst;
      P.xp = s.xp; P.xpNext = s.xpNext; P.lvl = s.lvl; P.gold = s.gold;
      P.x = pos.x; P.z = pos.z; P.yaw = pos.yaw;
      var w = EF.player.getWeapon();
      P.weapon = w ? w.name : '-';
      state.equipped = EF.player.getWeaponId();
    }
    if (EF.quests) state.tracked = EF.quests.tracked;

    acc += t.dt;                              // interact probe at 4 Hz
    if (acc < 0.25) return;
    acc = 0;
    if (EF.npcs && EF.npcs.nearest) {
      var near = EF.npcs.nearest();
      state.interact.available = !!(near && near.dist <= EF.npcs.INTERACT_RADIUS);
    }
  });

  /* [build-06] world.js has exposed setPlayerObject since Cycle 2 with the
   * note "(Combat: call this from your spawn path)" -- no module ever called
   * it, so pickup proximity collection AND Cycle 4's camera occlusion were
   * dead in every integrated build (the dept unit test injects the player
   * itself, masking the seam). Register the player root once it exists and
   * keep it registered across respawns. CR filed to Combat (CR-8). */
  function registerPlayerWithWorld() {
    if (EF.world && EF.world.setPlayerObject && EF.player && EF.player.root) {
      EF.world.setPlayerObject(EF.player.root);
    }
  }
  bus.on('player:spawned', function (p) {
    if (p && p.__selfTest) return;
    registerPlayerWithWorld();
  });

  bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    rebuildQuests();
    registerPlayerWithWorld();
  });

  console.log('[EF.stateAdapter] EF.state bridge active (TEMPORARY integrator glue)');
})();
