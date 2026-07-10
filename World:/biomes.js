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
      size: 220,            // world extents: size x size, centered on origin
      segments: 110,        // visual mesh grid (2 m vertex spacing)
      baseAmp: 2.6,         // rolling-hill amplitude (m)
      baseFreq: 0.045,
      octaves: 4,
      lacunarity: 2.05,
      gain: 0.5,
      mountain: {           // ridge rising toward the north edge
        start: -46,         // influence begins as z drops past this
        full: -104,         // full influence
        height: 20,         // added meters at full influence
        freq: 0.03,
        octaves: 3
      },
      colors: {             // vertex-color palette, blended by height/slope
        grass:    0x4a7c3a,
        grassDry: 0x6f8b45,
        dirt:     0x77603e,
        rock:     0x7d7f86,
        snow:     0xe8edf4
      },
      snowHeight: 12.5,     // snow fades in above this elevation
      rockSlope: 0.75       // gradient magnitude where rock takes over
    },

    /* ---- points of interest ----------------------------------------------
     * Every POI with flatten:true carves a local plateau into terrainH.
     * drop = plateau height relative to the raw terrain at the center.
     * world.js exposes these (plus resolved y) as EF.world.pois.
     * -------------------------------------------------------------------- */
    pois: [
      { id: 'village', label: 'Emberfell Village', x: 0,   z: 10,  radius: 15, flatten: true, drop: 0    },
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
    biomes: [
      {
        id: 'village_clearing',        // kept intentionally empty
        region: { kind: 'circle', x: 0, z: 10, r: 20 },
        scatter: []
      },
      {
        id: 'pine_forest',
        region: { kind: 'ring', x: 0, z: 4, rMin: 22, rMax: 82 },
        scatter: [
          { mesh: 'pine', count: 320, minScale: 0.85, maxScale: 1.6,
            maxSlope: 0.62, minH: -2.5, maxH: 9.5, tint: 0xffffff, jitter: 0.22 },
          { mesh: 'tuft', count: 240, minScale: 0.7,  maxScale: 1.3,
            maxSlope: 0.5,  minH: -2.5, maxH: 8,   tint: 0xffffff, jitter: 0.3 },
          { mesh: 'rock', count: 26,  minScale: 0.35, maxScale: 0.9,
            maxSlope: 0.9,  minH: -3,   maxH: 10,  tint: 0x8b8d93, jitter: 0.18 }
        ]
      },
      {
        id: 'birch_grove',
        region: { kind: 'circle', x: 54, z: 24, r: 32 },
        scatter: [
          { mesh: 'birch', count: 130, minScale: 0.8, maxScale: 1.45,
            maxSlope: 0.55, minH: -2.5, maxH: 7, tint: 0xffffff, jitter: 0.2 },
          { mesh: 'tuft',  count: 130, minScale: 0.7, maxScale: 1.2,
            maxSlope: 0.5,  minH: -2.5, maxH: 7, tint: 0xd9e08a, jitter: 0.25 }
        ]
      },
      {
        id: 'rocky_highlands',
        region: { kind: 'zband', zMin: -92, zMax: -48 },
        scatter: [
          { mesh: 'rock', count: 95, minScale: 0.5, maxScale: 2.4,
            maxSlope: 1.6, minH: 1, maxH: 14, tint: 0x84868e, jitter: 0.2 },
          { mesh: 'pine', count: 55, minScale: 0.7, maxScale: 1.15,
            maxSlope: 0.7, minH: 1, maxH: 11, tint: 0xbfc9c2, jitter: 0.15 }
        ]
      },
      {
        id: 'snowy_peaks',
        region: { kind: 'zband', zMin: -110, zMax: -86 },
        scatter: [
          { mesh: 'rock', count: 60, minScale: 0.6, maxScale: 2.8,
            maxSlope: 2.2, minH: 8, maxH: 40, tint: 0xe4eaf1, jitter: 0.1 },
          { mesh: 'pine', count: 24, minScale: 0.6, maxScale: 1.0,
            maxSlope: 0.8, minH: 8, maxH: 20, tint: 0xdfe7e4, jitter: 0.1 }
        ]
      },
      {
        id: 'tower_ruins',                 // scattered rubble ringing the sealed tower
        region: { kind: 'ring', x: 32, z: -24, rMin: 9, rMax: 22 },
        scatter: [
          { mesh: 'rock', count: 34, minScale: 0.5, maxScale: 2.0,
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
