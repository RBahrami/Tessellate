/*
 * export-dialog.js — SVG / PSD export configuration dialog for Tessellate.
 *
 * Opens from the toolbar Export menu (#svgBtn / #psdBtn). Lets the user pick
 * the export scope, an appearance preset (see export-treatment.js), background
 * handling, hidden-layer handling and (for SVG) the effect-fidelity mode, shows
 * a live preview of the treated static frame, and remembers the last-used
 * options SEPARATELY for SVG and PSD in localStorage (never inside the saved
 * project). The dialog is strictly non-destructive: nothing here mutates the
 * project, its layers, palettes or gradients.
 */
(function (root) {
  'use strict';

  const T = root.Treat;
  const $ = (id) => document.getElementById(id);
  const STORE = { svg: 'tessellate-exp-svg', psd: 'tessellate-exp-psd' };
  const FORMAT_LABEL = { svg: 'SVG', psd: 'PSD' };

  let fmt = 'svg';
  let opts = null;
  let busy = false;
  let previewTimer = 0;

  /* ------------------------- option persistence ------------------------- */
  function loadOpts() {
    try {
      const raw = localStorage.getItem(STORE[fmt]);
      if (raw) return Object.assign(T.defaultOpts(), JSON.parse(raw));
    } catch (e) { /* fall through */ }
    return T.defaultOpts();
  }
  function persistOpts() {
    try { localStorage.setItem(STORE[fmt], JSON.stringify(opts)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------ UI helpers ---------------------------- */
  function show(el, on) { el.hidden = !on; }

  function syncRows() {
    const preset = opts.preset;
    show($('expCard').querySelector('[data-x="mono"]'), preset === 'mono-outline');
    show($('expCard').querySelector('[data-x="sil"]'), preset === 'silhouette');
    const custom = preset === 'custom';
    show($('expCard').querySelector('[data-x="fill"]'), custom);
    show($('expCard').querySelector('[data-x="outline"]'), custom);
    show($('expCard').querySelector('[data-x="fx"]'), fmt === 'svg');
    $('expScope').disabled = busy;
    // mono / silhouette / custom color rows reflect opts
    $('expMonoColor').value = opts.monoColor;
    $('expSilColor').value = opts.silhouetteColor;
    $('expFillMode').value = opts.fillMode;
    $('expFillColor').hidden = opts.fillMode !== 'custom';
    $('expFillColor').value = opts.fillColor;
    $('expOutlineMode').value = opts.outlineMode;
    $('expOutlineColor').hidden = opts.outlineMode !== 'custom';
    $('expOutlineColor').value = opts.outlineColor;
    $('expBgMode').value = opts.bgMode;
    $('expBgColor').hidden = opts.bgMode !== 'custom';
    $('expBgColor').value = opts.bgColor;
    $('expHiddenSel').value = opts.includeHidden ? 'include' : 'omit';
    $('expEffects').value = opts.effectsMode;
    $('expLineWidth').value = opts.outlineWidth == null ? '' : opts.outlineWidth;
    const p = T.PRESETS.find((x) => x.id === preset);
    $('expPresetDesc').textContent = p ? p.desc : '';
  }

  function syncWarnings(res) {
    const warn = $('expWarn');
    const lines = [];
    if (res && res.rasterized && res.rasterized.length) {
      lines.push('Rasterized (not vector): ' + res.rasterized.join(', ') +
        '. Everything else stays fully editable.');
    }
    if (res && res.omitted && res.omitted.length) {
      lines.push('Omitted for editability: ' + res.omitted.join(', ') + '.');
    }
    if (lines.length) { warn.textContent = lines.join(' '); show(warn, true); }
    else show(warn, false);
  }

  /* ------------------------------ preview ------------------------------- */
  function previewSize() {
    const proj = root.TessellateAPI.getProject();
    const ar = proj.resW / proj.resH;
    const W = 512;
    return { W, H: Math.max(64, Math.round(W / ar)) };
  }

  function renderPreview() {
    const api = root.TessellateAPI;
    if (!api) return;
    const { W, H } = previewSize();
    const proj = api.getProject();
    const cv = $('expPreview');
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const t = T.resolve(opts);
    const bgLayer = proj.layers.find((l) => l.type === 'background');
    let bgCanvas = null, bgOp = 0;
    if (opts.scope === 'composition' && t.bg !== 'none' && bgLayer &&
        bgLayer.visible && bgLayer.opacity > 0) {
      bgCanvas = root.RasterExport.renderBackgroundRaster(bgLayer, W, H, t, api);
      bgOp = bgLayer.opacity / 100;
    }
    let layers;
    if (opts.scope === 'layer') {
      layers = [api.selectedLayer(proj)];
    } else {
      layers = root.Layers.patternLayers(proj).filter((l) => l.visible || opts.includeHidden);
    }
    const parts = [];
    for (const layer of layers) {
      const c = root.RasterExport.renderLayerRaster(layer, W, H, t, api);
      if (c) parts.push({ canvas: c, opacity: layer.opacity / 100, hidden: !layer.visible });
    }
    const merged = root.RasterExport.mergeComposite(W, H,
      bgCanvas ? { canvas: bgCanvas, opacity: bgOp } : null, parts);
    ctx.drawImage(merged, 0, 0);

    // warning line mirrors the exporters' decisions for the real resolution
    let rasterized = [], omitted = [];
    if (fmt === 'svg') {
      for (const layer of layers) {
        const plan = T.effectPlan(layer, opts.effectsMode, !!bgCanvas);
        plan.omitted.forEach((n) => omitted.push(`${layer.name}: ${n}`));
        plan.rasterized.forEach((n) => rasterized.push(`${layer.name}: ${n}`));
      }
      if (bgCanvas && helpers.bgIsConic(proj)) rasterized.push('Background (conic gradient)');
    }
    syncWarnings({ rasterized, omitted });
  }
  const helpers = {
    bgIsConic(proj) {
      const spec = root.TessellateAPI.bgFillSpec(proj);
      return !!(spec && spec.kind === 'gradient' && spec.grad && spec.grad.type === 'conic');
    },
  };
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 140);
  }

  /* ------------------------------- export ------------------------------- */
  async function run() {
    if (busy) return;
    busy = true;
    const go = $('expGo');
    const orig = go.textContent;
    persistOpts();
    const api = root.TessellateAPI;
    const proj = api.getProject();
    try {
      if (fmt === 'svg') {
        go.textContent = 'rendering…';
        await new Promise((r) => setTimeout(r, 30));
        const res = root.SvgExport.buildSvg(proj, api, opts);
        const blob = new Blob([res.svg], { type: 'image/svg+xml;charset=UTF-8' });
        api.downloadBlob(blob, `${api.fileBase()}-${res.W}x${res.H}.svg`);
        api.status(`SVG saved · ${res.layers} layer group${res.layers > 1 ? 's' : ''} · ` +
          `${res.paths.toLocaleString()} vector shapes · ${res.W}x${res.H} · ` +
          `${(blob.size / 1048576).toFixed(1)} MB · static frame`);
      } else {
        const res = await root.PsdExport.buildPsd(proj, api, opts, (m) => { go.textContent = m; });
        const blob = new Blob([res.buffer], { type: 'image/vnd.adobe.photoshop' });
        api.downloadBlob(blob, `${api.fileBase()}-${res.W}x${res.H}.psd`);
        api.status(`PSD saved · ${res.layerCount} layer${res.layerCount > 1 ? 's' : ''} · ` +
          `${res.W}x${res.H} · ${(blob.size / 1048576).toFixed(1)} MB · static frame`);
      }
      close();
    } catch (err) {
      api.status('export failed: ' + (err && err.message ? err.message : err));
      go.textContent = orig;
      busy = false;
    }
  }

  function close() {
    $('expWrap').hidden = true;
    busy = false;
  }

  /* -------------------------------- open -------------------------------- */
  function open(format) {
    fmt = format;
    opts = loadOpts();
    if (opts.preset === 'custom') { /* fine */ }
    // seed the background select with the preset's default only on first use
    if (opts.bgMode == null) opts.bgMode = T.defaultBgMode(opts.preset);

    const isSvg = fmt === 'svg';
    $('expTitle').textContent = 'Export ' + FORMAT_LABEL[fmt];
    $('expSub').textContent = isSvg
      ? 'Editable vector artwork · static frame at time zero'
      : 'Layered Photoshop document · static frame at time zero';
    $('expGo').textContent = 'Export ' + FORMAT_LABEL[fmt];
    $('expGo').disabled = false;

    const sel = $('expPreset');
    sel.innerHTML = '';
    for (const p of T.PRESETS) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    }
    sel.value = opts.preset;

    busy = false;
    $('expWrap').hidden = false;
    syncRows();
    renderPreview();
  }

  /* ------------------------------- wiring ------------------------------- */
  function wire() {
    $('expPreset').onchange = (e) => {
      opts.preset = e.target.value;
      opts.bgMode = T.defaultBgMode(opts.preset);
      syncRows(); persistOpts(); renderPreview();
    };
    $('expScope').onchange = (e) => { opts.scope = e.target.value; persistOpts(); renderPreview(); };
    $('expMonoColor').oninput = (e) => { opts.monoColor = e.target.value; persistOpts(); renderPreview(); };
    $('expSilColor').oninput = (e) => { opts.silhouetteColor = e.target.value; persistOpts(); renderPreview(); };
    $('expFillMode').onchange = (e) => { opts.fillMode = e.target.value; syncRows(); persistOpts(); renderPreview(); };
    $('expFillColor').oninput = (e) => { opts.fillColor = e.target.value; persistOpts(); renderPreview(); };
    $('expOutlineMode').onchange = (e) => { opts.outlineMode = e.target.value; syncRows(); persistOpts(); renderPreview(); };
    $('expOutlineColor').oninput = (e) => { opts.outlineColor = e.target.value; persistOpts(); renderPreview(); };
    $('expBgMode').onchange = (e) => { opts.bgMode = e.target.value; syncRows(); persistOpts(); renderPreview(); };
    $('expBgColor').oninput = (e) => { opts.bgColor = e.target.value; persistOpts(); renderPreview(); };
    $('expHiddenSel').onchange = (e) => { opts.includeHidden = e.target.value === 'include'; persistOpts(); renderPreview(); };
    $('expEffects').onchange = (e) => { opts.effectsMode = e.target.value; persistOpts(); renderPreview(); };
    $('expLineWidth').onchange = (e) => {
      const v = (e.target.value === '' || !(+e.target.value >= 0)) ? null : +e.target.value;
      opts.outlineWidth = v; persistOpts(); renderPreview();
    };
    $('expCard').querySelectorAll('[data-monosw]').forEach((b) => {
      b.onclick = () => {
        opts.monoColor = b.getAttribute('data-monosw');
        syncRows(); persistOpts(); renderPreview();
      };
    });
    $('expGo').onclick = run;
    $('expCancel').onclick = close;
    const wrap = $('expWrap');
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !wrap.hidden) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  root.ExportDialog = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
