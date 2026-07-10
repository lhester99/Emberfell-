# EMBERFELL — CHANGELOG

## Build history (Integrator/QA ledger)

| Build | Cycle | Date | Summary |
|-------|-------|------|---------|
| build-01 | 1 | pre-repo | Engine Core standalone smoke build (engine.js v1.0/v1.1 harness; predates this repo's integration history — not in git) |
| build-02 | 2 | 2026-07-09 | First integration: engine + World + Combat, Quests/NPCs/UI stubbed. Zero errors; draw budget FAIL (87/60 → CR-5) |
| build-03 | 2.5 | 2026-07-09 | Playtest fixes: off-mesh spawn clamps (analytic terrainH vs mesh edge), troll zone, player bound; temporary ATK/JMP/RESPAWN controls |
| build-04 | 3 | 2026-07-10 | Quests & NPCs integrated (6 quests, 5 NPCs); Combat CR-5 enemy batching (16 fixed calls, CR-5 closed); UI missing → temp UI shim; CR-6 (NPC meshes 99/60) + CR-7 (rewards uncredited) filed |
| build-05 | 3 | 2026-07-10 | UI/UX integrated (HUD, panels, dialogue, map+minimap, death/title); EF.state adapter glue; 5 UI bugs patched (map unclosable, 4× map scale, death-under-map, payload/field mismatches) |
| build-06 | 4 | 2026-07-10 | Polish integration + herb-pickup fix verified by dept test (4/4); setPlayerObject seam glued (pickups + camera occlusion were dead in all prior builds); damage-number anchoring payload patched; CR-6 re-escalated (fix not delivered) |

### Change requests (CR) — status

| ID | Owner | Status | Summary |
|----|-------|--------|---------|
| CR-1 | Engine | ✅ closed (v1.1) | Standalone harness explicit-only |
| CR-2 | Engine | ✅ closed (v1.1) | Zero per-frame allocations on engine paths |
| CR-4 | Engine | ✅ closed (v1.1) | Console polyfill first statements |
| CR-5 | Combat | ✅ closed (build-04) | Enemy pool → InstancedMesh batches (16 fixed calls; reference implementation for CR-6) |
| CR-W2 | World→Engine | 📋 open (advisory) | Rig-native camera occlusion would drop world.js's wheel-tracking bookkeeping |
| CR-6 | Quests/NPCs + Combat | ⛔ OPEN — **Cycle 5 blocker, re-escalated build-06** | Draw budget: 5 NPC humanoids = 67 meshes, player rig = 21 → village night fire 99/60. Claimed fixed in Cycle 4; **no fix present in delivered code** (enemies.js/combat.js byte-identical to Cycle 3, npcs.js has no batching). Apply the CR-5 merge/instancing pattern |
| CR-7 | Quests + Combat | ⛔ open | Quest rewards announced, never credited (no module reads `questData[id].reward` on quest:completed; Combat is the stats authority — `gainXp` already public) |
| CR-8 | Combat | ⛔ open (glued by integrator) | `EF.world.setPlayerObject` never called from the spawn path ("Combat: call this" since Cycle 2) — pickup collection and Cycle 4 camera occlusion were dead in every integrated build until adapter glue in build-06 |

### Amendment requests (AR) — status

| ID | Status | Summary |
|----|--------|---------|
| §1 rev A | ✅ ratified 2026-07-10 | Runtime world bounds (`EF.worldData.terrain.size`) + POI anchoring via `EF.world.pois`; no literal bounds |
| AR-1 | ⛔ open | Canonicalize `combat:damage` (warns once per boot; UI consumes it for damage numbers) |
| AR-2 | ⛔ open | EF key registry: ratify `EF.data`, `EF.worldData`, `EF.questData`, `EF.dialogue`, `EF.state` |
| AR-3 | ⛔ open | Enrich `quest:*` payloads with `title` (UI banners show generic fallbacks) |
| AR-4 | ⛔ open | `EF.state` ownership → Player dept (currently integrator adapter glue) |
| AR-5 | ⛔ open | Canonicalize/repoint UI ask-side events: `ui:menu`, `ui:start`, `ui:track`, `player:respawn` + Cycle 4 additions `journal:entry`, `dialogue:ambient` |
| AR-6 | ⛔ open (new, build-06) | Ratify ONE `combat:damage` payload shape — combat ships `position:{x,y,z}`, UI assumed flat `{x,z,y}`; integrator patch accepts both |


## build-06 (Cycle 4 polish + bug fixes) — 2026-07-10, Integrator/QA

**Deliverables:** `build-06.html`, `build-06-diag.html`, `index.html` (=
clean). Cycle 4 polish merged from all delivering departments; **herb-pickup
test ran first and passed** per task priority.

### Task 1 — tests/herb-pickup (`Test:/pickup_repro.js`): PASS 4/4

Run against the REAL world.js pickup path with real terrainH: 3 herbs spawn
on the new `ringMin/ringMax` shore ring (17–19 m from lake centre, clear of
the 11.8 m water disc +1 m), walking onto each fires `loot:collected`, quest
reaches `ready`. Two integrator fixes to the test harness only (marked): the
THREE stub predated Cycle 4's camera-occlusion `Raycaster`, and the engine
camera stub lacked `setDistance` — both stubs extended; test logic untouched.

### What Cycle 4 actually delivered vs the task sheet

- **World ✓** — vertex-color/terrain polish, rock clusters (scatter rock
  181→215), and NEW camera occlusion (raycast pull-in vs `world.occluders`).
- **Combat ⚠ partial** — ONLY the weapon-attachment fix landed (mount seated
  at the fist: forward 0.22 m, tilt so the blade points out of the hand).
  `enemies.js` and `combat.js` are **byte-identical to Cycle 3**: no
  hit-stop, no new death animation, no walk bob, no staggered aggro, and
  **no CR-6 fix** (see re-escalation below). The "enemy death animation"
  phone-test item passes via the existing CR-5 topple+sink.
- **Quests/NPCs ✓** — herb spawn ring fix, NPC idle set (weight shift,
  breathing, head glance), ambient barks (`dialogue:ambient`), gossip
  nodes, quest journal (`getJournal()` + `journal:entry`).
- **UI ✓** — low-HP vignette, smooth bar lerp/gold roll, floating damage
  numbers with world→screen projection, banner auto-dismiss (timeout +
  animation), pickup pop animations.

### Integration bugs found & fixed this build

- **CR-8 (new, Combat): `EF.world.setPlayerObject` had no caller — pickup
  collection was dead in EVERY integrated build.** world.js has exposed the
  hook since Cycle 2 ("Combat: call this from your spawn path"); no module
  ever called it, so proximity collection AND Cycle 4's camera occlusion
  (both gate on `playerObj`) never ran in browser builds. The dept unit
  test passes because it registers the player itself — masking the seam.
  Glued in `integration/state-adapter.js` (register on boot + respawn);
  verified live: 3/3 herbs collected, odda.herbs completed, journal entry
  fired. Combat should own this call in Cycle 5.
- **Damage numbers anchored at screen-centre, not the enemy:** ui.js's new
  handler assumed a flat `{x,z,y}` `combat:damage` payload; combat.js ships
  `position:{x,y,z}` (unchanged since Cycle 2). Integrator patch accepts
  both shapes (AR-6). Verified: numbers now project to the struck enemy in
  px; the player's own "-N" popup (separate handler) unchanged.
- **Upload-over regressions caught AGAIN at merge:** UI's Cycle 4 files were
  polished on a pre-build-05 base — all five build-05 UI patches (map
  unclosable, 4× map scale, death-under-map soft-lock, speaker field, POI
  fields) were missing and have been re-applied. The stale contract (minus
  §1 rev A) was re-uploaded a third time; merge kept the ratified copy.
  **Departments must pull the integration branch before editing.**

### §10 checklist

| # | Check | Result |
|---|-------|--------|
| 1 | Headers + dependency versions | PASS (world/quests/ui headers updated for Cycle 4; combat headers unchanged — consistent with unchanged files) |
| 2 | Zero console errors | PASS — clean and diag builds; engine selfTest 26/26; warns = known non-canonical set + new `dialogue:ambient`, `journal:entry` (AR-5) |
| 3 | Forbidden APIs / per-frame allocs | PASS — greps clean; vignette/bar smoothing are per-frame style writes (no allocation); occlusion raycast throttled to every 3rd frame |
| 4 | Draw calls ≤60 | **FAIL — CR-6 RE-ESCALATED.** Roam max 45 ✓; village day 73; night fire circle **99/60** — unchanged, because the claimed fix is not in the delivered code |
| 5 | CSS via cssText | PASS — zero static `<style>`; ui.js's single runtime-injected keyframe sheet unchanged (§2.2 carve-out; verified animating headless — efBanner/efRise run) |

### Priority phone-test items (headless pre-verification)

| Item | Result |
|------|--------|
| Floating damage numbers | PASS (after AR-6 patch: anchored above enemy, crit styling in place) |
| HP vignette at low health | PASS — opacity 0.32 at 15% hp, 0 at full |
| Weapon sits in hand | PASS — mount at fist (z 0.22, y −0.84, tilt 0.55π), model parented; **confirm the look on-device** |
| Herb pickup | PASS — full loop: accept → 3 spawns on shore ring → 3 collected → ready → turn-in → journal |
| NPC idle animations | PASS — leg sway Δ0.665, breathing Δ0.010 while unobserved |
| Enemy death animation | PASS — topple to π/2 + sink (pre-existing CR-5 behavior; no new polish landed) |
| Quest banner auto-dismiss | PASS — visible ≤3.0 s, display:none by 3.6 s (probe-verified) |
| Draw calls in diag overlay | Working — badge shows live/max vs 60; expect OVER BUDGET at the village until CR-6 lands |

---

## build-05 (UI/UX integration) — 2026-07-10, Integrator/QA

**Deliverables:** `build-05.html`, `build-05-diag.html`, `index.html` (=
clean). UI/UX delivery (`UI:/ui.js`, `UI:/map.js`) integrated; the build-04
temporary UI shim is **deleted** — the real UI owns all touch controls, HUD,
panels, dialogue, map, and death/title screens. Load order appends:
… npcs → **state-adapter (integrator glue) → ui → map** [→ diag overlay].

### The EF.state gap and the integration adapter

ui.js/map.js READ an authoritative `EF.state` view and ASK for changes via
events (`player:respawn`, `ui:track`, `item:use`) — a data contract **no
gameplay department publishes or consumes**. Unbridged, the HUD runs on
fallback dummy data, the map arrow never moves, and the death screen's
"Rise Again" does nothing. New `integration/state-adapter.js` (TEMPORARY
integrator glue) bridges both directions using only public surfaces:
mirrors `EF.player.stats/position` + `EF.quests` views into `EF.state`
(mutate-in-place per tick; arrays rebuilt at event rate only), maintains an
inventory ledger from `loot:collected`/`item:use`, and wires
`player:respawn`→`EF.combat.respawn()`, `ui:track`→`EF.quests.track()`,
`item:use(potion)`→`EF.combat.heal(30)` (heal() is combat.js's documented
UI/inventory hook; **30 hp is a placeholder** pending Combat's item table).
**AR-4:** ratify `EF.state` ownership — it should belong to a gameplay dept
(Player) in Cycle 4, replacing this adapter.

### UI bugs found & patched at integration (all marked `[build-05 integrator patch]`)

- **map.js `el()` helper dropped its text argument** — its own call sites
  pass (tag, css, TEXT). Result: the "MAP" title and the ✕ close glyph never
  rendered; with the frame covering the full 402 px width (no tappable
  backdrop gutter), the map was **unclosable on the phone**. Helper now
  matches ui.js's 3-arg signature.
- **map.js scale bug:** `terrain.size` (220, FULL extent per §1 rev A) was
  used as the half-extent, so the chart mapped ±220 and the world bunched
  into the middle quarter. Now maps ±size/2.
- **Death/title screens rendered UNDER an open map:** overlays were children
  of the UI root (z10 stacking context) so their z20 could never beat the
  body-level map root (z18) — dying with the map open soft-locked "Rise
  Again". Overlays now mount on document.body at z30.
- **Dialogue payload:** npcs.js emits `speaker`; ui.js read only `p.name`
  (blank speaker line). Accepts both now.
- **POI fields:** map expected `{name,type}`; world pois carry `{id,label}`
  (§1 rev A). Fallbacks added so pins get glyphs + captions.

### §10 spot-check

- Zero console errors both builds; engine selfTest 26/26; ui.selfTest PASS.
- §2.2 note: ui.js injects one runtime-built `<style>` (keyframes/:active —
  things cssText cannot express), with graceful degradation if stripped, per
  the §2.2 carve-out "verify it survives on-device". **Phone pass must
  confirm** damage flash + banners animate; everything else is cssText.
- Non-canonical events now warned once each: `combat:damage` (AR-1),
  `ui:menu`, `ui:start`, `ui:track`, `player:respawn` (**AR-5:** canonicalize
  or re-point this UI ask-side set in the §4 table).
- quest banners show "New quest"/"Quest complete" fallbacks — quests.js
  `quest:*` payloads carry only `{id}`; AR-3 payload enrichment (add
  `title`) would light them up.
- **CR-6 unchanged and still blocking:** village day 74, night fire circle
  **99/60** (67 NPC meshes + 21 player meshes; enemies stay at 16 batched).
  Roaming is within budget (max 56). The map/minimap are 2D canvas — zero
  WebGL draw-call cost.

### Full UI verification (headless, real taps end-to-end)

Title → "Enter World" → play mode. HUD tracks real stats (hp bar + numbers
mirror `EF.player.stats`; weapon chip "Pinewatch Sword"). Talk button
appears within 4 m of Maren via the adapter's interact probe → dialogue
panel (speaker + text + choices) → accept → quest banner + toast + journal
("maren.wolves: active", others "offered") → 5 wolf kills → counter 5/5 →
turn-in → quest:completed. Bag panel lists a looted Healing Potion; "Use"
heals 70→100 and decrements the ledger. Map opens (relief chart, POI
captions, player arrow, quest pin; 7 `map:setMarker` events) and closes via
✕. Death → "YOU DIED" screen → "Rise Again" → revived at full hp in play
mode. Minimap redraws at 5 Hz throughout.

---


## build-04 (Cycle 3 integration) — 2026-07-10, Integrator/QA

**Deliverables:** `build-04.html` (clean), `build-04-diag.html` (overlay +
FPS badge), `index.html` (= clean). New this cycle: Quests & NPCs delivery
integrated (questData, dialogue, quests, npcs — 6 quests, 5 NPCs), Combat's
CR-5 enemies.js rewrite integrated.

### ⚠ UI DEPARTMENT DID NOT DELIVER

The task sheet lists `ui/ui.js` + `ui/map.js`; neither exists on any branch
of the repo. Consequences, handled as follows:
- The instruction "remove diag-controls.js — UI now owns all touch controls"
  is void: with no UI there are no touch controls, no dialogue renderer, no
  toast display, no quest HUD, no map. Every Cycle 3 priority test would be
  untestable on the phone.
- Integrator therefore REPLACED diag-controls.js with **ui-temp.js**
  (TEMPORARY, both build flavors): ATK/JMP/TALK buttons via
  `input.bindButton` (npcs.js already polls the `interact` edge), RESPAWN
  pill shown only while dead, a dialogue panel rendering `dialogue:open`
  choices (taps call `EF.npcs.choose(i)` per npcs.js's own guidance), `ui:toast`
  rendering, a tracked-quest HUD refreshed at event rate from
  `EF.quests.objectiveText`, and a `map:setMarker` text line. Contract-clean:
  cssText only, no rAF, event-rate DOM writes. **Delete when UI ships.**
- `EF.ui` stays a reserved stub. `Quests:/harness.js` is a Node-only test
  harness (`require`/`vm`) and is excluded from browser builds.

### §10 checklist — results

| # | Check | Result |
|---|-------|--------|
| 1 | Headers + dependency versions | **PASS** — Quests modules declare THREE r128 / engine v1.1 / world deps and honor §1 rev A (POI-anchored NPC placement, no literal world coords) |
| 2 | Zero console errors on boot | **PASS** — 0 errors both builds; selfTest 26/26 PASS |
| 3 | Forbidden APIs + per-frame allocations | **PASS** — Quests files grep clean (ASCII, console.log/warn/error only, no rAF/`<style>`/innerHTML); quests.js goto scan throttled at 4 Hz; npcs.js tick is allocation-free |
| 4 | Draw calls ≤60 | **CR-5 CONFIRMED FIXED & CLOSED** for enemies: pool is now 16 fixed calls (4 instanced bodies + 10 limb batches + 2 shared hp bars, was ~170 potential). **BUT the budget FAILS again with new attribution — CR-6 filed**: measured 45 roaming, 73 at the village by day, **99 at the night fire circle** (all 5 NPCs seated + player + stars). npcs.js builds 5 unmerged humanoids = **67 meshes**; player rig is 21 more (Combat) |
| 5 | CSS via cssText only | **PASS** — zero `<style>` tags anywhere (all grep hits are comments); every style in engine/ui-temp/diag is `el.style.cssText` or inline attribute |

### Priority tests (headless rig, real button taps end-to-end)

| Test | Result |
|------|--------|
| Movement | PASS (WASD + joystick path unchanged) |
| Combat | PASS — greatsword swings killed a wolf through the real state machine |
| Death → respawn | PASS — RESPAWN appears on death, revives at village, full hp |
| Talk to NPC | PASS — TALK tap → `dialogue:open` (Maren, wolves offer), panel renders |
| Accept quest | PASS — choice tap → `quest:started`, toast, HUD tracker |
| Kill counter | PASS — "Slay timber wolves (5/5)" via `enemy:died` events only |
| Complete quest | PASS — turn-in at Maren → `quest:completed`, retrack |
| Map marker | PARTIAL — `map:setMarker` emitted correctly and rendered as HUD text by the shim; **no real map exists (UI/map.js missing)** |
| Inventory | **NOT TESTABLE — no inventory module exists in any department.** Closest ledger: `EF.player.stats` gold/xp (kill-credited by combat.js) |
| Level up | PASS — `player:levelup` fired, stats grew, heal-to-full on level |

### New findings

- **CR-6 (major, Quests/NPCs + Combat): draw-call budget re-escalated.**
  CR-5 is closed — the enemy fix works and is the reference implementation.
  Same treatment needed for: npcs.js humanoids (67 meshes → merge each body
  to 1–2 vertex-colored meshes keeping the 4 limb pivots, or instance the
  shared humanoid across all 5), and the player rig (21 meshes → merge
  static body, keep arm/leg/cloak pivots). Projected result: village night
  scene ~35–40 calls, comfortably under 60.
- **CR-7 (major, cross-dept Quests+Combat): quest rewards are never
  credited.** quests.js announces rewards ("+100 gold, +150 XP" toast) and
  deliberately defers crediting to "a Player module reading
  `questData[id].reward` on `quest:completed`" — no such module exists.
  Verified live: completing Wolves at the Gate paid 0 gold, 0 xp.
  Combat already exposes `EF.combat.gainXp`; recommend Combat own a
  `quest:completed` handler in Cycle 4 (it is the stats-math authority).
- **AR-1 still open** (`combat:damage` not canonical; warns once per boot).
  **AR-2 scope grows:** new EF keys `EF.questData`, `EF.dialogue` need
  registry ratification.
- **AR-3 (new):** `map:setMarker` and `dialogue:open`/`dialogue:choice`
  payloads as actually shipped are richer than the §4 table
  (`{questId,label,x,y,z,radius}` / `{npc,speaker,text,choices}` /
  `choiceId` vs `index`). Names are canonical so nothing warns; the table
  should be amended to the shipped shapes before UI codes against them.

### Integration notes

- **D-2 (load order):** task order "…npcs → quests…" contradicts the headers
  (npcs.js hard-fails without EF.quests). Shipped: questData → dialogue →
  quests → npcs. Headers win, as in D-1.
- **Upload-over regression caught at merge:** Combat's re-uploaded files were
  based on pre-build-03 sources — the off-mesh spawn fixes and the troll
  zone fix would have silently reverted. The bounds patch was re-applied to
  the CR-5 rewrite (marked `[build-03 integrator patch, re-applied …]`);
  troll zone, player clamp, and the ratified §1 addendum survive via the
  merge. **Departments: pull the integration branch before editing, or the
  next re-upload will revert ratified fixes again.** Verified post-merge:
  14/14 enemies on-mesh.

---


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
