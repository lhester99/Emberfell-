/* ============================================================================
 * EMBERFELL -- engine.js  v1.1
 * Department: Engine Core. Owns: bootstrap, event bus, tick loop, audio,
 * input, camera rig. Owns NOTHING gameplay: no damage, quests, spawning,
 * inventory. Those belong to Player / Combat / Quest / UI departments.
 *
 * Priorities, in order: stability, performance, API clarity.
 *
 * CHANGELOG v1.0 -> v1.1 (per Engine Contract v1.1, Cycle 1 acceptance):
 *   CR-1 (major): standalone harness now requires EXPLICIT boot({standalone:
 *         true}). The "no player/world module found" auto-detection heuristic
 *         is removed. Harness exposes removal handles: EF.engine.harness
 *         .dispose() tears down its meshes, bus subscriptions, and ground
 *         sampler. Plain boot() / auto-boot never starts the harness.
 *   CR-2 (minor): per-frame allocations eliminated:
 *         - game:tick payload is a single reused object (see note below)
 *         - bus.emit no longer snapshots the handler array per emit; the bus
 *           is copy-on-write (on/off replace the array, emit iterates the
 *           captured reference) -- zero allocation on the emit path
 *         - keyMove no longer returns a fresh object; keyboard state writes
 *           straight into input.move
 *   CR-4 (major): console-normalization polyfill is now the first statements
 *         of this file per Contract v1.1 SS2.1 (sandbox ships only log/warn/
 *         error; info/table/debug/etc. may be undefined and would throw).
 *   SS4:  seven pre-approved events added to CANONICAL_EVENTS: weapon:equip,
 *         item:use, dialogue:open, dialogue:choice, dialogue:close,
 *         map:setMarker, quest:offered. Registry is now 26 events.
 *
 * PER-FRAME PAYLOAD NOTE (CR-2): the game:tick and game:resize payload
 * objects are REUSED across emits. Read fields synchronously inside your
 * handler; if you must retain values past the handler, copy the fields.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC API (Contract SS5 -- the only supported surface)
 *
 *   EF.bus.on(event, fn) -> off()     subscribe (fn receives payload)
 *   EF.bus.once(event, fn) -> off()
 *   EF.bus.off(event, fn)
 *   EF.bus.emit(event, payload) -> n  number of handlers invoked
 *
 *   EF.engine.boot(opts?)             opts: { mount?: HTMLElement,
 *                                             standalone?: boolean }
 *                                     standalone:true ONLY in test harnesses.
 *   EF.engine.autoBoot                set false BEFORE window load to take
 *                                     manual control of boot order.
 *   EF.engine.scene / .renderer       THREE objects (read, don't replace)
 *   EF.engine.time                    { elapsed, dt, frame, fps }
 *   EF.engine.setGroundSampler(fn)    fn(x, z) -> groundY. World Builder:
 *                                     call setGroundSampler(terrainH) in your
 *                                     game:booted handler. Default: flat 0.
 *   EF.engine.groundAt(x, z)          query the active sampler
 *
 *   EF.engine.camera.setTarget(obj3D) third-person follow target
 *                                     (Combat: point this at the player root)
 *   EF.engine.camera.setDistance(d)   orbit distance (clamped 2.5..14)
 *   EF.engine.camera.object           the THREE.PerspectiveCamera
 *   EF.engine.camera.yaw / .pitch     current orbit angles
 *
 *   EF.engine.input.move              { x, y } normalized -1..1 (y=+1 fwd)
 *   EF.engine.input.look              { dx, dy } this frame's look delta
 *   EF.engine.input.buttons.isDown(name)
 *   EF.engine.input.buttons.wasPressed(name)    edge, true for one tick
 *   EF.engine.input.buttons.wasReleased(name)   edge, true for one tick
 *   EF.engine.input.bindButton(name, el)  UI dept binds its DOM buttons here.
 *       ADVISORY A-1 (stands): pointerleave releases held buttons. Design
 *       hold/charge mechanics around this or file a CR.
 *   EF.engine.input.unbindButton(name)
 *   EF.engine.input.bindKey(code, name)   e.g. bindKey('Space','jump')
 *
 *   EF.engine.audio.register(name, spec)  spec: { type, freq, freqEnd?,
 *                                         duration, gain?, attack? }
 *                                         play: EF.bus.emit('audio:play',
 *                                         { sfx: name })
 *   EF.engine.audio.setMuted(bool) / .muted
 *
 *   EF.engine.harness                 present only after boot({standalone:
 *                                     true}); .dispose() removes it (CR-1)
 *   EF.engine.selfTest()              fires+receives every canonical event
 *                                     with { __selfTest: true } payloads
 *
 *   Update hook: subscribe to game:tick. Do NOT run your own rAF loops.
 *
 * ----------------------------------------------------------------------------
 * CONTRACT SS4 -- CANONICAL EVENTS (v1.1: this table IS the contract)
 *
 *   event              emitter   payload
 *   game:booted        engine    { scene, renderer, camera }
 *   game:tick          engine    { dt, elapsed, frame }   (REUSED object)
 *   game:resize        engine    { width, height }        (REUSED object)
 *   game:paused        engine    { }        (tab hidden)
 *   game:resumed       engine    { }
 *   input:button       engine    { name, pressed }        (edge events)
 *   audio:play         any       { sfx, detune? } or "sfxName"
 *   camera:shake       any       { intensity?, duration? }
 *   player:damaged     combat    { amount, source }  (engine listens: shake)
 *   player:spawned     player    { position }
 *   player:died        player    { cause }
 *   player:levelup     player    { level }
 *   enemy:spawned      combat    { type, id, position }
 *   enemy:died         combat    { type, id }             (NOT enemy:killed)
 *   quest:offered      quests    { id }                   [v1.1]
 *   quest:started      quests    { id }                   (NOT quest:accepted)
 *   quest:updated      quests    { id, progress }
 *   quest:completed    quests    { id }
 *   loot:collected     player    { item, count }          (NOT item:pickup)
 *   weapon:equip       combat    { id, slot? }            [v1.1]
 *   item:use           player    { item }                 [v1.1]
 *   dialogue:open      quests/ui { npc }                  [v1.1]
 *   dialogue:choice    quests/ui { npc, index }           [v1.1]
 *   dialogue:close     quests/ui { npc }                  [v1.1]
 *   map:setMarker      any       { id, position }         [v1.1]
 *   ui:toast           any       { text }
 *
 * Payloads emitted by EF.engine.selfTest() carry { __selfTest: true } and
 * MUST be ignored by all gameplay handlers (Contract SS4).
 *
 * ----------------------------------------------------------------------------
 * Deployment (Contract SS2): Claude artifact sandbox, about:srcdoc iframe.
 * - Load THREE r128 from cdnjs WITH crossorigin="anonymous" (SS2.3) or all
 *   library errors report as unusable "Script error":
 *   <script crossorigin="anonymous"
 *    src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js">
 *   </script>
 * - WebGL 1.0 only assumed. Reference viewport 402x708 CSS px, dpr 3;
 *   pixel-ratio cap 1.5 stands.
 * - No <style> tags anywhere in engine output: all engine CSS is inline
 *   via el.style.cssText.
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- CR-4: console normalization -- MUST stay the first statements ------
   * Sandbox guarantees only console.log / warn / error. Everything else may
   * be undefined and will throw if called. Map missing methods to log (or to
   * a no-op where a log fallback would be noise). */
  (function normalizeConsole() {
    var g = typeof window !== 'undefined' ? window : globalThis;
    var c = g.console || (g.console = {});
    var base = typeof c.log === 'function' ? c.log : function () {};
    if (typeof c.log !== 'function') c.log = base;
    var toLog = ['info', 'debug', 'trace', 'table', 'dir'];
    var toNoop = ['group', 'groupEnd', 'groupCollapsed', 'time', 'timeEnd',
                  'count', 'assert', 'profile', 'profileEnd'];
    var i;
    for (i = 0; i < toLog.length; i++) {
      if (typeof c[toLog[i]] !== 'function') c[toLog[i]] = base;
    }
    for (i = 0; i < toNoop.length; i++) {
      if (typeof c[toNoop[i]] !== 'function') c[toNoop[i]] = function () {};
    }
    if (typeof c.warn !== 'function') c.warn = base;
    if (typeof c.error !== 'function') c.error = base;
  })();

  if (typeof THREE === 'undefined') {
    console.error('[EF.engine] THREE (r128) must be loaded before engine.js');
    return;
  }

  var EF = (window.EF = window.EF || {});
  var VERSION = '1.1';

  /* =========================================================================
   * 1. EVENT BUS  (copy-on-write: zero allocation on the emit path -- CR-2)
   * ======================================================================= */

  var CANONICAL_EVENTS = {
    'game:booted':     { scene: null, renderer: null, camera: null },
    'game:tick':       { dt: 0.016, elapsed: 1.0, frame: 60 },
    'game:resize':     { width: 402, height: 708 },
    'game:paused':     {},
    'game:resumed':    {},
    'input:button':    { name: 'jump', pressed: true },
    'audio:play':      { sfx: 'ui.click' },
    'camera:shake':    { intensity: 0.3, duration: 0.25 },
    'player:damaged':  { amount: 5, source: 'wolf' },
    'player:spawned':  { position: { x: 0, y: 0, z: 0 } },
    'player:died':     { cause: 'wolf' },
    'player:levelup':  { level: 2 },
    'enemy:spawned':   { type: 'wolf', id: 'wolf-1', position: { x: 4, y: 0, z: 4 } },
    'enemy:died':      { type: 'wolf', id: 'wolf-1' },
    'quest:offered':   { id: 'maren.wolves' },                      /* v1.1 */
    'quest:started':   { id: 'maren.wolves' },
    'quest:updated':   { id: 'maren.wolves', progress: 0.5 },
    'quest:completed': { id: 'maren.wolves' },
    'loot:collected':  { item: 'pelt', count: 1 },
    'weapon:equip':    { id: 'rusty-sword', slot: 'main' },         /* v1.1 */
    'item:use':        { item: 'potion' },                          /* v1.1 */
    'dialogue:open':   { npc: 'maren' },                            /* v1.1 */
    'dialogue:choice': { npc: 'maren', index: 0 },                  /* v1.1 */
    'dialogue:close':  { npc: 'maren' },                            /* v1.1 */
    'map:setMarker':   { id: 'maren', position: { x: 0, y: 0, z: 0 } }, /* v1.1 */
    'ui:toast':        { text: 'hello' }
  };

  var bus = (function () {
    var map = Object.create(null);     // event -> handler array (immutable)
    var warned = Object.create(null);  // non-canonical names warned once

    // Copy-on-write discipline: on()/off() build a NEW array; emit() iterates
    // whatever reference it captured. Handlers may safely (un)subscribe
    // mid-emit; changes take effect on the NEXT emit. No per-emit allocation.
    function on(ev, fn) {
      if (typeof fn !== 'function') throw new Error('[EF.bus] handler must be a function');
      var arr = map[ev];
      map[ev] = arr ? arr.concat([fn]) : [fn];
      return function off() { bus.off(ev, fn); };
    }

    function once(ev, fn) {
      var off = on(ev, function (p) { off(); fn(p); });
      return off;
    }

    function off(ev, fn) {
      var arr = map[ev];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i === -1) return;
      if (arr.length === 1) { delete map[ev]; return; }
      var next = arr.slice(0, i).concat(arr.slice(i + 1));
      map[ev] = next;
    }

    function emit(ev, payload) {
      if (!(ev in CANONICAL_EVENTS) && !warned[ev]) {
        warned[ev] = true;
        console.warn('[EF.bus] non-canonical event "' + ev + '" -- amend Contract SS4 / CANONICAL_EVENTS if intentional');
      }
      var arr = map[ev];               // captured reference; never mutated
      if (!arr) return 0;
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](payload); n++; }
        catch (err) {
          // one broken department must not take down the frame
          console.error('[EF.bus] handler error on "' + ev + '":', err);
        }
      }
      return n;
    }

    return { on: on, once: once, off: off, emit: emit };
  })();

  EF.bus = bus;

  /* =========================================================================
   * 2. AUDIO -- WebAudio manager, named oscillator sfx behind audio:play
   * ======================================================================= */

  var audio = (function () {
    var ctx = null;
    var master = null;
    var registry = Object.create(null);
    var api = { muted: false };

    // Placeholder set; Audio/UI departments register the real palette.
    var DEFAULT_SFX = {
      'ui.click': { type: 'square',   freq: 660, freqEnd: 520,  duration: 0.06, gain: 0.15 },
      'jump':     { type: 'triangle', freq: 300, freqEnd: 640,  duration: 0.14, gain: 0.22 },
      'hit':      { type: 'sawtooth', freq: 220, freqEnd: 70,   duration: 0.18, gain: 0.28 },
      'pickup':   { type: 'sine',     freq: 880, freqEnd: 1320, duration: 0.12, gain: 0.20 },
      'hurt':     { type: 'square',   freq: 160, freqEnd: 60,   duration: 0.22, gain: 0.30 }
    };

    function ensureCtx() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      return ctx;
    }

    // iOS: AudioContext must be created/resumed inside the FIRST user gesture.
    function unlockOnGesture() {
      function unlock() {
        var c = ensureCtx();
        if (c && c.state === 'suspended') c.resume();
        window.removeEventListener('touchstart', unlock, true);
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
      window.addEventListener('touchstart', unlock, true);
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }

    function register(name, spec) { registry[name] = spec; }

    function play(name, detune) {
      if (api.muted) return;
      var spec = registry[name];
      if (!spec) { console.warn('[EF.audio] unknown sfx "' + name + '"'); return; }
      var c = ensureCtx();
      if (!c || c.state !== 'running') return; // silent no-op pre-gesture

      var t0 = c.currentTime;
      var osc = c.createOscillator();
      var g = c.createGain();
      var dur = spec.duration || 0.1;
      var peak = spec.gain != null ? spec.gain : 0.2;
      var attack = spec.attack != null ? spec.attack : 0.005;

      osc.type = spec.type || 'sine';
      osc.frequency.setValueAtTime((spec.freq || 440) * (detune || 1), t0);
      if (spec.freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(1, spec.freqEnd * (detune || 1)), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g); g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      osc.onended = function () { osc.disconnect(); g.disconnect(); };
    }

    for (var k in DEFAULT_SFX) register(k, DEFAULT_SFX[k]);
    unlockOnGesture();

    bus.on('audio:play', function (p) {
      if (p && p.__selfTest) return;
      if (typeof p === 'string') return play(p);
      if (p && p.sfx) play(p.sfx, p.detune);
    });

    api.register = register;
    api.setMuted = function (m) { api.muted = !!m; };
    return api;
  })();

  /* =========================================================================
   * 3. INPUT -- floating joystick (left half), camera drag (right half),
   *    named button registry, WASD/mouse fallback.
   *    All input is read from EF.engine.input; only the engine adds listeners.
   * ======================================================================= */

  var input = (function () {
    var JOY_RADIUS = 48; // px, max thumb travel

    var state = {
      move: { x: 0, y: 0 },   // public, normalized (joystick or WASD)
      look: { dx: 0, dy: 0 }, // public, per-frame delta (set at tick start)
      pointerActive: { joystick: false, camera: false }
    };

    var lookAccum = { dx: 0, dy: 0 };  // raw, drained each tick
    var joyTouchId = null, camTouchId = null;
    var joyOrigin = { x: 0, y: 0 };
    var mouseDragging = false;
    var lastMouse = { x: 0, y: 0 };

    // ---- named buttons -----------------------------------------------------
    var buttons = Object.create(null); // name -> {down,pressed,released,el,handlers}
    var keyMap = Object.create(null);  // KeyboardEvent.code -> button name

    function btn(name) {
      return buttons[name] || (buttons[name] = { down: false, pressed: false, released: false, el: null, handlers: null });
    }
    function setButton(name, down) {
      var b = btn(name);
      if (b.down === down) return;
      b.down = down;
      if (down) b.pressed = true; else b.released = true;
      bus.emit('input:button', { name: name, pressed: down }); // edge-rate, not per-frame
    }

    function bindButton(name, el) {
      unbindButton(name);
      var b = btn(name);
      var onDown = function (e) { e.preventDefault(); setButton(name, true); };
      var onUp   = function (e) { e.preventDefault(); setButton(name, false); };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('pointerleave', onUp); // ADVISORY A-1: releases held buttons
      el.style.touchAction = 'none'; // stop iOS scroll/zoom from a held button
      b.el = el;
      b.handlers = { down: onDown, up: onUp };
    }
    function unbindButton(name) {
      var b = buttons[name];
      if (!b || !b.el) return;
      b.el.removeEventListener('pointerdown', b.handlers.down);
      b.el.removeEventListener('pointerup', b.handlers.up);
      b.el.removeEventListener('pointercancel', b.handlers.up);
      b.el.removeEventListener('pointerleave', b.handlers.up);
      b.el = null; b.handlers = null;
    }
    function bindKey(code, name) { keyMap[code] = name; }

    // fallback bindings; UI dept may rebind
    bindKey('Space', 'jump');
    bindKey('KeyF', 'attack');
    bindKey('KeyE', 'bag');

    // ---- keyboard WASD -----------------------------------------------------
    var keys = Object.create(null);

    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      keys[e.code] = true;
      if (keyMap[e.code]) { setButton(keyMap[e.code], true); e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) {
      keys[e.code] = false;
      if (keyMap[e.code]) setButton(keyMap[e.code], false);
    });
    window.addEventListener('blur', function () {
      keys = Object.create(null);
      for (var n in buttons) setButton(n, false);
      releaseJoy(); camTouchId = null; mouseDragging = false;
      state.pointerActive.camera = false;
    });

    // ---- joystick visual (engine-owned affordance; inline styles only,
    //      no <style> tags per Contract SS2.2) --------------------------------
    var joyBase = null, joyNub = null;
    function makeJoyDom(mount) {
      joyBase = document.createElement('div');
      joyNub = document.createElement('div');
      joyBase.style.cssText =
        'position:fixed;width:' + (JOY_RADIUS * 2) + 'px;height:' + (JOY_RADIUS * 2) + 'px;' +
        'margin:-' + JOY_RADIUS + 'px 0 0 -' + JOY_RADIUS + 'px;border-radius:50%;' +
        'border:2px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.06);' +
        'pointer-events:none;z-index:5;display:none;';
      joyNub.style.cssText =
        'position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;' +
        'background:rgba(255,255,255,0.35);pointer-events:none;z-index:6;display:none;';
      mount.appendChild(joyBase);
      mount.appendChild(joyNub);
    }
    function showJoy(x, y) {
      joyBase.style.display = joyNub.style.display = 'block';
      joyBase.style.left = x + 'px'; joyBase.style.top = y + 'px';
      moveJoyNub(x, y);
    }
    function moveJoyNub(x, y) { joyNub.style.left = x + 'px'; joyNub.style.top = y + 'px'; }
    function hideJoy() { if (joyBase) { joyBase.style.display = joyNub.style.display = 'none'; } }

    function releaseJoy() {
      joyTouchId = null;
      state.move.x = 0; state.move.y = 0;
      state.pointerActive.joystick = false;
      hideJoy();
    }

    // ---- touch layer ---------------------------------------------------------
    // PITFALL (v0): identifiers MUST be tracked per finger so joystick and
    // camera drag work simultaneously. PITFALL: touchmove must preventDefault
    // (passive:false) or iOS rubber-bands the page.
    function attachTouch(canvas) {
      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          var leftHalf = t.clientX < window.innerWidth * 0.5;
          if (leftHalf && joyTouchId === null) {
            joyTouchId = t.identifier;
            joyOrigin.x = t.clientX; joyOrigin.y = t.clientY;
            state.pointerActive.joystick = true;
            showJoy(t.clientX, t.clientY);
          } else if (camTouchId === null) {
            camTouchId = t.identifier;
            lastMouse.x = t.clientX; lastMouse.y = t.clientY; // struct reused
            state.pointerActive.camera = true;
          }
        }
      }, { passive: false });

      canvas.addEventListener('touchmove', function (e) {
        e.preventDefault(); // iOS rubber-band guard
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (t.identifier === joyTouchId) {
            var dx = t.clientX - joyOrigin.x;
            var dy = t.clientY - joyOrigin.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            if (len > JOY_RADIUS) {
              // floating joystick: base trails the finger past max radius
              var over = len - JOY_RADIUS;
              joyOrigin.x += dx / len * over;
              joyOrigin.y += dy / len * over;
              joyBase.style.left = joyOrigin.x + 'px';
              joyBase.style.top = joyOrigin.y + 'px';
              dx = t.clientX - joyOrigin.x;
              dy = t.clientY - joyOrigin.y;
              len = JOY_RADIUS;
            }
            moveJoyNub(joyOrigin.x + dx, joyOrigin.y + dy);
            state.move.x = dx / JOY_RADIUS;
            state.move.y = -dy / JOY_RADIUS; // screen-down is world-backward
          } else if (t.identifier === camTouchId) {
            lookAccum.dx += t.clientX - lastMouse.x;
            lookAccum.dy += t.clientY - lastMouse.y;
            lastMouse.x = t.clientX; lastMouse.y = t.clientY;
          }
        }
      }, { passive: false });

      function endTouch(e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (t.identifier === joyTouchId) releaseJoy();
          else if (t.identifier === camTouchId) {
            camTouchId = null;
            state.pointerActive.camera = false;
          }
        }
      }
      canvas.addEventListener('touchend', endTouch);
      canvas.addEventListener('touchcancel', endTouch);
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    // ---- mouse fallback (desktop) -------------------------------------------
    function attachMouse(canvas) {
      canvas.addEventListener('mousedown', function (e) {
        mouseDragging = true;
        lastMouse.x = e.clientX; lastMouse.y = e.clientY;
        state.pointerActive.camera = true;
      });
      window.addEventListener('mousemove', function (e) {
        if (!mouseDragging) return;
        lookAccum.dx += e.clientX - lastMouse.x;
        lookAccum.dy += e.clientY - lastMouse.y;
        lastMouse.x = e.clientX; lastMouse.y = e.clientY;
      });
      window.addEventListener('mouseup', function () {
        mouseDragging = false;
        if (camTouchId === null) state.pointerActive.camera = false;
      });
    }

    // called by the engine at the START of each tick.
    // CR-2: keyboard movement writes straight into state.move -- no
    // intermediate object is created per frame.
    function preTick() {
      if (joyTouchId === null) {
        var x = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
        var y = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
        if (x !== 0 && y !== 0) { x *= 0.7071067811865476; y *= 0.7071067811865476; }
        state.move.x = x; state.move.y = y;
      }
      state.look.dx = lookAccum.dx; state.look.dy = lookAccum.dy;
      lookAccum.dx = 0; lookAccum.dy = 0;
    }
    // called by the engine at the END of each tick -- clears edge flags
    function postTick() {
      for (var n in buttons) { buttons[n].pressed = false; buttons[n].released = false; }
    }

    state.buttons = {
      isDown: function (n) { var b = buttons[n]; return !!(b && b.down); },
      wasPressed: function (n) { var b = buttons[n]; return !!(b && b.pressed); },
      wasReleased: function (n) { var b = buttons[n]; return !!(b && b.released); }
    };
    state.bindButton = bindButton;
    state.unbindButton = unbindButton;
    state.bindKey = bindKey;
    state._attach = function (canvas, mount) { makeJoyDom(mount); attachTouch(canvas); attachMouse(canvas); };
    state._preTick = preTick;
    state._postTick = postTick;
    return state;
  })();

  /* =========================================================================
   * 4. CAMERA RIG -- third-person yaw/pitch orbit, smoothing, ground clamp,
   *    screen shake on player:damaged / camera:shake
   * ======================================================================= */

  var cameraRig = (function () {
    var cam = new THREE.PerspectiveCamera(60, 1, 0.1, 120);
    var target = null;

    var rig = {
      object: cam,
      yaw: 0,
      pitch: 0.45,          // radians above horizon
      distance: 6.5,
      minDistance: 2.5,
      maxDistance: 14,
      minPitch: -0.15,
      maxPitch: 1.30,
      lookSensitivity: 0.0045,
      followLerp: 10,       // higher = snappier target follow
      headOffset: 1.4       // look-at height above target origin
    };

    var smoothTarget = new THREE.Vector3(0, 0, 0);
    var shake = { intensity: 0, decay: 6 };
    var _desired = new THREE.Vector3(); // reused -- no per-frame allocation
    var _lookAt = new THREE.Vector3();  // reused

    rig.setTarget = function (obj) {
      target = obj;
      if (obj) smoothTarget.copy(obj.position);
    };
    rig.setDistance = function (d) {
      rig.distance = Math.min(rig.maxDistance, Math.max(rig.minDistance, d));
    };

    bus.on('player:damaged', function (p) {
      if (p && p.__selfTest) return;
      var amt = (p && p.amount) || 1;
      shake.intensity = Math.min(0.6, 0.08 + amt * 0.02);
    });
    bus.on('camera:shake', function (p) {
      if (p && p.__selfTest) return;
      shake.intensity = Math.max(shake.intensity, (p && p.intensity) || 0.25);
    });

    rig.update = function (dt, groundAt) {
      // orbit from look input
      rig.yaw -= input.look.dx * rig.lookSensitivity;
      rig.pitch += input.look.dy * rig.lookSensitivity;
      rig.pitch = Math.min(rig.maxPitch, Math.max(rig.minPitch, rig.pitch));

      // smooth follow
      if (target) {
        var a = 1 - Math.exp(-rig.followLerp * dt);
        smoothTarget.lerp(target.position, a);
      }

      var cx = smoothTarget.x, cy = smoothTarget.y + rig.headOffset, cz = smoothTarget.z;
      var cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
      _desired.set(
        cx + rig.distance * cp * Math.sin(rig.yaw),
        cy + rig.distance * sp,
        cz + rig.distance * cp * Math.cos(rig.yaw)
      );

      // screen shake (decaying random offset)
      if (shake.intensity > 0.001) {
        _desired.x += (Math.random() * 2 - 1) * shake.intensity;
        _desired.y += (Math.random() * 2 - 1) * shake.intensity;
        _desired.z += (Math.random() * 2 - 1) * shake.intensity;
        shake.intensity *= Math.exp(-shake.decay * dt);
      } else {
        shake.intensity = 0;
      }

      // terrain collision -- camera NEVER below ground (applied after shake)
      var floor = groundAt(_desired.x, _desired.z) + 0.35;
      if (_desired.y < floor) _desired.y = floor;

      cam.position.copy(_desired);
      _lookAt.set(cx, cy, cz);
      cam.lookAt(_lookAt);
    };

    return rig;
  })();

  /* =========================================================================
   * 5. ENGINE CORE -- bootstrap, tick loop, resize, harness, self-test
   * ======================================================================= */

  var engine = (function () {
    var api = {
      version: VERSION,
      booted: false,
      scene: null,
      renderer: null,
      camera: cameraRig,
      input: input,
      audio: audio,
      bus: bus,
      harness: null,
      time: { elapsed: 0, dt: 0, frame: 0, fps: 0 }
    };

    var DEFAULT_SAMPLER = function () { return 0; };
    var groundSampler = DEFAULT_SAMPLER;
    api.setGroundSampler = function (fn) {
      if (typeof fn !== 'function') throw new Error('[EF.engine] groundSampler must be fn(x,z)->y');
      groundSampler = fn;
    };
    api.groundAt = function (x, z) { return groundSampler(x, z); };

    var MAX_DT = 0.05; // clamp: never simulate more than 50ms per frame
    var lastNow = 0, rafId = 0, paused = false;
    var fpsAccum = 0, fpsFrames = 0;

    // CR-2: reused payload objects. Handlers must not retain these across
    // frames -- copy fields if you need them later.
    var TICK_PAYLOAD = { dt: 0, elapsed: 0, frame: 0 };
    var RESIZE_PAYLOAD = { width: 0, height: 0 };

    function tick(now) {
      rafId = requestAnimationFrame(tick);
      if (paused) { lastNow = now; return; }

      var dt = (now - lastNow) / 1000;
      lastNow = now;
      if (dt <= 0) return;
      if (dt > MAX_DT) dt = MAX_DT; // clamped delta per contract

      api.time.dt = dt;
      api.time.elapsed += dt;
      api.time.frame++;

      fpsAccum += dt; fpsFrames++;
      if (fpsAccum >= 0.5) { api.time.fps = Math.round(fpsFrames / fpsAccum); fpsAccum = 0; fpsFrames = 0; }

      input._preTick();
      TICK_PAYLOAD.dt = dt;
      TICK_PAYLOAD.elapsed = api.time.elapsed;
      TICK_PAYLOAD.frame = api.time.frame;
      bus.emit('game:tick', TICK_PAYLOAD);
      cameraRig.update(dt, groundSampler);
      api.renderer.render(api.scene, cameraRig.object);
      input._postTick();
    }

    function onResize() {
      var w = window.innerWidth, h = window.innerHeight;
      api.renderer.setSize(w, h);
      cameraRig.object.aspect = w / h;
      cameraRig.object.updateProjectionMatrix();
      RESIZE_PAYLOAD.width = w; RESIZE_PAYLOAD.height = h;
      bus.emit('game:resize', RESIZE_PAYLOAD);
    }

    api.boot = function (opts) {
      if (api.booted) { console.warn('[EF.engine] boot() called twice; ignoring'); return api; }
      opts = opts || {};
      var mount = opts.mount || document.body;

      // --- renderer: perf-first mobile settings per contract ---------------
      var renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.domElement.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;display:block;touch-action:none;';
      mount.appendChild(renderer.domElement);

      var scene = new THREE.Scene();
      var FOG_COLOR = 0x1b2a24; // dusk pines
      scene.background = new THREE.Color(FOG_COLOR);
      scene.fog = new THREE.Fog(FOG_COLOR, 16, 58);

      // baseline lighting -- cheap, no shadows by default
      var hemi = new THREE.HemisphereLight(0xcfd8e6, 0x2a2620, 0.9);
      var sun = new THREE.DirectionalLight(0xffe2b0, 0.7);
      sun.position.set(12, 20, 8);
      scene.add(hemi, sun);

      api.scene = scene;
      api.renderer = renderer;

      input._attach(renderer.domElement, mount);
      renderer.domElement.addEventListener('wheel', function (e) {
        e.preventDefault();
        cameraRig.setDistance(cameraRig.distance + (e.deltaY > 0 ? 0.8 : -0.8));
      }, { passive: false });

      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);

      document.addEventListener('visibilitychange', function () {
        var hide = document.hidden;
        if (hide === paused) return;
        paused = hide;
        bus.emit(hide ? 'game:paused' : 'game:resumed', {});
      });

      api.booted = true;
      bus.emit('game:booted', { scene: scene, renderer: renderer, camera: cameraRig.object });

      // CR-1: harness ONLY on explicit request. No auto-detection.
      if (opts.standalone === true) standaloneHarness();

      lastNow = performance.now();
      rafId = requestAnimationFrame(tick);
      return api;
    };

    api.shutdown = function () {
      cancelAnimationFrame(rafId);
      api.booted = false;
    };

    /* ---- STANDALONE SMOKE-TEST HARNESS (CR-1) -------------------------------
     * Engine-only proving ground. Runs ONLY via boot({standalone:true}) --
     * never in integrated builds. Placeholder cube as "player", sine terrain
     * to prove the camera ground-clamp, cube driven from EF.engine.input.
     * NOT gameplay. All handles kept; EF.engine.harness.dispose() removes
     * every mesh, bus subscription, and the harness ground sampler. */
    function standaloneHarness() {
      console.info('[EF.engine] standalone harness active (explicit standalone:true)');

      var offs = [];      // bus unsubscribe handles
      var objects = [];   // scene objects to remove on dispose

      function hills(x, z) {
        return Math.sin(x * 0.22) * Math.cos(z * 0.19) * 1.2;
      }
      api.setGroundSampler(hills);

      var SIZE = 90, SEG = 60;
      var geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      var pos = geo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        pos.setY(i, hills(pos.getX(i), pos.getZ(i)));
      }
      geo.computeVertexNormals();
      var ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x2f4a38 }));
      var grid = new THREE.GridHelper(SIZE, 30, 0x3d5c47, 0x27392e);
      var cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 1.6, 0.8),
        new THREE.MeshLambertMaterial({ color: 0xd9c58a })
      );
      cube.position.set(0, hills(0, 0) + 0.8, 0);
      api.scene.add(ground, grid, cube);
      objects.push(ground, grid, cube);
      cameraRig.setTarget(cube);

      var SPEED = 5;
      offs.push(bus.on('game:tick', function (t) {
        var mv = input.move;
        if (mv.x !== 0 || mv.y !== 0) {
          // camera-relative movement
          var yaw = cameraRig.yaw;
          var fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward
          var rx = Math.cos(yaw),  rz = -Math.sin(yaw); // right
          cube.position.x += (fx * mv.y + rx * mv.x) * SPEED * t.dt;
          cube.position.z += (fz * mv.y + rz * mv.x) * SPEED * t.dt;
        }
        cube.position.y = hills(cube.position.x, cube.position.z) + 0.8;

        // smoke-test the engine's own hooks
        if (input.buttons.wasPressed('jump'))   bus.emit('audio:play', { sfx: 'jump' });
        if (input.buttons.wasPressed('attack')) bus.emit('camera:shake', { intensity: 0.3 });
      }));

      api.harness = {
        dispose: function () {
          for (var i = 0; i < offs.length; i++) offs[i]();
          for (var j = 0; j < objects.length; j++) {
            api.scene.remove(objects[j]);
            if (objects[j].geometry) objects[j].geometry.dispose();
            if (objects[j].material) {
              if (objects[j].material.dispose) objects[j].material.dispose();
            }
          }
          cameraRig.setTarget(null);
          groundSampler = DEFAULT_SAMPLER;
          api.harness = null;
          console.info('[EF.engine] harness disposed');
        }
      };
    }

    /* ---- SELF-TEST ---------------------------------------------------------
     * Fires and receives every canonical event with dummy payloads.
     * Payloads carry __selfTest:true so live handlers can ignore them. */
    api.selfTest = function () {
      var results = [];
      var pass = true;
      Object.keys(CANONICAL_EVENTS).forEach(function (ev) {
        var received = false;
        var payload = { __selfTest: true };
        var dummy = CANONICAL_EVENTS[ev];
        for (var k in dummy) payload[k] = dummy[k];

        var off = bus.on(ev, function (p) { if (p && p.__selfTest) received = true; });
        bus.emit(ev, payload);
        off();

        results.push({ event: ev, ok: received });
        if (!received) pass = false;
      });
      console.table(results); // safe: normalized by the CR-4 polyfill
      console.info('[EF.engine] v' + VERSION + ' self-test ' + (pass ? 'PASS' : 'FAIL') +
        ' (' + results.length + ' canonical events)');
      return { pass: pass, results: results };
    };

    return api;
  })();

  EF.engine = engine;

  // Auto-boot the ENGINE ONLY (never the harness -- CR-1) at window load.
  // Set EF.engine.autoBoot = false immediately after this script tag to take
  // manual control of boot order. Test harnesses call boot({standalone:true}).
  engine.autoBoot = true;
  window.addEventListener('load', function () {
    if (engine.autoBoot && !engine.booted) engine.boot();
  });
})();
