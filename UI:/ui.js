/* ============================================================================
 * EMBERFELL — ui.js   (UI/UX department — Cycle 3)
 * Owns: HUD, touch-control DOM + registration, panels (inventory / quest log /
 * pause), feedback (damage flash, floating popups, level-up + quest banners,
 * toasts), dialogue box, and the death/respawn + title screens.
 * Map + minimap live in map.js (EF.ui.map).
 *
 * Contract compliance (v1.1):
 *  §2.2  No static <style>. All CSS is JS-injected (a runtime-built <style>
 *        for rules/keyframes/:active + el.style.cssText for layout). If the
 *        sandbox strips the injected <style> too, the cssText layout still
 *        holds; verify banners/:active on-device.
 *  §2.1  Only console.log/warn/error used here (info/table not assumed).
 *  §4    Emits by canonical name where one exists. UI→others requests use
 *        pre-approved names (item:use, weapon:equip, dialogue:choice,
 *        map:setMarker) + candidates flagged below; the v1.0 bus warns once.
 *  §5    Buttons are registered via EF.engine.input.bindButton — the ENGINE
 *        attaches the listeners. UI reacts to the resulting input:button
 *        events; it does NOT add its own listeners to registered buttons.
 *        (Transient panel/dialogue buttons are UI-internal and DO get their
 *        own touchstart+preventDefault handlers — the v0 iOS double-fire fix.)
 *
 * ---------------------------------------------------------------------------
 * DATA FLOW  (the boundary that keeps "zero direct writes to EF.state" true)
 *   READ  EF.state (authoritative, read-only) for HUD numbers, inventory,
 *         quests, and the contextual-interact prompt. Throttled.
 *   HEAR  bus events for feedback moments (flash / popup / banner / sfx).
 *   ASK   emit events to request changes; UI never mutates gameplay fields.
 *   OWN   EF.ui.mode ('play'|'menu'|'dialogue'). Player/Combat gate movement
 *         and attacks on EF.ui.mode === 'play'. UI mirrors it on ui:menu.
 *
 * EF.state shape UI expects (all optional; UI degrades if absent):
 *   EF.state.player   { hp,maxhp, st,maxst, xp,xpNext, lvl, gold, weapon }
 *   EF.state.inventory[] { id, name, kind:'weapon'|'consumable'|'material',
 *                          count, dmg? }            // weapon carries dmg
 *   EF.state.equipped   weaponId (string)
 *   EF.state.quests[]   { id, name, state:'offered'|'active'|'done',
 *                         progress:0..1, line, marker?:{x,z} }
 *   EF.state.tracked    questId (string)            // UI may set via ui:track
 *   EF.state.interact   { available:bool, label:'Talk'|'Pick up'|'Read'|... }
 *
 * Public: EF.ui.toast(text) · EF.ui.mode · EF.ui.setMode(m) · EF.ui.openBag()
 *         EF.ui.openQuests() · EF.ui.openMenu() · EF.ui.closeAll()
 *         EF.ui.banner(text,kind) · EF.ui.selfTest()
 * ========================================================================= */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});
  if (!EF.bus) { console.error('[EF.ui] EF.bus missing — load engine.js first'); return; }
  var bus = EF.bus, eng = EF.engine || null;

  /* ---- design tokens: aged parchment & iron ----------------------------- */
  var T = {
    ink:'#f3e9c8', gold:'#ffd97a', brass:'#c9a84f', brassDk:'#8a6d2a',
    iron:'rgba(21,16,11,.92)', ironSolid:'#15100b', iron2:'#241a10',
    hp:'#e8574a', hpDk:'#a92a20', st:'#4ac06a', stDk:'#207a3a',
    xp:'#58a6e8', xpDk:'#2b5f9e', bad:'#e8574a', good:'#7eff9a',
    serif:"Georgia,'Iowan Old Style','Times New Roman',serif"
  };

  /* ---- tiny DOM helpers ------------------------------------------------- */
  function el(tag, css, txt) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function tap(e, fn) { // transient UI buttons: iOS-safe, no double-fire
    e.addEventListener('touchstart', function (ev) { ev.preventDefault(); ev.stopPropagation(); fn(ev); }, { passive:false });
    e.addEventListener('click', function (ev) { ev.preventDefault(); fn(ev); });
    e.style.touchAction = 'none';
  }
  function sfx(name){ try { bus.emit('audio:play', { sfx:name }); } catch(_){} }

  /* ---- read-only state access ------------------------------------------ */
  var FALLBACK = { player:{ hp:100,maxhp:100, st:100,maxst:100, xp:0,xpNext:100, lvl:1, gold:0, weapon:'Iron Sword' },
                   inventory:[], equipped:null, quests:[], tracked:null, interact:{available:false,label:'Interact'} };
  function S(){ return EF.state || FALLBACK; }
  function P(){ return (EF.state && EF.state.player) || FALLBACK.player; }

  /* ---- register a couple of UI sfx (Audio dept may override) ------------ */
  if (eng && eng.audio && eng.audio.register) {
    var reg = eng.audio.register;
    reg('ui.open',   { type:'square',   freq:520, freqEnd:660, duration:0.06, gain:0.12 });
    reg('ui.close',  { type:'square',   freq:440, freqEnd:330, duration:0.06, gain:0.10 });
    reg('ui.levelup',{ type:'triangle', freq:523, freqEnd:1046,duration:0.30, gain:0.16 });
    reg('ui.quest',  { type:'triangle', freq:659, freqEnd:988, duration:0.28, gain:0.15 });
    reg('ui.coin',   { type:'square',   freq:880, freqEnd:1320,duration:0.10, gain:0.12 });
    reg('ui.death',  { type:'sawtooth', freq:220, freqEnd:60,  duration:0.80, gain:0.18 });
  }

  /* =======================================================================
   * 1. STYLE INJECTION  (rules that inline styles can't express)
   * ===================================================================== */
  (function injectStyle(){
    var css = [
      '@keyframes efRise{0%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-64px) scale(1.05)}}',
      '@keyframes efBanner{0%{opacity:0;transform:translate(-50%,10px)}12%{opacity:1;transform:translate(-50%,0)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-8px)}}',
      '@keyframes efFlash{0%{opacity:.42}100%{opacity:0}}',
      '.ef-btn:active{background:rgba(243,233,200,.34)!important;transform:translateY(1px)}',
      '.ef-chip:active{filter:brightness(.86)}',
      '.ef-row:last-child{border-bottom:none!important}',
      '.ef-scroll::-webkit-scrollbar{width:0;height:0}'
    ].join('');
    try {
      var s = document.createElement('style'); s.setAttribute('data-ef','ui'); s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    } catch(e){ console.warn('[EF.ui] style injection failed', e); }
  })();

  var SA = 'env(safe-area-inset-'; // shorthand for safe-area insets

  /* =======================================================================
   * 2. ROOT + HUD
   * ===================================================================== */
  var root = el('div','position:fixed;inset:0;z-index:10;pointer-events:none;font-family:'+T.serif+';');
  document.body.appendChild(root);

  function bar(w,h,fillA,fillB){
    var b = el('div','width:'+w+'px;height:'+h+'px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.32);border-radius:'+(h/2)+'px;margin-bottom:5px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.6);');
    var f = el('div','height:100%;width:100%;border-radius:'+(h/2)+'px;transition:width .14s ease-out;background:linear-gradient('+fillA+','+fillB+');');
    b.appendChild(f); return { box:b, fill:f };
  }
  var hud = el('div','position:fixed;top:calc(10px + '+SA+'top));left:12px;pointer-events:none;text-shadow:0 1px 3px #000;');
  var hpB = bar(154,14,T.hp,T.hpDk), stB = bar(124,10,T.st,T.stDk), xpB = bar(124,7,T.xp,T.xpDk);
  var statLine = el('div','color:'+T.ink+';font-size:13px;margin-top:2px;line-height:1.5;');
  statLine.innerHTML = 'Lv <b id="ef-lv">1</b> &nbsp;·&nbsp; <span style="color:'+T.gold+'">◆</span> <b id="ef-gold">0</b>';
  var wpnChip = el('div','display:inline-flex;align-items:center;gap:5px;margin-top:5px;padding:3px 9px;border:1px solid '+T.brassDk+';border-radius:5px;background:linear-gradient(#2a2114,#1a1408);color:'+T.ink+';font-size:12px;');
  wpnChip.innerHTML = '<span style="color:'+T.brass+'">⚔</span><span id="ef-wpn">—</span>';
  var questLine = el('div','color:'+T.gold+';font-size:13px;margin-top:6px;max-width:210px;line-height:1.35;display:none;');
  hud.append(hpB.box, stB.box, xpB.box, statLine, wpnChip, questLine);
  root.appendChild(hud);

  /* =======================================================================
   * 3. TOUCH CONTROLS  — build DOM, register with engine's button registry
   *    (attack/jump/interact are gameplay-owned; UI only builds+binds them
   *     and drives the interact label. bag/map/menu are UI-owned.)
   * ===================================================================== */
  function ctlBtn(label, css){
    var b = el('div','position:fixed;pointer-events:auto;display:flex;align-items:center;justify-content:center;text-align:center;'
      + 'color:'+T.ink+';font-family:'+T.serif+';border-radius:50%;line-height:1.05;'
      + 'background:linear-gradient(rgba(36,26,16,.62),rgba(20,16,10,.62));'
      + 'border:2px solid rgba(243,233,200,.5);box-shadow:0 2px 6px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.12);'
      + 'touch-action:none;-webkit-user-select:none;user-select:none;' + (css||''));
    b.className = 'ef-btn'; b.textContent = label; return b;
  }
  var bAttack  = ctlBtn('Attack','right:18px;bottom:calc(102px + '+SA+'bottom));width:82px;height:82px;font-size:15px;');
  var bJump    = ctlBtn('Jump',  'right:112px;bottom:calc(30px + '+SA+'bottom));width:66px;height:66px;font-size:13px;');
  var bInteract= ctlBtn('Talk',  'right:18px;bottom:calc(200px + '+SA+'bottom));width:72px;height:72px;font-size:13px;display:none;');
  // top-right stack: Map, Bag, Menu  (rectangular, ≥60px targets)
  function topBtn(label, right){
    var b = el('div','position:fixed;top:calc(10px + '+SA+'top));right:'+right+'px;pointer-events:auto;'
      + 'width:62px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;'
      + 'color:'+T.ink+';font-size:13px;font-family:'+T.serif+';background:linear-gradient(#241a10,#15100b);'
      + 'border:1px solid '+T.brassDk+';box-shadow:0 2px 5px rgba(0,0,0,.4);touch-action:none;');
    b.className='ef-btn'; b.textContent=label; return b;
  }
  var bBag = topBtn('Bag',12), bMap = topBtn('Map',80), bMenu = topBtn('☰',148);
  root.append(bAttack,bJump,bInteract,bBag,bMap,bMenu);

  // Register with the engine. The engine attaches listeners + emits input:button.
  function bind(name, dom){ if (eng && eng.input && eng.input.bindButton) eng.input.bindButton(name, dom); }
  bind('attack',bAttack); bind('jump',bJump); bind('interact',bInteract);
  bind('bag',bBag); bind('map',bMap); bind('menu',bMenu);

  // UI reacts to the UI-owned buttons only (gameplay buttons handled elsewhere).
  bus.on('input:button', function (p) {
    if (!p || p.__selfTest || !p.pressed) return;
    if (p.name === 'bag')  toggleBag();
    else if (p.name === 'map')  EF.ui.map ? EF.ui.map.toggle() : toast('Map module not loaded');
    else if (p.name === 'menu') toggleMenu();
  });

  /* =======================================================================
   * 4. PANELS  (inventory / quest log / pause)  — mode gates movement
   * ===================================================================== */
  function panelShell(titleTxt){
    var wrap = el('div','position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
      + 'width:min(90vw,360px);max-height:78vh;display:none;flex-direction:column;pointer-events:auto;z-index:16;'
      + 'background:linear-gradient(#1c1509,#120d06);border:2px solid '+T.brass+';border-radius:12px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.6),inset 0 0 0 1px rgba(0,0,0,.5);padding:16px;font-family:'+T.serif+';');
    var h = el('div','color:'+T.gold+';font-size:19px;letter-spacing:1px;margin-bottom:10px;border-bottom:1px solid '+T.brassDk+';padding-bottom:8px;',titleTxt);
    var body = el('div','overflow-y:auto;-webkit-overflow-scrolling:touch;'); body.className='ef-scroll';
    var close = el('div','margin-top:12px;min-height:52px;display:flex;align-items:center;justify-content:center;'
      + 'background:#2a2114;color:'+T.ink+';border:1px solid '+T.brass+';border-radius:8px;font-size:15px;','Close');
    close.className='ef-chip'; tap(close, closeAll);
    wrap.append(h, body, close); root.appendChild(wrap);
    return { wrap:wrap, body:body };
  }
  function row(){ return el('div','display:flex;justify-content:space-between;align-items:center;gap:10px;'
    + 'color:'+T.ink+';font-size:15px;padding:11px 2px;border-bottom:1px solid rgba(201,168,79,.22);'); }
  function actBtn(label, accent){ var b = el('div','min-width:70px;min-height:44px;padding:0 14px;display:flex;align-items:center;'
    + 'justify-content:center;border-radius:7px;font-size:14px;font-family:'+T.serif+';'
    + 'background:'+(accent==='use'?'#274a2b':'#2a2f52')+';color:'+T.ink+';border:1px solid '+(accent==='use'?'#4ac06a':'#5a7fd0')+';',label);
    b.className='ef-chip'; return b; }

  /* ---- inventory -------------------------------------------------------- */
  var invP = panelShell('Inventory');
  function renderInv(){
    var b = invP.body; b.innerHTML=''; var s = S(), inv = s.inventory||[];
    var equipped = (inv.filter(function(i){return i.id===s.equipped;})[0]) || null;
    var gRow = row(); gRow.append(el('span',null,'Gold'), el('b','color:'+T.gold, String(P().gold||0))); b.appendChild(gRow);
    if (!inv.length){ b.appendChild(el('div','padding:18px 2px;color:#b7a982;font-size:14px;','Your pack is empty. Wolves may drop coin and potions.')); return; }
    inv.forEach(function(it){
      var r = row();
      var name = el('span',null, it.name + (it.count>1?(' ×'+it.count):''));
      r.appendChild(name);
      if (it.kind==='weapon'){
        var eq = (it.id===s.equipped);
        var cmp = equipped && !eq ? (it.dmg - (equipped.dmg||0)) : 0;
        var label = el('span','font-size:12px;color:'+(cmp>0?T.good:cmp<0?T.bad:'#b7a982')+';margin-right:6px;',
          'DMG '+it.dmg + (equipped&&!eq ? (cmp>=0?'  (+'+cmp+')':'  ('+cmp+')') : (eq?'  · equipped':'')));
        var wrap2 = el('div','display:flex;align-items:center;gap:8px;'); wrap2.appendChild(label);
        if (!eq){ var e2 = actBtn('Equip'); tap(e2, function(){ bus.emit('weapon:equip',{ id:it.id }); sfx('ui.click'); }); wrap2.appendChild(e2); }
        r.appendChild(wrap2);
      } else if (it.kind==='consumable'){
        var u = actBtn('Use','use'); tap(u, function(){ bus.emit('item:use',{ id:it.id }); sfx('ui.click'); }); r.appendChild(u);
      }
      b.appendChild(r);
    });
  }

  /* ---- quest log -------------------------------------------------------- */
  var qP = panelShell('Quest Log');
  function renderQuests(){
    var b = qP.body; b.innerHTML=''; var s = S(), qs = s.quests||[];
    if (!qs.length){ b.appendChild(el('div','padding:18px 2px;color:#b7a982;font-size:14px;','No quests yet. Seek Maren by the fire.')); return; }
    qs.forEach(function(q){
      var r = el('div','padding:11px 2px;border-bottom:1px solid rgba(201,168,79,.22);'+(q.id===s.tracked?'background:rgba(201,168,79,.08);':''));
      r.className='ef-chip';
      var top = el('div','display:flex;justify-content:space-between;align-items:center;');
      var nm = el('span','font-size:15px;color:'+(q.state==='done'?'#9fd0a0':T.ink)+';', q.name + (q.id===s.tracked?'  ◂ tracked':''));
      var badge = el('span','font-size:11px;color:'+(q.state==='done'?T.good:q.state==='offered'?'#b7a982':T.gold)+';', q.state.toUpperCase());
      top.append(nm,badge); r.appendChild(top);
      if (q.line) r.appendChild(el('div','font-size:12px;color:#c9bd97;margin-top:3px;', q.line));
      if (q.state==='active' && typeof q.progress==='number'){
        var pb = el('div','height:6px;background:rgba(0,0,0,.5);border-radius:3px;margin-top:6px;overflow:hidden;');
        pb.appendChild(el('div','height:100%;width:'+Math.round(q.progress*100)+'%;background:linear-gradient('+T.gold+','+T.brassDk+');'));
        r.appendChild(pb);
      }
      tap(r, function(){ trackQuest(q); });
      b.appendChild(r);
    });
  }
  function trackQuest(q){
    if (q.state==='offered') return;
    bus.emit('ui:track',{ id:q.id });                 // §4 candidate (Quests owns tracked)
    if (q.marker) bus.emit('map:setMarker',{ x:q.marker.x, z:q.marker.z, label:q.name });
    questLine.style.display='block';
    questLine.textContent = 'Quest: ' + (q.line || q.name);
    renderQuests(); sfx('ui.click');
  }

  /* ---- pause / settings ------------------------------------------------- */
  var mP = panelShell('Paused');
  (function buildMenu(){
    var b = mP.body;
    var qRow = row(); qRow.appendChild(el('span',null,'Quality'));
    var qBtn = actBtn('High (1.5×)'); var hi = true;
    tap(qBtn, function(){ hi = !hi; var pr = hi?1.5:1.0; qBtn.textContent = hi?'High (1.5×)':'Low (1.0×)';
      try { if (eng && eng.renderer) { eng.renderer.setPixelRatio(pr); if (eng.renderer.setSize) eng.renderer.setSize(window.innerWidth, window.innerHeight); } } catch(_){}
      sfx('ui.click'); });
    qRow.appendChild(qBtn); b.appendChild(qRow);
    var sRow = row(); sRow.appendChild(el('span',null,'Sound'));
    var sBtn = actBtn('On','use'); var muted = eng && eng.audio ? !!eng.audio.muted : false;
    function paint(){ sBtn.textContent = muted?'Off':'On'; sBtn.style.background = muted?'#4a2727':'#274a2b'; sBtn.style.borderColor = muted?'#d06a6a':'#4ac06a'; }
    paint(); tap(sBtn, function(){ muted=!muted; if (eng&&eng.audio&&eng.audio.setMuted) eng.audio.setMuted(muted); paint(); });
    sRow.appendChild(sBtn); b.appendChild(sRow);
    var rRow = row(); rRow.appendChild(el('span',null,'Resume play')); var rBtn = actBtn('Resume','use'); tap(rBtn, closeAll); rRow.appendChild(rBtn); b.appendChild(rRow);
  })();

  /* ---- panel open/close + mode ----------------------------------------- */
  function setMode(m){ EF.ui.mode = m; try { bus.emit('ui:menu',{ mode:m, open:(m!=='play') }); } catch(_){} }
  function anyOpen(){ return invP.wrap.style.display==='flex' || qP.wrap.style.display==='flex' || mP.wrap.style.display==='flex'; }
  function showPanel(p, render){ closeAll(true); render && render(); p.wrap.style.display='flex'; setMode('menu'); sfx('ui.open'); }
  function toggleBag(){ invP.wrap.style.display==='flex' ? closeAll() : showPanel(invP, renderInv); }
  function toggleQuests(){ qP.wrap.style.display==='flex' ? closeAll() : showPanel(qP, renderQuests); }
  function toggleMenu(){ mP.wrap.style.display==='flex' ? closeAll() : showPanel(mP); }
  function closeAll(silent){
    var was = anyOpen() || dlg.wrap.style.display==='flex';
    invP.wrap.style.display=qP.wrap.style.display=mP.wrap.style.display='none';
    dlg.wrap.style.display='none';
    if (deathScreen.style.display==='flex' || titleScreen.style.display==='flex') return; // those own the mode
    setMode('play'); if (was && !silent) sfx('ui.close');
  }

  /* =======================================================================
   * 5. DIALOGUE  (event-driven; choices emit dialogue:choice)
   * ===================================================================== */
  var dlg = (function(){
    var wrap = el('div','position:fixed;left:50%;bottom:calc(22px + '+SA+'bottom));transform:translateX(-50%);'
      + 'width:min(93vw,440px);display:none;pointer-events:auto;z-index:16;font-family:'+T.serif+';'
      + 'background:linear-gradient(#1a1409,#100c05);border:2px solid '+T.brass+';border-radius:12px;padding:15px 16px;box-shadow:0 8px 30px rgba(0,0,0,.6);');
    var name = el('div','color:'+T.gold+';font-size:15px;margin-bottom:6px;');
    var text = el('div','color:'+T.ink+';font-size:16px;line-height:1.5;margin-bottom:12px;');
    var btns = el('div','display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;');
    wrap.append(name,text,btns); root.appendChild(wrap);
    return { wrap:wrap, name:name, text:text, btns:btns };
  })();
  function openDialogue(p){
    /* [build-05 integrator patch] npcs.js emits `speaker`; accept both */
    dlg.name.textContent = p.name||p.speaker||''; dlg.text.textContent = p.text||'';
    dlg.btns.innerHTML='';
    (p.choices||[{label:'Close',id:'close'}]).forEach(function(c){
      var b = el('div','min-height:52px;padding:0 18px;display:flex;align-items:center;justify-content:center;'
        + 'background:#3a2f18;color:'+T.ink+';border:1px solid '+T.brass+';border-radius:8px;font-size:15px;font-family:'+T.serif+';', c.label);
      b.className='ef-chip';
      tap(b, function(){ bus.emit('dialogue:choice',{ id:c.id }); if (c.id==='close') closeDialogue(); }); // iOS-safe
      dlg.btns.appendChild(b);
    });
    invP.wrap.style.display=qP.wrap.style.display=mP.wrap.style.display='none';
    dlg.wrap.style.display='flex'; setMode('dialogue'); sfx('ui.open');
  }
  function closeDialogue(){ dlg.wrap.style.display='none'; if (!anyOpen()) setMode('play'); }

  /* =======================================================================
   * 6. FEEDBACK  — flash, floating popups, banners, toasts
   * ===================================================================== */
  var flash = el('div','position:fixed;inset:0;background:#c81a12;opacity:0;pointer-events:none;z-index:12;');
  root.appendChild(flash);
  function doFlash(amt){ flash.style.animation='none'; void flash.offsetWidth;
    flash.style.setProperty('--a', amt); flash.style.animation='efFlash .45s ease-out';
  }
  function popup(text, color){
    var p = el('div','position:fixed;left:'+(50 + (Math.random()*10-5))+'%;top:38%;transform:translate(-50%,0);'
      + 'z-index:14;pointer-events:none;font-family:'+T.serif+';font-weight:bold;font-size:19px;'
      + 'color:'+(color||'#dfe7ff')+';text-shadow:0 1px 4px #000;animation:efRise 1.2s ease-out forwards;', text);
    root.appendChild(p); setTimeout(function(){ p.remove(); }, 1200);
  }
  var bannerEl = el('div','position:fixed;left:50%;top:22%;transform:translate(-50%,0);z-index:17;pointer-events:none;'
    + 'text-align:center;font-family:'+T.serif+';display:none;');
  root.appendChild(bannerEl);
  function banner(text, kind){
    bannerEl.innerHTML='';
    var sub = kind==='levelup'?'LEVEL UP':kind==='complete'?'QUEST COMPLETE':kind==='accept'?'QUEST':kind==='death'?'':'';
    if (sub) bannerEl.appendChild(el('div','color:'+(kind==='death'?T.bad:T.gold)+';font-size:13px;letter-spacing:4px;margin-bottom:4px;',sub));
    bannerEl.appendChild(el('div','color:'+T.ink+';font-size:26px;letter-spacing:1px;text-shadow:0 2px 10px rgba(0,0,0,.7);',text));
    bannerEl.style.display='block'; bannerEl.style.animation='none'; void bannerEl.offsetWidth;
    bannerEl.style.animation='efBanner 2.2s ease-out forwards';
    setTimeout(function(){ bannerEl.style.display='none'; }, 2200);
  }
  var toastEl = el('div','position:fixed;left:50%;top:calc(70px + '+SA+'top));transform:translateX(-50%);z-index:17;'
    + 'pointer-events:none;display:none;font-family:'+T.serif+';color:'+T.ink+';font-size:14px;'
    + 'background:rgba(21,16,11,.9);border:1px solid '+T.brassDk+';border-radius:8px;padding:8px 14px;box-shadow:0 4px 14px rgba(0,0,0,.5);');
  root.appendChild(toastEl); var toastT=null;
  function toast(text){ toastEl.textContent=text; toastEl.style.display='block';
    clearTimeout(toastT); toastT=setTimeout(function(){ toastEl.style.display='none'; }, 2200); }

  /* =======================================================================
   * 7. TITLE / DEATH / RESPAWN  (overlays own the mode while shown)
   * ===================================================================== */
  /* [build-05 integrator patch] overlays must OUTRANK the map panel (z18,
   * body-level). As children of root (z10) their z20 was trapped in root's
   * stacking context and the death screen rendered UNDER an open map,
   * making "Rise Again" unreachable. Body-level + z30 fixes the ordering. */
  function overlay(bg){ var o = el('div','position:fixed;inset:0;z-index:30;display:none;flex-direction:column;'
    + 'align-items:center;justify-content:center;text-align:center;pointer-events:auto;font-family:'+T.serif+';background:'+bg+';'); document.body.appendChild(o); return o; }
  function bigBtn(label){ var b = el('div','min-height:60px;padding:16px 40px;display:flex;align-items:center;justify-content:center;'
    + 'font-size:18px;letter-spacing:1px;color:#1a1408;border-radius:8px;font-family:'+T.serif+';'
    + 'background:linear-gradient(#f0dfa8,#c9a84f);border:1px solid '+T.brassDk+';box-shadow:0 4px 12px rgba(0,0,0,.5);', label);
    b.className='ef-chip'; return b; }

  var titleScreen = overlay('radial-gradient(ellipse at 50% 34%, #2c3a55 0%, #0c101c 72%)');
  titleScreen.append(
    el('div','color:'+T.ink+';font-size:46px;letter-spacing:7px;text-shadow:0 0 26px rgba(120,160,255,.5);','EMBERFELL'),
    el('div','color:#9aa8c4;font-size:14px;margin:16px 26px 30px;max-width:300px;line-height:1.6;',
      'A pocket-sized open world. Wolves haunt the pines beyond the village — old Maren at the fire could use a hand.')
  );
  var startBtn = bigBtn('Enter World'); titleScreen.appendChild(startBtn);
  tap(startBtn, function(){
    // first user gesture: nudge the audio ctx awake (engine unlocks on gesture too)
    try { if (eng && eng.audio && eng.audio.setMuted) eng.audio.setMuted(false); } catch(_){}
    titleScreen.style.display='none'; setMode('play'); bus.emit('ui:start',{}); refreshHUD();
  });

  var deathScreen = overlay('rgba(38,4,4,.86)');
  deathScreen.append(el('div','color:'+T.bad+';font-size:40px;letter-spacing:5px;margin-bottom:24px;text-shadow:0 2px 12px #000;','YOU DIED'));
  var respBtn = bigBtn('Rise Again'); deathScreen.appendChild(respBtn);
  tap(respBtn, function(){ deathScreen.style.display='none'; bus.emit('player:respawn',{}); setMode('play'); });

  /* =======================================================================
   * 8. EVENT WIRING  (feedback only — never mutating state)
   * ===================================================================== */
  bus.on('player:damaged', function(p){ if (!p||p.__selfTest) return; var a=p.amount||1;
    doFlash(Math.min(.5,.18+a*.02)); popup('-'+a, T.hp); markDirty(); });
  bus.on('combat:damage', function(p){ if (!p||p.__selfTest) return;   // §4 candidate: enemy hit numbers
    popup((p.crit?'✸':'')+'-'+(p.amount||0), p.crit?T.gold:'#ffffff'); });
  bus.on('loot:collected', function(p){ if (!p||p.__selfTest) return;
    var it=p.item||'item', n=p.count||1;
    if (it==='gold'){ popup('+'+n+' gold', T.gold); sfx('ui.coin'); }
    else popup('+'+(n>1?n+' ':'')+it, T.good);
    markDirty(); if (invP.wrap.style.display==='flex') renderInv(); });
  bus.on('player:levelup', function(p){ if (!p||p.__selfTest) return;
    banner('Level '+(p.level||P().lvl), 'levelup'); sfx('ui.levelup'); markDirty(); });
  bus.on('quest:started', function(p){ if (!p||p.__selfTest) return;
    banner((p.name||'New quest'), 'accept'); sfx('ui.quest'); markDirty(); if (qP.wrap.style.display==='flex') renderQuests(); });
  bus.on('quest:updated', function(p){ if (!p||p.__selfTest) return; markDirty(); if (qP.wrap.style.display==='flex') renderQuests(); });
  bus.on('quest:completed', function(p){ if (!p||p.__selfTest) return;
    banner((p.name||'Quest complete'), 'complete'); sfx('ui.quest'); markDirty(); if (qP.wrap.style.display==='flex') renderQuests(); });
  bus.on('player:died', function(p){ if (!p||p.__selfTest) return;
    deathScreen.style.display='flex'; setMode('menu'); sfx('ui.death'); });
  bus.on('player:spawned', function(p){ if (!p||p.__selfTest) return;
    deathScreen.style.display='none'; if (titleScreen.style.display!=='flex') setMode('play'); markDirty(); refreshHUD(); });
  bus.on('ui:toast', function(p){ if (!p||p.__selfTest) return; toast(p.text||''); });
  bus.on('dialogue:open', function(p){ if (!p||p.__selfTest) return; openDialogue(p); });
  bus.on('dialogue:close', function(p){ if (p&&p.__selfTest) return; closeDialogue(); });
  // quest-log open via a dedicated tap on the quest HUD line
  tap(questLine, toggleQuests);

  /* =======================================================================
   * 9. HUD REFRESH  — throttled DOM writes (§7 discipline) + interact label
   * ===================================================================== */
  var dirty = true, acc = 0, HUD_HZ = 8;
  function markDirty(){ dirty = true; }
  var lvEl, goldEl, wpnEl;
  function grab(){ lvEl=document.getElementById('ef-lv'); goldEl=document.getElementById('ef-gold'); wpnEl=document.getElementById('ef-wpn'); }
  grab();
  function pct(v,m){ return Math.max(0,Math.min(100,(v/(m||1))*100)); }
  function refreshHUD(){
    var pl = P(), s = S();
    hpB.fill.style.width = pct(pl.hp,pl.maxhp)+'%';
    stB.fill.style.width = pct(pl.st,pl.maxst||100)+'%';
    xpB.fill.style.width = pct(pl.xp,pl.xpNext)+'%';
    if (lvEl) lvEl.textContent = pl.lvl; if (goldEl) goldEl.textContent = pl.gold||0;
    var eqName = (s.inventory||[]).filter(function(i){return i.id===s.equipped;})[0];
    if (wpnEl) wpnEl.textContent = (eqName&&eqName.name) || pl.weapon || '—';
    // tracked quest line
    var tq = (s.quests||[]).filter(function(q){return q.id===s.tracked;})[0];
    if (tq && tq.state==='active'){ questLine.style.display='block'; questLine.textContent='Quest: '+(tq.line||tq.name); }
    else if (!s.tracked) questLine.style.display='none';
    dirty = false;
  }
  function refreshInteract(){
    var it = (S().interact)||FALLBACK.interact;
    if (EF.ui.mode!=='play'){ bInteract.style.display='none'; return; }
    if (it.available){ bInteract.style.display='flex'; bInteract.textContent = it.label||'Interact'; }
    else bInteract.style.display='none';
  }
  bus.on('game:tick', function(t){
    acc += (t && t.dt) || 0.016;
    if (dirty || acc >= 1/HUD_HZ){ acc = 0; refreshHUD(); }
    refreshInteract();
  });

  /* =======================================================================
   * 10. PUBLIC API + self-test
   * ===================================================================== */
  EF.ui = {
    mode: 'play', setMode: setMode,
    toast: toast, banner: banner, popup: popup,
    openBag: toggleBag, openQuests: toggleQuests, openMenu: toggleMenu, closeAll: closeAll,
    showTitle: function(){ titleScreen.style.display='flex'; setMode('menu'); },
    refresh: function(){ markDirty(); refreshHUD(); },
    selfTest: function(){
      var checks = [];
      function ck(n,v){ checks.push({ check:n, ok:!!v }); }
      ck('root mounted', document.body.contains(root));
      ck('hud bars', !!(hpB.fill && stB.fill && xpB.fill));
      ck('buttons registered', !!(bAttack&&bJump&&bInteract&&bBag&&bMap&&bMenu));
      ck('panels built', !!(invP.wrap&&qP.wrap&&mP.wrap));
      ck('death screen', !!deathScreen);
      ck('style injected', !!document.querySelector('style[data-ef="ui"]'));
      var pass = checks.every(function(c){return c.ok;});
      console.log('[EF.ui] self-test '+(pass?'PASS':'FAIL'), checks);
      return { pass:pass, checks:checks };
    }
  };

  // Show the title screen on load unless a host has already started play.
  if (!EF.__started) EF.ui.showTitle();
  refreshHUD();
  console.log('[EF.ui] ready — HUD, controls, panels, feedback, dialogue, death/respawn');
})();
