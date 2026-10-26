/*
 * export-raster.js — shared per-layer raster rendering for the PSD exporter
 * and for SVG layers whose effects cannot be represented as vectors.
 *
 * renderLayerRaster(...) reproduces EXACTLY what the multi-layer compositor
 * draws for a layer at time zero (same scene, same treated look, same
 * Effects.composeLayer passes, overlay animations frozen at t = 0) — without
 * baking the whole-layer opacity into the pixels (opacity stays a separate
 * layer/composite property).
 */
(function (root) {
  'use strict';

  const R = root.Renderer, FX = root.Effects, T = root.Treat;

  // one pattern layer -> transparent W x H canvas with effects applied
  function renderLayerRaster(layer, W, H, t, helpers) {
    const built = helpers.buildSceneForLayer(layer, W, H);
    if (!built || !built.scene) return null;
    const scene = built.scene;
    const { look: lookT, colorOverride } = T.treatedLook(built.look, t, scene.kind);

    const base = document.createElement('canvas');
    base.width = W; base.height = H;
    const bctx = base.getContext('2d');

    const animator = R.makeAnimator(scene, built.params, lookT);
    if (animator && animator.perTile) {
      // static export: animation frame at t = 0 (never modifies the project)
      animator.frame(bctx, 0);
    } else {
      R.paintScene(bctx, scene, built.params, lookT,
        R.frozenShimmer(scene, lookT, layer.effects) || colorOverride);
    }

    const overlay0 = (animator && animator.overlayFn) ? (c) => animator.overlayFn(c, 0) : null;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    FX.composeLayer(octx, base, W, H, lookT, layer.effects, overlay0);
    return out;
  }

  // background layer -> W x H canvas honoring the background treatment
  function renderBackgroundRaster(bgLayer, W, H, t, helpers) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (t.bg === 'custom') {
      ctx.fillStyle = t.bgColor;
      ctx.fillRect(0, 0, W, H);
    } else {
      helpers.paintBackgroundFill(ctx, W, H);
      if (t.gray) {
        const img = ctx.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = y;
        }
        ctx.putImageData(img, 0, 0);
      }
    }
    return c;
  }

  // composite in the same order as app.js compositeComposition: background
  // fill (with its opacity), then each layer canvas with the layer opacity
  function mergeComposite(W, H, bg, parts) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (bg && bg.canvas) {
      ctx.save();
      ctx.globalAlpha = bg.opacity;
      ctx.drawImage(bg.canvas, 0, 0, W, H);
      ctx.restore();
    }
    for (const p of parts) {
      if (!p.canvas || p.hidden) continue;
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.drawImage(p.canvas, 0, 0, W, H);
      ctx.restore();
    }
    return c;
  }

  root.RasterExport = { renderLayerRaster, renderBackgroundRaster, mergeComposite };
})(typeof window !== 'undefined' ? window : globalThis);
