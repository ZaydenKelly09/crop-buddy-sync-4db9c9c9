import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Upload, Download, Lock, Unlock, Maximize2, Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  component: DualCropTool,
});

type Crop = {
  x: number;
  y: number;
  w: number;
  h: number;
  ratio: string; // "free" | "1:1" | ... | "custom"
  customW: number;
  customH: number;
  locked: boolean;
};

type DragState =
  | null
  | {
      crop: "A" | "B";
      mode: "move" | "resize";
      handle?: string; // n,s,e,w,ne,nw,se,sw
      startMouseImg: { x: number; y: number };
      startCrop: Crop;
    }
  | { mode: "pan"; startMouse: { x: number; y: number }; startOffset: { x: number; y: number } };

const RATIO_PRESETS: { label: string; value: string }[] = [
  { label: "Free", value: "free" },
  { label: "1:1", value: "1:1" },
  { label: "4:5", value: "4:5" },
  { label: "5:4", value: "5:4" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "21:9", value: "21:9" },
  { label: "Custom", value: "custom" },
];

function parseRatio(c: Crop): number | null {
  if (c.ratio === "free") return null;
  if (c.ratio === "custom") {
    if (c.customW > 0 && c.customH > 0) return c.customW / c.customH;
    return null;
  }
  const [a, b] = c.ratio.split(":").map(Number);
  if (!a || !b) return null;
  return a / b;
}

function clampCrop(c: Crop, imgW: number, imgH: number): Crop {
  let { x, y, w, h } = c;
  w = Math.max(1, Math.min(w, imgW));
  h = Math.max(1, Math.min(h, imgH));
  x = Math.max(0, Math.min(x, imgW - w));
  y = Math.max(0, Math.min(y, imgH - h));
  return { ...c, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function applyRatio(c: Crop, imgW: number, imgH: number, anchor: "tl" | "center" = "center"): Crop {
  const r = parseRatio(c);
  if (!r) return clampCrop(c, imgW, imgH);
  // keep width, recompute height
  let w = c.w;
  let h = w / r;
  if (h > imgH) {
    h = imgH;
    w = h * r;
  }
  let x = c.x;
  let y = c.y;
  if (anchor === "center") {
    x = c.x + c.w / 2 - w / 2;
    y = c.y + c.h / 2 - h / 2;
  }
  return clampCrop({ ...c, x, y, w, h }, imgW, imgH);
}

function DualCropTool() {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string>("image");
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState<number>(92);

  const [cropA, setCropA] = useState<Crop>({
    x: 0, y: 0, w: 100, h: 100, ratio: "16:9", customW: 1920, customH: 1080, locked: false,
  });
  const [cropB, setCropB] = useState<Crop>({
    x: 0, y: 0, w: 100, h: 100, ratio: "9:16", customW: 1080, customH: 1920, locked: false,
  });
  const [activeCrop, setActiveCrop] = useState<"A" | "B">("A");

  // view transform
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [snap, setSnap] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const spaceRef = useRef(false);

  // ----- Load image helpers -----
  const loadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setFileName(file.name.replace(/\.[^.]+$/, "") || "image");
      // initial crops: place them taking up reasonable space
      const a: Crop = {
        x: 0, y: 0,
        w: Math.min(i.width, 1920),
        h: 0,
        ratio: "16:9",
        customW: 1920, customH: 1080,
        locked: false,
      };
      a.h = a.w * (9 / 16);
      const ac = applyRatio({ ...a, w: Math.min(i.width * 0.5, 1920) }, i.width, i.height, "tl");
      const b: Crop = {
        x: 0, y: 0,
        w: 0, h: 0,
        ratio: "9:16",
        customW: 1080, customH: 1920,
        locked: false,
      };
      b.h = Math.min(i.height, 1920);
      b.w = b.h * (9 / 16);
      const bc = applyRatio({ ...b, h: Math.min(i.height, 1920) }, i.width, i.height, "tl");
      setCropA(clampCrop(ac, i.width, i.height));
      setCropB(clampCrop({ ...bc, x: Math.min(ac.w + 20, i.width - bc.w) }, i.width, i.height));
      // reset view, fit handled in effect
      requestAnimationFrame(() => fitView(i));
    };
    i.src = url;
  }, []);

  const fitView = useCallback((image?: HTMLImageElement) => {
    const i = image ?? img;
    const wrap = wrapRef.current;
    if (!i || !wrap) return;
    const pad = 32;
    const s = Math.min((wrap.clientWidth - pad) / i.width, (wrap.clientHeight - pad) / i.height);
    setScale(s);
    setOffset({
      x: (wrap.clientWidth - i.width * s) / 2,
      y: (wrap.clientHeight - i.height * s) / 2,
    });
  }, [img]);

  // ----- File input + drop + paste -----
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = "";
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) loadFile(f);
          break;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  const [isDragOver, setIsDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) loadFile(f);
  };

  // ----- Keyboard -----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = true;
      if (!img) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const setter = activeCrop === "A" ? setCropA : setCropB;
      const step = e.shiftKey ? 10 : 1;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        setter((c) => {
          if (c.locked) return c;
          let { x, y } = c;
          if (e.key === "ArrowLeft") x -= step;
          if (e.key === "ArrowRight") x += step;
          if (e.key === "ArrowUp") y -= step;
          if (e.key === "ArrowDown") y += step;
          return clampCrop({ ...c, x, y }, img.width, img.height);
        });
      }
      if (e.key === "1") setActiveCrop("A");
      if (e.key === "2") setActiveCrop("B");
      if (e.key === "f" || e.key === "F") fitView();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [img, activeCrop, fitView]);

  // ----- Draw -----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
    canvas.style.width = wrap.clientWidth + "px";
    canvas.style.height = wrap.clientHeight + "px";
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);

    // checker bg
    const tile = 16;
    for (let y = 0; y < wrap.clientHeight; y += tile) {
      for (let x = 0; x < wrap.clientWidth; x += tile) {
        const dark = ((x / tile) + (y / tile)) % 2 === 0;
        ctx.fillStyle = dark ? "hsl(220 13% 14%)" : "hsl(220 13% 18%)";
        ctx.fillRect(x, y, tile, tile);
      }
    }

    if (!img) return;
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0);

    // dim outside crops using even-odd
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, img.width, img.height);
    ctx.rect(cropA.x, cropA.y, cropA.w, cropA.h);
    ctx.rect(cropB.x, cropB.y, cropB.w, cropB.h);
    ctx.fill("evenodd");

    drawCrop(ctx, cropA, "A", activeCrop === "A", scale);
    drawCrop(ctx, cropB, "B", activeCrop === "B", scale);

    ctx.restore();
  }, [img, scale, offset, cropA, cropB, activeCrop]);

  // resize observer to refit on container changes
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      // trigger redraw via offset change (no-op set)
      setOffset((o) => ({ ...o }));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ----- Mouse handling -----
  const screenToImg = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current!;
    const r = wrap.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    return { x: (sx - offset.x) / scale, y: (sy - offset.y) / scale };
  };

  const hitTest = (
    p: { x: number; y: number }
  ): { crop: "A" | "B"; mode: "move" | "resize"; handle?: string } | null => {
    const handleSize = 10 / scale;
    const order: ["A" | "B", Crop][] =
      activeCrop === "A"
        ? [["A", cropA], ["B", cropB]]
        : [["B", cropB], ["A", cropA]];
    for (const [name, c] of order) {
      // handles
      const handles: { name: string; x: number; y: number }[] = [
        { name: "nw", x: c.x, y: c.y },
        { name: "n", x: c.x + c.w / 2, y: c.y },
        { name: "ne", x: c.x + c.w, y: c.y },
        { name: "e", x: c.x + c.w, y: c.y + c.h / 2 },
        { name: "se", x: c.x + c.w, y: c.y + c.h },
        { name: "s", x: c.x + c.w / 2, y: c.y + c.h },
        { name: "sw", x: c.x, y: c.y + c.h },
        { name: "w", x: c.x, y: c.y + c.h / 2 },
      ];
      for (const h of handles) {
        if (Math.abs(p.x - h.x) <= handleSize && Math.abs(p.y - h.y) <= handleSize) {
          return { crop: name, mode: "resize", handle: h.name };
        }
      }
      if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
        return { crop: name, mode: "move" };
      }
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!img) return;
    const p = screenToImg(e.clientX, e.clientY);
    if (spaceRef.current || e.button === 1) {
      dragRef.current = {
        mode: "pan",
        startMouse: { x: e.clientX, y: e.clientY },
        startOffset: offset,
      };
      return;
    }
    const hit = hitTest(p);
    if (hit) {
      const c = hit.crop === "A" ? cropA : cropB;
      if (c.locked) return;
      setActiveCrop(hit.crop);
      dragRef.current = {
        crop: hit.crop,
        mode: hit.mode,
        handle: hit.handle,
        startMouseImg: p,
        startCrop: c,
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!img) return;
    const d = dragRef.current;
    const wrap = wrapRef.current!;
    if (!d) {
      // cursor
      const p = screenToImg(e.clientX, e.clientY);
      const hit = hitTest(p);
      if (spaceRef.current) wrap.style.cursor = "grab";
      else if (!hit) wrap.style.cursor = "default";
      else if (hit.mode === "move") wrap.style.cursor = "move";
      else {
        const map: Record<string, string> = {
          n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
          ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
        };
        wrap.style.cursor = map[hit.handle ?? ""] ?? "default";
      }
      return;
    }
    if (d.mode === "pan") {
      setOffset({
        x: d.startOffset.x + (e.clientX - d.startMouse.x),
        y: d.startOffset.y + (e.clientY - d.startMouse.y),
      });
      return;
    }
    const p = screenToImg(e.clientX, e.clientY);
    const dx = p.x - d.startMouseImg.x;
    const dy = p.y - d.startMouseImg.y;
    const setter = d.crop === "A" ? setCropA : setCropB;
    const other = d.crop === "A" ? cropB : cropA;

    if (d.mode === "move") {
      let nc: Crop = { ...d.startCrop, x: d.startCrop.x + dx, y: d.startCrop.y + dy };
      nc = clampCrop(nc, img.width, img.height);
      if (snap) nc = applySnap(nc, other, img.width, img.height, scale);
      setter(nc);
      return;
    }

    // resize
    let { x, y, w, h } = d.startCrop;
    const right = x + w;
    const bottom = y + h;
    const handle = d.handle!;
    if (handle.includes("e")) w = Math.max(1, d.startCrop.w + dx);
    if (handle.includes("s")) h = Math.max(1, d.startCrop.h + dy);
    if (handle.includes("w")) {
      x = d.startCrop.x + dx;
      w = right - x;
      if (w < 1) { x = right - 1; w = 1; }
    }
    if (handle.includes("n")) {
      y = d.startCrop.y + dy;
      h = bottom - y;
      if (h < 1) { y = bottom - 1; h = 1; }
    }
    let nc: Crop = { ...d.startCrop, x, y, w, h };
    const r = parseRatio(nc);
    if (r) {
      // adjust the dimension we did NOT primarily drag, anchored to opposite side
      const widthDriven = handle === "e" || handle === "w" || handle === "ne" || handle === "se" || handle === "nw" || handle === "sw";
      // for corners, drive by larger delta
      let driveW = widthDriven;
      if (handle.length === 2) {
        driveW = Math.abs(w - d.startCrop.w) >= Math.abs(h - d.startCrop.h);
      }
      if (driveW) {
        const newH = w / r;
        if (handle.includes("n")) y = bottom - newH;
        h = newH;
      } else {
        const newW = h * r;
        if (handle.includes("w")) x = right - newW;
        w = newW;
      }
      nc = { ...nc, x, y, w, h };
    }
    nc = clampCrop(nc, img.width, img.height);
    if (snap) nc = applySnap(nc, other, img.width, img.height, scale);
    setter(nc);
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!img) return;
    e.preventDefault();
    const wrap = wrapRef.current!;
    const r = wrap.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(0.05, Math.min(20, scale * factor));
    // zoom around mouse
    const ix = (mx - offset.x) / scale;
    const iy = (my - offset.y) / scale;
    setOffset({ x: mx - ix * newScale, y: my - iy * newScale });
    setScale(newScale);
  };

  // ----- Export -----
  const renderCropToCanvas = (c: Crop): HTMLCanvasElement => {
    const off = document.createElement("canvas");
    off.width = c.w;
    off.height = c.h;
    const cx = off.getContext("2d")!;
    cx.drawImage(img!, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    return off;
  };

  const blobFromCrop = (c: Crop): Promise<Blob> =>
    new Promise((resolve) => {
      const cv = renderCropToCanvas(c);
      cv.toBlob(
        (b) => resolve(b!),
        format === "png" ? "image/png" : "image/jpeg",
        format === "jpeg" ? quality / 100 : undefined
      );
    });

  const downloadOne = async (which: "A" | "B") => {
    if (!img) return;
    const c = which === "A" ? cropA : cropB;
    const b = await blobFromCrop(c);
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}_${which}_${c.w}x${c.h}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async () => {
    if (!img) return;
    const zip = new JSZip();
    const [ba, bb] = await Promise.all([blobFromCrop(cropA), blobFromCrop(cropB)]);
    zip.file(`${fileName}_A_${cropA.w}x${cropA.h}.${format}`, ba);
    zip.file(`${fileName}_B_${cropB.w}x${cropB.h}.${format}`, bb);
    const zb = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zb);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}_crops.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">
            ⌗
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Dual Crop</h1>
            <p className="text-xs text-muted-foreground leading-tight">
              {img ? `${fileName} · ${img.width}×${img.height}` : "Crop two regions from one image"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {img && (
            <Button variant="outline" size="sm" onClick={() => fitView()}>
              <Maximize2 className="h-4 w-4 mr-1" /> Fit
            </Button>
          )}
          <label>
            <input type="file" accept="image/*" className="hidden" onChange={onFileInput} />
            <Button asChild variant="outline" size="sm">
              <span><Upload className="h-4 w-4 mr-1" /> {img ? "Replace image" : "Load image"}</span>
            </Button>
          </label>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] min-h-0">
        {/* canvas area */}
        <div
          ref={wrapRef}
          className="relative bg-muted/30 overflow-hidden select-none"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={onDrop}
        >
          <canvas ref={canvasRef} className="block" />
          {!img && (
            <div className={`absolute inset-0 grid place-items-center pointer-events-none transition-colors ${isDragOver ? "bg-primary/10" : ""}`}>
              <div className="text-center pointer-events-auto">
                <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="mt-3 font-medium">Drop an image here</p>
                <p className="text-sm text-muted-foreground">or paste from clipboard, or use Load image</p>
              </div>
            </div>
          )}
          {img && (
            <div className="absolute bottom-2 left-2 text-xs text-muted-foreground bg-background/70 backdrop-blur px-2 py-1 rounded">
              Scroll to zoom · Space+drag to pan · 1/2 to switch crop · Arrows nudge · F to fit
            </div>
          )}
        </div>

        {/* side panel */}
        <aside className="border-l overflow-y-auto p-4 space-y-4 bg-card">
          <CropPanel
            label="Crop A"
            color="hsl(210 90% 60%)"
            crop={cropA}
            setCrop={setCropA}
            img={img}
            active={activeCrop === "A"}
            onActivate={() => setActiveCrop("A")}
          />
          <CropPanel
            label="Crop B"
            color="hsl(28 90% 60%)"
            crop={cropB}
            setCrop={setCropB}
            img={img}
            active={activeCrop === "B"}
            onActivate={() => setActiveCrop("B")}
          />

          <Separator />

          <Card className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="snap" className="text-sm">Snap to edges</Label>
              <Switch id="snap" checked={snap} onCheckedChange={setSnap} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Output format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "png" | "jpeg")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG (lossless)</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {format === "jpeg" && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <Label>Quality</Label>
                  <span className="text-muted-foreground">{quality}</span>
                </div>
                <Slider value={[quality]} min={50} max={100} step={1} onValueChange={(v) => setQuality(v[0])} />
              </div>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={!img} onClick={() => downloadOne("A")}>
              <Download className="h-4 w-4 mr-1" /> A
            </Button>
            <Button variant="outline" disabled={!img} onClick={() => downloadOne("B")}>
              <Download className="h-4 w-4 mr-1" /> B
            </Button>
          </div>
          <Button className="w-full" disabled={!img} onClick={downloadZip}>
            <Download className="h-4 w-4 mr-1" /> Download both as ZIP
          </Button>
        </aside>
      </div>
    </div>
  );
}

function applySnap(c: Crop, other: Crop, imgW: number, imgH: number, scale: number): Crop {
  const t = 6 / scale; // px in image coords
  let { x, y, w, h } = c;
  const candidatesX = [0, imgW - w, other.x, other.x + other.w - w, other.x + other.w, other.x - w];
  const candidatesY = [0, imgH - h, other.y, other.y + other.h - h, other.y + other.h, other.y - h];
  for (const cx of candidatesX) {
    if (Math.abs(x - cx) < t) { x = cx; break; }
  }
  for (const cy of candidatesY) {
    if (Math.abs(y - cy) < t) { y = cy; break; }
  }
  return clampCrop({ ...c, x, y, w, h }, imgW, imgH);
}

function drawCrop(
  ctx: CanvasRenderingContext2D,
  c: Crop,
  label: string,
  active: boolean,
  scale: number
) {
  const color = label === "A" ? "hsl(210 90% 60%)" : "hsl(28 90% 60%)";
  ctx.lineWidth = (active ? 2 : 1.25) / scale;
  ctx.strokeStyle = color;
  ctx.strokeRect(c.x, c.y, c.w, c.h);

  // thirds guides
  if (active) {
    ctx.save();
    ctx.lineWidth = 0.5 / scale;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(c.x + (c.w * i) / 3, c.y);
      ctx.lineTo(c.x + (c.w * i) / 3, c.y + c.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x, c.y + (c.h * i) / 3);
      ctx.lineTo(c.x + c.w, c.y + (c.h * i) / 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // label
  const fontPx = 12 / scale;
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  const text = `${label}  ${Math.round(c.w)}×${Math.round(c.h)}`;
  const padX = 6 / scale;
  const padY = 3 / scale;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = color;
  ctx.fillRect(c.x, c.y - (fontPx + padY * 2), tw + padX * 2, fontPx + padY * 2);
  ctx.fillStyle = "white";
  ctx.fillText(text, c.x + padX, c.y - padY * 1.5);

  // handles
  if (active) {
    const hs = 8 / scale;
    ctx.fillStyle = "white";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / scale;
    const pts = [
      [c.x, c.y], [c.x + c.w / 2, c.y], [c.x + c.w, c.y],
      [c.x + c.w, c.y + c.h / 2], [c.x + c.w, c.y + c.h],
      [c.x + c.w / 2, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y + c.h / 2],
    ];
    for (const [px, py] of pts) {
      ctx.beginPath();
      ctx.rect(px - hs / 2, py - hs / 2, hs, hs);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function CropPanel({
  label, color, crop, setCrop, img, active, onActivate,
}: {
  label: string;
  color: string;
  crop: Crop;
  setCrop: (updater: (c: Crop) => Crop) => void;
  img: HTMLImageElement | null;
  active: boolean;
  onActivate: () => void;
}) {
  const update = (patch: Partial<Crop>) => {
    if (!img) return;
    setCrop((c) => {
      let next: Crop = { ...c, ...patch };
      // re-apply ratio if relevant fields changed
      if ("ratio" in patch || "customW" in patch || "customH" in patch) {
        next = applyRatio(next, img.width, img.height, "center");
      } else if ("w" in patch || "h" in patch) {
        const r = parseRatio(next);
        if (r) {
          if ("w" in patch) next.h = next.w / r;
          else next.w = next.h * r;
        }
      }
      return clampCrop(next, img.width, img.height);
    });
  };

  const setPreset = (w: number, h: number) => {
    if (!img) return;
    setCrop((c) => clampCrop({
      ...c,
      ratio: "custom",
      customW: w,
      customH: h,
      w: Math.min(w, img.width),
      h: Math.min(h, img.height),
    }, img.width, img.height));
  };

  return (
    <Card className={`p-3 space-y-3 transition-colors ${active ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
      style={active ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
      onMouseDown={onActivate}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
          <span className="font-semibold text-sm">{label}</span>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setCrop((c) => ({ ...c, locked: !c.locked }))}
          title={crop.locked ? "Unlock" : "Lock"}
        >
          {crop.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={crop.x} onChange={(v) => update({ x: v })} disabled={!img || crop.locked} />
        <NumField label="Y" value={crop.y} onChange={(v) => update({ y: v })} disabled={!img || crop.locked} />
        <NumField label="W" value={crop.w} onChange={(v) => update({ w: v })} disabled={!img || crop.locked} />
        <NumField label="H" value={crop.h} onChange={(v) => update({ h: v })} disabled={!img || crop.locked} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Aspect ratio</Label>
        <Select value={crop.ratio} onValueChange={(v) => update({ ratio: v })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RATIO_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {crop.ratio === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Ratio W" value={crop.customW} onChange={(v) => update({ customW: v })} />
            <NumField label="Ratio H" value={crop.customH} onChange={(v) => update({ customH: v })} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <PresetBtn onClick={() => setPreset(2560, 1440)}>2560×1440</PresetBtn>
        <PresetBtn onClick={() => setPreset(1920, 1080)}>1920×1080</PresetBtn>
        <PresetBtn onClick={() => setPreset(1080, 1920)}>1080×1920</PresetBtn>
        <PresetBtn onClick={() => setPreset(1080, 1080)}>1080²</PresetBtn>
      </div>
    </Card>
  );
}

function PresetBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2 py-1 rounded border bg-background hover:bg-accent transition-colors"
    >
      {children}
    </button>
  );
}

function NumField({
  label, value, onChange, disabled,
}: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-8"
        value={Math.round(value)}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </div>
  );
}
