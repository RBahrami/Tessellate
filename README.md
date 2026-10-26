# Tessellate — Geometric Wallpaper Studio 🎩

![README views](https://hits.sh/github.com/RBahrami/Tessellate.svg?style=flat-square)

**Tessellate** (formerly "Einstein Wallpaper" / "Geometric Wallpaper Studio" — the
repository is `RBahrami/Tessellate`) generates wallpapers from the
**Einstein tile** (the aperiodic "hat" monotile discovered in 2023 by David Smith,
Joseph Samuel Myers, C. S. Kaplan and Chaim Goodman-Strauss) — **plus 13 more
mathematically verified tiling families** — and composes them in a **multi-layer
compositor**: stack up to 8 pattern layers over a permanent background layer, each
with its own tiling, color theme, effects and animation. Every image can be exported
as a full-resolution **PNG**, a **looping animated GIF**, a **lossless APNG**
(pixel-perfect animated PNG), a genuine **editable SVG** (vector paths for
Illustrator / Inkscape / CorelDRAW), or a **layered PSD** (one editable raster
layer per Tessellate layer for Photoshop / Photopea / Krita / GIMP) — all
encoded entirely in the browser and playable
anywhere with no extra software, plugins or codecs.

![Tessellate — desktop](docs/img/hero.png)

| Export menu (toolbar, after Save) | Mobile layout |
|---|---|
| ![Export menu](docs/img/export-menu.png) | ![Mobile](docs/img/mobile.png) |

## Features

### Tiling families (14)
| Family | Variants | Notes |
|--------|----------|-------|
| **Einstein hat** | A / B / C (H, P, F roots) | True aperiodic monotile via the metatile substitution construction from *An Aperiodic Monotile* (arXiv:2303.10798). Unchanged since v1. |
| **Lines** | horizontal, vertical, diagonal 45°, crosshatch, grid | Line-based patterns (strokes, not fake tiles) |
| **Triangles** | equilateral grid, right-triangle grid | Edge-to-edge, alternating rows |
| **Squares** | aligned grid, diamond (45°), checkerboard | |
| **Rectangles** | aligned 2:1 grid, running bond, herringbone 90°, basketweave | Herringbone lattice is verified overlap-free |
| **Rhombi** | 60°/45°/30° acute angles | Affine image of the square grid |
| **Parallelograms** | slant 30° right, 45° right, 30° left | Sheared grid |
| **Hexagons** | flat-top, pointy-top honeycomb | Regular, edge-to-edge |
| **Trapezoids** | flat / standard / steep | Half-turn tessellation of a generic quadrilateral |
| **Kites** | slim / classic / wide | Half-turn tessellation |
| **Trihexagonal** | kagome, rotated 30° | Rectified honeycomb: hexagons + triangles |
| **Octagon–square** | truncated square tiling | Regular octagons + 45° squares |
| **Cairo pentagons** | dual of the snub square tiling | The classic Cairo mosaic pentagon (three 120°s + two 90°s) |
| **Penrose rhombs** | P3 standard, P3 golden shifts | Dual of a de Bruijn pentagrid; matching rules hold by construction; fat:thin → φ |

Every family's geometry is verified by `tests/verify-tilings.js` (no overlaps, no
holes, correct edge lengths, Penrose fat:thin ratio → φ, Cairo pentagon shape, etc.).

### Layers — compose patterns over a background

The studio is a **layer compositor**. The **Layers panel** manages the stack:

- A dedicated **Background layer** always sits at the bottom of the stack — it
  cannot be deleted, duplicated or reordered, and it holds the wallpaper fill:
  a **solid color or a fully editable gradient** (type: linear / radial / conic,
  angle, and an unlimited stop list with color + position + live preview;
  gradient templates seed the editor and can be customized afterwards).
  Recoloring a pattern layer never silently moves the background.
- Up to **8 Pattern layers**, each with a full, independent configuration:
  tiling family + variant, tile scale, rotation, gap, color theme mode
  (Single / Palette / Gradient / Duotone with arrangements, templates and
  editors), visual effects, animation (effect, speed, direction) and seed.
- **Independent fill & border paint per layer:** tile **fill transparency**
  (`fillAlpha`) and tile **border transparency** (`lineAlpha`) are separate
  sliders, on top of the border color (automatic or manual) — wireframe, ghost
  and outline-only looks are one slider away. For the Lines family the fill
  slider is hidden and the border slider drives the line itself.
- Add, **duplicate** (copies every setting, assigns a fresh ID), rename,
  delete and **reorder** pattern layers; toggle each layer's visibility and
  adjust its **opacity 0–100%**.
- **Randomize layer** (Layers panel, or the <kbd>R</kbd> key) re-rolls every
  setting of the selected layer — it never touches any other layer. The 🎲
  dice in each section header randomizes just that section (tiling, colors
  within the current theme mode, effects, animation, or the background
  fill), so you can explore variations without losing the rest of the design.
- Selecting a layer points the existing Tiling / Color theme / Visual effects /
  Animation sections at it — there is one set of controls, not one per layer.
  Switching selection never mixes configurations between layers.

**Compositing:** every visible layer renders into its own surface, gets its own
post-processing (blur/glow/shadow/grain/vignette), then is stacked in order with
its opacity onto the shared output — tile fills, outlines, shadows and glow fade
together. The preview and all three export formats render the identical
composition. **PNG and APNG keep true RGBA transparency** whenever the
Background layer is hidden or faded below 100%; **GIF has no partial alpha**, so
transparent projects are flattened onto black.

**Independent animations:** each pattern layer runs its own animation on a
shared timeline (one layer can use Gradient Flow while another stays static).
Animated exports align every layer onto **one seamless loop**: the slowest
animation defines the loop, faster layers complete an integer number of cycles
(visual speed unchanged), and impractically long combinations are uniformly
time-compressed (the status bar notes it).

### Color — one unified Color theme section

A single **Color theme** panel with four modes. Each mode owns its dedicated
settings — arrangement, template library and an inline editor — and only the
active mode's panel is shown. Every control applies to the wallpaper in
real time, and every mode ships with templates you can customize further and
save/load as your own:

| Mode | Dedicated settings |
|------|--------------------|
| **Single** | tile color picker + a template row of curated solid colors (save/delete your own) |
| **Palette** | arrangement (how colors spread across tiles), the 26 built-in palettes as templates, inline color editor (add/remove/reorder, hex input), per-palette background + outline, save/duplicate/delete custom palettes |
| **Gradient** | arrangement (continuous **Sweep**, quantized **Bands** with band count, or **Random mix**), gradient templates, inline editor (linear/radial/conic, angle, multi-stop color/position), save/delete custom gradients |
| **Duotone** | arrangement (checkerboard / sweep / random), colors A + B, curated pair templates (save/delete your own) |

Shared across modes: outline auto/manual color and JSON theme export/import
(palettes + gradients + single/duotone templates). The wallpaper background
and the foreground opacity live on the **Layers** panel now (Background layer
fill + per-layer opacity) — see *Layers* above.

The **arrangement** is family-aware: the hat offers Supertiles (patches), By
orientation, Mirror split, Checkerboard and Random mix; periodic families
offer By tile kind / By orientation (hidden on families where every tile has
the same kind or orientation — those would render one flat color),
Checkerboard and Random mix. Sweep and Bands are normalized against the
actual tile positions, so they stay full-range gradients at every rotation
angle.

- **26 curated built-in palettes** — from Midnight and Nord to Cyberpunk and
  Sakura, light and dark.
- **Template-driven editing** — pick a template, tweak anything (colors,
  stops, angle, background, outline) with live feedback, then keep it as a
  custom template; custom palettes/gradients/single colors/duotone pairs all
  persist in the browser.
- Every color change re-colors the live preview instantly (no scene rebuild).

### Visual effects
Blur, Glow (intensity + radius), Shadow/depth (strength + softness + offset),
film Grain, and Vignette (darken or lighten edges). All default to neutral/off,
all are applied identically to the live preview and to every export format, and
all work with every tiling family.

**Special effects** — one effect per layer, picked from a dropdown (None,
Shimmer, Sheen, Iridescence, Chromatic aberration, Scanlines); only the
selected effect's settings are shown. Same export guarantees:
- **Shimmer (frozen tile shades)** — the Shimmer animation frozen in place,
  using the very same cell-based model: a quantized wave over the tile
  centers picks one of nine shade variants of each tile's own color
  (strength + direction + wavelength; strength 50 matches the animation's
  amplitude). Rendered in the scene paint, so it reads clearly on dark,
  light and mid backgrounds alike,
- **Sheen (light sweep)** — one soft band of light across the layer
  (strength + direction + position),
- **Iridescence** — a holographic rainbow sheen (strength + spread +
  direction),
- **Chromatic aberration** — red/blue channel split for a lens look,
- **Scanlines** — CRT-style dark scanlines (strength + spacing).

### Animation (per layer)
- **None** (static — no frames rendered),
- **Shimmer** (soft light wave over the tiles),
- **Gradient Flow** (a repeating band of palette/gradient colors drifts across the
  pattern; direction + speed configurable, seamlessly looping),
- **Glow Wave** (a restrained band of brightness sweeps the canvas; seamless loop).

The removed v1 animations (Cascade, Drift, Hue cycle, Pulse) are gone.

### Canvas & export
- Aspect presets 16:9, 16:10, 4:3, 5:4, 3:2, 21:9, 32:9, 1:1 and phone portraits
  (9:16, 9:19.5, 9:20) with standard resolutions from 720p to 4K+, plus custom
  sizes up to 8192 px — set from the **Canvas** popover in the toolbar. Canvas
  size/aspect/resolution are the only global settings — every layer renders
  into the same output coordinate space.
- Per layer: tile scale, rotation, tile gap, outline width/color, seeded
  randomization.
- The **Export** button in the toolbar (right after **Save**) opens a menu that
  asks about the format — PNG / GIF / APNG start immediately, while **SVG and
  PSD open an export-options dialog** (scope, appearance preset, background
  handling, hidden layers, and for SVG the effect-fidelity mode) with a live
  preview; the menu also carries a *Set as a live wallpaper* note with
  per-platform instructions.
  **All exports render the complete layer stack at the exact canvas resolution
  you chose** — animated exports rebuild every layer at that resolution (1:1,
  same geometry math as the preview) and capture exactly one seamless combined
  animation loop (see *Layers* above for the multi-animation alignment).
- **PNG** — full-resolution still of the composition, lossless, RGBA alpha
  preserved when the Background layer is hidden/faded.
- **GIF (looping)** — encoded entirely in the browser from the GIF89a spec:
  one global 256-color palette (median-cut across sample frames, so no palette
  flicker) with Floyd–Steinberg error-diffusion dithering, hand-written LZW,
  NETSCAPE2.0 infinite-loop extension. Plays on literally anything. GIF cannot
  carry partial alpha — transparent projects are flattened onto black.
- **APNG (lossless)** — animated PNG written from the PNG/APNG spec: truecolor
  RGBA with adaptive per-row PNG filtering (None/Sub/Up/Average/Paeth) and
  DEFLATE (native CompressionStream, with a hand-written zlib stored-blocks
  fallback). **Pixel-perfect**: decoded frames match the rendered canvas
  exactly — verified byte-for-byte in QA, alpha channel included. Plays in all
  modern browsers, macOS previews, Telegram/Discord, and most image viewers.
- **SVG (editable vectors)** — genuine vector export: every tile becomes an
  editable SVG `<path>` (line patterns become stroked `<path>` strokes, never
  filled polygons), grouped per layer with layer names, order, visibility and
  opacity preserved; the background exports as a solid fill or a native SVG
  gradient. Correct `viewBox`/dimensions, 2-decimal precision, XML-escaped
  names. For editing in Illustrator, Inkscape, CorelDRAW, Affinity and any
  vector tool. Static frame at time zero — animations are not serialized.
  Blur / glow / drop-shadow become native SVG filters; effects SVG cannot
  reproduce faithfully (grain, sheen, iridescence, chromatic aberration,
  scanlines, conic gradients) are **rasterized per affected layer only**
  (fidelity mode) or omitted (editability mode) — the dialog warns and the
  file's `<desc>` states exactly what happened. Never a canvas screenshot.
- **PSD (layered Photoshop document)** — written with the vendored ag-psd
  library (MIT, bundled locally — no CDN, works offline): one independently
  editable raster layer per Tessellate layer including the Background layer,
  with layer names, stacking order, visibility and opacity preserved as
  editable Photoshop properties, RLE-compressed channel data and a merged
  composite preview. Static frame at time zero. Opens in Photoshop, Photopea,
  Krita and GIMP.
- **Export treatments (SVG & PSD)** — seven appearance presets shared by both
  formats: Full Color, Outlines Only, Monochrome Outlines, Fills Only,
  Monochrome Silhouette, Grayscale (luminance-based) and a Custom Treatment
  with independent fill / outline / background choices. Treatments are applied
  to the export only — the project, its layers, palettes and gradients are
  never modified — and the last-used options are remembered separately for SVG
  and PSD.
- Tile budgets keep previews responsive; oversized requests are coarsened
  automatically with a status note.

### Persistence & project files
The whole **project** — global canvas settings plus every layer's order,
visibility, opacity, selection and configuration — persists in `localStorage`
(`einstein-wallpaper-v2`) with defensive validation (missing/corrupt layers are
repaired, the background layer is re-pinned to the bottom, IDs are kept
unique). A legacy `einstein-wallpaper-v1` save is **migrated automatically**:
background settings become the Background layer, `fgAlpha` becomes the pattern
layer's opacity, and palettes/gradients/templates are kept intact. Custom
palettes live in `ew-custom-palettes-v1`, gradients in `ew-gradients-v1`,
single-color templates in `ew-single-templates-v1` and duotone pairs in
`ew-duo-templates-v1` — all with stable IDs and defensive parsing.
**Reset** restores the whole default project.

### Toolbar, undo/redo
A single **top toolbar** (PC) carries everything project-level — the **Tessellate
logo + wordmark**, then the project name & save state, New, Random, Undo/Redo,
Canvas, Save/Load, **Export**, Share, Fullscreen and About; the sidebar below it
keeps only the per-layer editing sections (Layers, Tiling, Color theme,
Background layer, Visual effects, Animation):

- **Project name** — free-form (≤ 60 chars), shown in the toolbar, stored in the
  project and used for downloaded filenames (project JSON and exports).
- **New** — starts a fresh background-only project (the Background layer
  alone; pattern sections hide until a pattern layer is added). Background-only
  projects are first-class: they save, load, export and share like any other.
- **Random** — one click, one wallpaper: a fresh randomized pattern layer over
  a randomized background. Canvas size and project name are kept, and the
  whole change is a single undo step.
- **Save indicator** — `✓ saved HH:MM` once the autosave has caught up, and a
  `● unsaved draft` warning while a live palette/gradient edit is only a
  runtime draft (save it as a custom template to keep it). Saving a project
  file flashes `✓ exported`.
- **Undo / Redo** — snapshot-based (`js/history.js`): every committed change is
  undoable with **Ctrl+Z / Ctrl+Y** (or ⌘Z / ⌘Shift+Z / Ctrl+Y), including
  layer add/duplicate/delete/reorder, tiling, colors, effects, animation,
  background fill, randomizers, project reset and project load. Rapid edits
  to the same control (a full slider drag, a color-picker sweep) coalesce into
  ONE undo step; up to 60 steps are kept; a new edit after an undo discards
  the redo tail. Unsaved palette/gradient drafts are snapshot too, so even
  those are undoable. Buttons show tooltips naming the next undo/redo step.
- **Export** — opens the format menu (PNG / GIF / APNG / SVG / PSD) described
  above; SVG and PSD continue into the export-options dialog.
- **Share** — hands the wallpaper to the operating system's share sheet
  (`navigator.share`): a **PNG** while nothing animates, a seamless **GIF**
  otherwise — with a graceful fallback to a normal download on browsers or
  contexts (e.g. `file://`) without Web Share file support.
- **Canvas** — popover with aspect ratio, orientation and resolution presets.
- **About** — modal with credits + project reset; **Fullscreen** shows the raw
  wallpaper edge to edge.

**Project file (save/load as JSON):** *Save* in the toolbar downloads
the entire project — all layers plus every custom palette, gradient and
template — as one self-contained JSON file; *Load* restores it on any
machine. Agents can **generate wallpapers by writing that JSON** themselves:
[docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) documents every field, all built-in
palette/gradient references, and includes ready-to-adapt examples (minimal,
multi-layer, transparent). On phones (≤ 760 px) the toolbar turns
icon-only, the canvas moves above the controls, every section starts
collapsed, and a shortcut-chip row opens + scrolls to a section.
The loader accepts the full wrapper, a bare project
object, and legacy v1 settings.

## Examples

Three minimal one-layer starter projects live in
[`examples/`](examples/) — each is a single pattern layer over a background,
saved as a bare JSON project object together with a full-resolution PNG
rendered by the app's own exporter. Load a `.json` with **Load** in the
toolbar and make it yours, or use them as templates for agent-generated
wallpapers.

| Project | Render |
|---|---|
| [hat-aurora.json](examples/hat-aurora.json) — the Einstein hat, Palette mode (Aurora), supertile arrangement over a solid midnight background | ![Hat Aurora](examples/hat-aurora.png) |
| [hexagons-mint.json](examples/hexagons-mint.json) — flat honeycomb with the built-in Aurora gradient sweeping across, on a linear gradient background | ![Mint honeycombs](examples/hexagons-mint.png) |
| [penrose-ember.json](examples/penrose-ember.json) — Penrose rhombs (golden) in a duotone checker arrangement over a radial ember glow | ![Ember Penrose](examples/penrose-ember.png) |

## Quick start

Option A — GitHub Pages (recommended):

1. Repo → *Settings* → *Pages* → deploy from branch `main`, folder `/ (root)`.
2. Open `https://rbahrami.github.io/Tessellate/`.

Option B — locally: just open `index.html` in any modern browser (double-click it).
No build step, no server, no dependencies.

### Generate a wallpaper

1. Pick a **tiling family** and **pattern variant** (or add more **layers** to
   combine several patterns over the background).
2. Open **Color theme** and pick a mode — Single, Palette, Gradient or Duotone —
   only that mode's options are shown.
3. Optionally add visual effects and an animation — both belong to the selected
   layer.
4. Open the **Export** menu in the toolbar (after Save) and pick **PNG** for a
   still, or **GIF** / **APNG** for a live wallpaper at the chosen canvas
   resolution — exports always render the entire layer stack.

### Live wallpapers

| Platform | How |
|----------|-----|
| **Windows** | [Lively Wallpaper](https://www.rocksdanister.com/lively) (free, open source): *Add Wallpaper* → paste this page's URL to run the interactive web version, or drag in the exported GIF/APNG as a video wallpaper. Wallpaper Engine also works. |
| **Android** | Set the exported GIF/APNG with any “video live wallpaper” app, or use Wallpaper Engine. |
| **macOS** | APNG animates right in Finder/Preview; animated wallpaper tools accept GIF/APNG directly. |
| **Any OS** | Set the page as your browser's startup/new-tab page. |

## Project layout

```
index.html            UI (top toolbar + sidebar sections + live preview canvas)
css/style.css         dark minimal theme
js/hat-tiling.js      Einstein hat metatile engine (browser & Node, unchanged)
js/layers.js          layer model: project schema, v1→v2 migration, validation,
                      stack operations, multi-animation export loop planning
js/tilings.js         13 periodic/composite tiling generators + family metadata + icons
js/render.js          scene building, coloring/LUT, drawing, animations
js/palettes.js        built-in palette library + color helpers
js/gradients.js       multi-stop gradient engine + persistence
js/custom-palettes.js custom palette store + theme import/export
js/effects.js         post-processing pipeline (blur/glow/shadow/grain/vignette)
                      + special effects (shimmer/sheen/iridescence/aberration/scanlines)
                      incl. the per-layer composeLayer pass
js/gif.js             dependency-free animated GIF89a encoder (median-cut
                      palette, Floyd-Steinberg dithering, LZW, loop extension)
js/apng.js            dependency-free lossless APNG encoder (CRC32 chunks,
                      adaptive PNG filtering, DEFLATE + stored fallback)
js/history.js         undo/redo history (snapshot-based, same-control
                      coalescing, 60-step limit)
js/infotips.js        hover info tips: the small (i) icons in section headers
                      show each section's help in a shared floating bubble
js/app.js             UI wiring, layer compositor, caches, exports, persistence,
                      project-file save/load (JSON), undo/redo integration
examples/             minimal one-layer starter projects (JSON + rendered PNG)
tests/                geometry + unit verification (see below)
docs/AGENT_GUIDE.md   JSON project-format reference for agents: generate a
                      wallpaper by writing the project JSON and loading it
docs/img/             screenshots used by this README
```

## Verification

```bash
# geometry: every family/variant must tile without overlaps or holes,
# with per-family invariants (edge lengths, Penrose phi ratio, Cairo pentagons...)
bun tests/verify-tilings.js        # or: node tests/verify-tilings.js

# gradient engine unit tests (interpolation, clamping, validation, CRUD)
bun tests/test-gradients.js

# custom palette store tests (CRUD, import/export validation, migration)
bun tests/test-palettes.js

# GIF encoder tests (structure walk + LZW round-trip via an independent decoder)
bun tests/test-gif.js

# APNG encoder tests (chunk/CRC walk, filter round-trip, lossless verification)
bun tests/test-apng.js

# color theme system tests (map modes, LUT builders, duotone, bands)
bun tests/test-theme.js

# layer model tests (factories, background protection, duplication,
# reordering, v1 migration, sanitizer, owned background gradients,
# fill/line alpha, project name, export-loop planning)
bun tests/test-layers.js

# undo/redo history tests (push/undo/redo, coalescing, redo-tail
# truncation, entry limit, deep-cloned snapshots)
bun tests/test-history.js
```

Additional Playwright-driven end-to-end QA suites run on the development
machine only (not part of the repo): they drive the real UI in headless
Chromium across the toolbar/export menu, layer system, undo/redo, special
effects, GIF/APNG exports and the mobile layout, and prove e.g. that the
APNG export is pixel-perfect by comparing the decoded file byte-for-byte
against an in-page reference render.

## Acknowledgment — AI-assisted development

This project was **implemented with the help of an AI coding assistant**:
[Z.ai](https://z.ai)'s **GLM** model, used through Z.ai's agentic coding
environment. The repository owner, **Reza Bahrami**, directed the work —
he specified every feature and its behavior in successive iterations,
requested the reworks and refinements, set the quality bar for the UI and
the export formats, and reviewed and accepted each step. The AI assistant
wrote the application code, the encoders, the test suites, the QA scripts
and the documentation under that direction. All design decisions, final
acceptance, and publication are the owner's.

## Disclaimers

- **No warranty.** This software is provided "as is", without warranty of any
  kind, express or implied — see the [MIT license](LICENSE). Use at your own
  risk; the author is not liable for any damages or data loss.
- **AI-generated code.** Substantial parts of this codebase were written by an
  AI model under human direction. It is heavily tested (geometry/unit suites
  plus end-to-end UI QA), but AI-assisted code can still contain defects.
  Review anything you rely on, and please report issues you find.
- **No affiliation or endorsement.** This project is an independent fan/creator
  work. It is not affiliated with, endorsed by, or sponsored by the discoverers
  of the hat tile, the University of Waterloo, Z.ai, Quanta Magazine, or the
  makers of Lively Wallpaper or Wallpaper Engine. All third-party names,
  products and trademarks belong to their respective owners and are referenced
  here descriptively only.
- **Privacy.** Tessellate itself is fully offline and static: no accounts, no
  network requests. Your projects live in your own browser's storage and in the
  files you save. The one exception is the published GitHub Pages copy, which
  loads a single anonymous, cookie-free analytics beacon (Cloudflare Web
  Analytics) so the author can see aggregate visit counts — no cookies, no
  personal data, no cross-site tracking. Local/offline use of the app (opening
  `index.html` directly) loads nothing at all. Additionally, this README embeds
  a public hit-counter badge (hits.sh) that tallies README views on GitHub — a
  visible counter, separate from the author's private analytics dashboard.
- **Third-party live-wallpaper tools.** The live-wallpaper how-to names
  external applications as a convenience; follow their own terms and review
  their permissions before installing anything.
- **Math & rendering.** Tiling constructions follow the published references
  below and are covered by automated geometry tests, but neither the author
  nor the AI assistant guarantees the output is free of mathematical or visual
  defects in every configuration.

## References & citations

1. D. Smith, J. S. Myers, C. S. Kaplan, C. Goodman-Strauss,
   **"An Aperiodic Monotile"**, arXiv:2303.10798 (2023),
   https://arxiv.org/abs/2303.10798 — published in *Combinatorial Theory*
   (2024). Project page: https://cs.uwaterloo.ca/~csk/hat/ — source of the
   metatile substitution construction behind the `hat` family.
2. D. Smith, J. S. Myers, C. S. Kaplan, C. Goodman-Strauss,
   **"A chiral aperiodic monotile"** (the Spectre tile), arXiv:2305.17767
   (2023), https://arxiv.org/abs/2305.17767 — related background for the
   aperiodic-monotile family of results.
3. C. S. Kaplan, **hatviz** — reference implementation of the hat substitution
   algorithm, https://github.com/isohedral/hatviz — consulted when porting the
   metatile rules in `js/hat-tiling.js`.
4. N. G. de Bruijn, **"Algebraic theory of Penrose's non-periodic tilings of
   the plane"**, Nederl. Akad. Wetensch. Indag. Math. 43 (1981) 39–66 — the
   pentagrid duality used by the `penrose` family.
5. B. Grünbaum, G. C. Shephard, **"Tilings and Patterns"**, W. H. Freeman
   (1987) — general reference for the periodic tiling families (honeycomb,
   kagome/trihexagonal, octagon–square, Cairo pentagons and friends).
6. W3C/microsoft, **"GIF89a Specification"**,
   https://www.w3.org/Graphics/GIF/spec-gif89a.txt — implemented from scratch
   in `js/gif.js`.
7. Mozilla, **"APNG Specification"**,
   https://wiki.mozilla.org/APNG_Specification — implemented from scratch in
   `js/apng.js`.
8. MDN Web Docs, **Web Share API** (navigator.share / canShare),
   https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API, and
   **Canvas API**, https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
   — rendering and sharing foundations.
9. S. Hartnett, **"Hobbyist Finds Math's Elusive 'Einstein' Tile"**,
   Quanta Magazine (March 2023),
   https://www.quantamagazine.org/hobbyist-finds-maths-elusive-einstein-tile-20230328/
   — inspiration and accessible coverage of the discovery.
10. R. Danister, **Lively Wallpaper**, https://www.rocksdanister.com/lively —
    third-party tool mentioned in the live-wallpaper how-to.

## License

MIT — Copyright © 2026 Reza Bahrami. See [LICENSE](LICENSE).
