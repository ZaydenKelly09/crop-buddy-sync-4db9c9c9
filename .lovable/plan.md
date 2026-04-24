## Dual Crop Tool

A single-page tool for cropping two independent regions out of one image simultaneously — ideal for things like splitting a 4K image into a 1440p landscape wallpaper and a 1920×1080 vertical wallpaper.

### Flow

1. **Load an image** — drag & drop, file picker, or paste from clipboard (Ctrl/Cmd+V).
2. **Workspace appears** with the image displayed at fit-to-screen scale, and two draggable/resizable crop rectangles overlaid on top — labeled "Crop A" (blue) and "Crop B" (orange).
3. **Adjust each crop independently** by dragging the box, dragging its corner/edge handles, or typing exact pixel values in the side panel.
4. **Preview thumbnails** of both crops update live in the side panel.
5. **Export** — download Crop A, Crop B, or both as a ZIP.

### Crop controls (per crop, A and B)

- Drag to move, 8 handles to resize.
- Numeric inputs: X, Y, Width, Height (in original-image pixels, not display pixels).
- **Aspect ratio dropdown**: Free, 1:1, 4:5, 5:4, 16:9, 9:16, 4:3, 3:4, 21:9, **Custom** (two number inputs).
- Quick "Set to 1920×1080" / "Set to 2560×1440" preset buttons (common wallpaper sizes) since that's a primary use case.
- Lock toggle to prevent accidental movement once dialed in.
- Color-coded outline + label so the two crops are always distinguishable on the canvas.

### Canvas behavior

- Image is rendered on an HTML canvas, scaled to fit the viewport with zoom/pan (mouse wheel to zoom, space+drag to pan, "Fit" button to reset).
- Crop overlays are drawn on top with semi-transparent fill outside the crops (standard cropper dimming).
- Snapping: optional snap-to-edges and snap-to-other-crop-edge so the user can align them precisely if desired.
- Keyboard: arrow keys nudge the selected crop by 1px (Shift+arrow = 10px).

### Export

- "Download A", "Download B", and "Download both (.zip)" buttons.
- Output format selector: PNG (default) or JPEG with quality slider.
- Filenames default to `{originalname}_A_{w}x{h}.png` and `{originalname}_B_{w}x{h}.png`.
- Crops are extracted at full original resolution (not the display-scaled version) so quality is preserved.

### Layout

```text
┌──────────────────────────────────────────────┬──────────────────┐
│                                              │  Crop A  [blue]  │
│                                              │  X □  Y □        │
│         IMAGE WITH TWO CROP OVERLAYS         │  W □  H □        │
│         (zoom / pan / drag / resize)         │  Ratio ▾         │
│                                              │  [preview thumb] │
│                                              │──────────────────│
│                                              │  Crop B [orange] │
│                                              │  ...same...      │
│                                              │──────────────────│
│                                              │  Download A      │
│                                              │  Download B      │
│                                              │  Download ZIP    │
└──────────────────────────────────────────────┴──────────────────┘
```

Header shows image filename + dimensions and a "Load new image" button.

### Technical notes

- Single route `src/routes/index.tsx` replacing the placeholder. All client-side; no backend needed.
- Image loaded via `URL.createObjectURL` into an `HTMLImageElement`, drawn to a `<canvas>` with `requestAnimationFrame` redraw on state change.
- Crop state stored in original-image pixel coordinates; display transform handles zoom/pan.
- Export uses an offscreen canvas sized to the crop's pixel dimensions, drawing the source image with the crop region — guarantees full-resolution output.
- ZIP packaging via `jszip` (added as a dependency).
- shadcn `Button`, `Input`, `Select`, `Slider`, `Separator`, `Card` for the side panel UI.
