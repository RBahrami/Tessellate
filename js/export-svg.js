/*
 * export-svg.js — genuine vector SVG export for Tessellate.
 *
 * The exporter walks the SAME scene geometry the canvas renderer draws
 * (Renderer.buildScene + scene.lutIdx + look) and emits real SVG geometry:
 *   - hat scenes   : the 13-vertex hat outline transformed by mmul(view, hat.T)
 *   - poly scenes  : the precomputed screen-space polygons (gap shrink applied
 *                    exactly like Renderer.paintTiles)
 *   - line scenes  : <path> strokes with the scene's line width (never filled
 *                    polygons)
 * The canvas is never embedded as an image; a full-canvas <image> appears ONLY
 * when a layer (or a conic background) was explicitly rasterized by the
 * selected fidelity mode, and the <desc> + warnings always say so.
 *
 * Structure:
 *   <svg ... viewBox="0 0 W H">
 *     <title/> <desc/>
 *     <defs> background gradient, per-layer filters </defs>
 *     <g id="Background" data-tessellate-layer="Background"> bg rect/gradient
 *     <g id="Pattern-1" data-tessellate-layer="..." opacity display>
 *        <g fill stroke ...>  <path d/> per tile  </g>
 *     </g>
 *   </svg>
 *
 * Static export: every animated layer is frozen at time zero — the per-tile
 * shimmer uses the same formula as Renderer.makeAnimator with phase = 0, and
 * overlay animations (Gradient Flow / Glow Wave) are only reproduced when the
 * layer is rasterized (see Treat.effectPlan). Animations themselves are never
 * serialized.
 */
(function (root) {
  'use strict';

  const R = root.Renderer, HT = root.HatTiling, TL = root.Tilings, T = root.Treat;

  /* ------------------------------- helpers ------------------------------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const f2 = (v) => {
    const r = Math.round(v * 100) / 100;
    return (Object.is(r, -0) ? 0 : r).toString();
  };
  const slug = (s, i) => ('L' + i + '-' + String(s).replace(/[^a-zA-Z0-9]+/g, '-'))
    .replace(/^-+|-+$/g, '').slice(0, 40) || ('L' + i);

  // per-tile fill/ink color (treated look + shimmer animation frame at t=0 +
  // frozen special shimmer), mirroring the canvas paint order
  function tileColorFn(scene, lookT, layer, params) {
    const lutIdx = scene.lutIdx;
    let shimSteps = null;
    if (layer.animation === 'shimmer') {
      // Renderer.makeAnimator's shimmer frozen at t = 0 (phase = 0):
      // w = sin(-(px*0.9 + py*1.4)), 9 shade LUTs of the (treated) look
      shimSteps = R.buildShimLuts(lookT.lut);
    }
    const frozen = R.frozenShimmer(scene, lookT, layer.effects);
    return (tile, i) => {
      if (shimSteps) {
        const px = tile.cx !== undefined ? tile.cx : tile.x;
        const py = tile.cy !== undefined ? tile.cy : tile.y;
        const w = Math.sin(-(px * 0.9 + py * 1.4));
        const sIdx = Math.max(0, Math.min(8, Math.round((w + 1) / 2 * 8)));
        return shimSteps[sIdx][lutIdx[i]];
      }
      if (frozen) return frozen(tile, i);
      return lookT.lut[lutIdx[i]];
    };
  }

  // background gradient defs replicating Gradients.toCanvas geometry
  function bgGradientDef(gid, grad, W, H, treat) {
    const th = (grad.angle || 0) * Math.PI / 180;
    const cx = W / 2, cy = H / 2;
    const stops = grad.stops.map((s) =>
      `<stop offset="${f2(s.pos * 100)}%" stop-color="${treat(s.color)}"/>`).join('');
    if (grad.type === 'radial') {
      const Rr = Math.hypot(W, H) / 2;
      return `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(Rr)}">${stops}</radialGradient>`;
    }
    const dx = Math.cos(th), dy = Math.sin(th);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    return `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f2(cx - dx * half)}" y1="${f2(cy - dy * half)}" x2="${f2(cx + dx * half)}" y2="${f2(cy + dy * half)}">${stops}</linearGradient>`;
  }

  // per-layer SVG filter replicating the canvas passes (blur -> shadow -> glow)
  function filterDef(fid, fx) {
    const blur = +fx.blur || 0;
    const shadow = Math.min(0.9, (+fx.shadow || 0) / 100);
    const soft = +fx.shadowSoft || 14, off = +fx.shadowOff || 8;
    const glow = Math.min(1, (+fx.glow || 0) / 100);
    const glowR = +fx.glowRadius || 12;
    const pad = `x="-30%" y="-30%" width="160%" height="160%"`;
    let body = '';
    let last = 'SourceGraphic';
    if (blur > 0) {
      body += `<feGaussianBlur in="SourceGraphic" stdDeviation="${f2(blur)}" result="bl"/>`;
      last = 'bl';
    }
    if (shadow > 0) {
      body += `<feDropShadow in="${last}" dx="${f2(off)}" dy="${f2(off)}" stdDeviation="${f2(soft / 2)}" flood-color="#000000" flood-opacity="${f2(shadow)}" result="sh"/>`;
      last = 'sh';
    }
    if (glow > 0) {
      body += `<feGaussianBlur in="${last}" stdDeviation="${f2(glowR)}" result="gl"/>`;
      // additive glow, scaled by the glow strength exactly like the canvas
      // pass (FX: globalAlpha = glow/100, composite 'lighter' ≈ screen blend)
      body += `<feComponentTransfer in="gl" result="gla"><feFuncA type="linear" slope="${f2(glow)}" intercept="0"/></feComponentTransfer>`;
      body += `<feBlend in="gla" in2="${last}" mode="screen"/>`;
      last = undefined; // feBlend output is the filter result
    }
    return { def: `<filter id="${fid}" ${pad} color-interpolation-filters="sRGB">${body}</filter>`, empty: !body };
  }

  /* --------------------------- geometry emitters -------------------------- */
  // one <path> per tile, grouped into <g fill/stroke> buckets to keep the
  // file small while every tile stays individually editable
  function emitPolyPaths(scene, colorAt, lookT, shrink) {
    const buckets = new Map();
    const lw = lookT.outlineWidth || 0;
    const strokeA = (lookT.lineAlpha != null) ? +lookT.lineAlpha : 1;
    const fillA = (lookT.fillAlpha != null) ? +lookT.fillAlpha : 1;
    const hasStroke = lw > 0 && strokeA > 0;
    const hasFill = fillA > 0;
    if (!hasFill && !hasStroke) return { markup: '', count: 0 };
    const W = scene.W, H = scene.H;
    const gap = lookT.gap || 0;
    let count = 0;
    for (let i = 0; i < scene.screen.length; i++) {
      const s = scene.screen[i];
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (let j = 0; j < s.length; j += 2) {
        if (!isFinite(s[j]) || !isFinite(s[j + 1])) { sx1 = NaN; break; }
        if (s[j] < sx0) sx0 = s[j]; if (s[j] > sx1) sx1 = s[j];
        if (s[j + 1] < sy0) sy0 = s[j + 1]; if (s[j + 1] > sy1) sy1 = s[j + 1];
      }
      if (!isFinite(sx0)) continue;
      if (sx1 < -40 || sx0 > W + 40 || sy1 < -40 || sy0 > H + 40) continue;
      let d = 'M';
      if (gap > 0) {
        const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
        for (let j = 0; j < s.length; j += 2) {
          d += (j ? ' L ' : ' ') + f2(cx + (s[j] - cx) * (1 - gap)) + ' ' + f2(cy + (s[j + 1] - cy) * (1 - gap));
        }
      } else {
        for (let j = 0; j < s.length; j += 2) {
          d += (j ? ' L ' : ' ') + f2(s[j]) + ' ' + f2(s[j + 1]);
        }
      }
      d += ' Z';
      const fill = hasFill ? colorAt(scene.tiles[i], i) : 'none';
      const stroke = hasStroke ? lookT.line : null;
      const key = fill + '|' + (stroke ? f2(lw) + '|' + stroke : '');
      let b = buckets.get(key);
      if (!b) {
        b = { fill, stroke, lw, hasStroke, items: [] };
        buckets.set(key, b);
      }
      b.items.push(d);
      count++;
    }
    let markup = '';
    for (const b of buckets.values()) {
      markup += `<g fill="${b.fill}"` + (b.hasStroke
        ? ` stroke="${b.stroke}" stroke-width="${f2(b.lw)}" stroke-linejoin="round"` : '')
        + `>`;
      for (const d of b.items) markup += `<path d="${d}"/>`;
      markup += `</g>`;
    }
    return { markup, count };
  }

  function emitHatPaths(scene, colorAt, lookT) {
    const buckets = new Map();
    const lw = lookT.outlineWidth || 0;
    const strokeA = (lookT.lineAlpha != null) ? +lookT.lineAlpha : 1;
    const fillA = (lookT.fillAlpha != null) ? +lookT.fillAlpha : 1;
    const hasStroke = lw > 0 && strokeA > 0;
    const hasFill = fillA > 0;
    if (!hasFill && !hasStroke) return { markup: '', count: 0 };
    const outline = R.shrunkHatOutline(lookT.gap || 0);
    const V = scene.view;
    const W = scene.W, H = scene.H;
    let count = 0;
    for (let i = 0; i < scene.hats.length; i++) {
      const hat = scene.hats[i];
      const M = HT.mmul(V, hat.T);
      // cheap off-screen reject on the outline bbox (as paintTiles)
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      let ok = true;
      for (let j = 0; j < outline.length && ok; j++) {
        const p = outline[j];
        const x = M[0] * p[0] + M[1] * p[1] + M[2];
        const y = M[3] * p[0] + M[4] * p[1] + M[5];
        if (!isFinite(x) || !isFinite(y)) { ok = false; break; }
        if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
        if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
      }
      if (!ok) continue;
      if (sx1 < -40 || sx0 > W + 40 || sy1 < -40 || sy0 > H + 40) continue;
      let d = 'M';
      for (let j = 0; j < outline.length; j++) {
        const p = outline[j];
        const x = M[0] * p[0] + M[1] * p[1] + M[2];
        const y = M[3] * p[0] + M[4] * p[1] + M[5];
        d += (j ? ' L ' : ' ') + f2(x) + ' ' + f2(y);
      }
      d += ' Z';
      const fill = hasFill ? colorAt(hat, i) : 'none';
      const stroke = hasStroke ? lookT.line : null;
      const key = fill + '|' + (stroke ? f2(lw) + '|' + stroke : '');
      let b = buckets.get(key);
      if (!b) { b = { fill, stroke, lw, hasStroke, items: [] }; buckets.set(key, b); }
      b.items.push(d);
      count++;
    }
    let markup = '';
    for (const b of buckets.values()) {
      markup += `<g fill="${b.fill}"` + (b.hasStroke
        ? ` stroke="${b.stroke}" stroke-width="${f2(b.lw)}" stroke-linejoin="round"` : '')
        + `>`;
      for (const d of b.items) markup += `<path d="${d}"/>`;
      markup += `</g>`;
    }
    return { markup, count };
  }

  function emitLinePaths(scene, colorAt, lookT) {
    const buckets = new Map();
    const lineA = (lookT.lineAlpha != null) ? +lookT.lineAlpha : 1;
    if (lineA <= 0) return { markup: '', count: 0 };
    const W = scene.W, H = scene.H;
    const sw = scene.lineWidth || 1;
    let count = 0;
    for (let i = 0; i < scene.screen.length; i++) {
      const s = scene.screen[i];
      if (!isFinite(s[0]) || !isFinite(s[3])) continue;
      if (s[0] < -50 && s[2] < -50) continue;
      if (s[0] > W + 50 && s[2] > W + 50) continue;
      if (s[1] < -50 && s[3] < -50) continue;
      if (s[1] > H + 50 && s[3] > H + 50) continue;
      const d = `M ${f2(s[0])} ${f2(s[1])} L ${f2(s[2])} ${f2(s[3])}`;
      const stroke = colorAt(scene.tiles[i], i);
      const key = stroke;
      let b = buckets.get(key);
      if (!b) { b = { items: [] }; buckets.set(key, b); }
      b.items.push(d);
      count++;
    }
    let markup = '';
    for (const [stroke, b] of buckets) {
      markup += `<g fill="none" stroke="${stroke}" stroke-width="${f2(sw)}" stroke-linecap="butt">`;
      for (const d of b.items) markup += `<path d="${d}"/>`;
      markup += `</g>`;
    }
    return { markup, count };
  }

  /* ------------------------------ main build ------------------------------ */
  /*
   * buildSvg(project, helpers, opts)
   *   helpers: TessellateAPI { buildSceneForLayer, bgFillSpec, paintBackgroundFill }
   *   opts:    export-dialog options (scope, preset, ..., effectsMode)
   * returns { svg, W, H, warnings, rasterized, omitted, layers, paths }
   */
  function buildSvg(project, helpers, opts) {
    const t = T.resolve(opts);
    const W = project.resW, H = project.resH;
    const warnings = [];
    const rasterized = [], omitted = [];
    const defs = [];
    let paths = 0;

    /* ----- layer selection ----- */
    const allPat = (root.Layers ? root.Layers.patternLayers(project) : project.layers.filter((l) => l.type === 'pattern'));
    let layers;
    if (opts.scope === 'layer') {
      const sel = helpers.selectedLayer(project);
      layers = [sel]; // selected layer always renders, even when hidden
    } else {
      layers = allPat.filter((l) => l.visible || opts.includeHidden);
    }

    /* ----- background ----- */
    const bgLayer = project.layers.find((l) => l.type === 'background');
    const bgIncluded = opts.scope !== 'layer' && t.bg !== 'none' &&
      !!bgLayer && bgLayer.visible && bgLayer.opacity > 0;
    let bgMarkup = '';
    if (bgIncluded) {
      const bgOp = bgLayer.opacity < 100 ? ` opacity="${f2(bgLayer.opacity / 100)}"` : '';
      if (t.bg === 'custom') {
        bgMarkup = `<g id="Background" data-tessellate-layer="Background" data-layer-kind="background"${bgOp}><rect x="0" y="0" width="${f2(W)}" height="${f2(H)}" fill="${t.bgColor}"/></g>`;
      } else {
        const spec = helpers.bgFillSpec(project);
        if (spec.kind === 'solid') {
          bgMarkup = `<g id="Background" data-tessellate-layer="Background" data-layer-kind="background"${bgOp}><rect x="0" y="0" width="${f2(W)}" height="${f2(H)}" fill="${T.treatColor(spec.color, t, 'bg')}"/></g>`;
        } else {
          const grad = spec.grad;
          if (grad.type === 'conic') {
            // SVG has no native conic gradient — rasterize the background only
            const url = rasterBackground(helpers, W, H);
            bgMarkup = `<g id="Background" data-tessellate-layer="Background" data-layer-kind="background" data-rasterized="conic-gradient"${bgOp}><image x="0" y="0" width="${f2(W)}" height="${f2(H)}" href="${url}" preserveAspectRatio="none"/></g>`;
            rasterized.push('Background (conic gradient)');
            warnings.push('Conic background gradients cannot be expressed as SVG — the background was rasterized (the pattern layers remain vector).');
          } else {
            const gid = 'bgGrad';
            const treatStop = (c) => (t.gray ? T.grayOf(c) : c);
            defs.push(bgGradientDef(gid, grad, W, H, treatStop));
            bgMarkup = `<g id="Background" data-tessellate-layer="Background" data-layer-kind="background"${bgOp}><rect x="0" y="0" width="${f2(W)}" height="${f2(H)}" fill="url(#${gid})"/></g>`;
          }
        }
      }
    } else if (opts.scope !== 'layer' && t.bg === 'none') {
      warnings.push('Background excluded — the export has a transparent background.');
    }

    /* ----- pattern layers ----- */
    const layerGroups = [];
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const built = helpers.buildSceneForLayer(layer, W, H);
      if (!built || !built.scene) continue;
      const scene = built.scene;
      const kind = scene.kind;
      const lookT0 = T.treatedLook(built.look, t, kind);
      const lookT = lookT0.look;
      let colorAt = null;
      if (kind === 'line') {
        const lutIdx = scene.lutIdx;
        const shim = layer.animation === 'shimmer' ? R.buildShimLuts(lookT.lut) : null;
        const frozen = R.frozenShimmer(scene, lookT, layer.effects);
        colorAt = (tile, i) => {
          if (shim) {
            const px = tile.cx, py = tile.cy;
            const w = Math.sin(-(px * 0.9 + py * 1.4));
            return shim[Math.max(0, Math.min(8, Math.round((w + 1) / 2 * 8)))][lutIdx[i]];
          }
          if (frozen) return frozen(tile, i);
          return lookT.lut[lutIdx[i]];
        };
      } else {
        colorAt = tileColorFn(scene, lookT, layer, built.params);
      }

      const plan = T.effectPlan(layer, opts.effectsMode, bgIncluded);
      plan.omitted.forEach((n) => omitted.push(`${layer.name}: ${n}`));
      plan.rasterized.forEach((n) => rasterized.push(`${layer.name}: ${n}`));

      const attrs = [`id="${esc(slug(layer.name, li + 1))}"`,
        `data-tessellate-layer="${esc(layer.name)}"`,
        `data-layer-kind="pattern"`];
      if (layer.opacity < 100) attrs.push(`opacity="${f2(layer.opacity / 100)}"`);
      if (!layer.visible) attrs.push(`display="none"`);

      let inner = '';
      if (plan.raster) {
        // fidelity mode: rasterize just this layer (others stay vector)
        const canvas = root.RasterExport.renderLayerRaster(layer, W, H, t, helpers);
        const url = canvas.toDataURL('image/png');
        inner = `<image x="0" y="0" width="${f2(W)}" height="${f2(H)}" href="${url}" preserveAspectRatio="none"/>`;
        attrs.push(`data-rasterized="${esc(plan.rasterized.join(',') || 'effects')}"`);
      } else {
        let fid = null;
        if (plan.filter) {
          fid = 'fx' + (li + 1);
          const fd = filterDef(fid, layer.effects || {});
          if (!fd.empty) defs.push(fd.def); else fid = null;
        }
        if (fid) attrs.push(`filter="url(#${fid})"`);
        const emitted = kind === 'hat' ? emitHatPaths(scene, colorAt, lookT)
          : kind === 'line' ? emitLinePaths(scene, colorAt, lookT)
          : emitPolyPaths(scene, colorAt, lookT);
        inner = emitted.markup;
        paths += emitted.count;
        if (plan.vignette) {
          const fx = layer.effects || {};
          const a = Math.min(1, (+fx.vignette || 0) / 100);
          const light = fx.vignetteMode === 'light';
          const inner0 = light ? 0.55 : 0.25;
          const vid = 'vg' + (li + 1);
          defs.push(`<radialGradient id="${vid}" gradientUnits="userSpaceOnUse" cx="${f2(W / 2)}" cy="${f2(H / 2)}" r="${f2(Math.hypot(W, H) / 2)}"><stop offset="${f2(inner0 * Math.min(W, H) / (Math.hypot(W, H) / 2) * 100)}%" stop-color="${light ? '#fff4dc' : '#000000'}" stop-opacity="0"/><stop offset="100%" stop-color="${light ? '#fff4dc' : '#000000'}" stop-opacity="${f2(light ? a * 0.75 : a)}"/></radialGradient>`);
          inner += `<rect x="0" y="0" width="${f2(W)}" height="${f2(H)}" fill="url(#${vid})"/>`;
        }
      }
      layerGroups.push(`<g ${attrs.join(' ')}>${inner}</g>`);
    }

    /* ----- assemble ----- */
    const title = `<title>${esc(project.name || 'Tessellate wallpaper')}</title>`;
    const notes = [
      'Generated by Tessellate — genuine vector geometry (no canvas bitmap).',
      'Static frame: animated layers are frozen at time zero; animations are not preserved in SVG.',
    ];
    if (rasterized.length) notes.push('Rasterized content: ' + rasterized.join('; ') + '.');
    if (omitted.length) notes.push('Omitted effects (editability mode): ' + omitted.join('; ') + '.');
    notes.push(`Treatment: ${T.PRESETS.find((p) => p.id === opts.preset).name}.`);
    const desc = `<desc>${esc(notes.join(' '))}</desc>`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n` +
      title + '\n' + desc + '\n' +
      (defs.length ? `<defs>${defs.join('')}</defs>\n` : '') +
      (bgMarkup ? bgMarkup + '\n' : '') +
      layerGroups.join('\n') + '\n</svg>\n';
    return { svg, W, H, warnings, rasterized, omitted, layers: layers.length, paths };
  }

  function rasterBackground(helpers, W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    helpers.paintBackgroundFill(c.getContext('2d'), W, H);
    return c.toDataURL('image/png');
  }

  root.SvgExport = { buildSvg };
})(typeof window !== 'undefined' ? window : globalThis);
