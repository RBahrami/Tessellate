/*
 * app.js — UI wiring for Tessellate (geometric wallpaper studio).
 *
 * Multi-layer model (js/layers.js): one permanent Background layer at the
 * bottom of the stack plus up to 8 Pattern layers. Only canvas dimensions,
 * aspect and resolution are global — every tiling, color-theme, effect and
 * animation setting belongs to a layer. The sidebar sections (Tiling, Color
 * theme, Visual effects, Animation) edit the SELECTED layer; the Layers
 * panel handles add/duplicate/rename/delete/reorder/visibility/opacity.
 *
 * Rendering: every visible pattern layer is built into its own scene canvas
 * (cached per layer; only stale scenes rebuild), post-processed per layer
 * (FX.composeLayer), then composited onto the shared output in stack order
 * with the layer's opacity. A single visible opaque layer composites through
 * the legacy FX.compose fast path. Exports (PNG / GIF / APNG) render the
 * exact same composition at the chosen output resolution; animated exports
 * align all layers onto one seamless loop (Layers.planLoop).
 *
 * Persistence: project JSON in localStorage 'einstein-wallpaper-v2'; a
 * legacy 'einstein-wallpaper-v1' blob is migrated once (background settings
 * -> Background layer, fgAlpha -> pattern layer opacity). Palettes,
 * gradients and color templates keep their own stores.
 *
 * Project bar (top of the sidebar): editable project name, a live save
 * indicator (autosave + unsaved-draft warning), undo/redo (js/history.js:
 * snapshot-based with same-control coalescing) and project file save/load.
 * Randomization is section-scoped: the 🎲 dice in each section header
 * randomizes that section of the SELECTED layer; "Randomize layer" in the
 * Layers panel randomizes the whole selected layer.
 */
(function () {
  'use strict';

  const R = window.Renderer, PAL = window.Palettes,
    TL = window.Tilings, GR = window.Gradients, CP = window.CustomPalettes,
    FX = window.Effects, AP = window.Apng, LT = window.Layers,
    HI = window.History;

  /* ------------------------------------------------------- presets */

  const ASPECTS = [
    { id: '16:9',   r: 16 / 9 },
    { id: '16:10',  r: 16 / 10 },
    { id: '4:3',    r: 4 / 3 },
    { id: '5:4',    r: 5 / 4 },
    { id: '3:2',    r: 3 / 2 },
    { id: '21:9',   r: 21 / 9 },
    { id: '32:9',   r: 32 / 9 },
    { id: '1:1',    r: 1 },
    { id: '9:16',   r: 9 / 16 },
    { id: '9:19.5', r: 9 / 19.5 },
    { id: '9:20',   r: 9 / 20 },
  ];

  const RES_PRESETS = {
    '16:9':  [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]],
    '16:10': [[1280, 800], [1440, 900], [1680, 1050], [1920, 1200], [2560, 1600]],
    '4:3':   [[1024, 768], [1400, 1050], [1600, 1200], [2048, 1536]],
    '5:4':   [[1280, 1024], [1600, 1280], [2560, 2048]],
    '3:2':   [[1356, 904], [1620, 1080], [2160, 1440], [3000, 2000]],
    '21:9':  [[2560, 1080], [3440, 1440], [5120, 2160]],
    '32:9':  [[3840, 1080], [5120, 1440]],
    '1:1':   [[1080, 1080], [2048, 2048], [3000, 3000]],
    '9:16':  [[1080, 1920], [1440, 2560], [2160, 3840]],
    '9:19.5': [[1080, 2340], [1170, 2532], [1440, 3120]],
    '9:20':  [[1080, 2400], [1440, 3200]],
  };

  const ANIMS = [
    ['none', 'None (static)'],
    ['shimmer', 'Shimmer (light wave)'],
    ['flow', 'Gradient Flow'],
    ['glowwave', 'Glow Wave'],
  ];

  const THEME_MODES = [
    ['single', 'Single'], ['palette', 'Palette'],
    ['gradient', 'Gradient'], ['duotone', 'Duotone'],
  ];
  const MAP_LABELS = {
    supertile: 'Supertiles (patches)',
    kind: 'By tile kind',
    orientation: 'By orientation',
    mirror: 'Mirror split',
    checker: 'Checkerboard',
    random: 'Random mix',
    sweep: 'Sweep',
    bands: 'Bands',
    single: 'Uniform',
  };

  // built-in single-color templates
  const SINGLE_TPLS = [
    '#5bc8ff', '#8f7bff', '#ff8bd2', '#ffe14d', '#6be3a2', '#ff8a5b',
    '#f4777f', '#4dffb8', '#e8e8e8', '#9aa0b0', '#4a5a78', '#222639',
  ];
  // built-in duotone templates [A, B]
  const DUO_TPLS = [
    ['#5bc8ff', '#f4777f'], ['#ffe14d', '#b07bff'], ['#6be3a2', '#ff8a5b'],
    ['#ff8bd2', '#4dffb8'], ['#f4f1ea', '#54718f'], ['#ffd9a0', '#4a1c3d'],
  ];

  /* -------------------------------------- project state + migration */

  const STORE_V2 = 'einstein-wallpaper-v2';
  const STORE_V1 = 'einstein-wallpaper-v1';

  let project = loadProject();

  /* ------------------------------------------------------- undo/redo */

  // History snapshots capture the full committed state: the project AND the
  // per-layer runtime drafts (unsaved palette/gradient tweaks), so draft
  // edits are undoable too.
  const history = HI.createHistory({ limit: 60 });

  function serializeDrafts() {
    const out = [];
    for (const [id, d] of drafts) out.push([id, JSON.parse(JSON.stringify(d))]);
    return out;
  }
  function restoreDrafts(list) {
    drafts.clear();
    for (const [id, d] of (list || [])) drafts.set(id, JSON.parse(JSON.stringify(d)));
  }
  function takeSnapshot() {
    return { project: JSON.parse(JSON.stringify(project)), drafts: serializeDrafts() };
  }

  // human labels for history entries (keyed like the save() change keys)
  const HIST_LABELS = {
    name: 'Project name',
    aspect: 'Aspect ratio', orientation: 'Orientation', resolution: 'Resolution',
    opacity: 'Layer opacity', visibility: 'Layer visibility',
    layerAdd: 'Layer added', layerDup: 'Layer duplicated', layerDel: 'Layer deleted',
    layerMove: 'Layer reordered', layerRename: 'Layer renamed',
    family: 'Tiling family', variant: 'Pattern variant', tileSize: 'Tile scale',
    rotation: 'Rotation', gap: 'Tile gap', fillAlpha: 'Fill transparency',
    outlineWidth: 'Outline width', lineAlpha: 'Border transparency', seed: 'Seed',
    mode: 'Theme mode', palette: 'Palette', palDraft: 'Palette edits',
    palBg: 'Palette background', palOutline: 'Palette outline', palAdd: 'Palette colors',
    gradient: 'Gradient', gradDraft: 'Gradient edits', gradBands: 'Gradient bands',
    singleColor: 'Single color', duoA: 'Duotone color A', duoB: 'Duotone color B',
    colorMap: 'Palette arrangement', gradMap: 'Gradient arrangement', duoMap: 'Duotone arrangement',
    lineAuto: 'Auto outline', lineColor: 'Outline color',
    fxBlur: 'Blur', fxGlow: 'Glow', fxGlowRadius: 'Glow radius', fxShadow: 'Shadow',
    fxShadowSoft: 'Shadow softness', fxShadowOff: 'Shadow offset', fxGrain: 'Film grain',
    fxVignette: 'Vignette', fxVignetteMode: 'Vignette mode',
    fxShimmer: 'Shimmer strength', fxShimmerAngle: 'Shimmer direction',
    fxShimmerScale: 'Shimmer wavelength',
    fxSheen: 'Sheen strength', fxSheenAngle: 'Sheen direction', fxSheenPos: 'Sheen position',
    fxIrid: 'Iridescence strength', fxIridAngle: 'Iridescence direction', fxIridScale: 'Iridescence spread',
    fxAberration: 'Chromatic aberration', fxScan: 'Scanline strength', fxScanGap: 'Scanline spacing',
    fxSpecial: 'Special effect',
    animation: 'Animation', animSpeed: 'Animation speed', flowAngle: 'Animation direction',
    bgSource: 'Background fill', bgColor: 'Background color',
    bgGradTpl: 'Background gradient template', bgGradType: 'Background gradient type',
    bgGradAngle: 'Background gradient angle', bgGradStops: 'Background gradient stops',
    bgGradReset: 'Background gradient reset',
    randomLayer: 'Randomize layer', randomTiling: 'Randomize tiling',
    randomTheme: 'Randomize colors', randomFx: 'Randomize effects',
    randomAnim: 'Randomize animation', randomBg: 'Randomize background',
    themeImport: 'Themes imported', reset: 'Project reset', load: 'Project loaded',
  };

  function applySnapshot(snap) {
    project = JSON.parse(JSON.stringify(snap.project));
    restoreDrafts(snap.drafts);
    cache.clear(); // rebuild scenes against the restored state
    save();
    syncControls();
    composeFrame(performance.now(), true);
    refresh();
  }
  function doUndo() {
    const e = history.undo();
    if (!e) return;
    applySnapshot(e.snapshot);
    syncHistoryButtons();
    notice('Undo · ' + e.label);
  }
  function doRedo() {
    const e = history.redo();
    if (!e) return;
    applySnapshot(e.snapshot);
    syncHistoryButtons();
    notice('Redo · ' + e.label);
  }
  function syncHistoryButtons() {
    const u = $('undoBtn'), r = $('redoBtn');
    if (!u || !r) return;
    u.disabled = !history.canUndo();
    r.disabled = !history.canRedo();
    u.title = history.undoLabel() ? 'Undo (Ctrl+Z) · ' + history.undoLabel() : 'Undo (Ctrl+Z)';
    r.title = history.redoLabel() ? 'Redo (Ctrl+Y) · ' + history.redoLabel() : 'Redo (Ctrl+Y)';
  }

  function loadProject() {
    // 1) a saved v2 project wins; persist the sanitized form immediately so
    //    conversions (e.g. legacy palette background) stick without any edit
    try {
      const raw = localStorage.getItem(STORE_V2);
      if (raw) {
        const proj = fixProjectRefs(LT.sanitizeProject(JSON.parse(raw)));
        try { localStorage.setItem(STORE_V2, JSON.stringify(proj)); } catch (e) { /* ignore */ }
        return proj;
      }
    } catch (e) { /* fall through */ }
    // 2) migrate the legacy flat v1 settings (keeps palette/gradient refs);
    //    persist the migration immediately so it sticks without any edit
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(STORE_V1) || 'null'); } catch (e) { /* ignore */ }
    const proj = fixProjectRefs(LT.sanitizeProject(legacy));
    try { localStorage.setItem(STORE_V2, JSON.stringify(proj)); } catch (e) { /* ignore */ }
    return proj;
  }

  // post-sanitize reference validation that needs the runtime libraries
  function fixProjectRefs(proj) {
    for (const layer of LT.patternLayers(proj)) {
      if (!TL.isFamily(layer.family)) layer.family = 'hat';
      const fam = TL.get(layer.family);
      if (!fam.variants.some((v) => v.id === layer.variant)) layer.variant = fam.defaultVariant;
      if (layer.theme.gradientId && !GR.find(layer.theme.gradientId)) layer.theme.gradientId = null;
      if (!layer.theme.gradientId) layer.theme.gradientId = GR.BUILTINS[0].id;
    }
    const bg = LT.bgLayer(proj);
    if (bg.bg.gradientId && !GR.find(bg.bg.gradientId)) bg.bg.gradientId = null;
    // seed the owned background gradient from its template when missing
    // (v1/v2 migrations and agent files may reference a library gradient)
    if (!bg.bg.gradient) {
      const src = bg.bg.gradientId ? GR.find(bg.bg.gradientId) : null;
      bg.bg.gradient = LT.normGradient(src || LT.DEFAULT_BG_GRADIENT);
    }
    // legacy palette-derived background -> concrete solid color
    if (bg.bg.legacyPaletteRef) {
      try { bg.bg.color = PAL.get(bg.bg.legacyPaletteRef).bg; } catch (e) { /* keep */ }
      delete bg.bg.legacyPaletteRef;
    }
    return proj;
  }

  function save(key, label) {
    try { localStorage.setItem(STORE_V2, JSON.stringify(project)); } catch (e) { /* ignore */ }
    if (key) {
      history.push(key, label || HIST_LABELS[key] || key, takeSnapshot());
      syncHistoryButtons();
    }
    updateSaveState();
  }

  /* ------------------------------------------------- save indicator */

  function hhmm() {
    const d = new Date();
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
           (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  // mode: undefined = autosave state, 'exported' / 'loaded' = file actions
  function updateSaveState(mode) {
    const el = $('saveState');
    if (!el) return;
    if (mode === 'exported') {
      el.textContent = '✓ exported ' + hhmm();
      el.className = 'sv ok';
      el.title = 'Project file downloaded';
      return;
    }
    if (mode === 'loaded') {
      el.textContent = '✓ loaded ' + hhmm();
      el.className = 'sv ok';
      el.title = 'Project loaded from file';
      return;
    }
    let anyDraft = false;
    for (const d of drafts.values()) {
      if ((d.pal && d.pal.active) || (d.grad && d.grad.active)) { anyDraft = true; break; }
    }
    if (anyDraft) {
      el.textContent = '● unsaved draft';
      el.className = 'sv warn';
      el.title = 'This layer has live palette/gradient edits that are NOT ' +
        'persisted — save them as a custom palette/gradient to keep them.';
    } else {
      el.textContent = '✓ saved ' + hhmm();
      el.className = 'sv ok';
      el.title = 'All changes are auto-saved in this browser (localStorage).';
    }
  }

  // generic template store (Single colors, Duotone pairs) — localStorage
  function tplStore(key) {
    let items = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) items = data;
      }
    } catch (e) { /* ignore */ }
    const persist = () => {
      try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) { /* ignore */ }
    };
    return {
      list: () => items.slice(),
      add(tpl) { items.push(tpl); persist(); },
      remove(i) { if (i >= 0 && i < items.length) { items.splice(i, 1); persist(); } },
    };
  }
  const singleStore = tplStore('ew-single-templates-v1');
  const duoStore = tplStore('ew-duo-templates-v1');

  // per-layer transient edit drafts (unsaved palette/gradient tweaks).
  // Runtime only — like the pre-layer behavior, unsaved drafts are lost on
  // reload unless saved as a custom palette/gradient/template.
  const drafts = new Map(); // layerId -> { pal: {active, draft}, grad: {active, draft, editId} }
  function draftFor(id) {
    let d = drafts.get(id);
    if (!d) {
      d = { pal: { active: false, draft: null }, grad: { active: false, draft: null, editId: null } };
      drafts.set(id, d);
    }
    return d;
  }

  // custom palette resolver for Palettes.get
  PAL.setCustomResolver((id) => CP.find(id));

  /* ------------------------------------------------- dom + selection */

  const $ = (id) => document.getElementById(id);
  const canvas = $('preview');
  const statusEl = $('status');

  function SL() { return LT.selectedLayer(project); }
  function SP() {
    const l = SL();
    return (l && l.type === 'pattern') ? l : LT.patternLayers(project)[0];
  }
  function selectLayer(id) {
    if (project.selected === id) return;
    project.selected = id;
    save();
    syncControls();
    const l = SL();
    if (l) notice(`Editing "${l.name}"`);
  }

  function naturalOrientation(a) { return a.r >= 1 ? 'landscape' : 'portrait'; }
  function currentAspect() {
    const a = ASPECTS.find((x) => x.id === project.aspect) || ASPECTS[0];
    const nat = naturalOrientation(a);
    if (project.orientation === nat) return a.r;
    return 1 / a.r;
  }
  function sameRef(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind === 'builtin' && b.kind === 'builtin') return a.index === b.index;
    if (a.kind === 'custom' && b.kind === 'custom') return a.id === b.id;
    return false;
  }

  /* ------------------------------------------- background layer fill */

  // Resolved fill spec of the Background layer (explicit — it never depends
  // on which pattern layer happens to be selected). Fill is a solid color or
  // the layer's OWN fully-editable gradient object.
  function bgFillSpec() {
    const b = LT.bgLayer(project).bg;
    if (b.source === 'gradient') {
      return { kind: 'gradient', grad: b.gradient || GR.find(b.gradientId) || GR.BUILTINS[0] };
    }
    return { kind: 'solid', color: b.color };
  }
  function paintBackgroundFill(ctx, W, H) {
    const spec = bgFillSpec();
    if (spec.kind === 'gradient') {
      const g = GR.toCanvas(ctx, spec.grad, W, H, 0);
      if (g && g.conic) GR.fillConic(ctx, spec.grad, W, H);
      else { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    } else {
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, 0, W, H);
    }
  }
  function effectiveBgColor() {
    const spec = bgFillSpec();
    return spec.kind === 'gradient' ? GR.sample(spec.grad, 0.5) : spec.color;
  }
  function bgSourceLabel(layer) {
    return layer.bg.source === 'gradient' ? 'gradient' : 'solid';
  }

  /* ------------------------------------------- color theme helpers */

  // Arrangement options for a layer's theme mode. Options that would be
  // mathematically constant on the current family (By tile kind / By
  // orientation on families with a single kind/orientation) are hidden —
  // the engine's degenerate-map guard covers any stale-scene race.
  function arrOptions(layer, modeArg) {
    const fam = TL.get(layer.family);
    const kind = fam.id === 'hat' ? 'hat' : (fam.id === 'lines' ? 'line' : 'poly');
    const e = cache.get(layer.id);
    const counts = (e && e.scene && e.scene.kind === 'poly' && e.scene.family === layer.family) ? e.scene : null;
    const m = modeArg || layer.theme.mode;
    if (m === 'palette') {
      if (kind === 'hat') return ['supertile', 'orientation', 'mirror', 'checker', 'random'];
      if (kind === 'poly') {
        const opts = [];
        if (!counts || counts.kindCount >= 2) opts.push('kind');
        if (!counts || counts.orientCount >= 2) opts.push('orientation');
        opts.push('checker', 'random');
        return opts;
      }
      return ['orientation', 'random'];
    }
    if (m === 'gradient') return ['sweep', 'bands', 'random'];
    if (m === 'duotone') return ['checker', 'sweep', 'random'];
    return ['single'];
  }
  function mapKeyFor(mode) {
    return mode === 'palette' ? 'colorMap'
      : mode === 'gradient' ? 'gradMap' : 'duoMap';
  }
  function currentMap(layer) {
    const th = layer.theme;
    if (th.mode === 'single') return 'single';
    if (th.mode === 'gradient') return th.gradMap;
    if (th.mode === 'duotone') return th.duoMap;
    return th.colorMap;
  }
  function ensureMapValid(layer) {
    if (layer.theme.mode === 'single') return;
    const key = mapKeyFor(layer.theme.mode);
    const opts = arrOptions(layer);
    if (!opts.includes(layer.theme[key])) layer.theme[key] = opts[0];
  }
  function setThemeMode(mode) {
    const layer = SP();
    if (!THEME_MODES.some((m) => m[0] === mode)) mode = 'palette';
    layer.theme.mode = mode;
    ensureMapValid(layer);
    save('mode', 'Theme mode'); syncControls(); recolor(layer);
  }

  /* ------------------------------------------------- per-layer cache */

  // cache: layerId -> { gkey, ckey, scene, params, look, animator,
  //                     canvas(scene), ctx, fx(fx scratch), fxCtx }
  const cache = new Map();
  function entryFor(layer) {
    let e = cache.get(layer.id);
    if (!e) {
      e = {
        gkey: null, ckey: null, scene: null, params: null, look: null, animator: null,
        canvas: document.createElement('canvas'), ctx: null,
        fx: document.createElement('canvas'), fxCtx: null,
      };
      e.ctx = e.canvas.getContext('2d');
      e.fxCtx = e.fx.getContext('2d');
      cache.set(layer.id, e);
    }
    return e;
  }

  function layerParams(layer) {
    return {
      family: layer.family, variant: layer.variant,
      tileSize: layer.tileSize, rotation: layer.rotation,
      panX: layer.panX || 0, panY: layer.panY || 0,
      gap: layer.gap, outlineWidth: layer.outlineWidth, seed: layer.seed,
      gradBands: layer.theme.gradBands, paletteRef: layer.theme.paletteRef,
      animation: layer.animation, animSpeed: layer.animSpeed, flowAngle: layer.flowAngle,
    };
  }
  // geometry key: a change here requires a scene rebuild
  function gkeyFor(layer, W, H) {
    return [W, H, layer.family, layer.variant, layer.tileSize, layer.rotation,
      layer.panX || 0, layer.panY || 0, layer.seed, layer.animation === 'none'].join('|');
  }
  // color/look key: a change here only re-colorizes + repaints the scene
  function ckeyFor(layer) {
    const th = layer.theme;
    const d = draftFor(layer.id);
    return [th.mode, th.colorMap, th.gradMap, th.duoMap, th.gradBands,
      th.singleColor, th.duoA, th.duoB, JSON.stringify(th.paletteRef), th.gradientId,
      d.pal.active ? JSON.stringify(d.pal.draft) : '',
      d.grad.active ? JSON.stringify(d.grad.draft) : '',
      layer.lineAuto, layer.lineColor, layer.gap, layer.outlineWidth,
      layer.fillAlpha, layer.lineAlpha,
      layer.animation, layer.animSpeed, layer.flowAngle,
      effectiveBgColor()].join('|');
  }

  function palSourceFor(layer) {
    const d = draftFor(layer.id);
    if (d.pal.active && d.pal.draft) return d.pal.draft;
    return PAL.get(layer.theme.paletteRef);
  }
  function gradSourceFor(layer) {
    const d = draftFor(layer.id);
    if (d.grad.active && d.grad.draft) return d.grad.draft;
    return GR.find(layer.theme.gradientId) || GR.BUILTINS[0];
  }

  // color look for a PATTERN layer: LUT + outline + paint geometry.
  // look.alpha stays 1 — layer opacity is applied at composite time to the
  // entire rendered layer (tiles, outlines, shadows, glow alike).
  function makeLayerLook(layer) {
    const th = layer.theme;
    const d = draftFor(layer.id);
    let lut, pal = null;
    if (th.mode === 'single') {
      lut = R.buildSolidLut(th.singleColor);
    } else if (th.mode === 'gradient') {
      lut = R.buildLut({ _isGradient: true, gradient: gradSourceFor(layer) });
    } else if (th.mode === 'duotone') {
      lut = R.buildLut({
        _isGradient: true,
        gradient: GR.normalize({
          type: 'linear', angle: 0,
          stops: [{ pos: 0, color: th.duoA }, { pos: 1, color: th.duoB }],
        }),
      });
    } else {
      pal = palSourceFor(layer);
      lut = d.pal.active ? R.buildLutFromColors(pal.colors) : R.buildLut(th.paletteRef);
    }
    // outline: palette's own outline (when Auto outline is on) -> auto -> manual
    const palOutline = pal && pal.outline != null ? pal.outline : null;
    const line = layer.lineAuto ? (palOutline || PAL.autoLineColor(effectiveBgColor())) : layer.lineColor;
    const look = { lut, line, bg: effectiveBgColor(), gap: layer.gap, outlineWidth: layer.outlineWidth, alpha: 1 };
    // per-tile fill vs border transparency (independent of layer opacity,
    // which is applied later at composite time to the whole layer)
    look.fillAlpha = Math.max(0, Math.min(1, (layer.fillAlpha == null ? 100 : layer.fillAlpha) / 100));
    look.lineAlpha = Math.max(0, Math.min(1, (layer.lineAlpha == null ? 100 : layer.lineAlpha) / 100));
    // for the single-layer fast path (FX.compose paints the background from
    // the look) carry the real background fill when it is a gradient
    const spec = bgFillSpec();
    if (spec.kind === 'gradient') {
      const g = spec.grad;
      look.bg = GR.sample(g, 0.5);
      look.bgPaint = (ctx, W, H) => {
        const gp = GR.toCanvas(ctx, g, W, H, 0);
        if (gp && gp.conic) GR.fillConic(ctx, g, W, H);
        else { ctx.fillStyle = gp; ctx.fillRect(0, 0, W, H); }
      };
    }
    return look;
  }

  /* --------------------------------------- palette templates grid */

  function buildPaletteGrid(layer) {
    const grid = $('paletteGrid');
    grid.innerHTML = '';
    const nameEl = $('palName');
    const pal = palSourceFor(layer);
    const d = draftFor(layer.id);
    if (nameEl) nameEl.textContent = (d.pal.active ? 'edited · ' : '') + pal.name;
    PAL.LIST.forEach((palB, i) => {
      grid.appendChild(makeSwatch(layer, palB, { kind: 'builtin', index: i }));
    });
    const customs = CP.list();
    if (customs.length) {
      const sep = document.createElement('div');
      sep.className = 'swatch-sep';
      sep.title = 'Custom palettes';
      grid.appendChild(sep);
      for (const p of customs) grid.appendChild(makeSwatch(layer, p, { kind: 'custom', id: p.id }));
    }
  }
  function makeSwatch(layer, pal, ref) {
    const b = document.createElement('button');
    const on = sameRef(layer.theme.paletteRef, ref) && !draftFor(layer.id).pal.active;
    b.className = 'swatch' + (on ? ' on' : '');
    b.title = pal.name + (ref.kind === 'custom' ? ' (custom)' : '');
    b.style.background = `linear-gradient(135deg, ${pal.colors.join(',')})`;
    b.style.borderColor = on ? '#fff' : 'rgba(255,255,255,.15)';
    b.onclick = () => applyPaletteRef(layer, ref);
    return b;
  }
  function applyPaletteRef(layer, ref) {
    layer.theme.paletteRef = ref;
    draftFor(layer.id).pal.active = false;
    loadPalDraft(layer);
    save('palette', 'Palette selected');
    syncControls();
    recolor(layer);
  }

  /* -------------------------------------- palette editor (per layer) */

  function loadPalDraft(layer) {
    const d = draftFor(layer.id);
    let src;
    if (layer.theme.paletteRef.kind === 'custom') src = CP.find(layer.theme.paletteRef.id) || PAL.LIST[0];
    else src = PAL.LIST[layer.theme.paletteRef.index] || PAL.LIST[0];
    d.pal.draft = {
      name: src.name,
      colors: [...src.colors],
      bg: src.bg || '#0b1020',
      outline: ('outline' in src && src.outline != null) ? src.outline : null,
    };
  }
  function palEdited(layer) {
    const d = draftFor(layer.id);
    d.pal.active = true;
    $('palEditState').textContent = 'edited · live';
  }
  function renderPalEditor(layer) {
    const d = draftFor(layer.id);
    if (!d.pal.draft) loadPalDraft(layer);
    const palDraft = d.pal.draft;
    const list = $('palStops');
    list.innerHTML = '';
    palDraft.colors.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'stoprow';
      const col = document.createElement('input');
      col.type = 'color'; col.value = c;
      col.oninput = () => {
        palDraft.colors[i] = col.value; palEdited(layer);
        buildPaletteGrid(layer); recolor(layer); save('palDraft', 'Palette colors');
      };
      const hexin = document.createElement('input');
      hexin.type = 'text'; hexin.value = c; hexin.className = 'hextext'; hexin.spellcheck = false;
      hexin.onchange = () => {
        if (GR.isHexColor(hexin.value)) {
          palDraft.colors[i] = GR.normHex(hexin.value); palEdited(layer);
          buildPaletteGrid(layer); renderPalEditor(layer); recolor(layer); save('palDraft', 'Palette colors');
        } else hexin.value = palDraft.colors[i];
      };
      const up = document.createElement('button');
      up.className = 'mini-btn'; up.textContent = '↑'; up.title = 'Move up';
      up.onclick = () => {
        if (i > 0) {
          [palDraft.colors[i - 1], palDraft.colors[i]] = [palDraft.colors[i], palDraft.colors[i - 1]];
          palEdited(layer); buildPaletteGrid(layer); renderPalEditor(layer); recolor(layer); save('palDraft', 'Palette color order');
        }
      };
      const down = document.createElement('button');
      down.className = 'mini-btn'; down.textContent = '↓'; down.title = 'Move down';
      down.onclick = () => {
        if (i < palDraft.colors.length - 1) {
          [palDraft.colors[i + 1], palDraft.colors[i]] = [palDraft.colors[i], palDraft.colors[i + 1]];
          palEdited(layer); buildPaletteGrid(layer); renderPalEditor(layer); recolor(layer); save('palDraft', 'Palette color order');
        }
      };
      const del = document.createElement('button');
      del.className = 'mini-btn'; del.textContent = '×'; del.title = 'Remove color';
      del.onclick = () => {
        if (palDraft.colors.length > 1) {
          palDraft.colors.splice(i, 1);
          palEdited(layer); buildPaletteGrid(layer); renderPalEditor(layer); recolor(layer); save('palDraft', 'Palette colors');
        }
      };
      row.append(col, hexin, up, down, del);
      list.appendChild(row);
    });
    $('palBg').value = palDraft.bg;
    $('palOutline').value = palDraft.outline || PAL.autoLineColor(palDraft.bg);
    $('palOutline').disabled = palDraft.outline == null;
  }

  /* ------------------------------------- gradient editor (per layer) */

  function loadGradDraft(layer) {
    const d = draftFor(layer.id);
    const src = GR.find(layer.theme.gradientId) || GR.BUILTINS[0];
    d.grad.draft = GR.normalize(JSON.parse(JSON.stringify(src)));
    d.grad.editId = src.id;
  }
  function fillGradientSelect(sel, selectedId) {
    sel.innerHTML = '';
    const g1 = document.createElement('optgroup');
    g1.label = 'Built-in';
    GR.BUILTINS.forEach((g) => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      if (selectedId === g.id) o.selected = true;
      g1.appendChild(o);
    });
    sel.appendChild(g1);
    const customs = GR.list();
    if (customs.length) {
      const g2 = document.createElement('optgroup');
      g2.label = 'Custom';
      for (const g of customs) {
        const o = document.createElement('option');
        o.value = g.id; o.textContent = g.name;
        if (selectedId === g.id) o.selected = true;
        g2.appendChild(o);
      }
      sel.appendChild(g2);
    }
  }
  function applyGradientId(layer, id) {
    layer.theme.gradientId = id;
    const d = draftFor(layer.id);
    d.grad.active = false;
    loadGradDraft(layer);
    fillGradientSelect($('gradPick'), id);
    syncControls();
    recolor(layer);
    save('gradient', 'Gradient selected');
  }
  function gradEdited(layer) {
    const d = draftFor(layer.id);
    d.grad.active = true;
    $('gradEditState').textContent = 'edited · live';
  }
  function renderGradEditor(layer) {
    const d = draftFor(layer.id);
    if (!d.grad.draft) loadGradDraft(layer);
    const gradDraft = d.grad.draft;
    fillSelect($('gradType'), [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']], gradDraft.type);
    $('gradAngle').value = gradDraft.angle;
    $('gradAngleVal').textContent = gradDraft.angle + '°';
    $('gradStopCount').textContent = gradDraft.stops.length + ' stops';
    const list = $('gradStops');
    list.innerHTML = '';
    gradDraft.stops.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'stoprow';
      const col = document.createElement('input');
      col.type = 'color'; col.value = s.color;
      col.oninput = () => {
        gradDraft.stops[i].color = col.value;
        gradEdited(layer);
        renderGradPreview(layer); recolor(layer); save('gradDraft', 'Gradient stops');
      };
      const pos = document.createElement('input');
      pos.type = 'number'; pos.min = 0; pos.max = 100; pos.step = 1;
      pos.value = Math.round(s.pos * 100);
      pos.className = 'postext';
      pos.onchange = () => {
        gradDraft.stops[i].pos = Math.max(0, Math.min(100, +pos.value || 0)) / 100;
        gradDraft.stops.sort((a, b) => a.pos - b.pos);
        gradEdited(layer);
        renderGradEditor(layer); recolor(layer); save('gradDraft', 'Gradient stop position');
      };
      const del = document.createElement('button');
      del.className = 'mini-btn'; del.textContent = '×'; del.title = 'Remove stop';
      del.onclick = () => {
        if (gradDraft.stops.length > 2) {
          gradDraft.stops.splice(i, 1);
          gradEdited(layer);
          renderGradEditor(layer); recolor(layer); save('gradDraft', 'Gradient stops');
        }
      };
      row.append(col, pos, del);
      list.appendChild(row);
    });
    $('gradDelete').disabled = !d.grad.editId || GR.BUILTINS.some((g) => g.id === d.grad.editId);
    renderGradPreview(layer);
  }
  function renderGradPreview(layer) {
    const d = draftFor(layer.id);
    const grad = (d.grad.active && d.grad.draft) ? d.grad.draft : GR.normalize(gradSourceFor(layer));
    const cv = $('gradPreview');
    const w = cv.parentElement ? (cv.parentElement.clientWidth || 260) : 260;
    cv.width = w; cv.height = 26;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const g = GR.toCanvas(ctx, grad, cv.width, cv.height, 0);
    if (g && g.conic) GR.fillConic(ctx, grad, cv.width, cv.height);
    else { ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height); }
  }
  function syncGradEditState(layer) {
    const d = draftFor(layer.id);
    $('gradEditState').textContent = d.grad.active ? 'edited · live' : '';
    $('palEditState').textContent = d.pal.active ? 'edited · live' : '';
  }

  /* ------------------------------- single / duotone templates */

  function buildSingleTpls(layer) {
    const box = $('singleTpls');
    box.innerHTML = '';
    SINGLE_TPLS.forEach((c) => {
      box.appendChild(makeTplSwatch(c, c === layer.theme.singleColor, () => {
        layer.theme.singleColor = c; $('singleColor').value = c;
        buildSingleTpls(layer); recolor(layer); save('singleColor', 'Single color template');
      }));
    });
    const customs = singleStore.list();
    if (customs.length) {
      const sep = document.createElement('div');
      sep.className = 'tpl-sep';
      box.appendChild(sep);
      customs.forEach((c, i) => {
        box.appendChild(makeTplSwatch(c, c === layer.theme.singleColor, () => {
          layer.theme.singleColor = c; $('singleColor').value = c;
          buildSingleTpls(layer); recolor(layer); save('singleColor', 'Single color template');
        }, i));
      });
    }
  }
  function makeTplSwatch(bg, on, onclick, customIdx) {
    const b = document.createElement('button');
    b.className = 'tpl' + (on ? ' on' : '');
    b.style.background = bg;
    b.title = customIdx != null ? 'Custom template' : bg;
    b.onclick = onclick;
    return b;
  }
  function buildDuoTpls(layer) {
    const box = $('duoTpls');
    box.innerHTML = '';
    const pairOn = (a, b) => a === layer.theme.duoA && b === layer.theme.duoB;
    DUO_TPLS.forEach(([a, b]) => {
      box.appendChild(makeTplSwatch(`linear-gradient(135deg, ${a} 50%, ${b} 50%)`, pairOn(a, b), () => {
        layer.theme.duoA = a; layer.theme.duoB = b;
        $('duoA').value = a; $('duoB').value = b;
        buildDuoTpls(layer); recolor(layer); save('duoA', 'Duotone pair');
      }));
    });
    const customs = duoStore.list();
    if (customs.length) {
      const sep = document.createElement('div');
      sep.className = 'tpl-sep';
      box.appendChild(sep);
      customs.forEach((p, i) => {
        box.appendChild(makeTplSwatch(`linear-gradient(135deg, ${p.a} 50%, ${p.b} 50%)`, pairOn(p.a, p.b), () => {
          layer.theme.duoA = p.a; layer.theme.duoB = p.b;
          $('duoA').value = p.a; $('duoB').value = p.b;
          buildDuoTpls(layer); recolor(layer); save('duoA', 'Duotone pair');
        }, i));
      });
    }
  }

  /* --------------------------------------------------- rendering */

  let animRaf = 0;

  function previewSize() {
    const box = $('canvasWrap').getBoundingClientRect();
    const ar = currentAspect();
    let w = box.width - 24, h = box.height - 24;
    if (w / h > ar) w = h * ar; else h = w / ar;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cap = 1920;
    let scale = dpr;
    if (w * scale > cap) scale = cap / w;
    return { w: Math.round(w * scale), h: Math.round(h * scale), cssW: Math.round(w), cssH: Math.round(h) };
  }

  // Build (or reuse) the cached scene of a pattern layer at W x H. A scene
  // rebuild happens only when the geometry key changed; color/look changes
  // just re-colorize + repaint.
  function ensureScene(layer, W, H, opts) {
    opts = opts || {};
    const e = entryFor(layer);
    const gk = gkeyFor(layer, W, H);
    if (opts.force || e.gkey !== gk || !e.scene) {
      const scaleToTarget = W / project.resW;
      const p = layerParams(layer);
      p.tileSize = layer.tileSize * scaleToTarget;
      const budget = opts.budget || (layer.animation === 'none' ? 450000 : 120000);
      e.scene = R.buildScene(p, W, H, { budget });
      if (!e.scene) { e.gkey = null; e.ckey = null; return e; }
      e.params = p;
      e.scale = scaleToTarget;
      if (e.canvas.width !== W || e.canvas.height !== H) {
        e.canvas.width = W; e.canvas.height = H;
        e.fx.width = W; e.fx.height = H;
      }
      e.gkey = gk;
      e.ckey = null; // force recolor for the new scene
    }
    if (e.ckey !== ckeyFor(layer)) recolorEntry(layer, e);
    return e;
  }

  // re-colorize + rebuild look/animator + repaint the scene canvas. Params
  // are rebuilt from the LAYER (not the build-time snapshot) so animation
  // speed/direction/map changes apply without a geometry rebuild.
  function recolorEntry(layer, e) {
    const p = layerParams(layer);
    p.tileSize = layer.tileSize * (e.scale != null ? e.scale : e.scene.W / project.resW);
    p.colorMap = currentMap(layer);
    R.colorize(e.scene, p);
    e.params = p;
    e.look = makeLayerLook(layer);
    e.animator = R.makeAnimator(e.scene, p, e.look);
    e.ckey = ckeyFor(layer);
    // frozen special-effect shimmer shades tiles IN the base paint (a still
    // frame of the shimmer animation, cell-based like the animator); the
    // shimmer animation itself repaints per frame and is never paused
    R.paintScene(e.ctx, e.scene, p, e.look, R.frozenShimmer(e.scene, e.look, layer.effects));
  }

  function anyAnimating() {
    return LT.patternLayers(project).some((l) => l.visible && l.animation !== 'none');
  }

  function regenerate() {
    const ps = previewSize();
    canvas.width = ps.w; canvas.height = ps.h;
    canvas.style.width = ps.cssW + 'px';
    canvas.style.height = ps.cssH + 'px';

    const t0 = performance.now();
    let built = 0, tiles = 0;
    for (const layer of LT.patternLayers(project)) {
      if (!layer.visible) continue;
      const e = ensureScene(layer, ps.w, ps.h);
      if (e.scene) {
        built++;
        tiles += (e.scene.kind === 'hat') ? e.scene.hats.length : e.scene.tiles.length;
      }
    }
    const ms = (performance.now() - t0).toFixed(0);
    const nPat = LT.patternLayers(project).length;
    if (performance.now() >= noticeUntil) {
      statusEl.textContent = `${nPat} pattern layer${nPat > 1 ? 's' : ''} · ${built} visible · ` +
        `${tiles.toLocaleString()} tiles · ${ms} ms`;
    }

    // scenes are ready: refresh family-aware arrangement options
    syncMapSelects();
    composeFrame(0, false);
    cancelAnimationFrame(animRaf);
    if (anyAnimating()) animRaf = requestAnimationFrame(loop);
  }

  function composeFrame(t, live) {
    compositeComposition(canvas.getContext('2d'), canvas.width, canvas.height, t, !!live, null);
  }

  /*
   * Render the full layer stack onto targetCtx (shared by the live preview
   * and every export):
   *   1. Background layer fill (its own opacity; skipped when hidden —
   *      transparency then survives into PNG/APNG)
   *   2. each visible pattern layer bottom-to-top: per-layer effects into a
   *      scratch surface, then drawn with the layer's opacity
   * Single visible fully-opaque layer over a visible background uses the
   * legacy FX.compose fast path (one compose, no intermediate blit).
   * parts: prepared layer renders (export path); null -> build from cache.
   * matte: optional pre-fill color for formats without alpha (GIF).
   */
  function compositeComposition(ctx, W, H, t, live, parts, matte) {
    const bg = LT.bgLayer(project);
    if (!parts) {
      parts = [];
      for (const layer of LT.patternLayers(project)) {
        if (!layer.visible || layer.opacity <= 0) continue;
        const e = ensureScene(layer, W, H);
        if (!e.scene) continue;
        parts.push({ layer, canvas: e.canvas, sctx: e.ctx, look: e.look,
          animator: e.animator, fxCanvas: e.fx, fxCtx: e.fxCtx });
      }
    }
    const bgOn = !!(bg && bg.visible && bg.opacity > 0);
    const vis = parts.filter((p) => p.layer.visible && p.layer.opacity > 0);
    ctx.clearRect(0, 0, W, H);
    if (matte) { ctx.fillStyle = matte; ctx.fillRect(0, 0, W, H); }

    const fast = bgOn && vis.length === 1 && vis[0].layer.opacity === 100 && !matte;
    if (fast) {
      const p = vis[0];
      if (live && p.animator && p.animator.perTile) {
        p.sctx.clearRect(0, 0, W, H);
        p.animator.frame(p.sctx, t);
      }
      const overlay = (live && p.animator && p.animator.overlayFn) ? (c) => p.animator.overlayFn(c, t) : null;
      FX.compose(ctx, p.canvas, W, H, p.look, p.layer.effects, overlay);
      return;
    }

    if (bgOn) {
      ctx.save();
      ctx.globalAlpha = bg.opacity / 100;
      paintBackgroundFill(ctx, W, H);
      ctx.restore();
    }
    for (const p of vis) {
      if (live && p.animator && p.animator.perTile) {
        p.sctx.clearRect(0, 0, W, H);
        p.animator.frame(p.sctx, t);
      }
      const overlay = (live && p.animator && p.animator.overlayFn) ? (c) => p.animator.overlayFn(c, t) : null;
      FX.composeLayer(p.fxCtx, p.canvas, W, H, p.look, p.layer.effects, overlay);
      ctx.save();
      ctx.globalAlpha = p.layer.opacity / 100;
      ctx.drawImage(p.fxCanvas, 0, 0, W, H);
      ctx.restore();
    }
  }

  function loop(t) {
    animRaf = requestAnimationFrame(loop);
    if (!anyAnimating()) { cancelAnimationFrame(animRaf); animRaf = 0; return; }
    composeFrame(t, true);
  }

  // live re-color of one layer: rebuild its map/LUT/animator and repaint its
  // scene canvas without touching geometry (cheap enough for input events)
  function recolor(layer) {
    layer = layer || SP();
    const e = ensureScene(layer, canvas.width, canvas.height);
    if (!e.scene) return;
    recolorEntry(layer, e);
    composeFrame(performance.now(), true);
  }
  // re-color every visible layer (background fill changed -> looks change)
  function recolorAll() {
    for (const layer of LT.patternLayers(project)) {
      if (!layer.visible) continue;
      const e = ensureScene(layer, canvas.width, canvas.height);
      if (e.scene) recolorEntry(layer, e);
    }
    composeFrame(performance.now(), true);
  }

  let refreshTimer = 0;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(regenerate, 120);
  }

  // transient status message that survives the next debounced regenerate
  let noticeUntil = 0;
  function notice(text) {
    statusEl.textContent = text;
    noticeUntil = performance.now() + 2000;
  }

  /* ------------------------------------------------------- export */

  const tickAsync = () => new Promise((r) => setTimeout(r, 0));
  function famTag() {
    const pats = LT.patternLayers(project);
    if (pats.length > 1) return 'stack' + pats.length;
    const l = pats[0];
    if (!l) return 'wallpaper';
    return l.family === 'hat' ? 'einstein' : l.family;
  }
  // file base for downloads: the project name (slugged) when the user named
  // the project, otherwise the tiling-family tag
  function fileBase() {
    const n = (project.name || '').trim();
    if (n && n !== LT.PROJECT_NAME_DEFAULT) {
      const s = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (s) return s;
    }
    return famTag();
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Build one pattern layer's scene + look at an exact resolution WITHOUT
  // painting (shared by the SVG/PSD exporters and their live preview).
  // Visible flag is intentionally ignored — hidden layers can be exported too.
  function buildSceneForLayer(layer, W, H) {
    const p = layerParams(layer);
    const sc = R.buildScene(p, W, H, { budget: layer.animation === 'none' ? 500000 : 200000 });
    if (!sc) return null;
    p.colorMap = currentMap(layer);
    R.colorize(sc, p);
    const lk = makeLayerLook(layer);
    return { layer, scene: sc, params: p, look: lk };
  }

  // Build every visible pattern layer fresh at the EXACT export resolution
  // (same geometry math as the preview — scale factor 1:1).
  // Optional `include(layer)` predicate overrides the default visibility rule.
  function buildExportParts(W, H, include) {
    const parts = [];
    for (const layer of LT.patternLayers(project)) {
      if (include ? !include(layer) : (!layer.visible || layer.opacity <= 0)) continue;
      const p = layerParams(layer);
      const staticAnim = layer.animation === 'none';
      const sc = R.buildScene(p, W, H, { budget: staticAnim ? 500000 : 200000 });
      if (!sc) continue;
      p.colorMap = currentMap(layer);
      R.colorize(sc, p);
      const lk = makeLayerLook(layer);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const sctx = c.getContext('2d');
      // paint the static scene ONCE: per-tile animations repaint it per
      // frame, overlay/static renders composite this painted base.
      // Frozen special-effect shimmer shades the tiles in this base paint.
      R.paintScene(sctx, sc, p, lk, R.frozenShimmer(sc, lk, layer.effects));
      const animator = R.makeAnimator(sc, p, lk);
      const fxC = document.createElement('canvas');
      fxC.width = W; fxC.height = H;
      parts.push({ layer, canvas: c, sctx, look: lk, animator,
        fxCanvas: fxC, fxCtx: fxC.getContext('2d') });
    }
    return parts;
  }

  // full-resolution PNG as a Blob (shared by exportPNG and the toolbar
  // Share button)
  function renderPngBlob() {
    return new Promise((resolve, reject) => {
      const W = project.resW, H = project.resH;
      const parts = buildExportParts(W, H);
      if (!parts.length && !(LT.bgLayer(project).visible)) {
        reject(new Error('nothing visible'));
        return;
      }
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      compositeComposition(off.getContext('2d'), W, H, 0, false, parts);
      off.toBlob((blob) => {
        if (blob) resolve({ blob, W, H, n: parts.reduce((a, p) => a + (p.canvas ? 1 : 0), 0) });
        else reject(new Error('PNG encode failed'));
      }, 'image/png');
    });
  }

  async function exportPNG() {
    statusEl.textContent = 'rendering full resolution…';
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    try {
      const { blob, W, H, n } = await renderPngBlob();
      downloadBlob(blob, `${fileBase()}-${W}x${H}.png`);
      statusEl.textContent = `PNG saved · ${n} layer${n > 1 ? 's' : ''} · ${W}x${H} · ${(performance.now() - t0).toFixed(0)} ms`;
    } catch (err) {
      statusEl.textContent = 'export failed: ' + err.message;
    }
  }

  /*
   * Animated exports: one seamless combined loop. The slowest animated
   * layer defines the loop length; faster layers get an integer number of
   * cycles via a per-layer time warp (visually unchanged speed); overly
   * long combinations are uniformly compressed. Frames composite the full
   * stack (background fill + all visible pattern layers).
   */
  function prepareLoopExport(W, H, matte) {
    const parts = buildExportParts(W, H);
    // zero pattern layers is fine (background-only GIF/APNG = one static
    // frame of the background fill)
    const plan = LT.planLoop(parts.map((p) => (p.animator && p.animator.periodMs) || 0));
    const bg = LT.bgLayer(project);
    const outC = document.createElement('canvas');
    outC.width = W; outC.height = H;
    const octx = outC.getContext('2d');
    const bgOn = bg.visible && bg.opacity > 0;
    const fast = !matte && bgOn && parts.length === 1 && parts[0].layer.opacity === 100;
    const renderAt = (t) => {
      if (fast) {
        const p = parts[0];
        const tw = t * (plan.warps[0] || 1);
        if (p.animator && p.animator.perTile) {
          p.sctx.clearRect(0, 0, W, H);
          p.animator.frame(p.sctx, tw);
        }
        const overlay = (p.animator && p.animator.overlayFn) ? (c) => p.animator.overlayFn(c, tw) : null;
        FX.compose(octx, p.canvas, W, H, p.look, p.layer.effects, overlay);
        return;
      }
      octx.clearRect(0, 0, W, H);
      if (matte) { octx.fillStyle = matte; octx.fillRect(0, 0, W, H); }
      if (bgOn) {
        octx.save();
        octx.globalAlpha = bg.opacity / 100;
        paintBackgroundFill(octx, W, H);
        octx.restore();
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const tw = t * (plan.warps[i] || 1);
        if (p.animator && p.animator.perTile) {
          p.sctx.clearRect(0, 0, W, H);
          p.animator.frame(p.sctx, tw);
        }
        const overlay = (p.animator && p.animator.overlayFn) ? (c) => p.animator.overlayFn(c, tw) : null;
        FX.composeLayer(p.fxCtx, p.canvas, W, H, p.look, p.layer.effects, overlay);
        octx.save();
        octx.globalAlpha = p.layer.opacity / 100;
        octx.drawImage(p.fxCanvas, 0, 0, W, H);
        octx.restore();
      }
    };
    return { W, H, octx, renderAt, plan, parts };
  }

  // seamless GIF as raw bytes (shared by exportGIF and the toolbar Share
  // button); onStep(optional) receives progress text for a button label
  async function renderGifBytes(onStep) {
    const step = (t) => { if (onStep) onStep(t); };
    statusEl.textContent = 'rendering GIF frames…';
    await tickAsync();
    // GIF has no partial alpha: transparent projects are flattened on black
    const prep = prepareLoopExport(project.resW, project.resH, '#000000');
    if (!prep) throw new Error('GIF render failed');
    const { W, H, octx, renderAt, plan } = prep;
    const frames = plan.frames;
    // one static frame (background-only project) still needs a sane delay
    const delayCs = plan.frames === 1 ? Math.max(plan.delayCs, 50) : plan.delayCs;

    // one global palette from a spread of sample frames keeps colors
    // stable across the animation (no palette flicker)
    const nS = Math.min(frames, 12);
    const samples = [];
    for (let s = 0; s < nS; s++) {
      renderAt(Math.round((s * frames) / nS) * delayCs * 10);
      samples.push(new Uint8ClampedArray(octx.getImageData(0, 0, W, H).data));
      step(`palette ${Math.round(((s + 1) / nS) * 100)}%`);
      await tickAsync();
    }
    const pal = Gif.buildPalette(samples, 256);
    const map = Gif.createMapper(pal);
    const writer = new Gif.GifWriter(W, H, pal, { loop: 0 });
    writer.start();
    for (let i = 0; i < frames; i++) {
      renderAt(i * delayCs * 10);
      writer.addFrame(map(octx.getImageData(0, 0, W, H).data, W, H), delayCs);
      step(`${Math.round(((i + 1) / frames) * 100)}%`);
      if ((i & 1) === 1) await tickAsync();
    }
    return { bytes: writer.finish(), frames, W, H, compressed: plan.compressed };
  }

  let gifBusy = false;
  async function exportGIF() {
    if (gifBusy) return;
    gifBusy = true;
    const btn = popLabel($('gifBtn'));
    const orig = btn.textContent;
    try {
      const { bytes, frames, W, H, compressed } = await renderGifBytes((t) => { btn.textContent = t; });
      downloadBlob(new Blob([bytes], { type: 'image/gif' }),
        `${fileBase()}-live-${frames}f-${W}x${H}.gif`);
      const note = compressed < 1 ? ' · loop compressed' : '';
      statusEl.textContent = `GIF saved · ${frames} frame${frames > 1 ? 's' : ''} · ${W}x${H} · ` +
        `${(bytes.length / 1048576).toFixed(1)} MB${note}`;
    } catch (err) {
      statusEl.textContent = 'GIF export failed: ' + err.message;
    } finally {
      btn.textContent = orig;
      gifBusy = false;
    }
  }

  let apngBusy = false;
  async function exportAPNG() {
    if (apngBusy) return;
    apngBusy = true;
    const btn = popLabel($('apngBtn'));
    const orig = btn.textContent;
    try {
      statusEl.textContent = 'rendering APNG frames…';
      await tickAsync();
      const prep = prepareLoopExport(project.resW, project.resH, null); // alpha preserved
      if (!prep) { statusEl.textContent = 'APNG export failed'; return; }
      const { W, H, octx, renderAt, plan } = prep;
      const frames = plan.frames, delayCs = plan.delayCs;
      const enc = new AP.ApngEncoder(W, H, { totalFrames: frames, delayNum: delayCs * 10, delayDen: 1000 });
      enc.start();
      for (let i = 0; i < frames; i++) {
        renderAt(i * delayCs * 10);
        await enc.addFrame(octx.getImageData(0, 0, W, H).data);
        btn.textContent = `${Math.round(((i + 1) / frames) * 100)}%`;
        await tickAsync();
      }
      const bytes = enc.finish();
      downloadBlob(new Blob([bytes], { type: 'image/apng' }),
        `${fileBase()}-live-${frames}f-${W}x${H}.png`);
      const note = plan.compressed < 1 ? ' · loop compressed' : '';
      statusEl.textContent = `APNG saved · ${frames} frame${frames > 1 ? 's' : ''} · ${W}x${H} · ` +
        `${(bytes.length / 1048576).toFixed(1)} MB (lossless)${note}`;
    } finally {
      btn.textContent = orig;
      apngBusy = false;
    }
  }

  /* --------------------------------------------- share (OS share sheet) */

  // export menu items are two-line buttons (title + description); progress
  // text replaces only the title line so the description survives the export
  const popLabel = (btn) => btn.querySelector('.pilabel') || btn;

  // Hand the wallpaper to the operating system's share sheet: PNG while
  // nothing animates, seamless GIF otherwise. Devices/browsers without
  // Web Share file support (or plain file:// pages) fall back to a normal
  // download so the button always produces the wallpaper.
  async function shareFiles(file, label) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: project.name || 'Wallpaper', text: 'Wallpaper made with Tessellate' });
        statusEl.textContent = 'shared ' + label;
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') { statusEl.textContent = 'share canceled'; return; }
        // fall through to the download fallback for other errors
      }
    }
    downloadBlob(file, file.name);
    statusEl.textContent = 'sharing not supported here — downloaded ' + label + ' instead';
  }

  async function shareWallpaper() {
    const animated = LT.patternLayers(project).some((l) => l.visible && l.animation !== 'none');
    if (animated && gifBusy) { statusEl.textContent = 'busy — try again in a moment'; return; }
    try {
      if (animated) {
        gifBusy = true;
        try {
          const { bytes, frames, W, H } = await renderGifBytes();
          const file = new File([bytes], `${fileBase()}-live-${frames}f-${W}x${H}.gif`, { type: 'image/gif' });
          await shareFiles(file, `GIF (${frames} frames)`);
        } finally { gifBusy = false; }
      } else {
        statusEl.textContent = 'preparing PNG for share…';
        await tickAsync();
        const { blob, W, H } = await renderPngBlob();
        const file = new File([blob], `${fileBase()}-${W}x${H}.png`, { type: 'image/png' });
        await shareFiles(file, 'PNG');
      }
    } catch (err) {
      statusEl.textContent = 'share failed: ' + (err && err.message ? err.message : err);
    }
  }

  /* ------------------------------------------------ project file IO */

  // Self-contained project file: the v2 project plus every custom library
  // (palettes/gradients/templates) so nothing is lost on another machine.
  // Agents can generate just the `project` object — see docs/AGENT_GUIDE.md.
  function buildProjectFile() {
    return {
      type: 'einstein-wallpaper-project',
      version: 2,
      saved: new Date().toISOString(),
      project: JSON.parse(JSON.stringify(project)),
      libraries: {
        palettes: CP.list(),
        gradients: GR.list(),
        extras: { single: singleStore.list(), duo: duoStore.list() },
      },
    };
  }
  // Accepts: full project files ({type, project}), bare v2 projects
  // ({version: 2, layers}), and legacy flat v1 settings.
  function extractProject(data) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.project && typeof data.project === 'object' && !Array.isArray(data.project)) return data.project;
      if (Array.isArray(data.layers) || data.version === 2 ||
          typeof data.family === 'string' || data.themeMode || data.colorMode) return data;
    }
    throw new Error('no project data found in file');
  }
  function loadProjectFromText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('not a valid JSON file'); }
    if (data && typeof data === 'object' && data.libraries && typeof data.libraries === 'object') {
      const libs = data.libraries;
      if (Array.isArray(libs.palettes) && libs.palettes.length) CP.replaceAll(libs.palettes);
      if (Array.isArray(libs.gradients) && libs.gradients.length) GR.replaceAll(libs.gradients);
      if (libs.extras && typeof libs.extras === 'object') {
        if (Array.isArray(libs.extras.single)) libs.extras.single.forEach((c) => {
          if (GR.isHexColor(c) && !singleStore.list().includes(c)) singleStore.add(c);
        });
        if (Array.isArray(libs.extras.duo)) libs.extras.duo.forEach((p) => {
          if (p && GR.isHexColor(p.a) && GR.isHexColor(p.b) && !duoStore.list().some((q) => q.a === p.a && q.b === p.b)) duoStore.add(p);
        });
      }
    }
    project = fixProjectRefs(LT.sanitizeProject(extractProject(data)));
    cache.clear();
    drafts.clear();
    save('load', 'Project loaded');
    updateSaveState('loaded');
    syncControls(); refresh();
    notice('Project loaded · ' + LT.patternLayers(project).length +
      ' pattern layer' + (LT.patternLayers(project).length > 1 ? 's' : ''));
  }

  /* ------------------------------------------------ randomize/reset */

  // Randomizers are section-scoped: each touches ONE section of the selected
  // layer (or the background fill), so users can explore per-aspect variations
  // without losing the rest of their design. "Randomize layer" (Layers panel,
  // or the R key) randomizes the whole selected layer.

  // shared random-background core (used by the section dice and by
  // the toolbar's Random wallpaper button)
  function applyRandomBg(rr) {
    const layer = LT.bgLayer(project);
    const src = rr() < 0.5 ? 'solid' : 'gradient';
    layer.bg.source = src;
    if (src === 'gradient') {
      const all = GR.all();
      seedBgGradient(all[Math.floor(rr() * all.length)].id);
    } else {
      const vivid = ['#0b1020', '#071018', '#1a0e14', '#0e1a12', '#241432', '#10141c'];
      layer.bg.color = vivid[Math.floor(rr() * vivid.length)];
    }
  }

  function randomizeBg() {
    applyRandomBg(Math.random);
    save('randomBg', 'Randomize background');
    syncControls(); recolorAll();
    notice('Randomized "Background" fill');
  }

  // Tiling section: variant, scale, rotation, gap, seed — family stays.
  function randomizeTiling() {
    const layer = SP();
    if (!layer || layer.type !== 'pattern') return;
    const rr = Math.random;
    const fam = TL.get(layer.family);
    layer.variant = fam.variants[Math.floor(rr() * fam.variants.length)].id;
    layer.tileSize = Math.round(16 + rr() * 74);
    layer.rotation = Math.floor(rr() * 24) * 15;
    layer.gap = rr() < 0.6 ? 0 : +(rr() * 0.05).toFixed(3);
    layer.seed = 1 + Math.floor(rr() * 99999);
    save('randomTiling', 'Randomize tiling');
    syncControls(); refresh();
    notice(`Randomized tiling of "${layer.name}"`);
  }

  // Color theme section: stays within the layer's current mode.
  function randomizeTheme() {
    const layer = SP();
    if (!layer || layer.type !== 'pattern') return;
    const rr = Math.random;
    const vivid = ['#5bc8ff', '#ff8bd2', '#ffe14d', '#6be3a2', '#b07bff', '#ff8a5b', '#4dffb8', '#f4777f'];
    const d = draftFor(layer.id);
    const th = layer.theme;
    if (th.mode === 'single') {
      th.singleColor = vivid[Math.floor(rr() * vivid.length)];
    } else if (th.mode === 'palette') {
      const nC = CP.count();
      th.paletteRef = (nC && rr() < 0.25)
        ? { kind: 'custom', id: CP.list()[Math.floor(rr() * nC)].id }
        : { kind: 'builtin', index: Math.floor(rr() * PAL.LIST.length) };
      d.pal.active = false;
      loadPalDraft(layer);
      const pOpts = arrOptions(layer, 'palette');
      th.colorMap = pOpts[Math.floor(rr() * pOpts.length)];
    } else if (th.mode === 'gradient') {
      const all = GR.all();
      th.gradientId = all[Math.floor(rr() * all.length)].id;
      d.grad.active = false;
      loadGradDraft(layer);
      const gOpts = arrOptions(layer, 'gradient');
      th.gradMap = gOpts[Math.floor(rr() * gOpts.length)];
      th.gradBands = 3 + Math.floor(rr() * 6);
    } else { // duotone
      th.duoA = vivid[Math.floor(rr() * vivid.length)];
      th.duoB = PAL.hslRotate(th.duoA, 110 + rr() * 140);
      const dOpts = arrOptions(layer, 'duotone');
      th.duoMap = dOpts[Math.floor(rr() * dOpts.length)];
    }
    ensureMapValid(layer);
    save('randomTheme', 'Randomize colors');
    syncControls(); recolor(layer);
    notice(`Randomized colors of "${layer.name}"`);
  }

  // Visual effects section: one coherent profile (mostly clean, sometimes a
  // glow / shadow / grain+vignette / soft-focus look) plus the occasional
  // special-effect accent (frozen shimmer / sheen / iridescence /
  // aberration / scanlines).
  function randomizeFx() {
    const layer = SP();
    if (!layer || layer.type !== 'pattern') return;
    const rr = Math.random;
    const fx = { ...LT.FX_DEFAULTS };
    const r = rr();
    if (r >= 0.35) { // 35% chance: keep it clean
      if (r < 0.55) {
        fx.glow = 15 + rr() * 30;
        fx.glowRadius = 10 + rr() * 40;
      } else if (r < 0.72) {
        fx.shadow = 20 + rr() * 35;
        fx.shadowSoft = 8 + rr() * 30;
        fx.shadowOff = 4 + rr() * 14;
      } else if (r < 0.88) {
        fx.grain = 5 + rr() * 15;
        fx.vignette = 15 + rr() * 30;
        fx.vignetteMode = rr() < 0.7 ? 'dark' : 'light';
      } else {
        fx.blur = 1 + rr() * 4;
        fx.glow = 10 + rr() * 20;
      }
    }
    // ONE special effect per layer (dropdown model): ~55% none, otherwise a
    // random mode with tasteful params — never a mix, matching the UI
    const sr = rr();
    const ang = () => Math.floor(rr() * 24) * 15;
    fx.special = 'none';
    if (sr > 0.55) {
      const modes = ['shimmer', 'sheen', 'irid', 'aberration', 'scan'];
      const m = modes[Math.floor(rr() * modes.length)];
      fx.special = m;
      if (m === 'shimmer') {
        fx.shimmer = 25 + rr() * 45;
        fx.shimmerAngle = ang();
        fx.shimmerScale = 60 + rr() * 160;
      } else if (m === 'sheen') {
        fx.sheen = 30 + rr() * 45;
        fx.sheenAngle = ang();
        fx.sheenPos = Math.floor(rr() * 100);
      } else if (m === 'irid') {
        fx.irid = 20 + rr() * 40;
        fx.iridAngle = ang();
        fx.iridScale = 60 + rr() * 160;
      } else if (m === 'aberration') {
        fx.aberration = 1 + rr() * 3;
      } else if (m === 'scan') {
        fx.scan = 12 + rr() * 33;
        fx.scanGap = 3 + Math.floor(rr() * 5);
      }
    }
    layer.effects = fx;
    save('randomFx', 'Randomize effects');
    syncControls(); composeFrame(performance.now(), true);
    notice(`Randomized effects of "${layer.name}"`);
  }

  // Animation section: effect, speed, direction.
  function randomizeAnim() {
    const layer = SP();
    if (!layer || layer.type !== 'pattern') return;
    const rr = Math.random;
    const r = rr();
    layer.animation = r < 0.25 ? 'none' : r < 0.5 ? 'shimmer' : r < 0.75 ? 'flow' : 'glowwave';
    layer.animSpeed = +(0.5 + rr() * 2).toFixed(1);
    layer.flowAngle = Math.floor(rr() * 24) * 15;
    save('randomAnim', 'Randomize animation');
    syncControls(); refresh();
    notice(`Randomized animation of "${layer.name}"`);
  }

  // shared random-pattern-layer core: everything at once (no save/sync —
  // callers decide history granularity)
  function applyRandomLayer(layer, rr) {
    layer.family = rr() < 0.35 ? 'hat' : TL.FAMILIES[1 + Math.floor(rr() * (TL.FAMILIES.length - 1))].id;
    const fam = TL.get(layer.family);
    layer.variant = fam.variants[Math.floor(rr() * fam.variants.length)].id;
    const vivid = ['#5bc8ff', '#ff8bd2', '#ffe14d', '#6be3a2', '#b07bff', '#ff8a5b', '#4dffb8', '#f4777f'];
    const tm = rr();
    layer.theme.mode = tm < 0.45 ? 'palette' : tm < 0.72 ? 'gradient' : tm < 0.9 ? 'duotone' : 'single';
    const d = draftFor(layer.id);
    d.pal.active = false; d.grad.active = false;
    if (layer.theme.mode === 'palette') {
      const nC = CP.count();
      layer.theme.paletteRef = (nC && rr() < 0.25)
        ? { kind: 'custom', id: CP.list()[Math.floor(rr() * nC)].id }
        : { kind: 'builtin', index: Math.floor(rr() * PAL.LIST.length) };
      const pOpts = arrOptions(layer, 'palette');
      layer.theme.colorMap = pOpts[Math.floor(rr() * pOpts.length)];
    } else if (layer.theme.mode === 'gradient') {
      const all = GR.all();
      layer.theme.gradientId = all[Math.floor(rr() * all.length)].id;
      const gm = rr();
      layer.theme.gradMap = gm < 0.55 ? 'sweep' : gm < 0.8 ? 'bands' : 'random';
      layer.theme.gradBands = 3 + Math.floor(rr() * 6);
    } else if (layer.theme.mode === 'duotone') {
      layer.theme.duoA = vivid[Math.floor(rr() * vivid.length)];
      layer.theme.duoB = PAL.hslRotate(layer.theme.duoA, 110 + rr() * 140);
      layer.theme.duoMap = ['checker', 'sweep', 'random'][Math.floor(rr() * 3)];
    } else {
      layer.theme.singleColor = vivid[Math.floor(rr() * vivid.length)];
    }
    layer.opacity = rr() < 0.8 ? 100 : 55 + Math.round(rr() * 40);
    layer.fillAlpha = rr() < 0.9 ? 100 : 35 + Math.round(rr() * 65);
    layer.lineAlpha = rr() < 0.9 ? 100 : 35 + Math.round(rr() * 65);
    layer.animation = ['none', 'shimmer', 'flow', 'glowwave'][Math.floor(rr() * 4)];
    layer.flowAngle = Math.floor(rr() * 24) * 15;
    layer.rotation = Math.floor(rr() * 24) * 15;
    layer.tileSize = Math.round(16 + rr() * 60);
    layer.gap = rr() < 0.6 ? 0 : +(rr() * 0.05).toFixed(3);
    layer.seed = Math.floor(rr() * 99999);
    layer.effects = { ...LT.FX_DEFAULTS };
    if (rr() < 0.4) {
      const pick = ['glow', 'vignette', 'grain', 'shadow'][Math.floor(rr() * 4)];
      layer.effects[pick] = pick === 'glow' ? 20 + rr() * 25 : pick === 'grain' ? 8 + rr() * 12 : 25 + rr() * 25;
    }
    ensureMapValid(layer);
  }

  function randomize() {
    const layer = SL();
    if (!layer) return;
    if (layer.type === 'background') {
      randomizeBg();
      return;
    }
    // pattern layer: everything at once
    applyRandomLayer(layer, Math.random);
    save('randomLayer', 'Randomize layer');
    syncControls(); refresh();
    notice(`Randomized "${layer.name}" (selected layer only)`);
  }

  // toolbar: fresh project with ONLY the background layer (no patterns)
  function newBackgroundProject() {
    project = LT.defaultProject();
    project.layers = [LT.bgLayer(project)];
    project.selected = project.layers[0].id;
    cache.clear(); drafts.clear();
    save('newBg', 'New background-only project');
    syncControls(); refresh();
    notice('New background-only project');
  }

  // toolbar: one fresh randomized pattern layer over a randomized
  // background — canvas size and project name are kept, history gets ONE
  // undo step
  function randomWallpaper() {
    const rr = Math.random;
    const keep = {
      name: project.name, aspect: project.aspect,
      orientation: project.orientation, resW: project.resW, resH: project.resH,
    };
    project = LT.defaultProject();
    Object.assign(project, keep);
    project.layers[1].theme.gradientId = GR.BUILTINS[0].id;
    cache.clear(); drafts.clear();
    applyRandomBg(rr);
    applyRandomLayer(project.layers[1], rr);
    save('randomWall', 'Random wallpaper');
    syncControls(); refresh();
    notice('Random wallpaper: background + one pattern layer');
  }

  function fullscreen() {
    const el = $('canvasWrap');
    if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
    else document.exitFullscreen();
  }

  /* --------------------------------------------- layers panel UI */

  function buildLayersPanel() {
    const box = $('layerList');
    box.innerHTML = '';
    const pats = LT.patternLayers(project);
    for (const layer of project.layers) {
      const row = document.createElement('div');
      row.className = 'layerrow' + (project.selected === layer.id ? ' on' : '') +
        (layer.visible ? '' : ' hiddenL') + (layer.type === 'background' ? ' locked' : '');
      const eye = document.createElement('button');
      eye.className = 'eye';
      eye.textContent = layer.visible ? '◉' : '○';
      eye.title = layer.visible ? 'Hide layer' : 'Show layer';
      eye.onclick = (ev) => {
        ev.stopPropagation();
        layer.visible = !layer.visible;
        save('visibility', 'Layer visibility');
        buildLayersPanel();
        composeFrame(performance.now(), true);
      };
      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = layer.name;
      const badge = document.createElement('span');
      badge.className = 'lbadge';
      badge.textContent = layer.type === 'background' ? 'bg' : String(pats.indexOf(layer) + 1);
      const meta = document.createElement('span');
      meta.className = 'lmeta';
      meta.textContent = layer.type === 'background' ? bgSourceLabel(layer) : layer.opacity + '%';
      row.append(eye, name, badge, meta);
      row.onclick = () => selectLayer(layer.id);
      box.appendChild(row);
    }
    const sel = SL();
    const idx = sel ? project.layers.indexOf(sel) : -1;
    $('layerAdd').disabled = pats.length >= LT.MAX_PATTERN_LAYERS;
    $('layerDup').disabled = !sel || sel.type !== 'pattern' || pats.length >= LT.MAX_PATTERN_LAYERS;
    $('layerDel').disabled = !sel || sel.type === 'background' || pats.length <= 1;
    $('layerRename').disabled = !sel;
    $('layerUp').disabled = !sel || sel.type === 'background' || idx >= project.layers.length - 1;
    $('layerDown').disabled = !sel || sel.type === 'background' || idx <= 1;
    $('layerOpacity').value = sel ? sel.opacity : 100;
    $('layerOpacityVal').textContent = (sel ? sel.opacity : 100) + '%';
  }

  function addPatternLayer() {
    const pats = LT.patternLayers(project);
    if (pats.length >= LT.MAX_PATTERN_LAYERS) return;
    const layer = LT.createPattern({ name: 'Pattern ' + (pats.length + 1), _n: pats.length + 1 });
    layer.theme.gradientId = GR.BUILTINS[0].id;
    project.layers.push(layer);
    project.selected = layer.id;
    save('layerAdd', 'Layer added'); syncControls(); refresh();
    notice(`Layer "${layer.name}" added`);
  }
  function dupLayer() {
    const sel = SL();
    if (!sel || sel.type !== 'pattern') return;
    if (LT.patternLayers(project).length >= LT.MAX_PATTERN_LAYERS) return;
    const copy = LT.duplicateLayer(sel);
    if (!copy) return;
    project.layers.splice(project.layers.indexOf(sel) + 1, 0, copy);
    project.selected = copy.id;
    const d = drafts.get(sel.id);
    if (d) drafts.set(copy.id, JSON.parse(JSON.stringify(d)));
    save('layerDup', 'Layer duplicated'); syncControls(); refresh();
    notice(`Duplicated as "${copy.name}" (new id)`);
  }
  function renameLayer() {
    const sel = SL();
    if (!sel) return;
    const name = prompt('Layer name', sel.name);
    if (name == null) return;
    const trimmed = name.trim().slice(0, 40);
    if (trimmed) sel.name = trimmed;
    save('layerRename', 'Layer renamed'); syncControls();
  }
  function delLayer() {
    const sel = SL();
    if (!sel || sel.type === 'background') return;
    if (LT.patternLayers(project).length <= 1) {
      notice('the last pattern layer cannot be deleted');
      return;
    }
    const name = sel.name;
    LT.deleteLayer(project, sel.id);
    cache.delete(sel.id);   // release the layer's scene/scratch canvases
    drafts.delete(sel.id);
    project.selected = LT.patternLayers(project)[0].id;
    save('layerDel', 'Layer deleted'); syncControls(); refresh();
    notice(`Layer "${name}" deleted`);
  }
  function moveSelLayer(dir) {
    const sel = SL();
    if (!sel) return;
    if (LT.moveLayer(project, sel.id, dir)) {
      save('layerMove', 'Layer reordered'); syncControls();
      composeFrame(performance.now(), true);
      notice(`Moved "${sel.name}" ${dir < 0 ? 'up' : 'down'}`);
    }
  }

  /* ------------------------------------------------- control sync */

  function showSection(id, on) {
    const el = $(id);
    if (el) el.style.display = on ? '' : 'none';
  }
  function setHint(id, name) {
    const el = $(id);
    if (el) el.textContent = name ? '· ' + name : '';
  }

  function buildAspectChips() {
    const box = $('aspectChips');
    box.innerHTML = '';
    for (const a of ASPECTS) {
      const b = document.createElement('button');
      b.className = 'chip' + (project.aspect === a.id ? ' on' : '');
      b.textContent = a.id;
      b.title = a.r >= 1 ? 'landscape' : 'portrait';
      b.onclick = () => {
        project.aspect = a.id;
        project.orientation = naturalOrientation(a);
        applyResForAspect();
        syncControls(); refresh(); save('aspect', 'Aspect ratio');
      };
      box.appendChild(b);
    }
  }

  function applyResForAspect() {
    const a = ASPECTS.find((x) => x.id === project.aspect) || ASPECTS[0];
    const list = RES_PRESETS[project.aspect] || [[1920, 1080]];
    const nat = naturalOrientation(a);
    const swapped = project.orientation !== nat;
    const eff = swapped ? list.map((r) => [r[1], r[0]]) : list;
    if (!eff.some((r) => r[0] === project.resW && r[1] === project.resH)) {
      project.resW = eff[0][0]; project.resH = eff[0][1];
    }
  }

  function buildResSelect() {
    const sel = $('resSelect');
    const a = ASPECTS.find((x) => x.id === project.aspect) || ASPECTS[0];
    const list0 = RES_PRESETS[project.aspect] || [[1920, 1080]];
    const list = project.orientation !== naturalOrientation(a) ? list0.map((r) => [r[1], r[0]]) : list0;
    sel.innerHTML = '';
    for (const [w, h] of list) {
      const o = document.createElement('option');
      o.value = w + 'x' + h;
      o.textContent = `${w} × ${h}`;
      if (project.resW === w && project.resH === h) o.selected = true;
      sel.appendChild(o);
    }
    const o = document.createElement('option');
    o.value = 'custom';
    o.textContent = 'Custom…';
    if (!list.some(([w, h]) => w === project.resW && h === project.resH)) o.selected = true;
    sel.appendChild(o);
  }

  function fillSelect(sel, pairs, value) {
    sel.innerHTML = '';
    for (const [v, label] of pairs) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      if (v === value) o.selected = true;
      sel.appendChild(o);
    }
  }

  /* ------------------------------------------- family grid */

  function buildFamilyGrid(layer) {
    const grid = $('familyGrid');
    grid.innerHTML = '';
    for (const fam of TL.FAMILIES) {
      const b = document.createElement('button');
      b.className = 'fam' + (layer.family === fam.id ? ' on' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', layer.family === fam.id ? 'true' : 'false');
      b.title = fam.name;
      b.innerHTML = fam.icon + `<span>${fam.name}</span>`;
      b.onclick = () => {
        if (layer.family === fam.id) return;
        layer.family = fam.id;
        layer.variant = fam.defaultVariant;
        ensureMapValid(layer);
        save('family'); syncControls(); refresh();
      };
      grid.appendChild(b);
    }
  }

  /* --------------------------------- color theme control building */

  function buildThemeControls(layer) {
    const box = $('themeModeChips');
    box.innerHTML = '';
    for (const [m, label] of THEME_MODES) {
      const b = document.createElement('button');
      b.className = 'chip' + (layer.theme.mode === m ? ' on' : '');
      b.textContent = label;
      b.onclick = () => setThemeMode(m);
      box.appendChild(b);
    }
    ensureMapValid(layer);
    syncMapSelects();
    $('gradBands').value = layer.theme.gradBands;
    $('gradBandsVal').textContent = layer.theme.gradBands;
    $('singleColor').value = layer.theme.singleColor;
    $('duoA').value = layer.theme.duoA;
    $('duoB').value = layer.theme.duoB;
    fillGradientSelect($('gradPick'), layer.theme.gradientId || GR.BUILTINS[0].id);
    buildSingleTpls(layer);
    buildDuoTpls(layer);
    $('lineAuto').checked = layer.lineAuto;
    $('lineColor').value = layer.lineColor;
    $('lineColor').disabled = layer.lineAuto;
    syncThemeVisibility(layer);
  }

  // fill the per-mode arrangement selects from the family-aware option lists
  function syncMapSelects() {
    const layer = SP();
    if (!layer) return;
    fillSelect($('palMap'), arrOptions(layer, 'palette').map((m) => [m, MAP_LABELS[m] || m]), layer.theme.colorMap);
    fillSelect($('gradMapSel'), arrOptions(layer, 'gradient').map((m) => [m, MAP_LABELS[m] || m]), layer.theme.gradMap);
    fillSelect($('duoMapSel'), arrOptions(layer, 'duotone').map((m) => [m, MAP_LABELS[m] || m]), layer.theme.duoMap);
  }

  // show only the panel (and rows) that belong to the layer's theme mode
  function syncThemeVisibility(layer) {
    const mode = layer.theme.mode;
    const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
    show('panel-single', mode === 'single');
    show('panel-palette', mode === 'palette');
    show('panel-gradient', mode === 'gradient');
    show('panel-duotone', mode === 'duotone');
    show('gradBandsRow', mode === 'gradient' && layer.theme.gradMap === 'bands');
  }

  function syncFamilyVisibility(layer) {
    const isLine = layer.family === 'lines';
    $('gapRow').style.display = isLine ? 'none' : '';
    $('outlineRow').style.display = isLine ? 'none' : '';
    // line patterns are pure strokes: no fills, so the fill slider is hidden
    // and the border slider drives the line alpha
    $('fillAlphaRow').style.display = isLine ? 'none' : '';
    $('lineAlphaRow').style.display = '';
    $('lineAlphaLabel').firstChild.nodeValue = isLine ? 'Line transparency ' : 'Border transparency ';
  }

  function syncAnimVisibility(layer) {
    const showAngle = layer.animation === 'flow' || layer.animation === 'glowwave';
    $('flowAngleRow').style.display = showAngle ? '' : 'none';
  }

  /* -------------------------------------- background layer controls */

  // The Background layer owns a FULL gradient spec (type/angle/stops) that
  // is edited live in place. bg.gradientId records the library template the
  // spec was last seeded from ("Reset edits" re-copies it).
  function seedBgGradient(id) {
    const bg = LT.bgLayer(project).bg;
    const src = id ? GR.find(id) : null;
    bg.gradientId = src ? id : null;
    bg.gradient = LT.normGradient(src ? JSON.parse(JSON.stringify(src)) : LT.DEFAULT_BG_GRADIENT);
  }
  function renderBgGradEditor() {
    const bg = LT.bgLayer(project).bg;
    const g = bg.gradient || LT.normGradient(LT.DEFAULT_BG_GRADIENT);
    fillSelect($('bgGradType'), [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']], g.type);
    $('bgGradAngle').value = g.angle;
    $('bgGradAngleVal').textContent = g.angle + '°';
    $('bgGradStopCount').textContent = g.stops.length + ' stops';
    $('bgGradState').textContent = bg.gradientId ?
      ((GR.find(bg.gradientId) || {}).name || '') : 'edited';
    const list = $('bgGradStops');
    list.innerHTML = '';
    g.stops.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'stoprow';
      const col = document.createElement('input');
      col.type = 'color'; col.value = s.color;
      col.oninput = () => {
        bg.gradient.stops[i].color = col.value;
        save('bgGradStops'); renderBgGradPreview(); recolorAll();
      };
      const pos = document.createElement('input');
      pos.type = 'number'; pos.min = 0; pos.max = 100; pos.step = 1;
      pos.value = Math.round(s.pos * 100);
      pos.className = 'postext';
      pos.onchange = () => {
        bg.gradient.stops[i].pos = Math.max(0, Math.min(100, +pos.value || 0)) / 100;
        bg.gradient.stops.sort((a, b) => a.pos - b.pos);
        save('bgGradStops'); renderBgGradEditor(); recolorAll();
      };
      const del = document.createElement('button');
      del.className = 'mini-btn'; del.textContent = '×'; del.title = 'Remove stop';
      del.onclick = () => {
        if (bg.gradient.stops.length > 2) {
          bg.gradient.stops.splice(i, 1);
          save('bgGradStops'); renderBgGradEditor(); recolorAll();
        }
      };
      row.append(col, pos, del);
      list.appendChild(row);
    });
    renderBgGradPreview();
  }
  function renderBgGradPreview() {
    const bg = LT.bgLayer(project).bg;
    const grad = bg.gradient || LT.normGradient(LT.DEFAULT_BG_GRADIENT);
    const cv = $('bgGradPreview');
    const w = cv.parentElement ? (cv.parentElement.clientWidth || 260) : 260;
    cv.width = w; cv.height = 26;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const g = GR.toCanvas(ctx, grad, cv.width, cv.height, 0);
    if (g && g.conic) GR.fillConic(ctx, grad, cv.width, cv.height);
    else { ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height); }
  }

  function syncBackgroundControls(layer) {
    $('bgFillSource').value = layer.bg.source;
    $('bgFillColor').value = layer.bg.color;
    fillGradientSelect($('bgGradTpl'), layer.bg.gradientId || '');
    $('bgSolidRow').style.display = layer.bg.source === 'solid' ? '' : 'none';
    $('bgGradEditor').style.display = layer.bg.source === 'gradient' ? '' : 'none';
    if (layer.bg.source === 'gradient') renderBgGradEditor();
  }

  function setSlider(id, valId, v, fmt) {
    $(id).value = v;
    $(valId).textContent = fmt(v);
  }

  // show/hide the special-effect setting rows for the selected layer's
  // active mode (shared by syncPatternControls and the dropdown handler)
  function updateSpecialUI() {
    const l = SP();
    const fx = (l && l.effects) || {};
    const mode = LT.SPECIAL_MODES.includes(fx.special) ? fx.special : 'none';
    document.querySelectorAll('.sp-row').forEach((r) => {
      r.hidden = r.getAttribute('data-sp') !== mode;
    });
  }

  function syncPatternControls(layer) {
    buildFamilyGrid(layer);
    const fam = TL.get(layer.family);
    fillSelect($('variantSelect'), fam.variants.map((v) => [v.id, v.name]), layer.variant);
    fillSelect($('animSelect'), ANIMS, layer.animation);
    buildThemeControls(layer);
    setSlider('tileSize', 'tileSizeVal', layer.tileSize, (v) => v + ' px');
    setSlider('rotation', 'rotationVal', layer.rotation, (v) => v + '°');
    setSlider('gap', 'gapVal', Math.round(layer.gap * 100), (v) => v + '%');
    setSlider('fillAlpha', 'fillAlphaVal', layer.fillAlpha == null ? 100 : layer.fillAlpha, (v) => v + '%');
    setSlider('outlineWidth', 'outlineWidthVal', layer.outlineWidth, (v) => (+v).toFixed(1) + ' px');
    setSlider('lineAlpha', 'lineAlphaVal', layer.lineAlpha == null ? 100 : layer.lineAlpha, (v) => v + '%');
    setSlider('animSpeed', 'animSpeedVal', layer.animSpeed, (v) => (+v).toFixed(1) + '×');
    setSlider('flowAngle', 'flowAngleVal', layer.flowAngle, (v) => v + '°');
    setSlider('seed', 'seedVal', layer.seed, (v) => '#' + v);
    const fx = layer.effects;
    setSlider('fxBlur', 'fxBlurVal', fx.blur, (v) => (+v) + ' px');
    setSlider('fxGlow', 'fxGlowVal', fx.glow, (v) => Math.round(v) + '%');
    setSlider('fxGlowRadius', 'fxGlowRadiusVal', fx.glowRadius, (v) => v + ' px');
    setSlider('fxShadow', 'fxShadowVal', fx.shadow, (v) => Math.round(v) + '%');
    setSlider('fxShadowSoft', 'fxShadowSoftVal', fx.shadowSoft, (v) => v + ' px');
    setSlider('fxShadowOff', 'fxShadowOffVal', fx.shadowOff, (v) => v + ' px');
    setSlider('fxGrain', 'fxGrainVal', fx.grain, (v) => Math.round(v) + '%');
    setSlider('fxVignette', 'fxVignetteVal', fx.vignette, (v) => Math.round(v) + '%');
    $('fxVignetteMode').value = fx.vignetteMode;
    const spSel = $('fxSpecial');
    spSel.value = LT.SPECIAL_MODES.includes(fx.special) ? fx.special : 'none';
    updateSpecialUI();
    setSlider('fxShimmer', 'fxShimmerVal', fx.shimmer, (v) => Math.round(v) + '%');
    setSlider('fxShimmerAngle', 'fxShimmerAngleVal', fx.shimmerAngle, (v) => v + '°');
    setSlider('fxShimmerScale', 'fxShimmerScaleVal', fx.shimmerScale, (v) => Math.round(v) + '%');
    setSlider('fxSheen', 'fxSheenVal', fx.sheen, (v) => Math.round(v) + '%');
    setSlider('fxSheenAngle', 'fxSheenAngleVal', fx.sheenAngle, (v) => v + '°');
    setSlider('fxSheenPos', 'fxSheenPosVal', fx.sheenPos, (v) => Math.round(v) + '%');
    setSlider('fxIrid', 'fxIridVal', fx.irid, (v) => Math.round(v) + '%');
    setSlider('fxIridAngle', 'fxIridAngleVal', fx.iridAngle, (v) => v + '°');
    setSlider('fxIridScale', 'fxIridScaleVal', fx.iridScale, (v) => Math.round(v) + '%');
    setSlider('fxAberration', 'fxAberrationVal', fx.aberration, (v) => v + ' px');
    setSlider('fxScan', 'fxScanVal', fx.scan, (v) => Math.round(v) + '%');
    setSlider('fxScanGap', 'fxScanGapVal', fx.scanGap, (v) => v + ' px');
    syncAnimVisibility(layer);
    syncFamilyVisibility(layer);
    buildPaletteGrid(layer);
    renderPalEditor(layer);
    renderGradEditor(layer);
    syncGradEditState(layer);
  }

  function syncControls() {
    const nameEl = $('projName');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = project.name || LT.PROJECT_NAME_DEFAULT;
    buildAspectChips();
    buildResSelect();
    buildLayersPanel();
    const layer = SL();
    const isPat = !!(layer && layer.type === 'pattern');
    showSection('sec-tiling', isPat);
    showSection('sec-theme', isPat);
    showSection('sec-fx', isPat);
    showSection('sec-anim', isPat);
    showSection('sec-bgprops', !isPat);
    setHint('hintTiling', layer && layer.name);
    setHint('hintTheme', isPat && layer.name);
    setHint('hintFx', isPat && layer.name);
    setHint('hintAnim', isPat && layer.name);
    $('resW').value = project.resW;
    $('resH').value = project.resH;
    const orBtns = document.querySelectorAll('[data-orient]');
    orBtns.forEach((b) => b.classList.toggle('on', b.dataset.orient === project.orientation));
    if (!layer) return;
    if (isPat) syncPatternControls(layer);
    else syncBackgroundControls(layer);
  }

  /* ------------------------------------------------------- bind */

  function bind() {
    $('resSelect').onchange = (e) => {
      if (e.target.value === 'custom') { $('resW').focus(); return; }
      const [w, h] = e.target.value.split('x').map(Number);
      project.resW = w; project.resH = h;
      $('resW').value = w; $('resH').value = h;
      refresh(); save('resolution');
    };
    const resChanged = () => {
      project.resW = Math.max(64, Math.min(8192, +$('resW').value || project.resW));
      project.resH = Math.max(64, Math.min(8192, +$('resH').value || project.resH));
      refresh(); save('resolution');
    };
    $('resW').onchange = resChanged;
    $('resH').onchange = resChanged;
    document.querySelectorAll('[data-orient]').forEach((b) => {
      b.onclick = () => {
        project.orientation = b.dataset.orient;
        applyResForAspect();
        syncControls(); refresh(); save('orientation');
      };
    });

    // ---- project bar ----
    const commitName = () => {
      const v = ($('projName').value || '').trim().slice(0, 60);
      const next = v || LT.PROJECT_NAME_DEFAULT;
      if (next === (project.name || LT.PROJECT_NAME_DEFAULT)) {
        $('projName').value = next;
        return;
      }
      project.name = next;
      $('projName').value = next;
      save('name', 'Project name');
      notice('Project named "' + next + '"');
    };
    $('projName').onchange = commitName;
    $('projName').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); $('projName').value = project.name || LT.PROJECT_NAME_DEFAULT; e.target.blur(); }
    };
    $('undoBtn').onclick = doUndo;
    $('redoBtn').onclick = doRedo;

    // ---- layers panel ----
    $('layerAdd').onclick = addPatternLayer;
    $('layerDup').onclick = dupLayer;
    $('layerRename').onclick = renameLayer;
    $('layerDel').onclick = delLayer;
    $('layerUp').onclick = () => moveSelLayer(1);
    $('layerDown').onclick = () => moveSelLayer(-1);
    $('layerOpacity').oninput = (e) => {
      const sel = SL();
      if (!sel) return;
      sel.opacity = Math.max(0, Math.min(100, Math.round(+e.target.value || 0)));
      $('layerOpacityVal').textContent = sel.opacity + '%';
      composeFrame(performance.now(), true);
      save('opacity');
      const meta = $('layerList').children[project.layers.indexOf(sel)];
      if (meta) meta.querySelector('.lmeta').textContent =
        sel.type === 'background' ? bgSourceLabel(sel) : sel.opacity + '%';
    };

    // ---- background layer props ----
    $('bgFillSource').onchange = (e) => {
      const l = SL();
      if (!l || l.type !== 'background') return;
      l.bg.source = e.target.value === 'gradient' ? 'gradient' : 'solid';
      save('bgSource'); syncControls(); recolorAll();
    };
    $('bgFillColor').oninput = (e) => {
      const l = SL();
      if (!l || l.type !== 'background') return;
      l.bg.color = e.target.value;
      save('bgColor'); recolorAll();
    };
    // background gradient editor (owned full gradient spec, live edits)
    $('bgGradTpl').onchange = (e) => {
      seedBgGradient(e.target.value);
      save('bgGradTpl'); syncControls(); recolorAll();
    };
    $('bgGradType').onchange = (e) => {
      const bg = LT.bgLayer(project).bg;
      bg.gradient.type = e.target.value;
      save('bgGradType'); renderBgGradEditor(); recolorAll();
    };
    $('bgGradAngle').oninput = (e) => {
      const bg = LT.bgLayer(project).bg;
      bg.gradient.angle = ((Math.round(+e.target.value) || 0) % 360 + 360) % 360;
      $('bgGradAngleVal').textContent = bg.gradient.angle + '°';
      save('bgGradAngle'); renderBgGradPreview(); recolorAll();
    };
    $('bgGradAddStop').onclick = () => {
      const bg = LT.bgLayer(project).bg;
      if (bg.gradient.stops.length < 16) {
        bg.gradient.stops.push({ pos: 1, color: '#88aacc' });
        bg.gradient.stops.sort((a, b) => a.pos - b.pos);
        save('bgGradStops'); renderBgGradEditor(); recolorAll();
      }
    };
    $('bgGradDraftReset').onclick = () => {
      seedBgGradient(LT.bgLayer(project).bg.gradientId);
      save('bgGradReset'); syncControls(); recolorAll();
    };

    // ---- tiling (selected pattern layer) ----
    $('tileSize').oninput = (e) => { const l = SP(); l.tileSize = +e.target.value; $('tileSizeVal').textContent = l.tileSize + ' px'; refresh(); save('tileSize'); };
    $('rotation').oninput = (e) => { const l = SP(); l.rotation = +e.target.value; $('rotationVal').textContent = l.rotation + '°'; refresh(); save('rotation'); };
    $('gap').oninput = (e) => { const l = SP(); l.gap = e.target.value / 100; $('gapVal').textContent = e.target.value + '%'; recolor(l); save('gap'); };
    $('fillAlpha').oninput = (e) => { const l = SP(); l.fillAlpha = Math.max(0, Math.min(100, Math.round(+e.target.value || 0))); $('fillAlphaVal').textContent = l.fillAlpha + '%'; recolor(l); save('fillAlpha'); };
    $('outlineWidth').oninput = (e) => { const l = SP(); l.outlineWidth = +e.target.value; $('outlineWidthVal').textContent = (+e.target.value).toFixed(1) + ' px'; recolor(l); save('outlineWidth'); };
    $('lineAlpha').oninput = (e) => { const l = SP(); l.lineAlpha = Math.max(0, Math.min(100, Math.round(+e.target.value || 0))); $('lineAlphaVal').textContent = l.lineAlpha + '%'; recolor(l); save('lineAlpha'); };
    $('seed').oninput = (e) => { const l = SP(); l.seed = +e.target.value || 1; $('seedVal').textContent = '#' + l.seed; refresh(); save('seed'); };
    $('animSpeed').oninput = (e) => { const l = SP(); l.animSpeed = +e.target.value; $('animSpeedVal').textContent = (+e.target.value).toFixed(1) + '×'; recolor(l); save('animSpeed'); };
    $('flowAngle').oninput = (e) => { const l = SP(); l.flowAngle = +e.target.value; $('flowAngleVal').textContent = l.flowAngle + '°'; recolor(l); save('flowAngle'); };
    $('animSelect').onchange = (e) => { const l = SP(); l.animation = e.target.value; syncAnimVisibility(l); refresh(); save('animation'); };
    $('variantSelect').onchange = (e) => { const l = SP(); l.variant = e.target.value; refresh(); save('variant'); };

    // ---- color theme: per-mode arrangements (selected layer) ----
    $('palMap').onchange = (e) => { const l = SP(); l.theme.colorMap = e.target.value; recolor(l); save('colorMap'); };
    $('gradMapSel').onchange = (e) => { const l = SP(); l.theme.gradMap = e.target.value; syncThemeVisibility(l); recolor(l); save('gradMap'); };
    $('duoMapSel').onchange = (e) => { const l = SP(); l.theme.duoMap = e.target.value; recolor(l); save('duoMap'); };
    $('gradBands').oninput = (e) => { const l = SP(); l.theme.gradBands = Math.max(2, Math.min(12, +e.target.value || 5)); $('gradBandsVal').textContent = l.theme.gradBands; recolor(l); save('gradBands'); };
    $('singleColor').oninput = (e) => { const l = SP(); l.theme.singleColor = e.target.value; buildSingleTpls(l); recolor(l); save('singleColor'); };
    $('duoA').oninput = (e) => { const l = SP(); l.theme.duoA = e.target.value; buildDuoTpls(l); recolor(l); save('duoA'); };
    $('duoB').oninput = (e) => { const l = SP(); l.theme.duoB = e.target.value; buildDuoTpls(l); recolor(l); save('duoB'); };
    $('gradPick').onchange = (e) => applyGradientId(SP(), e.target.value);
    $('lineAuto').onchange = (e) => { const l = SP(); l.lineAuto = e.target.checked; $('lineColor').disabled = l.lineAuto; recolor(l); save('lineAuto'); };
    $('lineColor').oninput = (e) => { const l = SP(); l.lineColor = e.target.value; recolor(l); save('lineColor'); };

    // ---- single / duotone template save/delete ----
    $('singleTplSave').onclick = () => {
      const l = SP();
      if (!singleStore.list().includes(l.theme.singleColor)) {
        singleStore.add(l.theme.singleColor);
        buildSingleTpls(l);
        statusEl.textContent = 'single-color template saved';
      } else statusEl.textContent = 'already saved';
    };
    $('singleTplDelete').onclick = () => {
      const l = SP();
      const i = singleStore.list().indexOf(l.theme.singleColor);
      if (i >= 0) { singleStore.remove(i); buildSingleTpls(l); statusEl.textContent = 'template deleted'; }
      else statusEl.textContent = 'select a custom template first';
    };
    $('duoTplSave').onclick = () => {
      const l = SP();
      const list = duoStore.list();
      if (!list.some((p) => p.a === l.theme.duoA && p.b === l.theme.duoB)) {
        duoStore.add({ a: l.theme.duoA, b: l.theme.duoB });
        buildDuoTpls(l);
        statusEl.textContent = 'duotone template saved';
      } else statusEl.textContent = 'already saved';
    };
    $('duoTplDelete').onclick = () => {
      const l = SP();
      const list = duoStore.list();
      const i = list.findIndex((p) => p.a === l.theme.duoA && p.b === l.theme.duoB);
      if (i >= 0) { duoStore.remove(i); buildDuoTpls(l); statusEl.textContent = 'template deleted'; }
      else statusEl.textContent = 'select a custom template first';
    };

    // ---- palette editor (inline in Palette mode) ----
    $('palAddColor').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.pal.draft) loadPalDraft(l);
      if (d.pal.draft.colors.length < CP.MAX_COLORS) {
        d.pal.draft.colors.push('#88aacc');
        palEdited(l);
        buildPaletteGrid(l); renderPalEditor(l); recolor(l); save('palAdd', 'Palette colors');
      }
    };
    $('palDraftReset').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      d.pal.active = false;
      loadPalDraft(l);
      $('palEditState').textContent = '';
      buildPaletteGrid(l); renderPalEditor(l); recolor(l); save('palDraft', 'Palette edits reset');
    };
    $('palBg').oninput = (e) => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.pal.draft) loadPalDraft(l);
      d.pal.draft.bg = e.target.value;
      palEdited(l); recolor(l); save('palBg', 'Palette background');
    };
    $('palOutline').oninput = (e) => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.pal.draft) loadPalDraft(l);
      d.pal.draft.outline = e.target.value;
      palEdited(l); recolor(l); save('palOutline', 'Palette outline');
    };
    $('palOutlineAuto').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.pal.draft) loadPalDraft(l);
      d.pal.draft.outline = null;
      palEdited(l);
      renderPalEditor(l); recolor(l); save('palOutline', 'Palette outline');
    };
    $('palSave').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.pal.draft) loadPalDraft(l);
      const draft = JSON.parse(JSON.stringify(d.pal.draft));
      if (l.theme.paletteRef.kind === 'custom' && d.pal.active) {
        CP.update(l.theme.paletteRef.id, draft);
        statusEl.textContent = 'custom palette updated';
      } else {
        const created = CP.create({ ...draft, name: draft.name + ' (custom)' });
        if (created) l.theme.paletteRef = { kind: 'custom', id: created.id };
        statusEl.textContent = 'palette saved as custom';
      }
      d.pal.active = false;
      loadPalDraft(l);
      save('palette', 'Palette saved'); syncControls(); recolor(l);
    };
    $('palDuplicate').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.pal.draft) loadPalDraft(l);
      const src = l.theme.paletteRef.kind === 'custom' ? l.theme.paletteRef.id : null;
      const created = src ? CP.duplicate(src) : CP.create(JSON.parse(JSON.stringify(d.pal.draft)));
      if (created) {
        l.theme.paletteRef = { kind: 'custom', id: created.id };
        d.pal.active = false; loadPalDraft(l);
        buildPaletteGrid(l); renderPalEditor(l);
      }
      statusEl.textContent = 'palette duplicated';
      save('palette', 'Palette duplicated'); recolor(l);
    };
    $('palDelete').onclick = () => {
      const l = SP();
      if (l.theme.paletteRef.kind !== 'custom') { statusEl.textContent = 'built-in palettes cannot be deleted'; return; }
      CP.remove(l.theme.paletteRef.id);
      l.theme.paletteRef = { kind: 'builtin', index: 0 };
      const d = draftFor(l.id);
      d.pal.active = false; loadPalDraft(l);
      syncControls(); refresh(); save('palette', 'Palette deleted');
      statusEl.textContent = 'palette deleted';
    };

    // ---- gradient editor (inline in Gradient mode) ----
    $('gradType').onchange = (e) => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.grad.draft) loadGradDraft(l);
      d.grad.draft.type = e.target.value;
      gradEdited(l);
      renderGradPreview(l); recolor(l); save('gradDraft', 'Gradient type');
    };
    $('gradAngle').oninput = (e) => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.grad.draft) loadGradDraft(l);
      d.grad.draft.angle = +e.target.value;
      $('gradAngleVal').textContent = d.grad.draft.angle + '°';
      gradEdited(l);
      renderGradPreview(l); recolor(l); save('gradDraft', 'Gradient angle');
    };
    $('gradAddStop').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.grad.draft) loadGradDraft(l);
      if (d.grad.draft.stops.length < 16) {
        d.grad.draft.stops.push({ pos: 1, color: '#88aacc' });
        d.grad.draft.stops.sort((a, b) => a.pos - b.pos);
        gradEdited(l);
        renderGradEditor(l); recolor(l); save('gradDraft', 'Gradient stops');
      }
    };
    $('gradDraftReset').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      d.grad.active = false;
      loadGradDraft(l);
      syncGradEditState(l);
      renderGradEditor(l); recolor(l); save('gradDraft', 'Gradient edits reset');
    };
    $('gradSave').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.grad.draft) loadGradDraft(l);
      const g = JSON.parse(JSON.stringify(d.grad.draft));
      const editingCustom = d.grad.active && d.grad.editId && !GR.BUILTINS.some((x) => x.id === d.grad.editId);
      const saved = GR.save(editingCustom ? { ...g, id: d.grad.editId } : g);
      l.theme.gradientId = saved.id;
      d.grad.editId = saved.id;
      d.grad.active = false;
      loadGradDraft(l);
      save('gradient', 'Gradient saved'); syncControls(); recolor(l);
      statusEl.textContent = editingCustom ? 'custom gradient updated' : 'gradient saved as custom';
    };
    $('gradDelete').onclick = () => {
      const l = SP();
      const d = draftFor(l.id);
      if (!d.grad.editId || GR.BUILTINS.some((g) => g.id === d.grad.editId)) {
        statusEl.textContent = 'built-in gradients cannot be deleted';
        return;
      }
      GR.remove(d.grad.editId);
      l.theme.gradientId = GR.BUILTINS[0].id;
      d.grad.active = false; loadGradDraft(l);
      syncControls(); recolor(l); save('gradient', 'Gradient deleted');
      statusEl.textContent = 'gradient deleted';
    };

    // ---- theme export/import (all template kinds) ----
    $('themeExport').onclick = () => {
      const json = CP.exportJSON(CP.list(), GR.list(), {
        single: singleStore.list(),
        duo: duoStore.list(),
      });
      downloadBlob(new Blob([json], { type: 'application/json' }), 'einstein-wallpaper-themes.json');
      statusEl.textContent = 'themes exported';
    };
    $('themeImport').onclick = () => $('themeFile').click();
    $('themeFile').onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const res = CP.importJSON(String(reader.result));
          if (res.extras) {
            if (Array.isArray(res.extras.single)) res.extras.single.forEach((c) => { if (GR.isHexColor(c) && !singleStore.list().includes(c)) singleStore.add(c); });
            if (Array.isArray(res.extras.duo)) res.extras.duo.forEach((p) => { if (p && GR.isHexColor(p.a) && GR.isHexColor(p.b) && !duoStore.list().some((q) => q.a === p.a && q.b === p.b)) duoStore.add(p); });
          }
          fixProjectRefs(project);
          syncControls(); refresh(); save('themeImport', 'Themes imported');
          statusEl.textContent = `imported ${res.palettes} palettes, ${res.gradients} gradients` +
            (res.extras ? `, ${res.extras.single.length || 0} single + ${res.extras.duo.length || 0} duotone templates` : '');
        } catch (err) {
          statusEl.textContent = 'import failed: ' + err.message;
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    // ---- effects (selected layer) ----
    // repaint=true: the effect shades tiles in the SCENE paint (frozen
    // shimmer), so the layer canvas must be repainted, not just recomposed
    const fxBind = (id, key, valId, fmt, repaint) => {
      $(id).oninput = (e) => {
        const l = SP();
        l.effects[key] = +e.target.value;
        $(valId).textContent = fmt(+e.target.value);
        if (repaint) recolor(l);
        // post-processing only: recompose reusing the painted scene canvases
        else composeFrame(performance.now(), true);
        save('fx' + key[0].toUpperCase() + key.slice(1));
      };
    };
    fxBind('fxBlur', 'blur', 'fxBlurVal', (v) => v + ' px');
    fxBind('fxGlow', 'glow', 'fxGlowVal', (v) => Math.round(v) + '%');
    fxBind('fxGlowRadius', 'glowRadius', 'fxGlowRadiusVal', (v) => v + ' px');
    fxBind('fxShadow', 'shadow', 'fxShadowVal', (v) => Math.round(v) + '%');
    fxBind('fxShadowSoft', 'shadowSoft', 'fxShadowSoftVal', (v) => v + ' px');
    fxBind('fxShadowOff', 'shadowOff', 'fxShadowOffVal', (v) => v + ' px');
    fxBind('fxGrain', 'grain', 'fxGrainVal', (v) => Math.round(v) + '%');
    fxBind('fxVignette', 'vignette', 'fxVignetteVal', (v) => Math.round(v) + '%');
    $('fxVignetteMode').onchange = (e) => { SP().effects.vignetteMode = e.target.value; composeFrame(performance.now(), true); save('fxVignetteMode'); };
    fxBind('fxShimmer', 'shimmer', 'fxShimmerVal', (v) => Math.round(v) + '%', true);
    fxBind('fxShimmerAngle', 'shimmerAngle', 'fxShimmerAngleVal', (v) => v + '°', true);
    fxBind('fxShimmerScale', 'shimmerScale', 'fxShimmerScaleVal', (v) => Math.round(v) + '%', true);
    fxBind('fxSheen', 'sheen', 'fxSheenVal', (v) => Math.round(v) + '%');
    fxBind('fxSheenAngle', 'sheenAngle', 'fxSheenAngleVal', (v) => v + '°');
    fxBind('fxSheenPos', 'sheenPos', 'fxSheenPosVal', (v) => Math.round(v) + '%');
    fxBind('fxIrid', 'irid', 'fxIridVal', (v) => Math.round(v) + '%');
    fxBind('fxIridAngle', 'iridAngle', 'fxIridAngleVal', (v) => v + '°');
    fxBind('fxIridScale', 'iridScale', 'fxIridScaleVal', (v) => Math.round(v) + '%');
    fxBind('fxAberration', 'aberration', 'fxAberrationVal', (v) => v + ' px');
    fxBind('fxScan', 'scan', 'fxScanVal', (v) => Math.round(v) + '%');
    fxBind('fxScanGap', 'scanGap', 'fxScanGapVal', (v) => v + ' px');

    // ---- special effects: ONE active effect per layer (dropdown) ----
    // switching modes zeroes every special amount, then seeds the chosen
    // effect with a clearly visible strength so it is never selected but
    // invisible
    const SPECIAL_SEED = {
      shimmer: { shimmer: 50 },
      sheen: { sheen: 60 },
      irid: { irid: 45 },
      aberration: { aberration: 4 },
      scan: { scan: 35 },
    };
    $('fxSpecial').onchange = (e) => {
      const fx = SP().effects;
      fx.special = e.target.value;
      fx.shimmer = 0; fx.sheen = 0; fx.irid = 0; fx.aberration = 0; fx.scan = 0;
      Object.assign(fx, SPECIAL_SEED[fx.special] || {});
      syncControls();
      // shimmer renders in the scene paint (frozen per-tile shades) — repaint
      // the layer canvas, not just the post-processing composite
      recolor(SP());
      const opt = e.target.selectedOptions[0];
      save('fxSpecial', 'Special effect · ' + (opt ? opt.textContent : fx.special));
    };

    // ---- section-scoped randomizers (dice in the section headers) ----
    // preventDefault/stopPropagation so clicking the dice never toggles the section
    const dice = (id, fn) => {
      $(id).onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
    };
    dice('randTiling', randomizeTiling);
    dice('randTheme', randomizeTheme);
    dice('randFx', randomizeFx);
    dice('randAnim', randomizeAnim);
    dice('randBg', randomizeBg);

    $('layerRand').onclick = randomize;
    $('pngBtn').onclick = () => { closePops(); exportPNG(); };
    $('gifBtn').onclick = () => { closePops(); exportGIF(); };
    $('apngBtn').onclick = () => { closePops(); exportAPNG(); };
    $('svgBtn').onclick = () => { closePops(); window.ExportDialog.open('svg'); };
    $('psdBtn').onclick = () => { closePops(); window.ExportDialog.open('psd'); };
    $('projSaveBtn').onclick = () => {
      downloadBlob(new Blob([JSON.stringify(buildProjectFile(), null, 2)],
        { type: 'application/json' }), `${fileBase()}-project.json`);
      updateSaveState('exported');
      statusEl.textContent = 'project saved as JSON';
    };
    $('projLoadBtn').onclick = () => $('projFile').click();
    $('projFile').onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          loadProjectFromText(String(reader.result));
        } catch (err) {
          statusEl.textContent = 'load failed: ' + err.message;
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };
    $('fsBtn').onclick = fullscreen;
    $('resetBtn').onclick = () => {
      project = LT.defaultProject();
      project.layers[1].theme.gradientId = GR.BUILTINS[0].id;
      cache.clear();
      drafts.clear();
      save('reset', 'Project reset'); syncControls(); refresh();
      notice('Project reset (all layers)');
      closeModal();
    };

    // ---- toolbar: new / random / export menu / share / canvas popover / about modal ----
    // canvas settings + export format menu share one open/close behavior
    $('newBgBtn').onclick = newBackgroundProject;
    $('randWallBtn').onclick = randomWallpaper;
    $('shareBtn').onclick = shareWallpaper;
    const pops = [['canvasBtn', 'canvasPop'], ['exportBtn', 'exportPop']];
    const closePops = () => { for (const [, id] of pops) $(id).hidden = true; };
    const anyPopOpen = () => pops.some(([, id]) => !$(id).hidden);
    for (const [bId, pId] of pops) {
      const p = $(pId);
      $(bId).onclick = (e) => {
        e.stopPropagation();
        const wasOpen = !p.hidden;
        closePops();
        p.hidden = wasOpen; // toggle, and only one popover open at a time
      };
      p.addEventListener('click', (e) => e.stopPropagation());
    }
    document.addEventListener('click', closePops);
    const modal = $('modalWrap');
    const closeModal = () => { modal.hidden = true; };
    $('aboutBtn').onclick = () => { modal.hidden = false; };
    $('aboutClose').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (!modal.hidden || anyPopOpen())) {
        closeModal();
        closePops();
      }
    });

    document.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; // native text undo
        e.preventDefault(); doUndo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault(); doRedo(); return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (k === 'r') randomize();
      if (k === 'f') fullscreen();
    });
    window.addEventListener('resize', () => { refresh(); });
    document.addEventListener('fullscreenchange', () => { setTimeout(refresh, 60); });
  }

  /* ------------------------------------------------------- init */

  // mobile usability: on small screens every section starts collapsed and a
  // chip row (built here) opens + scrolls to a section. Desktop is untouched.
  function initMobileNav() {
    const narrow = window.matchMedia('(max-width: 760px)');
    const nav = $('secNav');
    const sections = [
      ['sec-layers', 'Layers'], ['sec-tiling', 'Tiling'], ['sec-theme', 'Colors'],
      ['sec-bgprops', 'Background'], ['sec-fx', 'Effects'], ['sec-anim', 'Animation'],
    ];
    for (const [id, label] of sections) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = label;
      b.onclick = () => {
        if (!narrow.matches) return;
        document.querySelectorAll('#controls > details').forEach((d) => { d.open = d.id === id; });
        const el = $(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      nav.appendChild(b);
    }
    const collapseAll = () => {
      if (narrow.matches) {
        document.querySelectorAll('#controls > details').forEach((d) => { d.open = false; });
      }
    };
    collapseAll();
    if (narrow.addEventListener) narrow.addEventListener('change', collapseAll);
    else if (narrow.addListener) narrow.addListener(collapseAll); // older API
  }

  // Read-only API for the export modules (SVG/PSD exporters + dialog) and the
  // QA suite. Exporters must treat the project as immutable: they never call
  // save() and never mutate layers — all treatment happens on local copies.
  window.TessellateAPI = {
    getProject: () => project,
    SP, selectedLayer: (p) => LT.selectedLayer(p || project),
    layerParams, currentMap, makeLayerLook,
    bgFillSpec, paintBackgroundFill, effectiveBgColor,
    buildSceneForLayer, buildExportParts, compositeComposition,
    fileBase, downloadBlob,
    status: (m) => { statusEl.textContent = m; },
    // QA/agent hook: replace the working project through the same sanitize +
    // fix path as file loading (no localStorage write, no history entry)
    setProjectForTest: (obj) => {
      project = fixProjectRefs(LT.sanitizeProject(obj));
      cache.clear();
      drafts.clear();
      syncControls();
      refresh();
      return project;
    },
  };

  bind();
  initMobileNav();
  syncControls();
  regenerate();
  history.reset(takeSnapshot()); // base entry: the state the page loaded with
  syncHistoryButtons();
  updateSaveState();
})();
