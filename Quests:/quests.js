/* ============================================================================
 * EMBERFELL - quests.js  (Quests & NPCs dept, Cycle 3)
 * A GENERIC quest state machine that executes Contract SS6 quest data
 * (data/questData.js). It owns NO content: names, lines, counts and rewards
 * all come from data. It tracks progress purely from canonical events.
 *
 * Requires (load order): engine.js (EF.bus/EF.engine), world.js (EF.world.pois,
 * terrainH, spawnPickup), data/questData.js. NPC positions and dialogue come
 * from npcs.js / data/dialogue.js, loaded after this.
 *
 * Contract v1.1 compliance:
 *   SS4 - listens to canonical events only: enemy:died, loot:collected,
 *         game:tick. Emits quest:started / quest:updated / quest:completed,
 *         ui:toast, audio:play, map:setMarker (pre-approved SS4 addition) and
 *         journal:entry (UI log hook). Every handler ignores __selfTest.
 *   SS2 - ASCII quotes; console.log/warn/error only; no per-frame allocation
 *         in the tick path (goto scan is throttled and allocation-free).
 *
 * PITFALL (owned): we NEVER count kills ourselves with a private tally. There
 * is no EF.state.kills in this build, so the authoritative source is the event
 * stream: each active kill objective increments only in response to
 * 'enemy:died'. If this module is reloaded mid-quest, no desynced counter can
 * survive to double-count, because there is no counter to survive - progress
 * is rebuilt from the events that arrive after load. (If a Player dept later
 * ships EF.state.kills, swap the enemy:died handler for a delta read; the rest
 * of the machine is unchanged.)
 *
 * PUBLIC API (EF.quests):
 *   flags                      mutable bag of world flags (e.g. towerOpened).
 *   getState(id)               'locked'|'offerable'|'active'|'ready'|'done'.
 *   isOfferable(id)            convenience boolean.
 *   accept(id)                 -> bool. Starts it, spawns any collect pickups,
 *                                 emits quest:started, tracks it.
 *   turnIn(id, byNpc?)         completes a matching talk objective for byNpc if
 *                                 pending, then finalizes if all objectives met.
 *   abandon(id)                resets to not-accepted; pickups removed; re-accept
 *                                 works clean.
 *   track(id|null)             sets the single tracked quest that shows a marker.
 *   tracked                    current tracked id (read-only-ish).
 *   activeList()               [id,...] of accepted-but-not-done quests.
 *   progress(id)               0..1 overall objective fraction.
 *   objectiveText(id)          array of HUD lines with have/need.
 *   journal / getJournal()     append-only log of completed quests.
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.bus || !EF.engine) {
    console.error('[EF.quests] engine.js (EF.bus/EF.engine) must load first');
    return;
  }
  if (!EF.questData) {
    console.error('[EF.quests] data/questData.js must load before quests.js');
    return;
  }

  var DATA = EF.questData.quests;
  var bus = EF.bus;

  /* records[id] = { status, obj:[{have, done}], pickups:[handle] } */
  var records = Object.create(null);
  var GOTO_INTERVAL = 0.25;      // seconds between goto proximity scans
  var _gotoAccum = 0;

  var api = {
    flags: Object.create(null),
    tracked: null,
    journal: []       // append-only log of completed quests (see finalize)
  };
  EF.quests = api;

  /* Returns a shallow copy of the completed-quest journal, newest last. */
  api.getJournal = function () { return api.journal.slice(); };

  /* ---------------------------------------------------------------- utils */

  function def(id) { return DATA[id] || null; }

  function poiById(id) {
    var pois = (EF.world && EF.world.pois) || [];
    for (var i = 0; i < pois.length; i++) if (pois[i].id === id) return pois[i];
    return null;
  }

  function newRecord(q) {
    var obj = [];
    for (var i = 0; i < q.objectives.length; i++) obj.push({ have: 0, done: false });
    return { status: 'active', obj: obj, pickups: [] };
  }

  function objComplete(q, rec, i) {
    var o = q.objectives[i], r = rec.obj[i];
    if (o.type === 'kill' || o.type === 'collect') return r.have >= o.count;
    return r.done === true; // goto / talk
  }

  function allComplete(q, rec) {
    for (var i = 0; i < q.objectives.length; i++) if (!objComplete(q, rec, i)) return false;
    return true;
  }

  function requiresMet(q) {
    var req = q.requires;
    if (!req || !req.length) return true;
    for (var i = 0; i < req.length; i++) if (api.getState(req[i]) !== 'done') return false;
    return true;
  }

  /* --------------------------------------------------------------- states */

  api.getState = function (id) {
    var q = def(id);
    if (!q) return 'locked';
    var rec = records[id];
    if (rec) {
      if (rec.status === 'done') return 'done';
      return allComplete(q, rec) ? 'ready' : 'active';
    }
    return requiresMet(q) ? 'offerable' : 'locked';
  };

  api.isOfferable = function (id) { return api.getState(id) === 'offerable'; };

  api.activeList = function () {
    var out = [];
    for (var id in records) if (records[id].status !== 'done') out.push(id);
    return out;
  };

  api.progress = function (id) {
    var q = def(id), rec = records[id];
    if (!q || !rec) return 0;
    var have = 0, need = 0;
    for (var i = 0; i < q.objectives.length; i++) {
      var o = q.objectives[i];
      if (o.type === 'kill' || o.type === 'collect') { need += o.count; have += Math.min(rec.obj[i].have, o.count); }
      else { need += 1; have += rec.obj[i].done ? 1 : 0; }
    }
    return need ? have / need : 0;
  };

  api.objectiveText = function (id) {
    var q = def(id), rec = records[id];
    if (!q) return [];
    var lines = [];
    for (var i = 0; i < q.objectives.length; i++) {
      var o = q.objectives[i];
      var base = o.desc || o.type;
      if (o.type === 'kill' || o.type === 'collect') {
        var have = rec ? Math.min(rec.obj[i].have, o.count) : 0;
        lines.push(base + ' (' + have + '/' + o.count + ')');
      } else {
        lines.push(base + (rec && rec.obj[i].done ? ' (done)' : ''));
      }
    }
    return lines;
  };

  /* -------------------------------------------------------------- markers */
  /* Only the tracked quest ever emits a marker. Target POI is authored in
   * questData.marker: turnin when ready, else active (kill quests author
   * active:null, so we fall back to the giver/turnin POI). */

  function markerTargetId(id) {
    var q = def(id), rec = records[id];
    if (!q || !rec) return null;
    var m = q.marker || {};
    if (rec.status === 'done') return null;
    if (allComplete(q, rec)) return m.turnin || m.active || null;
    return m.active || m.turnin || null;
  }

  function emitMarker() {
    if (!api.tracked) { bus.emit('map:setMarker', { clear: true }); return; }
    var poiId = markerTargetId(api.tracked);
    var poi = poiId && poiById(poiId);
    if (!poi) { bus.emit('map:setMarker', { clear: true }); return; }
    bus.emit('map:setMarker', {
      questId: api.tracked, label: poi.label,
      x: poi.x, y: poi.y, z: poi.z, radius: poi.radius
    });
  }

  api.track = function (id) {
    if (id && records[id] && records[id].status !== 'done') api.tracked = id;
    else if (id == null) api.tracked = null;
    else api.tracked = id; // allow tracking a ready quest too
    emitMarker();
  };

  function retrackAfter(id) {
    if (api.tracked !== id) return;
    var live = api.activeList();
    api.tracked = live.length ? live[0] : null;
    emitMarker();
  }

  /* --------------------------------------------------------- accept / turn */

  api.accept = function (id) {
    var q = def(id);
    if (!q) { console.warn('[EF.quests] accept unknown quest "' + id + '"'); return false; }
    if (api.getState(id) !== 'offerable') {
      console.warn('[EF.quests] "' + id + '" is not offerable (' + api.getState(id) + ')');
      return false;
    }
    var rec = newRecord(q);
    records[id] = rec;
    spawnCollectPickups(q, rec);
    bus.emit('quest:started', { id: id });
    bus.emit('quest:updated', { id: id, progress: api.progress(id) });
    bus.emit('ui:toast', { text: 'Quest: ' + q.title });
    api.track(id);
    return true;
  };

  api.turnIn = function (id, byNpc) {
    var q = def(id), rec = records[id];
    if (!q || !rec || rec.status === 'done') return false;

    // a delivery/talk objective is satisfied by handing in AT the target npc
    if (byNpc) {
      for (var i = 0; i < q.objectives.length; i++) {
        var o = q.objectives[i];
        if (o.type === 'talk' && o.npc === byNpc && !rec.obj[i].done) {
          rec.obj[i].done = true;
          bus.emit('quest:updated', { id: id, progress: api.progress(id) });
        }
      }
    }
    if (!allComplete(q, rec)) {
      // not ready yet - keep it active, just acknowledge
      return false;
    }
    finalize(id);
    return true;
  };

  function finalize(id) {
    var q = def(id), rec = records[id];
    if (!q || !rec || rec.status === 'done') return;
    rec.status = 'done';
    removePickups(rec);

    // rewards: gold/xp are the Player dept's ledger. We announce via ui:toast
    // and quest:completed; a Player module can read questData[id].reward on
    // quest:completed to credit the purse. We do not invent a reward event.
    var r = q.reward || {};
    var bits = [];
    if (r.gold) bits.push('+' + r.gold + ' gold');
    if (r.xp) bits.push('+' + r.xp + ' XP');
    if (r.item) bits.push(r.item);

    if (q.onComplete) {
      if (q.onComplete.setFlags) {
        for (var f in q.onComplete.setFlags) api.flags[f] = q.onComplete.setFlags[f];
      }
      if (q.onComplete.toast) bus.emit('ui:toast', { text: q.onComplete.toast });
    }

    bus.emit('quest:updated', { id: id, progress: 1 });
    bus.emit('quest:completed', { id: id });
    bus.emit('ui:toast', { text: 'Complete: ' + q.title + (bits.length ? ' - ' + bits.join(', ') : '') });
    bus.emit('audio:play', { sfx: 'quest' });

    // journal: record the finished quest so a log panel can list achievements.
    var entry = {
      order: api.journal.length + 1,
      id: id, title: q.title, blurb: q.blurb || '',
      giver: q.giver,
      reward: bits.join(', '),
      at: (EF.engine && EF.engine.time) ? EF.engine.time.elapsed : 0
    };
    api.journal.push(entry);
    bus.emit('journal:entry', entry);

    retrackAfter(id);
  }

  api.abandon = function (id) {
    var q = def(id), rec = records[id];
    if (!q || !rec || rec.status === 'done') return false;
    removePickups(rec);
    delete records[id];
    bus.emit('ui:toast', { text: 'Abandoned: ' + q.title });
    retrackAfter(id);
    return true;
  };

  /* ------------------------------------------------------------- pickups */

  /* Run fn now if the world can spawn, else once the world is ready. Prevents
   * a collect quest accepted a frame early from silently spawning nothing. */
  function whenSpawnable(fn) {
    if (EF.world && typeof EF.world.spawnPickup === 'function' && EF.world.ready) { fn(); return; }
    var off = bus.on('game:tick', function () {
      if (EF.world && typeof EF.world.spawnPickup === 'function' && EF.world.ready) { off(); fn(); }
    });
  }

  function terrainH(x, z) {
    return (EF.world && typeof EF.world.terrainH === 'function') ? EF.world.terrainH(x, z)
                                                                 : EF.engine.groundAt(x, z);
  }
  function slopeAt(x, z) {
    var e = 0.7;
    var hx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e);
    var hz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
    return Math.sqrt(hx * hx + hz * hz);
  }
  /* Water-surface elevation for a POI if biomes marks it as water, else -inf.
   * poi.y is the (lowered) plateau/bed; the plane sits `water` above it. */
  function waterSurfaceY(poiId, poi) {
    var wd = EF.worldData;
    if (wd && wd.pois) {
      for (var i = 0; i < wd.pois.length; i++) {
        if (wd.pois[i].id === poiId && wd.pois[i].water != null) return poi.y + wd.pois[i].water;
      }
    }
    return -Infinity;
  }

  /* Pick a spawn point in one angular sector on the shore ring, terrain-aware:
   * reject points at/under the water surface, prefer dry + flat ground. This is
   * what keeps herbs out of the Stillmere puddles the playtest snagged on. */
  function pickShorePoint(poi, sp, poiId, sector, n) {
    var rad = poi.radius || 6;
    var rMin = (sp.ringMin != null ? sp.ringMin : 1.2) * rad;
    var rMax = (sp.ringMax != null ? sp.ringMax : 1.5) * rad;
    var wy = waterSurfaceY(poiId, poi);
    var a0 = (sector / n) * Math.PI * 2, a1 = ((sector + 1) / n) * Math.PI * 2;
    var best = null, bestScore = -Infinity, fallback = null, fbH = -Infinity;
    for (var t = 0; t < 10; t++) {
      var a = a0 + Math.random() * (a1 - a0);
      var d = rMin + Math.random() * (rMax - rMin);
      var x = poi.x + Math.cos(a) * d, z = poi.z + Math.sin(a) * d;
      var h = terrainH(x, z);
      if (h > fbH) { fbH = h; fallback = { x: x, z: z }; } // highest = driest fallback
      var dry = (wy === -Infinity) ? 1 : (h - wy);
      if (dry < 0.3) continue;                            // submerged / waterline: skip
      var score = dry - slopeAt(x, z) * 2.0;              // dry and flat wins
      if (score > bestScore) { bestScore = score; best = { x: x, z: z }; }
    }
    return best || fallback || { x: poi.x + Math.cos((a0 + a1) / 2) * rMax,
                                 z: poi.z + Math.sin((a0 + a1) / 2) * rMax };
  }

  function scatterPoint(poi, sp, k, n) {
    var rad = poi.radius || 6, scatter = sp.scatter || 5;
    var a = (k / n) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / n);
    var d = scatter * (0.55 + Math.random() * 0.45);
    return { x: poi.x + Math.cos(a) * d, z: poi.z + Math.sin(a) * d };
  }

  function spawnCollectPickups(q, rec) {
    for (var i = 0; i < q.objectives.length; i++) {
      var o = q.objectives[i];
      if (o.type !== 'collect' || !o.spawn) continue;
      var sp = o.spawn;
      var poi = poiById(sp.poi);
      if (!poi) { console.warn('[EF.quests] collect spawn: no poi "' + sp.poi + '"'); continue; }
      var n = sp.n || o.count;
      var ring = (sp.ringMin != null || sp.ringMax != null);

      // capture everything so a deferred spawn is correct even with multiple
      // collect objectives, and verifies the record is still active.
      (function (objSpawn, count, useRing, poiRef, poiId, itemId, questId, forRec) {
        whenSpawnable(function () {
          if (records[questId] !== forRec || forRec.status === 'done') return;
          for (var k = 0; k < count; k++) {
            var pt = useRing ? pickShorePoint(poiRef, objSpawn, poiId, k, count)
                             : scatterPoint(poiRef, objSpawn, k, count);
            var h = EF.world.spawnPickup(itemId, pt.x, pt.z);
            if (h) forRec.pickups.push(h);
          }
        });
      })(sp, n, ring, poi, sp.poi, o.item, q.id, rec);
    }
  }

  function removePickups(rec) {
    for (var i = 0; i < rec.pickups.length; i++) {
      try { if (rec.pickups[i] && rec.pickups[i].remove) rec.pickups[i].remove(); }
      catch (e) { /* pickup already gone */ }
    }
    rec.pickups.length = 0;
  }

  /* --------------------------------------------------- event: kills ----- */

  bus.on('enemy:died', function (p) {
    if (!p || p.__selfTest) return;
    var type = p.type;
    var changed = null;
    for (var id in records) {
      var rec = records[id];
      if (rec.status === 'done') continue;
      var q = def(id);
      for (var i = 0; i < q.objectives.length; i++) {
        var o = q.objectives[i];
        if (o.type === 'kill' && o.target === type && rec.obj[i].have < o.count) {
          rec.obj[i].have++;
          changed = id;
          bus.emit('quest:updated', { id: id, progress: api.progress(id) });
          checkReady(id);
        }
      }
    }
    if (changed) refreshMarkerIfTracked(changed);
  });

  /* ----------------------------------------------- event: collect ------- */

  bus.on('loot:collected', function (p) {
    if (!p || p.__selfTest) return;
    var item = p.item, amt = p.count || 1;
    var changed = null;
    for (var id in records) {
      var rec = records[id];
      if (rec.status === 'done') continue;
      var q = def(id);
      for (var i = 0; i < q.objectives.length; i++) {
        var o = q.objectives[i];
        if (o.type === 'collect' && o.item === item && rec.obj[i].have < o.count) {
          rec.obj[i].have = Math.min(o.count, rec.obj[i].have + amt);
          changed = id;
          bus.emit('quest:updated', { id: id, progress: api.progress(id) });
          checkReady(id);
        }
      }
    }
    if (changed) refreshMarkerIfTracked(changed);
  });

  /* --------------------------------------------- tick: goto proximity --- */

  bus.on('game:tick', function (t) {
    if (!t || t.__selfTest) return;
    _gotoAccum += t.dt;
    if (_gotoAccum < GOTO_INTERVAL) return;
    _gotoAccum = 0;

    var pos = EF.player && EF.player.position;
    if (!pos) return; // no player root yet - nothing to test against

    for (var id in records) {
      var rec = records[id];
      if (rec.status === 'done') continue;
      var q = def(id);
      for (var i = 0; i < q.objectives.length; i++) {
        var o = q.objectives[i];
        if (o.type !== 'goto' || rec.obj[i].done) continue;
        var poi = poiById(o.poi);
        if (!poi) continue;
        var rad = o.radius != null ? o.radius : poi.radius;
        var dx = pos.x - poi.x, dz = pos.z - poi.z;
        if (dx * dx + dz * dz <= rad * rad) {
          rec.obj[i].done = true;
          bus.emit('quest:updated', { id: id, progress: api.progress(id) });
          checkReady(id);
          refreshMarkerIfTracked(id);
        }
      }
    }
  });

  /* --------------------------------------------------------- readiness -- */

  function checkReady(id) {
    var q = def(id), rec = records[id];
    if (!q || !rec || rec.status === 'done') return;
    if (allComplete(q, rec)) {
      if (q.autoComplete) finalize(id);        // e.g. the tower door
      else {
        bus.emit('ui:toast', { text: 'Ready to turn in: ' + q.title });
        bus.emit('audio:play', { sfx: 'quest' });
      }
    }
  }

  function refreshMarkerIfTracked(id) { if (api.tracked === id) emitMarker(); }

  /* --------------------------------------------------------- boot chores- */

  bus.on('game:booted', function (p) {
    if (p && p.__selfTest) return;
    // a soft, low chime for quest beats; register once here.
    try {
      EF.engine.audio.register('quest', { type: 'sine', freq: 520, freqEnd: 780, duration: 0.16, gain: 0.16, attack: 0.01 });
    } catch (e) { /* audio optional */ }
  });

  console.log('[EF.quests] ready - ' + EF.questData.order.length + ' quests loaded');
})();
