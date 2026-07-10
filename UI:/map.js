/* ============================================================================
 * EMBERFELL — map.js   (UI/UX department — Cycle 3)
 * The chart: a top-down parchment relief drawn from data. Terrain is sampled
 * ONCE at init from the ground sampler into an offscreen canvas (a hand-inked
 * cartographer's chart, not a radar screen); POIs, the player arrow, and the
 * quest pin are overlaid live. Opening the map paints instantly because the
 * relief is prebuilt — "where you are and where the quest is" inside 1s.
 * A north-up corner minimap redraws at ≤5 Hz.
 *
 * Runtime data (queried, never hardcoded):
 *   world extent  EF.worldData.terrain.size   (fallback 200)
 *   ground height EF.engine.groundAt(x,z) | EF.worldData.terrain.sample
 *   POIs          EF.world.pois[] { id,name,type,x,z }
 *   player pose   EF.state.player { x,z,yaw }   (read-only)
 *   quest pin     event map:setMarker { x,z,label } | null to clear
 *
 * Public: EF.ui.map.open() / .close() / .toggle() / .rebuild() / .setMarker()
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.bus) { console.error('[EF.map] EF.bus missing — load engine.js first'); return; }
  var bus = EF.bus, eng = EF.engine || null;

  var T = { ink:'#f3e9c8', gold:'#ffd97a', brass:'#c9a84f', brassDk:'#8a6d2a',
            parch:'#d9c9a0', paper:'#e9dcb8', umber:'#7d5f36', shadow:'#5f4a2c',
            serif:"Georgia,'Iowan Old Style',serif" };

  /* ---- data queries with fallbacks ------------------------------------- */
  function worldSize(){
    var s = EF.worldData && EF.worldData.terrain && EF.worldData.terrain.size;
    return (typeof s === 'number' && s > 0) ? s : 200;
  }
  function sampler(){
    if (eng && typeof eng.groundAt === 'function') return eng.groundAt;
    var t = EF.worldData && EF.worldData.terrain;
    if (t && typeof t.sample === 'function') return t.sample;
    return function(){ return 0; };
  }
  function pois(){
    return (EF.world && EF.world.pois) || (EF.worldData && EF.worldData.pois) || [];
  }
  function player(){ return (EF.state && EF.state.player) || { x:0, z:0, yaw:0 }; }

  var POI_STYLE = {
    village:{ g:'⌂', c:'#c98a3a' }, npc:{ g:'✦', c:'#e8c85a' }, vendor:{ g:'$', c:'#d0a24a' },
    tower:{ g:'♜', c:'#8892a2' }, dungeon:{ g:'☗', c:'#9a5a5a' }, fire:{ g:'✷', c:'#e07a3a' },
    shrine:{ g:'✚', c:'#7ea0c0' }, _def:{ g:'•', c:'#b08a4a' }
  };
  function poiStyle(t){ return POI_STYLE[t] || POI_STYLE._def; }

  /* =======================================================================
   * 1. OFFSCREEN RELIEF  — built once from the height field
   * ===================================================================== */
  var OFF = document.createElement('canvas');
  var DIM = 460;                 // offscreen resolution (square)
  OFF.width = OFF.height = DIM;
  var builtSize = 0, builtOK = false;

  function buildRelief(){
    var S = worldSize(), samp = sampler();
    var g = OFF.getContext('2d');
    var GRID = 150, cell = DIM / GRID;

    // sample height field + track range
    var H = new Float32Array(GRID * GRID), min = Infinity, max = -Infinity, i, j;
    for (j = 0; j < GRID; j++) {
      for (i = 0; i < GRID; i++) {
        var wx = -S + (i / (GRID - 1)) * 2 * S;
        var wz = -S + (j / (GRID - 1)) * 2 * S;
        var h = samp(wx, wz); if (!isFinite(h)) h = 0;
        H[j * GRID + i] = h; if (h < min) min = h; if (h > max) max = h;
      }
    }
    var span = (max - min) || 1;

    // parchment base wash
    g.fillStyle = T.parch; g.fillRect(0, 0, DIM, DIM);

    // hillshade (light from NW) + sepia relief ramp
    function lerpHex(a, b, t){
      var pa=parseInt(a.slice(1),16), pb=parseInt(b.slice(1),16);
      var r=((pa>>16)&255)+(((pb>>16)&255)-((pa>>16)&255))*t;
      var gg=((pa>>8)&255)+(((pb>>8)&255)-((pa>>8)&255))*t;
      var bl=(pa&255)+((pb&255)-(pa&255))*t;
      return 'rgb('+(r|0)+','+(gg|0)+','+(bl|0)+')';
    }
    for (j = 0; j < GRID; j++) {
      for (i = 0; i < GRID; i++) {
        var c = H[j*GRID+i];
        var xr = H[j*GRID + Math.min(GRID-1,i+1)] - c;   // dz/dx
        var zr = H[Math.min(GRID-1,j+1)*GRID + i] - c;   // dz/dy
        var shade = 0.5 + (-(xr + zr)) * 0.9;            // NW light
        shade = Math.max(0, Math.min(1, shade));
        var elev = (c - min) / span;                      // 0..1
        // low ground = greener umber, high ground = pale bone
        var base = lerpHex('#8a7a4a', '#efe3bf', 0.25 + elev*0.6);
        g.fillStyle = base; g.globalAlpha = 1;
        g.fillRect(i*cell, j*cell, cell+1, cell+1);
        // multiply a shadow pass
        g.globalAlpha = (1 - shade) * 0.5;
        g.fillStyle = T.shadow;
        g.fillRect(i*cell, j*cell, cell+1, cell+1);
        g.globalAlpha = 1;
      }
    }

    // contour lines: draw where quantized elevation band changes
    var BANDS = 7;
    g.strokeStyle = 'rgba(90,66,34,.35)'; g.lineWidth = 1;
    function band(v){ return Math.floor(((v - min)/span) * BANDS); }
    g.beginPath();
    for (j = 1; j < GRID; j++) {
      for (i = 1; i < GRID; i++) {
        var b0 = band(H[j*GRID+i]);
        if (b0 !== band(H[j*GRID+i-1])) { g.moveTo(i*cell, j*cell); g.lineTo(i*cell, (j+1)*cell); }
        if (b0 !== band(H[(j-1)*GRID+i])) { g.moveTo(i*cell, j*cell); g.lineTo((i+1)*cell, j*cell); }
      }
    }
    g.stroke();

    // paper grain + vignette
    var grain = 900;
    g.globalAlpha = 0.05;
    for (i = 0; i < grain; i++){ g.fillStyle = (i&1)?'#000':'#fff';
      g.fillRect(Math.random()*DIM, Math.random()*DIM, 1, 1); }
    g.globalAlpha = 1;
    var vg = g.createRadialGradient(DIM/2,DIM/2,DIM*0.30, DIM/2,DIM/2,DIM*0.62);
    vg.addColorStop(0,'rgba(60,40,18,0)'); vg.addColorStop(1,'rgba(40,26,10,.5)');
    g.fillStyle = vg; g.fillRect(0,0,DIM,DIM);

    builtSize = S; builtOK = true;
  }
  function ensureRelief(){ if (!builtOK || builtSize !== worldSize()) buildRelief(); }

  /* =======================================================================
   * 2. QUEST MARKER (map:setMarker)
   * ===================================================================== */
  var marker = null; // { x, z, label }
  bus.on('map:setMarker', function(p){
    if (p && p.__selfTest) return;
    marker = (p && typeof p.x === 'number') ? { x:p.x, z:p.z, label:p.label||'Objective' } : null;
  });

  /* =======================================================================
   * 3. DRAW HELPERS  — world→canvas, arrow, pins
   * ===================================================================== */
  // north (−z) is up; +x right, +z down
  function w2c(x, z, W, Hh){ var S = worldSize();
    return { x:(x + S)/(2*S) * W, y:(z + S)/(2*S) * Hh }; }

  function drawArrow(g, cx, cy, yaw, size, fill){
    var sx = Math.sin(yaw), sz = Math.cos(yaw);          // world forward
    var rot = Math.atan2(sx, -sz);                        // screen up = 0
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.beginPath(); g.moveTo(0,-size); g.lineTo(size*0.66,size*0.7); g.lineTo(0,size*0.34); g.lineTo(-size*0.66,size*0.7); g.closePath();
    g.fillStyle = fill; g.strokeStyle = 'rgba(20,14,6,.85)'; g.lineWidth = 1.5; g.fill(); g.stroke();
    g.restore();
  }
  function drawPin(g, cx, cy, label, showLabel){
    g.save();
    g.beginPath(); g.arc(cx, cy-9, 7, Math.PI, 0); g.lineTo(cx, cy); g.closePath();
    g.fillStyle = '#c0362f'; g.strokeStyle = 'rgba(20,10,6,.9)'; g.lineWidth = 1.5; g.fill(); g.stroke();
    g.beginPath(); g.arc(cx, cy-9, 2.6, 0, 6.29); g.fillStyle = '#ffe6a0'; g.fill();
    if (showLabel && label){
      g.font = '12px '+T.serif; var tw = g.measureText(label).width;
      g.fillStyle = 'rgba(20,14,6,.82)'; g.fillRect(cx-tw/2-5, cy-30, tw+10, 16);
      g.fillStyle = T.gold; g.textAlign='center'; g.fillText(label, cx, cy-18);
    }
    g.restore();
  }
  function drawPOIs(g, W, Hh, scale){
    pois().forEach(function(p){
      var c = w2c(p.x, p.z, W, Hh), st = poiStyle(p.type);
      g.beginPath(); g.arc(c.x, c.y, 4*scale+1, 0, 6.29);
      g.fillStyle = st.c; g.strokeStyle='rgba(20,14,6,.8)'; g.lineWidth=1; g.fill(); g.stroke();
      if (scale >= 1){
        g.font = (11)+'px '+T.serif; g.fillStyle='rgba(30,20,8,.9)'; g.textAlign='center';
        g.fillText(st.g, c.x, c.y+4);
        if (p.name){ g.fillStyle='rgba(35,24,10,.85)'; g.font='11px '+T.serif;
          g.fillText(p.name, c.x, c.y+18); }
      }
    });
  }

  /* =======================================================================
   * 4. FULL MAP PANEL
   * ===================================================================== */
  var root = el('div','position:fixed;inset:0;z-index:18;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(6,4,2,.72);pointer-events:auto;font-family:'+T.serif+';');
  var frame = el('div','position:relative;width:min(92vw,520px);aspect-ratio:1/1;max-height:82vh;'
    + 'background:linear-gradient(#2a2013,#14100a);border:3px solid '+T.brass+';border-radius:14px;'
    + 'box-shadow:0 14px 50px rgba(0,0,0,.7),inset 0 0 0 2px rgba(0,0,0,.5);padding:14px;');
  var title = el('div','position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:#1a140a;'
    + 'border:1px solid '+T.brass+';border-radius:6px;padding:2px 14px;color:'+T.gold+';font-size:14px;letter-spacing:2px;','MAP');
  var mapCv = document.createElement('canvas');
  mapCv.style.cssText = 'width:100%;height:100%;display:block;border-radius:8px;';
  var closeX = el('div','position:absolute;top:8px;right:10px;width:60px;height:44px;display:flex;align-items:center;'
    + 'justify-content:center;color:'+T.ink+';font-size:20px;background:rgba(20,14,8,.75);border:1px solid '+T.brassDk+';'
    + 'border-radius:8px;pointer-events:auto;','✕');
  tapEl(closeX, function(){ close(); });
  var legend = el('div','position:absolute;left:16px;bottom:14px;color:'+T.ink+';font-size:11px;line-height:1.6;'
    + 'background:rgba(20,14,8,.6);border:1px solid '+T.brassDk+';border-radius:6px;padding:6px 9px;');
  legend.innerHTML = '<span style="color:#e8c85a">✦</span> NPC &nbsp; <span style="color:#8892a2">♜</span> Tower &nbsp; '
    + '<span style="color:#c0362f">◆</span> Quest &nbsp; <span style="color:#7ec8ff">▲</span> You';
  frame.append(title, mapCv, closeX, legend); root.appendChild(frame);
  document.body.appendChild(root);

  function drawFull(){
    ensureRelief();
    var r = mapCv.getBoundingClientRect();
    var W = Math.max(2, Math.round(r.width)), Hh = Math.max(2, Math.round(r.height));
    if (mapCv.width !== W || mapCv.height !== Hh){ mapCv.width = W; mapCv.height = Hh; }
    var g = mapCv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(OFF, 0, 0, W, Hh);
    // compass rose (NW corner)
    g.save(); g.translate(W-34, 34); g.font='13px '+T.serif; g.fillStyle='rgba(30,20,8,.9)'; g.textAlign='center';
    g.fillText('N', 0, -12); g.strokeStyle='rgba(30,20,8,.7)'; g.lineWidth=1.5;
    g.beginPath(); g.moveTo(0,-9); g.lineTo(0,9); g.moveTo(-9,0); g.lineTo(9,0); g.stroke();
    g.beginPath(); g.moveTo(0,-9); g.lineTo(-3,-3); g.lineTo(3,-3); g.closePath(); g.fillStyle='#c0362f'; g.fill(); g.restore();

    drawPOIs(g, W, Hh, 1.2);
    if (marker){ var m = w2c(marker.x, marker.z, W, Hh); drawPin(g, m.x, m.y, marker.label, true); }
    var pl = player(); var pc = w2c(pl.x, pl.z, W, Hh); drawArrow(g, pc.x, pc.y, pl.yaw||0, 9, '#7ec8ff');
  }

  /* =======================================================================
   * 5. MINIMAP  (corner, ≤5 Hz, north-up)
   * ===================================================================== */
  var mini = document.createElement('canvas');
  var MSZ = 118;
  mini.width = mini.height = MSZ * (Math.min(window.devicePixelRatio||1, 2));
  mini.style.cssText = 'position:fixed;top:calc(62px + env(safe-area-inset-top));right:12px;width:'+MSZ+'px;height:'+MSZ+'px;'
    + 'z-index:11;border-radius:50%;border:2px solid '+T.brass+';box-shadow:0 3px 10px rgba(0,0,0,.5);'
    + 'pointer-events:none;background:'+T.parch+';';
  document.body.appendChild(mini);

  function drawMini(){
    ensureRelief();
    var g = mini.getContext('2d'), W = mini.width, Hh = mini.height;
    g.save();
    // circular clip
    g.beginPath(); g.arc(W/2, Hh/2, W/2, 0, 6.29); g.clip();
    g.imageSmoothingEnabled = true; g.drawImage(OFF, 0, 0, W, Hh);
    // POIs (dots only) + quest + player
    pois().forEach(function(p){ var c = w2c(p.x,p.z,W,Hh), st = poiStyle(p.type);
      g.beginPath(); g.arc(c.x,c.y, W*0.03, 0, 6.29); g.fillStyle=st.c; g.fill(); });
    if (marker){ var m = w2c(marker.x, marker.z, W, Hh);
      g.beginPath(); g.arc(m.x, m.y, W*0.05, 0, 6.29); g.fillStyle='#c0362f'; g.strokeStyle='#ffe6a0'; g.lineWidth=2; g.fill(); g.stroke(); }
    var pl = player(); var pc = w2c(pl.x, pl.z, W, Hh); drawArrow(g, pc.x, pc.y, pl.yaw||0, W*0.07, '#7ec8ff');
    g.restore();
    // north tick
    g.fillStyle='#c0362f'; g.beginPath(); g.moveTo(W/2,3); g.lineTo(W/2-4,11); g.lineTo(W/2+4,11); g.closePath(); g.fill();
  }

  /* =======================================================================
   * 6. OPEN / CLOSE + throttled redraw
   * ===================================================================== */
  var open = false;
  function openMap(){ ensureRelief(); root.style.display='flex'; open=true;
    try { bus.emit('ui:menu',{ mode:'menu', open:true }); } catch(_){}
    if (EF.ui) EF.ui.mode='menu';
    drawFull(); }
  function close(){ root.style.display='none'; open=false;
    if (EF.ui && EF.ui.mode==='menu') EF.ui.setMode && EF.ui.setMode('play'); }
  function toggle(){ open ? close() : openMap(); }
  tapEl(root, function(e){ if (e.target === root) close(); }); // tap backdrop to close

  var accMini = 0, accFull = 0;
  bus.on('game:tick', function(t){
    var dt = (t && t.dt) || 0.016;
    accMini += dt; accFull += dt;
    if (accMini >= 0.2 && mini.width){ accMini = 0; if (!open) drawMini(); }   // 5 Hz
    if (open && accFull >= 1/15){ accFull = 0; drawFull(); }                   // smooth arrow while open
  });
  bus.on('game:booted', function(){ ensureRelief(); drawMini(); });
  bus.on('game:resize', function(){ if (open) drawFull(); });

  /* =======================================================================
   * 7. shared DOM helpers (self-contained; no dependency on ui.js internals)
   * ===================================================================== */
  function el(tag, css){ var e = document.createElement(tag); if (css) e.style.cssText = css; return e; }
  function tapEl(e, fn){
    e.addEventListener('touchstart', function(ev){ ev.preventDefault(); ev.stopPropagation(); fn(ev); }, { passive:false });
    e.addEventListener('click', function(ev){ fn(ev); });
    e.style.touchAction = 'none';
  }

  /* ---- public ---------------------------------------------------------- */
  EF.ui = EF.ui || {};
  EF.ui.map = {
    open: openMap, close: close, toggle: toggle,
    rebuild: function(){ builtOK=false; ensureRelief(); if (open) drawFull(); drawMini(); },
    setMarker: function(x,z,label){ marker = (typeof x==='number') ? { x:x, z:z, label:label||'Objective' } : null; if (open) drawFull(); }
  };
  ensureRelief(); drawMini();
  console.log('[EF.map] ready — relief chart, POIs, quest pin, minimap (5 Hz)');
})();
