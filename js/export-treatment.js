/*
 * export-treatment.js — shared appearance-treatment model for the SVG and PSD
 * exporters (Tessellate).
 *
 * A "treatment" is a non-destructive description of how the current artwork is
 * re-colored for a vector/raster export. It NEVER touches the project, its
 * layers, palettes or gradients — exporters apply it to their local copies of
 * the look (raster path) or to color strings (vector path).
 *
 * treatment = {
 *   fill:    'original' | 'none' | 'custom'   (custom -> fillColor)
 *   outline: 'original' | 'none' | 'custom'   (custom -> outlineColor)
 *   bg:      'original' | 'none' | 'custom'   (custom -> bgColor)
 *   gray:    boolean                          (luminance grayscale of everything)
 *   outlineWidth: number | null               (null = project setting; px)
 * }
 *
 * Presets (Section 3 of the export spec):
 *   full         Full Color              — everything as-is
 *   outlines     Outlines Only           — transparent fills, outlines kept
 *   mono-outline Monochrome Outlines     — one stroke color, transparent fills
 *   fills        Fills Only              — outlines removed, fills kept
 *   silhouette   Monochrome Silhouette   — one solid fill color, no outlines
 *   gray         Grayscale               — luminance conversion of everything
 *   custom       Custom Treatment        — independent fill/outline/background
 *
 * Line-based families (Lines): the stroked line IS the pattern ink, so the
 * FILL channel recolors line strokes (an "outlines only" preset keeps lines in
 * their original colors; a monochrome outline/silhouette recolors them). The
 * OUTLINE channel applies to polygon borders only and cannot remove line
 * patterns — matching the Fills-Only rule "preserve the actual line geometry".
 *
 * This module is dependency-free (uses only Palettes color helpers when
 * available) and loads in the browser and in Node/bun.
 */
(function (root) {
  'use strict';

  const HEX_RE = /^#[0-9a-f]{6}$/i;

  function clampHex(v, dflt) {
    return (typeof v === 'string' && HEX_RE.test(v)) ? v.toLowerCase() : dflt;
  }

  /* ---------------------------- color helpers ---------------------------- */
  function hexToRgb(h) {
    const v = clampHex(h, '#808080').slice(1);
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  // Consistent luminance conversion (Rec. 709 weights, same as Palettes
  // .luminance) — preserves tonal differences instead of flat gray.
  function grayOf(h) {
    const [r, g, b] = hexToRgb(h);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return rgbToHex(y, y, y);
  }

  /* ------------------------------ presets -------------------------------- */
  const PRESETS = [
    { id: 'full', name: 'Full Color', desc: 'Current colors, outlines and background exactly as previewed' },
    { id: 'outlines', name: 'Outlines Only', desc: 'Transparent tile interiors, original outlines — clean line art' },
    { id: 'mono-outline', name: 'Monochrome Outlines', desc: 'All outlines in one color, transparent interiors' },
    { id: 'fills', name: 'Fills Only', desc: 'Fill colors kept, polygon outlines removed (line patterns stay)' },
    { id: 'silhouette', name: 'Monochrome Silhouette', desc: 'All tiles as solid shapes in one color, no outlines' },
    { id: 'gray', name: 'Grayscale', desc: 'Luminance grayscale of fills, outlines and background' },
    { id: 'custom', name: 'Custom Treatment', desc: 'Independently choose fill, outline and background' },
  ];

  // dialog options (remembered per format)
  function defaultOpts() {
    return {
      scope: 'composition',            // 'composition' | 'layer'
      preset: 'full',
      includeHidden: false,            // export hidden layers too (marked hidden)
      bgMode: 'original',              // 'original' | 'none' | 'custom'
      bgColor: '#0b1020',
      monoColor: '#000000',            // mono-outline stroke color
      monoSwatch: '#ffffff',           // quick-swatch secondary (white)
      silhouetteColor: '#111111',      // silhouette fill color
      fillMode: 'original',            // custom preset: 'original'|'none'|'custom'
      fillColor: '#5bc8ff',
      outlineMode: 'original',         // custom preset: 'original'|'none'|'custom'
      outlineColor: '#101014',
      outlineWidth: null,              // null = use project outline width
      effectsMode: 'raster',           // SVG only: 'raster' = fidelity, 'vector' = editability
    };
  }

  // preset -> which dialog selects are forced (dialog disables them visually)
  function presetRules(preset) {
    switch (preset) {
      case 'outlines': return { fill: 'none', outline: 'original', gray: false };
      case 'mono-outline': return { fill: 'none', outline: 'custom', gray: false };
      case 'fills': return { fill: 'original', outline: 'none', gray: false };
      case 'silhouette': return { fill: 'custom', outline: 'none', gray: false };
      case 'gray': return { fill: 'original', outline: 'original', gray: true };
      case 'custom': return null; // fully driven by opts.fillMode/outlineMode
      case 'full':
      default: return { fill: 'original', outline: 'original', gray: false };
    }
  }

  // default background mode a preset starts with (dialog seeds its select)
  function defaultBgMode(preset) {
    return preset === 'outlines' || preset === 'mono-outline' || preset === 'silhouette'
      ? 'none' : 'original';
  }

  /*
   * resolve(opts) -> treatment
   * opts: the dialog options above. The Background select (opts.bgMode) is the
   * single source for the background channel for every preset.
   */
  function resolve(opts) {
    const o = Object.assign(defaultOpts(), opts || {});
    // callers that omit bgMode entirely get the preset's natural default
    // (Outlines Only / Monochrome Outlines / Silhouette start transparent);
    // Object.assign(defaultOpts, ...) always fills bgMode, so check the RAW opts
    const rawBg = opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'bgMode')
      ? opts.bgMode : null;
    if (rawBg == null) o.bgMode = defaultBgMode(o.preset);
    const rules = presetRules(o.preset) || {
      fill: o.fillMode, outline: o.outlineMode, gray: false,
    };
    const t = {
      fill: rules.fill === 'custom' ? 'custom' : rules.fill,
      fillColor: clampHex(o.fillColor, '#5bc8ff'),
      outline: rules.outline === 'custom' ? 'custom' : rules.outline,
      outlineColor: clampHex(o.outlineMode === 'custom' && rules.outline !== 'custom'
        ? o.outlineColor : (o.preset === 'mono-outline' ? o.monoColor : o.outlineColor), '#101014'),
      bg: o.bgMode,
      bgColor: clampHex(o.bgColor, '#0b1020'),
      gray: !!rules.gray,
      outlineWidth: (o.outlineWidth == null || !(+o.outlineWidth >= 0)) ? null : Math.min(40, +o.outlineWidth),
    };
    // mono-outline preset: the stroke color is the mono picker
    if (o.preset === 'mono-outline') { t.outline = 'custom'; t.outlineColor = clampHex(o.monoColor, '#000000'); }
    if (o.preset === 'silhouette') { t.fill = 'custom'; t.fillColor = clampHex(o.silhouetteColor, '#111111'); }
    return t;
  }

  // treat one color for a given channel ('fill' | 'line' | 'bg')
  function treatColor(hexStr, t, channel) {
    let c = hexStr;
    if (channel === 'fill' && t.fill === 'custom') return t.fillColor;
    if (channel === 'line' && t.outline === 'custom') return t.outlineColor;
    if (channel === 'bg' && t.bg === 'custom') return t.bgColor;
    if (t.gray) c = grayOf(c);
    return c;
  }

  /*
   * treatedLook(look, t, sceneKind) -> { look, colorOverride }
   * Raster path (PSD / rasterized SVG layers / preview): returns a NEW look
   * object the existing Renderer.paintTiles consumes unchanged, plus an
   * optional constant colorOverride for custom fills.
   *   look: { lut[256], line, alpha, fillAlpha, lineAlpha, outlineWidth, gap, ... }
   *   sceneKind: 'hat' | 'poly' | 'line'
   */
  function treatedLook(look, t, sceneKind) {
    const isLine = sceneKind === 'line';
    const lut = look.lut.map((c) => {
      if (isLine) {
        // line ink: recolor via the FILL channel (custom), fall back to the
        // outline channel when it is a custom mono color (mono-outline on Lines)
        if (t.fill === 'custom') return t.fillColor;
        if (t.outline === 'custom') return t.outlineColor;
      }
      if (!isLine && t.fill === 'custom') return t.fillColor;
      return t.gray ? grayOf(c) : c;
    });
    const out = Object.assign({}, look, { lut });
    if (isLine) {
      // lines ignore outlineWidth/look.line entirely in the renderer
      out.fillAlpha = look.fillAlpha; // unused for line scenes
    } else {
      if (t.fill === 'none') out.fillAlpha = 0;
      if (t.outline === 'none') { out.outlineWidth = 0; }
      else if (t.outlineWidth != null) { out.outlineWidth = t.outlineWidth; }
      out.line = t.outline === 'custom' ? t.outlineColor : (t.gray ? grayOf(look.line) : look.line);
    }
    // line scenes keep their strokes unless the user explicitly drops the
    // whole pattern via a custom fill of 'none' — but Lines + 'none' would
    // produce an empty layer, which is a user choice; renderer handles it
    // through lineAlpha, so leave lineAlpha untouched here.
    const colorOverride = (!isLine && t.fill === 'custom')
      ? () => t.fillColor : null;
    return { look: out, colorOverride };
  }

  /* ----------------- effect classification (SVG policy) ------------------ */
  // 'vector' effects get native SVG equivalents; 'raster' ones cannot be
  // reproduced faithfully as vectors and are rasterized or omitted per
  // the selected fidelity mode. Animation overlays (flow/glowwave) and the
  // vignette-on-transparent case rasterize too.
  const FX_VECTOR = { blur: true, glow: true, shadow: true };
  const FX_RASTER = { grain: true, sheen: true, irid: true, aberration: true, scan: true };

  /*
   * effectPlan(layer, effectsMode, bgIncluded) ->
   *   { filter: 'blur'|'glow'|'shadow'|combined|null, vignette: bool,
   *     raster: bool, omitted: [names], rasterized: [names] }
   * effectsMode: 'raster' (fidelity: rasterize layers with unrepresentable
   *              effects) | 'vector' (editability: omit them + warn)
   */
  function effectPlan(layer, effectsMode, bgIncluded) {
    const fx = layer.effects || {};
    const plan = { filter: null, vignette: false, raster: false, omitted: [], rasterized: [] };
    const parts = [];
    if (+fx.blur > 0) parts.push('blur');
    if (+fx.shadow > 0) parts.push('shadow');
    if (+fx.glow > 0) parts.push('glow');
    if (parts.length) plan.filter = parts.length === 1 ? parts[0] : 'combined';
    if (+fx.vignette > 0) {
      if (bgIncluded) plan.vignette = true; // radial-gradient overlay approximation
      else {
        (effectsMode === 'vector' ? plan.omitted : plan.rasterized).push('vignette');
        if (effectsMode !== 'vector') plan.raster = true;
      }
    }
    for (const k of Object.keys(FX_RASTER)) {
      if (+fx[k] > 0) {
        (effectsMode === 'vector' ? plan.omitted : plan.rasterized).push(k);
        if (effectsMode !== 'vector') plan.raster = true;
      }
    }
    // animation overlays at t=0: static gradients — rasterize or omit
    if (layer.animation === 'flow' || layer.animation === 'glowwave') {
      (effectsMode === 'vector' ? plan.omitted : plan.rasterized).push(layer.animation);
      if (effectsMode !== 'vector') plan.raster = true;
    }
    return plan;
  }

  root.Treat = {
    PRESETS, defaultOpts, presetRules, defaultBgMode, resolve, treatColor,
    treatedLook, grayOf, hexToRgb, rgbToHex, effectPlan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Treat;
})(typeof window !== 'undefined' ? window : globalThis);
