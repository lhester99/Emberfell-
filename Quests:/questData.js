/* ============================================================================
 * EMBERFELL - data/questData.js  (Quests & NPCs dept, Cycle 3)
 * Pure data. No THREE, no engine dependency. Consumed by quests.js.
 *
 * Load order: three.js -> engine.js -> data/biomes.js -> world.js
 *   -> data/enemyTypes.js -> (combat) -> data/questData.js -> data/dialogue.js
 *   -> quests.js -> npcs.js
 *
 * Contract v1.1 compliance:
 *   SS4 - objective/reward hooks map to canonical events only. Kill objectives
 *         are satisfied by 'enemy:died'; collect by 'loot:collected'. No custom
 *         counters live here (see quests.js "never count kills yourself").
 *   SS2 - ASCII quotes only; no exotic console; pure data.
 *
 * ---- SCHEMA (read by quests.js) -------------------------------------------
 * EF.questData.quests[id] = {
 *   id       : string, stable id, also the event id on quest:started/updated.
 *   giver    : npc id (see dialogue.js / npcs.js) who offers + rewards it.
 *   title    : short HUD title.
 *   blurb    : one-line journal summary.
 *   requires : [questId, ...]  chain gate. Quest is 'locked' (unofferable)
 *              until every listed quest is 'done'. Empty/absent = always open.
 *   objectives: [ objective ]  ALL must complete to make the quest 'ready'.
 *     objective types:
 *       { type:'kill',    target:<enemy type id>, count:N }
 *       { type:'collect', item:<pickup item id>,  count:N, spawn:{poi,scatter,n} }
 *       { type:'goto',    poi:<poi id>, radius?:N }   radius defaults to poi.radius
 *       { type:'talk',    npc:<npc id> }              satisfied by turning in AT that npc
 *     each objective may carry desc: HUD line (auto-derived if absent).
 *   marker   : { active:<poi id|null>, turnin:<poi id> }
 *              where to point map:setMarker. active=null on a kill quest means
 *              "point at the giver until ready" (wolves roam; no fixed POI).
 *   reward   : { gold?:N, xp?:N, item?:string }
 *   onComplete: { setFlags:{ flag:true }, toast:string }  optional finale hook.
 * -------------------------------------------------------------------------- */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});

  EF.questData = {

    /* deterministic offer order for journals / debug */
    order: [
      'maren.wolves',
      'odda.herbs',
      'gethin.stones',
      'talia.delivery',
      'maren.watch',
      'maren.seal'
    ],

    quests: {

      /* 1. KILL - the Cycle-1 wolf contract, recreated in data. --------- */
      'maren.wolves': {
        id: 'maren.wolves',
        giver: 'maren',
        title: 'Wolves at the Gate',
        blurb: 'Maren says the wolves took two goats. Thin the pack.',
        objectives: [
          { type: 'kill', target: 'wolf', count: 5, desc: 'Slay timber wolves' }
        ],
        marker: { active: null, turnin: 'village' },
        reward: { gold: 100, xp: 150 }
      },

      /* 2. COLLECT - three glowing herbs by the lake. World spawns the
       *    pickups (item id 'herb' already has a palette colour); the herb
       *    mesh emits loot:collected on proximity, which quests.js counts. */
      'odda.herbs': {
        id: 'odda.herbs',
        giver: 'odda',
        title: 'Odda\'s Poultice',
        blurb: 'Gather glowing marsh-herbs from the Stillmere shore.',
        objectives: [
          { type: 'collect', item: 'herb', count: 3, desc: 'Gather glowing herbs',
            spawn: { poi: 'lake', scatter: 6.5, n: 3 } }
        ],
        marker: { active: 'lake', turnin: 'village' },
        reward: { gold: 60, xp: 80 }
      },

      /* 3. GOTO - walk out to the Standing Stones and look. -------------- */
      'gethin.stones': {
        id: 'gethin.stones',
        giver: 'gethin',
        title: 'What Woke the Stones',
        blurb: 'Gethin heard the old stones humming. Go and see.',
        objectives: [
          { type: 'goto', poi: 'stones', desc: 'Investigate the Standing Stones' }
        ],
        marker: { active: 'stones', turnin: 'village' },
        reward: { gold: 50, xp: 90 }
      },

      /* 4. TALK / DELIVERY - carry Talia's keepsake from the arch to Maren.
       *    giver is Talia (at the arch); the talk objective is satisfied by
       *    handing it to Maren, so it also turns in at Maren. */
      'talia.delivery': {
        id: 'talia.delivery',
        giver: 'talia',
        title: 'A Word to the Elder',
        blurb: 'Talia asks you to bring her mother\'s ring to Maren.',
        objectives: [
          { type: 'talk', npc: 'maren', desc: 'Bring the ring to Maren' }
        ],
        marker: { active: 'village', turnin: 'village' },
        reward: { gold: 40, xp: 70 }
      },

      /* 5+6. CHAIN - watch (kill) unlocks seal (goto tower), the cliffhanger.
       *    maren.watch has no requires; maren.seal requires maren.watch done. */
      'maren.watch': {
        id: 'maren.watch',
        giver: 'maren',
        title: 'Bones on the Road',
        blurb: 'Risen bones walk the tower road. Put three back down.',
        objectives: [
          { type: 'kill', target: 'skeleton', count: 3, desc: 'Destroy risen bones' }
        ],
        marker: { active: null, turnin: 'village' },
        reward: { gold: 90, xp: 120 }
      },

      'maren.seal': {
        id: 'maren.seal',
        giver: 'maren',
        title: 'The Sealed Tower',
        blurb: 'With the road quiet, approach the sealed tower.',
        requires: ['maren.watch'],
        objectives: [
          { type: 'goto', poi: 'tower', desc: 'Approach the sealed tower' }
        ],
        marker: { active: 'tower', turnin: 'tower' },
        /* the tower door IS the turn-in: reaching it finalizes on the spot
         * (no walk-back), so the cliffhanger lands where the player stands. */
        autoComplete: true,
        reward: { xp: 200 },
        onComplete: {
          setFlags: { towerOpened: true },
          toast: 'The seal splits. Cold air breathes out of the dark.'
        }
      }

    }
  };
})();
