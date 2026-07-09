# EMBERFELL — Engine Contract v1.1
**Supersedes v1.0. Redistribute to ALL projects.** Changes from Cycle 1 are marked [v1.1]. Everything else in the original v1.0 contract remains in force — this document lists only the amended/added sections; keep v1.0 attached alongside it.

---

## §2 addendum — Deployment environment [v1.1]

Builds run inside the Claude artifact sandbox (an `about:srcdoc` iframe). Verified constraints every module MUST respect:

1. **Partial console shim.** Only `console.log`, `console.warn`, `console.error` are guaranteed. `console.info`, `console.table`, and others may be undefined and WILL throw if called. Engine Core ships a console-normalization polyfill as the first statements of engine.js (v1.1+); other modules still must not assume exotic console methods.
2. **`<style>` tags are stripped by the sandbox.** All CSS must be delivered as inline `style` attributes or injected via JavaScript (`el.style.cssText`, or a JS-created `<style>` appended at runtime — verify the latter survives before relying on it). **UI/UX department: this changes your entire delivery format — no static stylesheet.**
3. **Cross-origin error masking.** The three.js script tag must carry `crossorigin="anonymous"` or all errors originating in library code report as an unusable "Script error."
4. **WebGL 1.0 confirmed available** (WebGL2 unverified — do not assume it). Device reference: 402×708 CSS px viewport, devicePixelRatio 3 (pixel-ratio cap of 1.5 stands).
5. **Delivery format:** code moves between projects as raw `.js`/`.html` text files ONLY. PDF prints, word-processor round-trips, and copy-paste through other apps are rejected at intake — Cycle 1 lost a day to margin-clipped lines and smart-quote corruption. Integrator greps every delivery for U+2018/U+2019/U+201C/U+201D and rejects on match.

## §4 replacement — Canonical events [v1.1]

The `CANONICAL_EVENTS` table in engine.js v1.0/v1.1 is canonical (19 events). It supersedes the v1.0 contract's event list where names differ — notably: use `enemy:died` (not `enemy:killed`), `quest:started` (not `quest:accepted`), `loot:collected` (not `item:pickup`), `ui:toast` for popups. Payloads carrying `__selfTest: true` must be ignored by all gameplay handlers. Events not yet in the table that v1.0 promised (`weapon:equip`, `item:use`, `dialogue:open/choice/close`, `map:setMarker`, `quest:offered`) are PRE-APPROVED for addition in engine v1.1 — Combat, Quests, and UI should code against them; Engine Core adds them to the table.

## §5 addendum — Engine API as built [v1.1]

The engine's actual public surface (binding for all departments):
- `EF.bus` — `on(ev,fn)→off()`, `once`, `off`, `emit(ev,payload)→handlerCount`. Handler errors are isolated; non-canonical event names warn once.
- `EF.engine.boot(opts)` — call with `{standalone:true}` ONLY in test harnesses. `EF.engine.autoBoot=false` before load to take manual control.
- `EF.engine.setGroundSampler(fn)` / `EF.engine.groundAt(x,z)` — **World Builder: this is where `terrainH` plugs in.** Call `setGroundSampler(terrainH)` during your `game:booted` handler.
- `EF.engine.input` — `.move {x,y}` (y=+1 forward), `.look {dx,dy}` per-frame deltas, `.buttons.isDown/wasPressed/wasReleased(name)`, `.bindButton(name, domElement)`, `.bindKey(code,name)`.
- `EF.engine.camera` — the rig: `.object` (THREE camera), `.yaw`, `.pitch`, `.setTarget(object3D)` (**Combat: point this at the player root**), `.setDistance(d)`.
- `EF.engine.audio.register(name, spec)` — spec `{type,freq,freqEnd,duration,gain,attack}`; play via `EF.bus.emit('audio:play',{sfx:name})`.
- `EF.engine.time` — `{elapsed, dt, frame, fps}`.
- Update hook: subscribe to `game:tick` `{dt, elapsed, frame}`. Do NOT run your own rAF loops.

## Open change requests against Engine Core (for v1.1)

- CR-1 (major): standalone harness must require explicit `standalone:true`; remove the auto-detection heuristic; keep removal handles.
- CR-2 (minor): eliminate per-frame allocations (tick payload, emit snapshot, keyMove return object).
- CR-4 (major): console polyfill at top of engine.js per §2.1.
- Plus: add the pre-approved §4 events to CANONICAL_EVENTS.
- Advisory A-1 stands: `pointerleave` releases held buttons — Combat/UI, design around this or file a CR if you need hold/charge mechanics.

## Build discipline [v1.1]

Integrator ships every build in two flavors: `build-NN.html` (clean) and `build-NN-diag.html` (error overlay + probes + FPS badge). Department test harnesses should include the diag layer — the phone is the QA rig and cannot otherwise report errors.
