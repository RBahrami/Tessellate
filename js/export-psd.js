/*
 * export-psd.js — layered Photoshop document export for Tessellate.
 *
 * Uses the vendored ag-psd library (js/vendor/ag-psd.js, MIT, UMD global
 * `agPsd`) — a mature browser-side PSD reader/writer — so the file is a real
 * layered PSD (signature 8BPS), not a renamed image. The library ships with
 * the app: no CDN, no build step, fully offline.
 *
 * Document model (bottom -> top, PSD order):
 *   children[0] = Background layer (own raster, own opacity, optional)
 *   children[1..] = one layer per exported pattern layer:
 *       name, visibility flag and opacity are preserved as EDITABLE
 *       properties; raster content is the layer's treated render at time zero
 *       with its effects applied and transparent pixels outside the geometry.
 *   psd.canvas = merged composite of the visible exported layers (what
 *       Photoshop/Photopea show before the user touches the layers).
 *
 * All appearance presets from export-treatment.js work per layer; layers are
 * never merged with each other.
 */
(function (root) {
  'use strict';

  const T = root.Treat;

  let canvasInited = false;
  function ensureAgPsd() {
    const A = root.agPsd;
    if (!A || typeof A.writePsd !== 'function') {
      throw new Error('PSD library not loaded (js/vendor/ag-psd.js)');
    }
    if (!canvasInited) {
      A.initializeCanvas(() => document.createElement('canvas'));
      canvasInited = true;
    }
    return A;
  }

  // sensible memory guard: every layer materializes a few W x H RGBA buffers
  function checkBudget(W, H, layerCount) {
    const bytes = W * H * 4 * (layerCount + 2) * 3; // base + fx + composite slack
    if (bytes > 1.4e9) {
      throw new Error(`PSD export too large: ${W}x${H} with ${layerCount} layer(s) needs roughly ` +
        `${(bytes / 1e9).toFixed(1)} GB of canvas memory — reduce the canvas resolution and retry.`);
    }
  }

  /*
   * buildPsd(project, helpers, opts) -> Promise
   *   { buffer: ArrayBuffer, W, H, layerCount, names }
   * opts: same dialog options as SVG (effectsMode is ignored — PSD always
   * renders effects; it is a raster format).
   */
  async function buildPsd(project, helpers, opts, onStep) {
    const A = ensureAgPsd();
    const t = T.resolve(opts);
    const W = project.resW, H = project.resH;
    const step = async (m) => { if (onStep) onStep(m); await new Promise((r) => setTimeout(r, 0)); };

    /* ----- layer selection (same rules as SVG) ----- */
    const allPat = root.Layers.patternLayers(project);
    let layers;
    if (opts.scope === 'layer') {
      layers = [helpers.selectedLayer(project)];
    } else {
      layers = allPat.filter((l) => l.visible || opts.includeHidden);
    }
    const bgLayer = project.layers.find((l) => l.type === 'background');
    const bgWanted = opts.scope !== 'layer' && t.bg !== 'none' && !!bgLayer &&
      (bgLayer.visible || opts.includeHidden);
    checkBudget(W, H, layers.length + (bgWanted ? 1 : 0));
    await step('preparing layers…');

    const children = [];
    const compParts = [];
    let bgComp = null;

    /* ----- background layer ----- */
    if (bgWanted) {
      const canvas = root.RasterExport.renderBackgroundRaster(bgLayer, W, H, t, helpers);
      children.push({
        name: bgLayer.name || 'Background',
        hidden: !bgLayer.visible,
        opacity: Math.max(0, Math.min(1, bgLayer.opacity / 100)),
        blendMode: 'normal',
        canvas,
      });
      if (bgLayer.visible && bgLayer.opacity > 0) {
        bgComp = { canvas, opacity: bgLayer.opacity / 100 };
      }
    }

    /* ----- pattern layers ----- */
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      await step(`rendering ${layer.name}… (${i + 1}/${layers.length})`);
      const canvas = root.RasterExport.renderLayerRaster(layer, W, H, t, helpers);
      if (!canvas) continue;
      children.push({
        name: layer.name,
        hidden: !layer.visible,
        opacity: Math.max(0, Math.min(1, layer.opacity / 100)),
        blendMode: 'normal',
        canvas,
      });
      if (layer.visible && layer.opacity > 0) {
        compParts.push({ canvas, opacity: layer.opacity / 100, hidden: false });
      }
    }

    /* ----- merged composite preview ----- */
    await step('compositing preview…');
    const merged = root.RasterExport.mergeComposite(W, H, bgComp, compParts);

    const psd = {
      width: W,
      height: H,
      channels: 4,
      bits: 8,
      colorMode: 3, // RGB
      children,
      canvas: merged,
    };
    await step('writing PSD…');
    const buffer = A.writePsd(psd, { compression: A.Compression.RleCompressed });
    return {
      buffer, W, H,
      layerCount: children.length,
      names: children.map((c) => c.name),
    };
  }

  root.PsdExport = { buildPsd };
})(typeof window !== 'undefined' ? window : globalThis);
