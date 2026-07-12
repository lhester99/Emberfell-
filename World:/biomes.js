/* ============================================================================
 * EMBERFELL — data/biomes.js  (v1.0, Cycle 2)
 * Department: World Builder. Pure data — no THREE, no engine dependency.
 * Load order: three.js -> engine.js -> data/biomes.js -> world.js
 * Contract v1.1 notes: ASCII quotes only (SS2.5); no console.info anywhere.
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});

  EF.worldData = {

    seed: 1337,

    /* ---- terrain field ---------------------------------------------------
     * world.js builds terrainH(x,z) from these numbers. Analytic FBM value
     * noise + a northern mountain ridge (negative z). POIs below flatten
     * the field locally, and the flattening is part of terrainH itself so
     * the sampler and the visual mesh can never disagree.
     * -------------------------------------------------------------------- */
    terrain: {
      /* [build-09] world expanded from +/-110 to +/-200 (size 220 -> 400).
       * Mesh spacing kept near 2.2 m (segments 180) so detail holds; the
       * whole terrain is still ONE draw call regardless of segment count. */
      size: 400,            // world extents: size x size, centered on origin (+/-200)
      segments: 180,        // visual mesh grid (~2.2 m vertex spacing)
      baseAmp: 2.9,         // rolling-hill amplitude (m) -- a touch more relief
      baseFreq: 0.045,
      octaves: 4,
      lacunarity: 2.05,
      gain: 0.5,
      mountain: {           // ridge rising toward the north edge (bigger world)
        start: -70,         // influence begins as z drops past this
        full: -180,         // full influence near the north edge
        height: 30,         // added meters at full influence
        freq: 0.03,
        octaves: 3
      },
      canyon: {             // [build-09] uncrossable river canyon, east-west band
        z: -78,             // centre line (middle distance, north of the village)
        halfWidth: 7,       // flat channel half-width
        rim: 15,            // blend distance from channel to rim
        depth: 9,           // metres carved below the local ground
        waterY: -6.6        // water plane height inside the canyon
      },
      colors: {             // vertex-color palette, blended by height/slope
        grass:    0x4a7c3a,
        grassDry: 0x6f8b45,
        dirt:     0x77603e,
        rock:     0x7d7f86,
        snow:     0xe8edf4
      },
      snowHeight: 15.0,     // snow fades in above this elevation
      rockSlope: 0.72       // gradient magnitude where rock takes over
    },

    /* ---- points of interest ----------------------------------------------
     * Every POI with flatten:true carves a local plateau into terrainH.
     * drop = plateau height relative to the raw terrain at the center.
     * world.js exposes these (plus resolved y) as EF.world.pois.
     * -------------------------------------------------------------------- */
    pois: [
      { id: 'village', label: 'Emberfell Village', x: 0,   z: 10,  radius: 30, flatten: true, drop: 0    },
      { id: 'tower',   label: 'The Sealed Tower',  x: 32,  z: -24, radius: 8,  flatten: true, drop: 0.4  },
      { id: 'stones',  label: 'Standing Stones',   x: -30, z: -32, radius: 9,  flatten: true, drop: 0.2  },
      { id: 'arch',    label: 'Ruined Arch',       x: 20,  z: 36,  radius: 7,  flatten: true, drop: 0.1  },
      { id: 'lake',    label: 'Stillmere',         x: -36, z: 28,  radius: 13, flatten: true, drop: -2.4,
        water: 1.2 }        // water plane sits this far above the lake bed
    ],

    /* ---- biome scatter rules ----------------------------------------------
     * region kinds understood by world.js:
     *   circle {x,z,r} | ring {x,z,rMin,rMax} | zband {zMin,zMax}
     * Each rule scatters `count` instances of `mesh` (pine|birch|rock|tuft)
     * inside the region, rejecting samples that land in a POI, outside the
     * world, above maxSlope, or outside [minH,maxH]. `tint` multiplies the
     * mesh's baked vertex colors per instance (jitter adds variation).
     * -------------------------------------------------------------------- */
    /* [build-09] regions extended to the +/-200 world. Every rule scatters
     * via ONE InstancedMesh per species (world.js buildScatter) -- more
     * instances, NOT more draw calls. Counts kept moderate for phone tris. */
    biomes: [
      {
        id: 'village_clearing',        // kept clear; the stone wall sits at r~35
        region: { kind: 'circle', x: 0, z: 10, r: 34 },
        scatter: []
      },
      {
        id: 'pine_forest',             // the broad ring around the village
        region: { kind: 'ring', x: 0, z: 4, rMin: 38, rMax: 150 },
        scatter: [
          { mesh: 'pine', count: 520, minScale: 0.85, maxScale: 1.7,
            maxSlope: 0.62, minH: -2.5, maxH: 11, tint: 0xffffff, jitter: 0.22 },
          { mesh: 'tuft', count: 360, minScale: 0.7,  maxScale: 1.3,
            maxSlope: 0.5,  minH: -2.5, maxH: 9,   tint: 0xffffff, jitter: 0.3 },
          { mesh: 'rock', count: 60,  minScale: 0.35, maxScale: 1.0,
            maxSlope: 0.9,  minH: -3,   maxH: 12,  tint: 0x8b8d93, jitter: 0.18 }
        ]
      },
      {
        id: 'dark_forest',             // [build-09] dense dark wood, EAST quadrant
        region: { kind: 'circle', x: 120, z: -20, r: 78 },
        scatter: [
          { mesh: 'pine', count: 640, minScale: 1.0, maxScale: 2.0,
            maxSlope: 0.7, minH: -3, maxH: 16, tint: 0x5f7a58, jitter: 0.28 },   // darker canopy
          { mesh: 'pine', count: 280, minScale: 0.7, maxScale: 1.2,
            maxSlope: 0.7, minH: -3, maxH: 16, tint: 0x4c6350, jitter: 0.3 },    // shadowed understory
          { mesh: 'rock', count: 70, minScale: 0.5, maxScale: 1.8,
            maxSlope: 1.4, minH: -3, maxH: 18, tint: 0x6a6c72, jitter: 0.2 },
          { mesh: 'tuft', count: 160, minScale: 0.6, maxScale: 1.1,
            maxSlope: 0.5, minH: -3, maxH: 12, tint: 0x6f8a5a, jitter: 0.3 }
        ]
      },
      {
        id: 'birch_grove',
        region: { kind: 'circle', x: -90, z: 70, r: 46 },
        scatter: [
          { mesh: 'birch', count: 210, minScale: 0.8, maxScale: 1.5,
            maxSlope: 0.55, minH: -2.5, maxH: 8, tint: 0xffffff, jitter: 0.2 },
          { mesh: 'tuft',  count: 200, minScale: 0.7, maxScale: 1.2,
            maxSlope: 0.5,  minH: -2.5, maxH: 8, tint: 0xd9e08a, jitter: 0.25 }
        ]
      },
      {
        id: 'rocky_highlands',
        region: { kind: 'zband', zMin: -150, zMax: -80 },
        scatter: [
          { mesh: 'rock', count: 220, minScale: 0.5, maxScale: 2.8,
            maxSlope: 1.8, minH: 1, maxH: 22, tint: 0x84868e, jitter: 0.2 },
          { mesh: 'pine', count: 120, minScale: 0.7, maxScale: 1.2,
            maxSlope: 0.7, minH: 1, maxH: 15, tint: 0x9fb0a6, jitter: 0.15 }
        ]
      },
      {
        id: 'snowy_peaks',             // below the merged mountain cones, north edge
        region: { kind: 'zband', zMin: -198, zMax: -150 },
        scatter: [
          { mesh: 'rock', count: 150, minScale: 0.7, maxScale: 3.2,
            maxSlope: 2.4, minH: 10, maxH: 60, tint: 0xe4eaf1, jitter: 0.1 },
          { mesh: 'pine', count: 60, minScale: 0.6, maxScale: 1.0,
            maxSlope: 0.8, minH: 8, maxH: 24, tint: 0xdfe7e4, jitter: 0.1 }
        ]
      },
      {
        id: 'open_scrubland',          // [build-09] scattered rocks so open west/south is not empty
        region: { kind: 'zband', zMin: 40, zMax: 190 },
        scatter: [
          { mesh: 'rock', count: 130, minScale: 0.4, maxScale: 2.2,
            maxSlope: 1.4, minH: -3, maxH: 14, tint: 0x8a8c92, jitter: 0.22 },
          { mesh: 'tuft', count: 220, minScale: 0.6, maxScale: 1.2,
            maxSlope: 0.5, minH: -3, maxH: 10, tint: 0xbfd28a, jitter: 0.3 }
        ]
      },
      {
        id: 'west_reach',              // [build-09] rocks + tufts filling the western open ground
        region: { kind: 'zband', zMin: -40, zMax: 40 },
        scatter: [
          { mesh: 'rock', count: 90, minScale: 0.4, maxScale: 2.0,
            maxSlope: 1.4, minH: -3, maxH: 14, tint: 0x84868e, jitter: 0.22 }
        ]
      },
      {
        id: 'tower_ruins',                 // scattered rubble ringing the sealed tower
        region: { kind: 'ring', x: 32, z: -24, rMin: 9, rMax: 22 },
        scatter: [
          { mesh: 'rock', count: 40, minScale: 0.5, maxScale: 2.0,
            maxSlope: 1.5, minH: -4, maxH: 16, tint: 0x70727a, jitter: 0.22 }
        ]
      }
    ],

    /* ---- pickups ---------------------------------------------------------
     * Color per itemId for EF.world.spawnPickup(). Unknown ids fall back
     * to 'default'.
     * -------------------------------------------------------------------- */
    pickups: {
      radius: 1.5,          // proximity collect distance (m)
      bobHeight: 0.15,
      colors: {
        pelt:    0xa9743f,
        coin:    0xf2c14e,
        herb:    0x69c25f,
        ember:   0xff7a3c,
        'default': 0xcfd2da
      }
    }
  };
})();
