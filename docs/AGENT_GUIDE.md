# Agent Guide — generating Tessellate (formerly EinsteinWallpaper) projects as JSON

This guide is for **AI agents and power users** who want to create wallpapers
by writing a JSON file instead of clicking through the UI. Generate the JSON,
give it to the user as a `.json` file, and they load it with **Load** in the
top toolbar (Tessellate logo + wordmark, project name, New background-only,
Random one-layer wallpaper, undo/redo, canvas settings, save/load, export
menu, share, fullscreen, about). The whole application state
(layers, colors, effects, animation, canvas) lives in that one file.

The app is fully offline and has no build step; the JSON is loaded and
validated entirely in the browser. Malformed values never break the app —
every field is clamped/repaired to a safe default, so *partial* files work.

---

## 1. File shapes (all accepted)

**A. Full project file** (what the app itself saves — recommended when you
also want to ship custom palettes/gradients):

```json
{
  "type": "einstein-wallpaper-project",
  "version": 2,
  "saved": "2026-10-17T12:00:00.000Z",
  "project": { "...": "the project object, see §2" },
  "libraries": { "palettes": [], "gradients": [], "extras": { "single": [], "duo": [] } }
}
```

**B. Bare project object** — the same object without a wrapper. This is the
simplest choice for agents:

```json
{
  "name": "My Aurora",
  "aspect": "16:9", "orientation": "landscape", "resW": 1920, "resH": 1080,
  "layers": [ { "type": "background", "...": "..." }, { "type": "pattern", "...": "..." } ]
}
```

The `version: 2` field is optional on load (it is stamped in automatically).
Legacy flat v1 settings are also still accepted and migrated.

**Loading without the UI:** the project object (shape B) can also be written
directly to `localStorage["einstein-wallpaper-v2"]` on the app's origin, then
reload the page. The UI path is preferred.

---

## 2. Project object (global settings)

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | `"Untitled wallpaper"` | free-form project name, ≤ 60 chars; shown in the top toolbar and used for saved-file/export filenames |
| `aspect` | string | `"16:9"` | One of `16:9, 16:10, 4:3, 5:4, 3:2, 21:9, 32:9, 1:1, 9:16, 9:19.5, 9:20` |
| `orientation` | string | `"landscape"` | `landscape` \| `portrait` |
| `resW`, `resH` | int | 1920 × 1080 | Export resolution in pixels, 64–8192 |
| `selected` | string | — | id of the layer selected on load (optional; falls back to the first pattern layer) |
| `layers` | array | — | `[backgroundLayer, ...patternLayers]` — the background is ALWAYS rendered at the bottom regardless of array order |

These four canvas fields are the **only global visual settings**. Everything
else belongs to a layer. At most **8 pattern layers** are kept (extras are
dropped). Zero pattern layers is also valid — a background-only project (the
toolbar's **New** button creates one); it renders and exports just the
background fill. `selected` may point at the background layer in that case.

---

## 3. Background layer

```json
{
  "id": "bg-1",
  "type": "background",
  "name": "Background",
  "visible": true,
  "opacity": 100,
  "bg": {
    "source": "gradient",
    "color": "#0b1020",
    "gradientId": null,
    "gradient": {
      "type": "radial",
      "angle": 0,
      "stops": [
        { "pos": 0, "color": "#ffe14d" },
        { "pos": 0.55, "color": "#f4854e" },
        { "pos": 1, "color": "#4a1c3d" }
      ]
    }
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `type` | `"background"` | fixed; there is exactly one, it cannot be deleted or reordered |
| `visible` | bool | set `false` for a transparent wallpaper (PNG/APNG keep the alpha) |
| `opacity` | 0–100 | whole-background alpha at composite time |
| `bg.source` | `"solid"` \| `"gradient"` | the only two fill kinds |
| `bg.color` | `#rrggbb` | used when `source` is `"solid"` |
| `bg.gradient` | gradient object | used when `source` is `"gradient"` — **owned, full spec, editable in the UI** |
| `bg.gradientId` | string \| null | optional; id of a built-in/custom gradient used as the *template* the gradient was seeded from (informational) |

**Gradient object** (the same shape is used everywhere in the app):

| Field | Values | Notes |
|---|---|---|
| `type` | `"linear"` \| `"radial"` \| `"conic"` | |
| `angle` | 0–359 (degrees) | ignored by `radial` |
| `stops` | array, ≥ 2 | `{ "pos": 0..1, "color": "#rrggbb" }`, sorted by `pos` (auto-sorted on load); a single stop is padded to two |

A missing `gradient` falls back to a dark blue linear default. A legacy
`"source": "palette"` is converted to a solid color on load.

---

## 4. Pattern layer

```json
{
  "id": "pat-1",
  "type": "pattern",
  "name": "Copper hats",
  "visible": true,
  "opacity": 100,

  "family": "hat",
  "variant": "H",
  "tileSize": 34,
  "rotation": 0,
  "panX": 0,
  "panY": 0,
  "gap": 0.02,
  "outlineWidth": 1.2,
  "fillAlpha": 100,
  "lineAlpha": 100,
  "lineAuto": true,
  "lineColor": "#101014",
  "seed": 7,

  "theme": {
    "mode": "palette",
    "colorMap": "supertile",
    "gradMap": "sweep",
    "duoMap": "checker",
    "gradBands": 5,
    "singleColor": "#5bc8ff",
    "duoA": "#5bc8ff",
    "duoB": "#f4777f",
    "paletteRef": { "kind": "builtin", "index": 3 },
    "gradientId": "bi-ember-dawn"
  },

  "animation": "flow",
  "animSpeed": 1.0,
  "flowAngle": 30,

  "effects": {
    "special": "none",
    "blur": 0, "glow": 0, "glowRadius": 14,
    "shadow": 0, "shadowSoft": 14, "shadowOff": 8,
    "grain": 0, "vignette": 0, "vignetteMode": "dark",
    "shimmer": 0, "shimmerAngle": 30, "shimmerPhase": 0, "shimmerScale": 100,
    "sheen": 0, "sheenAngle": 30, "sheenPos": 50,
    "irid": 0, "iridScale": 100, "iridAngle": 0,
    "aberration": 0,
    "scan": 0, "scanGap": 4
  }
}
```

### 4.1 Geometry & tiling

| Field | Range / values | Default | Notes |
|---|---|---|---|
| `family` | see table below | `"hat"` | tiling family id |
| `variant` | family-specific | family default | |
| `tileSize` | 4–400 | 34 | tile pitch in pixels at export resolution |
| `rotation` | 0–345, step 15 | 0 | degrees |
| `panX`, `panY` | −4000–4000 | 0 | offsets in pixels |
| `gap` | 0–0.4 | 0.02 | shrink between tiles as a fraction (0 = none); ignored by `lines` |
| `outlineWidth` | 0–20 | 1.2 | border width in pixels; 0 = no borders; ignored by `lines` |
| `seed` | 1–99999 | 7 | random arrangement seed |

**Families** (`family` → `variant` ids, `*` = default):

| family | variants |
|---|---|
| `hat` | `H*`, `P`, `F` (Einstein aperiodic monotile) |
| `lines` | `horizontal`, `vertical`, `diagonal*`, `crosshatch`, `grid` |
| `triangles` | `equilateral*`, `right` |
| `squares` | `grid*`, `diamond`, `checker` |
| `rectangles` | `grid`, `brick*`, `herringbone`, `basketweave` |
| `rhombi` | `60*`, `45`, `30` |
| `parallelograms` | `30r*`, `45r`, `30l` |
| `hexagons` | `flat*`, `pointy` |
| `trapezoids` | `flat`, `standard*`, `steep` |
| `kites` | `slim`, `classic*`, `wide` |
| `trihexagonal` | `classic*`, `rotated` |
| `octagons` | `classic*` (octagon–square) |
| `cairo` | `classic*` (Cairo pentagons) |
| `penrose` | `standard*`, `golden` (Penrose rhombs) |

### 4.2 Fill vs border — independent color & transparency

The user asked for independent control of tile **fill** and tile **border**:

| Field | Range | Default | Controls |
|---|---|---|---|
| `fillAlpha` | 0–100 | 100 | transparency of the tile **fill** (100 = opaque) |
| `lineAlpha` | 0–100 | 100 | transparency of the tile **border/stroke** (for `lines` family: the line itself) |
| `lineAuto` | bool | `true` | border color chosen automatically (palette outline color, or derived from the background) |
| `lineColor` | `#rrggbb` | `#101014` | manual border color, used when `lineAuto` is `false` |

Fill **colors** come from the color theme (§4.3). Useful recipes:

- wireframe look: `fillAlpha: 0`, `outlineWidth: 1.5`
- ghost overlay layer: `fillAlpha: 30`, `lineAlpha: 10`, plus layer `opacity`
- borders only on dark fills: `lineAuto: false`, `lineColor: "#f4f1ea"`

These alphas are applied **per tile** when painting; the layer's `opacity`
is applied afterwards to the entire rendered layer (fills, borders, glow,
shadow alike) — stack them deliberately.

### 4.3 Color theme (`theme`)

| Field | Values |
|---|---|
| `mode` | `single` \| `palette` \| `gradient` \| `duotone` |
| `singleColor` | `#rrggbb` — used by `single` |
| `paletteRef` | `{ "kind": "builtin", "index": 0–25 }` or `{ "kind": "custom", "id": "p-..." }` — used by `palette` |
| `gradientId` | built-in: `bi-ember-dawn`, `bi-abyss`, `bi-aurora`, `bi-solar`, `bi-iris`, `bi-porcelain`, or a custom id — used by `gradient` |
| `gradBands` | 2–12 — band count for the `bands` arrangement |
| `duoA`, `duoB` | `#rrggbb` — the two colors of `duotone` |
| `colorMap` | palette-mode **arrangement** (below) |
| `gradMap` | gradient-mode arrangement: `sweep`, `bands`, `random` |
| `duoMap` | duotone-mode arrangement: `checker`, `sweep`, `random` |

**Palette-mode arrangements** (`colorMap`): `supertile`, `orientation`,
`mirror`, `checker`, `random` on the `hat` family; `kind`, `orientation`,
`checker`, `random` on polygon families; `orientation`, `random` on `lines`.
Arrangements that would be mathematically constant on a family (e.g. `kind`
on hexagons, which have a single tile kind) are repaired to `checker` on
load, so a wallpaper can never collapse into one flat color.

**Built-in palettes** (`paletteRef.kind = "builtin"`, by index):
0 Midnight · 1 Nord · 2 Deep Space · 3 Aurora · 4 Ocean · 5 Forest ·
6 Sunset · 7 Ember · 8 Terracotta · 9 Coffee · 10 Berry · 11 Candy ·
12 Neon Nights · 13 Cyberpunk · 14 Retro Arcade · 15 Mono · 16 Ink & Paper ·
17 Sakura · 18 Lavender · 19 Mint · 20 Sandstone · 21 Coral Reef ·
22 Citrus · 23 Slate & Amber · 24 Duotone · 25 Moss & Stone

### 4.4 Animation

| Field | Values | Notes |
|---|---|---|
| `animation` | `none` \| `shimmer` \| `flow` \| `glowwave` | per layer, independent |
| `animSpeed` | 0.2–3 | speed multiplier |
| `flowAngle` | 0–345 step 15 | direction for `flow` / `glowwave` |

All visible layers animate together on a shared timeline; animated exports
(PNG via APNG and GIF) align every layer onto one seamless loop.

### 4.5 Effects (per layer)

All fields optional; `0` = off. `blur`, `glowRadius`, `shadowSoft`,
`shadowOff` are **pixels**; `glow`, `shadow`, `grain`, `vignette` are
**0–100 percent**; `vignetteMode` is `dark` | `light`.

Special effects — exactly **ONE** effect runs per layer, selected by
`special` (the UI shows it as a dropdown and only exposes that effect's
settings); they render identically in the live preview, PNG and every
animated export. Legacy blobs without `special` infer the active mode from
the first non-zero amount. Switching modes in the UI zeroes the other
amounts and seeds a visible strength; strength `0` = off.

| Field | Range | Default | What it does |
|---|---|---|---|
| `special` | `none` \| `shimmer` \| `sheen` \| `irid` \| `aberration` \| `scan` | `none` | the one active special effect |
| `shimmer` | 0–100 (%) | 0 | frozen frame of the Shimmer animation, cell-based like the animator: a quantized wave over tile centers picks one of 9 shade variants of each tile's own color (Renderer.frozenShimmer, painted in the scene canvas — not a raster pass); strength 50 = the animation's ±0.25 amplitude |
| `shimmerAngle` | 0–345 step 15 | 30 | wave travel direction |
| `shimmerPhase` | 0–100 | 0 | shifts the wave along its direction (data-model only — not shown in the simplified UI) |
| `shimmerScale` | 20–400 (%) | 100 | wavelength multiplier (100 = the animation's rhythm, |(0.9,1.4)| rad/px) |
| `sheen` | 0–100 (%) | 0 | ONE soft band of light across the layer (frozen light sweep) |
| `sheenAngle` | 0–345 step 15 | 30 | sweep axis |
| `sheenPos` | 0–100 | 50 | band position across the layer |
| `irid` | 0–100 (%) | 0 | iridescent rainbow sheen (holographic tint) |
| `iridAngle` | 0–345 step 15 | 0 | rainbow axis |
| `iridScale` | 20–400 (%) | 100 | rainbow cycle density |
| `aberration` | 0–20 (px) | 0 | chromatic aberration — red/blue channel split along a fixed 20° axis |
| `scan` | 0–100 (%) | 0 | CRT scanlines strength |
| `scanGap` | 2–24 (px) | 4 | distance between scanlines |

---

## 5. Custom libraries (optional, full-file shape only)

`libraries` lets a project travel with its own assets:

```json
"libraries": {
  "palettes": [
    { "id": "p-agent-sun", "name": "Agent Sun", "colors": ["#ffd9a0", "#f4854e", "#b13a5e"],
      "bg": "#140a06", "outline": null }
  ],
  "gradients": [
    { "id": "g-agent-mint", "name": "Agent Mint", "type": "linear", "angle": 45,
      "stops": [{ "pos": 0, "color": "#eef7f2" }, { "pos": 1, "color": "#1fa886" }] }
  ],
  "extras": { "single": ["#5bc8ff"], "duo": [{ "a": "#5bc8ff", "b": "#f4777f" }] }
}
```

- `palettes.colors`: 1–64 hex colors; `bg` is the suggested background color;
  `outline: null` = automatic border color.
- Referenced ids must match: `paletteRef = { "kind": "custom", "id": "p-agent-sun" }`.
- Import merges with existing customs (same id = overwrite) and persists in
  the browser.
- `id` fields: keep them unique, prefix with `p-` / `g-` by convention.

---

## 6. Worked examples

### 6.1 Minimal — one pattern layer over a solid background

```json
{
  "resW": 1920, "resH": 1080,
  "layers": [
    { "type": "background", "bg": { "source": "solid", "color": "#071018" } },
    { "type": "pattern", "family": "hat", "variant": "H",
      "theme": { "mode": "palette", "paletteRef": { "kind": "builtin", "index": 3 } } }
  ]
}
```

### 6.2 Full — gradient background + two pattern layers with independent alpha

```json
{
  "name": "Aurora study",
  "aspect": "16:9", "orientation": "landscape", "resW": 2560, "resH": 1440,
  "layers": [
    {
      "type": "background",
      "bg": {
        "source": "gradient",
        "gradient": { "type": "linear", "angle": 120, "stops": [
          { "pos": 0, "color": "#05060e" }, { "pos": 1, "color": "#232b52" } ] }
      }
    },
    {
      "type": "pattern", "name": "Hats", "family": "hat", "variant": "H",
      "tileSize": 42, "seed": 42, "fillAlpha": 100, "lineAlpha": 60,
      "theme": { "mode": "gradient", "gradientId": "bi-ember-dawn", "gradMap": "sweep" },
      "animation": "flow", "flowAngle": 45, "animSpeed": 1.2,
      "effects": { "glow": 25, "glowRadius": 20 }
    },
    {
      "type": "pattern", "name": "Wire overlay", "family": "hexagons", "variant": "pointy",
      "tileSize": 64, "rotation": 15, "fillAlpha": 0, "outlineWidth": 1.4,
      "lineAuto": false, "lineColor": "#9d7bea",
      "theme": { "mode": "single", "singleColor": "#9d7bea" },
      "animation": "none", "opacity": 70
    }
  ]
}
```

### 6.3 Transparent wallpaper (for PNG / APNG with alpha)

```json
{
  "resW": 2160, "resH": 3840,
  "layers": [
    { "type": "background", "visible": false },
    { "type": "pattern", "family": "penrose", "variant": "golden", "tileSize": 80,
      "fillAlpha": 85, "theme": { "mode": "duotone", "duoA": "#ffffff", "duoB": "#8f7bff" } }
  ]
}
```

GIF cannot store partial alpha — exporting a transparent project to GIF
flattens it onto black. PNG and APNG keep true RGBA transparency.

---

## 7. Validation rules (what happens to bad input)

- Unknown values fall back to defaults; numbers are clamped into range.
- Colors must be `#rgb`/`#rrggbb` strings (3/4-digit forms are expanded,
  alpha bytes are dropped). The project `name` is trimmed, capped at 60
  characters, and falls back to `"Untitled wallpaper"` when missing/blank.
- Duplicate/missing layer ids are regenerated; exactly one background layer
  is kept and forced to the bottom; pattern layers beyond 8 are dropped.
- Gradients need ≥ 2 stops (auto-padded), stops are sorted by `pos`.
- A project file that parses as JSON but contains no project data reports
  `load failed: no project data found in file` in the status bar.

## 8. Output formats

All five formats are offered by the toolbar **Export** menu (the button right
after **Save**); PNG / GIF / APNG start immediately, while SVG and PSD open an
options dialog (scope, appearance preset, background handling) with a live
preview.

| Format | Transparency | Animation | Notes |
|---|---|---|---|
| PNG | full RGBA | no | exact `resW × resH`, whole composition |
| APNG | full RGBA | seamless loop | lossless truecolor, per-frame zlib |
| GIF | binary (flattened onto black when transparent) | seamless loop | 256 colors + dithering, whole composition |
| SVG | full RGBA | no (static frame at t=0) | genuine editable vectors: one `<path>` per tile, per-layer `<g>` groups with names/visibility/opacity, native background gradient; appearance presets (outlines-only, monochrome, silhouette, grayscale, custom); effects that SVG cannot express are rasterized per layer or omitted per the fidelity setting |
| PSD | full RGBA | no (static frame at t=0) | layered Photoshop document via the vendored ag-psd library (MIT, bundled in `js/vendor/`): one editable raster layer per Tessellate layer incl. Background, names/order/visibility/opacity preserved, RLE-compressed, merged composite preview |

Exports always render the **entire layer stack** (SVG/PSD also offer a
"selected layer only" scope in their dialog) at the exact canvas resolution,
matching the live preview. The SVG/PSD appearance presets re-color the export
only — the project JSON, its layers and its palettes are never modified, so
agent-generated projects can be exported repeatedly with different treatments.
