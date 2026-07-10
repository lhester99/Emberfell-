# EMBERFELL — CHANGELOG

## build-03 (playtest fixes) — 2026-07-09, Integrator/QA

**Deliverables:** `build-03.html` (clean), `build-03-diag.html` (overlay +
FPS badge + hp/stamina line), `index.html` (= clean build). Responds to the
build-02 phone playtest.

### Playtest item 1 — enemies floating / spawning off-map: FIXED

**Root cause was NOT the flat-terrain stub.** `enemies.js`'s `groundAt`
fallback chain was already correct — it prefers `EF.world.terrainH` for both
spawn placement and per-frame ground height, and World's sampler was active
at spawn time (World subscribes to `game:booted` before Combat in load
order). The actual bug: **`terrainH` is analytic** — it happily returns
heights for any (x,z) — but the visual terrain mesh only spans 220×220
(edges at ±110). Three spawn zones poked past the mesh (wolf to z=−150,
skeleton to z=−125, bandit to x=−120) and the troll zone was centered on the
exact map corner (110,−110), reaching (170,−170). Enemies out there stood on
invisible analytic ground — including the +20 m mountain ridge — reading as
"floating, off-map."

Fixes (marked `[build-03 integrator patch]` in source):
- `enemies.js`: spawn candidates outside the mesh (±size/2 − 4 m margin,
  read from `EF.worldData` with a safe fallback) are rejected; the fallback
  spawn is the zone center clamped onto the mesh. Per-frame AI movement
  (chase/lunge/knockback/wander) is clamped to the same bound — no
  per-frame allocation, plain comparisons.
- `enemyTypes.js`: troll zone moved in-bounds, `{cx:80, cz:−80, r:24}` —
  still the remote NE corner.
- `player.js`: the hardcoded ±200 position clamp had the same latent bug
  (mesh ends at ±110); now clamps to the mesh extent from `EF.worldData`.

Verified headless: all 14 enemies on-mesh, `root.position.y` equal to
`terrainH(x,z)` to within 0.01, zero off-mesh after spawn and while ticking.

### Playtest item 2 — scene membership & fog distance: CONFIRMED

All 14 spawned enemies have `root.parent === EF.engine.scene`. Distances at
spawn: 4 of 14 within the 60 m fog-far (wolves/bandits near the village
ring); the rest sit 63–119 m out in their remote zones — **fog-hidden at
spawn is expected behavior**, they appear as you approach. The
away-from-player spawn rule (>32 m) guarantees none pop in point-blank.

### Playtest item 3 — temporary diagnostic controls: ADDED

New integrator module `diag-controls.js` ships in BOTH build-03 flavors
(marked TEMPORARY — delete when UI delivers in Cycle 3):
- **ATK** / **JMP** touch circles bottom-right, **RESPAWN** pill bottom
  center. All three bound via `EF.engine.input.bindButton`, so Attack and
  Jump flow through the exact `wasPressed()` edges combat.js and player.js
  already poll, and every press emits the canonical `input:button` event.
  Respawn polls its own button edge on `game:tick` and calls
  `EF.combat.respawn()` → `player.respawnAt()` → `player:spawned`.
- Contract-clean: cssText only (§2.2), no private rAF, no per-frame
  allocation; pressed-state feedback rides the `input:button` event.

Verified headless via real DOM taps: JMP → airborne; ATK → swing state
machine ran and a wolf took damage (40→35); kill → movement locked while
dead → RESPAWN tap → alive at village spawn, hp/st restored to full.
Zero console errors; self-test 26/26 PASS.

Note: draw-call budget unchanged from build-02 (max 84 observed this run —
V-1/CR-5 against enemy mesh counts still open with Combat dept).

### ⛔ CR-5 escalated to CYCLE 3 BLOCKER (2026-07-10)

No fix has landed from Combat since build-02. Max observed draw calls: 87
(build-02), 84 (build-03) vs the ≤60 budget — and Cycle 3 integration will
only push this UP: Quests adds POI/map markers and UI adds HUD elements,
each of which costs draw calls out of the same budget. CR-5 (merge enemy
bodies into 1–2 vertex-colored meshes keeping only animation pivots
separate, or InstancedMesh per part; pool the hp bars) must be resolved
**before or alongside** Quests/UI integration, or build-04 ships over
budget by construction. Integrator will not sign off a Cycle 3 build over
60 calls.

### World bounds — guidance for Quests (Cycle 3)

Asked and answered as far as the delivered data can answer: the 220×220
extent (`EF.worldData.terrain.size`, edges at ±110) reads as *tuned, not
placeholder* — the mountain ridge crests exactly at the north edge
(full influence z=−104), the sky dome (r=100), sun/moon transit (r=88),
fog (16–58 m), and the engine camera far plane (120) are all scaled to it,
and every POI sits within ±40. Only World Builder can rule it "final,"
though — confirmation requested for Cycle 3 kickoff.

**Binding guidance regardless of that answer:** do NOT hardcode ±110.
Read `EF.worldData.terrain.size` at runtime (this is exactly what the
build-03 patches in enemies.js/player.js do), and place POI markers from
`EF.world.pois` — `[{id, label, x, z, y, radius}]` — which is
bounds-correct by construction and already carries the resolved plateau
height `y` for marker anchoring.

**RATIFIED 2026-07-10 as Contract §1 addendum revised [v1.1 rev A]** (see
`engine/emberfell-contract-v1.1.md`): world bounds are not a fixed number —
query `EF.worldData.terrain.size` at runtime; POI anchoring uses
`EF.world.pois`; no department places anything in world space against a
literal bound. Compliance sweep at ratification: enemies.js and player.js
query the runtime value (their literal fallbacks apply only to
module-standalone harnesses without World, per the addendum's carve-out);
no other module places world-space content against a literal bound.
AR-1 (`combat:damage` event) and AR-2 (EF.data/worldData registry) remain
open with Engine Core.

---

## build-02 (Cycle 2 integration) — 2026-07-09, Integrator/QA

**Deliverables:** `build-02.html` (clean), `build-02-diag.html` (error overlay +
probes + FPS badge per Contract v1.1 "Build discipline"), `index.html`
(identical to the clean build). Single-file HTML, artifact-sandbox-ready:
three.js r128 from cdnjs with `crossorigin="anonymous"` (§2.3), zero `<style>`
tags (§2.2), ASCII-clean (§2.5).

**QA rig:** headless Chromium (r128 via Playwright, SwiftShader software GL,
402×708 viewport per §2.4 device reference). FPS numbers from this rig are NOT
representative of the phone; draw-call and error counts are. Phone pass on
`build-02-diag.html` still required before acceptance.

---

### Contract §10 checklist — results

| # | Check | Result |
|---|-------|--------|
| 1 | File headers + dependency versions | **PASS** — all modules declare THREE r128 + Contract v1.1; engine.js is v1.1 (CR-1/CR-2/CR-4 landed, 26-event registry) |
| 2 | Assemble in load order, zero console errors | **PASS** — 0 errors, 0 warnings at idle in both builds; engine self-test **PASS (26/26 canonical events)** |
| 3 | Forbidden APIs (§2) + per-frame allocations (§7) | **PASS** — details below |
| 4 | No undeclared EF keys | **PASS with amendment request AR-2** — runtime EF keys: `bus, engine, worldData, world, data, player, enemies, combat, npcs, quests, ui` |
| 5 | Draw calls ≤ 60 | **FAIL** — measured max **87** at spawn (settles to 58–66 while exploring; 63–65 across the full day cycle). Violation V-1, CR filed against Combat dept |

### Per-module verdict

| Module | Dept | Verdict | Notes |
|--------|------|---------|-------|
| engine.js v1.1 | Engine Core | **PASS** | Console polyfill first statements (CR-4) verified; no harness in integrated build (CR-1) verified; reused tick/resize payloads (CR-2) verified. `console.info/table` used internally — legal post-polyfill |
| data/biomes.js | World | **PASS** | Pure data, no THREE/engine dependency, ASCII-clean |
| world.js | World | **PASS** | Exemplary draw-call discipline: terrain+sky+sun+moon+stars+merged POIs+water+flame+4 instanced scatter = **12 calls total**. `terrainH` registered via `setGroundSampler` in `game:booted`; canonical events only; in-place tick updates, zero per-frame allocation |
| data/weapons.js | Combat | **PASS** | Pure data + factories; grip-at-origin convention documented |
| data/enemyTypes.js | Combat | **PASS (data)** | Implicated in V-1: models are 9–13 unmerged meshes each — see CR-5 |
| player.js | Combat | **PASS** | Equips via pre-approved `weapon:equip` (now canonical in engine v1.1 — no warn); stamina ownership respected; A-1 respected (run from stick magnitude, no hold) |
| enemies.js | Combat | **FAIL (perf budget only)** | Functionally correct (14-enemy pool spawns, AI wrinkles run, hp bars billboard, combat wiring verified end-to-end). Draw-call violation V-1 below. No per-frame allocation found — numeric scratch discipline held |
| combat.js | Combat | **PASS with AR-1** | Sole-hp-writer boundary verified live (hurtPlayer 100→93; swing dropped wolf 40→25 through the real state machine). Emits non-canonical `combat:damage` — warned exactly once, as its header predicts |
| npcs.js / quests.js / ui.js | — | **STUB** | Integrator-authored empty modules reserving `EF.npcs` / `EF.quests` / `EF.ui` |

### §2 forbidden-API grep

- Smart quotes U+2018/2019/201C/201D: **0 matches** across all sources and both builds.
- `console.*` beyond log/warn/error: only inside engine.js, after its own CR-4
  polyfill — allowed. World/Combat modules clean.
- Private rAF loops / `setInterval`: **none** outside engine.js. All modules
  ride `game:tick`.
- `<style>` tags, `innerHTML`, `document.write`, `eval`: **none** (all
  `<style` grep hits are inside comments).

### §7 per-frame allocation audit

- engine.js: reused `TICK_PAYLOAD`/`RESIZE_PAYLOAD`, copy-on-write bus (zero
  alloc on emit), keyboard writes straight into `input.move` — CR-2 confirmed.
- world.js: sky dome recolored in place (187 verts), water verts in place,
  palette lerps into module-scope Colors. Allocation only at event rate
  (pickup collect) — acceptable.
- player.js / enemies.js / combat.js: number math + module-scope scratch;
  emit payload objects allocated only at event rate (hits, deaths, spawns).
- diag overlay (diag build only): allocates strings at 4 Hz updating its DOM
  text — documented, never ships in the clean build.

### Violations & change requests

- **V-1 / CR-5 (major, Combat dept): draw-call budget exceeded.** Measured
  max 87 vs the ≤60 budget at the village spawn. Attribution: each enemy is
  9–13 individual meshes plus 2 hp-bar planes; the 14-enemy pool is a
  worst-case ~176 potential calls, and the wolf zone (cx 0, cz −60, r 90)
  overlaps the spawn. Requested fix, pick either: (a) bake each enemy model
  into 1–2 merged vertex-colored meshes (world.js `endMerge` pattern) with
  leg/telegraph pivots kept as the only separate nodes, or (b) InstancedMesh
  per body part per type. HP bars → one shared billboard per enemy or a
  pooled sprite sheet. World's 12-call total shows the budget is realistic.
- **AR-1 (amendment request, Engine Core): add `combat:damage` to
  CANONICAL_EVENTS.** Payload `{ amount, crit, target: 'enemy'|'player'|'heal',
  position: {x,y,z} }`, emitter combat, consumer UI (floating damage
  numbers). combat.js's header already flags this as pending; it warns once
  at the first hit until amended.
- **AR-2 (amendment request, contract §5/EF registry): ratify `EF.data` and
  `EF.worldData`.** Combat parks shared data under `EF.data.*`
  (weapons, enemyTypes); World uses a sibling `EF.worldData`. Both work but
  the split is inconsistent — recommend converging on `EF.data.*` in Cycle 3
  (`EF.data.world` or fold `worldData` in) and declaring the registry:
  `bus, engine, world, worldData, data, player, enemies, combat, npcs,
  quests, ui`.

### Deviations & integrator fixes

- **D-1 (load order):** the task sheet's coarse order
  (engine → world → enemies → combat → player) contradicts the binding module
  headers (player.js: "before combat.js/enemies.js"; combat.js: "Load order:
  LAST"). Headers win. Shipped order: three.js → engine.js → data/biomes.js →
  world.js → data/weapons.js → data/enemyTypes.js → player.js → enemies.js →
  combat.js → npcs (stub) → quests (stub) → ui (stub) [→ diag overlay in the
  diag build]. Verified boot- and tick-clean in this order.
- **F-1 (assembly fix, Engine Core FYI):** engine.js's header comment contains
  a literal `</script>` (the §2.3 example tag). Inlined verbatim it terminates
  the build's script block and the whole page dies with a SyntaxError. The
  assembler escapes `</script` → `<\/script` at build time; source files are
  untouched. Engine Core: please break up literal closing script tags in
  comments (`<\/script>`) in the next drop.
- **F-2 (repo hygiene):** root file `character` is a byte-identical duplicate
  of `Combat:/weapons.js` — excluded from the build; recommend deletion. The
  directory names `World:` and `Combat:` contain a colon, which is
  uncheckoutable on Windows — recommend renaming to `world/` and `combat/`.
  Stale comment in world.js (lines 43–44) references the removed v1.0
  harness auto-detection heuristic — harmless, tidy next cycle.

### Runtime verification log (headless rig)

- Boot: `game:booted` → world ready (POIs: village, tower, stones, arch,
  lake; scatter pine=399 birch=130 rock=181 tuft=370 in 4 draw calls) →
  14 enemies across 4 zones → stubs loaded. **0 console errors.**
- `EF.engine.selfTest()`: **PASS**, 26/26 canonical events echoed with
  `__selfTest` payloads; no gameplay handler reacted.
- Combat smoke test: `EF.combat.hurtPlayer(7,'qa-test')` → hp 100→93 +
  `player:damaged` + camera shake; `weapon:equip {id:'greatsword'}` →
  equipped and model re-parented; real KeyF swing through the
  windup/active/recover machine hit a wolf for 15 (40→25 hp) with knockback;
  `EF.world.spawnPickup('herb',0,8)` returned a live remove handle.
- Draw calls: 80–87 during the first 12 s at spawn (**over budget**, V-1),
  58–66 while moving, 63–65 across a forced full day-cycle sweep
  (t = 0, 0.25, 0.5, 0.75).
