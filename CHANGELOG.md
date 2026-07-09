# EMBERFELL — CHANGELOG

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
