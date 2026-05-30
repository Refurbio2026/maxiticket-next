import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  getLayout,
  upsertLayout,
  computeCapacity,
  HALL_TYPE_LABEL,
  uid,
  type HallLayout,
  type Shape,
  type ShapeKind,
  type HallType,
} from "@/lib/layouts-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  MousePointer2,
  Square,
  Grid3x3,
  Users,
  Star,
  Mic2,
  DoorOpen,
  Type as TypeIcon,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Save,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/events/hall-layouts/$id")({
  head: () => ({ meta: [{ title: "Editor haly · MAXITICKET Admin" }] }),
  component: Editor,
});

type Tool =
  | "select"
  | "sector"
  | "seats"
  | "standing"
  | "vip"
  | "stage"
  | "entrance"
  | "label";

const TOOL_DEFAULTS: Record<Exclude<Tool, "select">, Partial<Shape>> = {
  sector: { kind: "sector", width: 240, height: 160, color: "#3b82f6", label: "Sektor" },
  seats: { kind: "seats", width: 280, height: 180, rows: 6, cols: 10, seatSize: 24, color: "#22c55e", label: "Seating", startRow: 1, startSeat: 1, priceCategory: "Regular" },
  standing: { kind: "standing", width: 260, height: 140, color: "#f59e0b", label: "Standing", capacity: 200, priceCategory: "Regular" },
  vip: { kind: "vip", width: 200, height: 120, color: "#a855f7", label: "VIP", capacity: 40, priceCategory: "VIP" },
  stage: { kind: "stage", width: 360, height: 60, color: "#0f172a", label: "PÓDIUM" },
  entrance: { kind: "entrance", width: 80, height: 28, color: "#64748b", label: "Vstup" },
  label: { kind: "label", width: 120, height: 28, color: "transparent", label: "Text" },
};

const PRICE_CATEGORIES = ["Regular", "VIP", "Early Bird", "Premium", "ZŤP", "Vlastná"];

function Editor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<HallLayout | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const l = getLayout(id);
    if (!l) {
      toast.error("Hala neexistuje");
      navigate({ to: "/admin/events/hall-layouts" });
      return;
    }
    setLayout(l);
  }, [id, navigate]);

  // Autosave (debounced via timeout)
  useEffect(() => {
    if (!layout) return;
    const t = setTimeout(() => {
      upsertLayout({ ...layout, capacity: computeCapacity(layout.shapes) });
    }, 400);
    return () => clearTimeout(t);
  }, [layout]);

  const pushHistory = useCallback(
    (prevShapes: Shape[]) => {
      setHistory((h) => [...h.slice(-49), prevShapes]);
      setFuture([]);
    },
    []
  );

  const setShapes = useCallback(
    (updater: (prev: Shape[]) => Shape[], snapshot = true) => {
      setLayout((l) => {
        if (!l) return l;
        if (snapshot) setHistory((h) => [...h.slice(-49), l.shapes]);
        if (snapshot) setFuture([]);
        return { ...l, shapes: updater(l.shapes) };
      });
    },
    []
  );

  const selected = useMemo(
    () => layout?.shapes.find((s) => s.id === selectedId) ?? null,
    [layout, selectedId]
  );

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || e.shiftKey) {
      panRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
      return;
    }
    if (tool === "select") {
      if (e.target === svgRef.current) setSelectedId(null);
      return;
    }
    const pt = svgPoint(e.clientX, e.clientY);
    const def = TOOL_DEFAULTS[tool];
    const shape: Shape = {
      id: uid(),
      kind: def.kind as ShapeKind,
      x: pt.x - (def.width ?? 100) / 2,
      y: pt.y - (def.height ?? 60) / 2,
      width: def.width ?? 100,
      height: def.height ?? 60,
      color: def.color,
      label: def.label,
      rows: def.rows,
      cols: def.cols,
      seatSize: def.seatSize,
      startRow: def.startRow,
      startSeat: def.startSeat,
      priceCategory: def.priceCategory,
      capacity: def.capacity,
    };
    setShapes((prev) => [...prev, shape]);
    setSelectedId(shape.id);
    setTool("select");
  };

  const handleShapeMouseDown = (e: React.MouseEvent, shape: Shape) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(shape.id);
    const pt = svgPoint(e.clientX, e.clientY);
    draggingRef.current = {
      id: shape.id,
      startX: pt.x,
      startY: pt.y,
      origX: shape.x,
      origY: shape.y,
    };
    // snapshot once at drag start
    setHistory((h) => (layout ? [...h.slice(-49), layout.shapes] : h));
    setFuture([]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (panRef.current) {
      const p = panRef.current;
      setPan({ x: p.origX + (e.clientX - p.startX), y: p.origY + (e.clientY - p.startY) });
      return;
    }
    const d = draggingRef.current;
    if (!d) return;
    const pt = svgPoint(e.clientX, e.clientY);
    const dx = pt.x - d.startX;
    const dy = pt.y - d.startY;
    setShapes(
      (prev) =>
        prev.map((s) => (s.id === d.id ? { ...s, x: d.origX + dx, y: d.origY + dy } : s)),
      false
    );
  };

  const handleMouseUp = () => {
    draggingRef.current = null;
    panRef.current = null;
  };

  const updateSelected = (patch: Partial<Shape>) => {
    if (!selected) return;
    setShapes((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  };

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setShapes((prev) => prev.filter((s) => s.id !== selected.id));
    setSelectedId(null);
  }, [selected, setShapes]);

  const undo = () => {
    setLayout((l) => {
      if (!l || history.length === 0) return l;
      const last = history[history.length - 1];
      setHistory((h) => h.slice(0, -1));
      setFuture((f) => [...f, l.shapes]);
      return { ...l, shapes: last };
    });
  };

  const redo = () => {
    setLayout((l) => {
      if (!l || future.length === 0) return l;
      const next = future[future.length - 1];
      setFuture((f) => f.slice(0, -1));
      setHistory((h) => [...h.slice(-49), l.shapes]);
      return { ...l, shapes: next };
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
                 ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, history, future]);

  const exportJson = () => {
    if (!layout) return;
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${layout.name}.json`;
    a.click();
  };

  const importJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text()) as HallLayout;
        if (!Array.isArray(data.shapes)) throw new Error("invalid");
        setLayout((l) => (l ? { ...l, shapes: data.shapes } : l));
        toast.success("Layout naimportovaný");
      } catch {
        toast.error("Neplatný JSON");
      }
    };
    input.click();
  };

  if (!layout) {
    return <div className="text-sm text-muted-foreground">Načítavam editor…</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-3">
      {/* Top bar */}
      <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-card p-3">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/admin/events/hall-layouts">
            <ArrowLeft className="h-4 w-4" /> Späť
          </Link>
        </Button>
        <Input
          value={layout.name}
          onChange={(e) => setLayout({ ...layout, name: e.target.value })}
          className="max-w-xs font-semibold"
        />
        <Select
          value={layout.type}
          onValueChange={(v) => setLayout({ ...layout, type: v as HallType })}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(HALL_TYPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span>Kapacita: <strong className="text-foreground tabular-nums">{computeCapacity(layout.shapes)}</strong></span>
          <Button size="sm" variant="outline" onClick={importJson} className="gap-1"><Upload className="h-4 w-4" />Import</Button>
          <Button size="sm" variant="outline" onClick={exportJson} className="gap-1"><Download className="h-4 w-4" />Export</Button>
          <Button size="sm" onClick={() => { upsertLayout(layout); toast.success("Uložené"); }} className="gap-1">
            <Save className="h-4 w-4" /> Uložiť
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        {/* Left toolbar */}
        <div className="flex w-14 flex-col items-center gap-1 rounded-lg border border-border/40 bg-card p-2">
          <ToolBtn icon={MousePointer2} label="Select" active={tool === "select"} onClick={() => setTool("select")} />
          <ToolBtn icon={Square} label="Sektor" active={tool === "sector"} onClick={() => setTool("sector")} />
          <ToolBtn icon={Grid3x3} label="Sedadlá" active={tool === "seats"} onClick={() => setTool("seats")} />
          <ToolBtn icon={Users} label="Standing" active={tool === "standing"} onClick={() => setTool("standing")} />
          <ToolBtn icon={Star} label="VIP zóna" active={tool === "vip"} onClick={() => setTool("vip")} />
          <ToolBtn icon={Mic2} label="Pódium" active={tool === "stage"} onClick={() => setTool("stage")} />
          <ToolBtn icon={DoorOpen} label="Vstup" active={tool === "entrance"} onClick={() => setTool("entrance")} />
          <ToolBtn icon={TypeIcon} label="Text" active={tool === "label"} onClick={() => setTool("label")} />
          <div className="my-1 h-px w-full bg-border/60" />
          <ToolBtn icon={Undo2} label="Undo" onClick={undo} />
          <ToolBtn icon={Redo2} label="Redo" onClick={redo} />
          <ToolBtn icon={ZoomIn} label="Zoom +" onClick={() => setZoom((z) => Math.min(3, z * 1.2))} />
          <ToolBtn icon={ZoomOut} label="Zoom -" onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))} />
          <ToolBtn icon={Trash2} label="Zmazať" onClick={deleteSelected} />
        </div>

        {/* Canvas */}
        <div className="relative flex-1 overflow-hidden rounded-lg border border-border/40 bg-muted/30">
          <svg
            ref={svgRef}
            className="h-full w-full cursor-crosshair"
            style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.4" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {layout.shapes.map((s) => (
                <ShapeView
                  key={s.id}
                  shape={s}
                  selected={s.id === selectedId}
                  onMouseDown={(e) => handleShapeMouseDown(e, s)}
                />
              ))}
            </g>
          </svg>
          <div className="absolute bottom-2 right-3 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
            Zoom {(zoom * 100).toFixed(0)}% · Shift+drag = posun · Del = zmazať
          </div>
        </div>

        {/* Right properties */}
        <div className="w-72 overflow-y-auto rounded-lg border border-border/40 bg-card p-4">
          {!selected && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Vlastnosti haly</h3>
              <Field label="Mesto">
                <Input value={layout.city ?? ""} onChange={(e) => setLayout({ ...layout, city: e.target.value })} />
              </Field>
              <Field label="Adresa">
                <Input value={layout.address ?? ""} onChange={(e) => setLayout({ ...layout, address: e.target.value })} />
              </Field>
              <Field label="Poznámka">
                <Textarea rows={3} value={layout.note ?? ""} onChange={(e) => setLayout({ ...layout, note: e.target.value })} />
              </Field>
              <p className="text-xs text-muted-foreground">
                Vyber prvok na plátne pre úpravu jeho vlastností. Pridaj prvok z ľavej lišty kliknutím a potom kliknutím do plátna.
              </p>
            </div>
          )}
          {selected && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Vlastnosti prvku</h3>
              <div className="text-xs text-muted-foreground capitalize">{selected.kind}</div>
              <Field label="Názov / popisok">
                <Input value={selected.label ?? ""} onChange={(e) => updateSelected({ label: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="X"><Input type="number" value={Math.round(selected.x)} onChange={(e) => updateSelected({ x: +e.target.value })} /></Field>
                <Field label="Y"><Input type="number" value={Math.round(selected.y)} onChange={(e) => updateSelected({ y: +e.target.value })} /></Field>
                <Field label="Šírka"><Input type="number" value={Math.round(selected.width)} onChange={(e) => updateSelected({ width: +e.target.value })} /></Field>
                <Field label="Výška"><Input type="number" value={Math.round(selected.height)} onChange={(e) => updateSelected({ height: +e.target.value })} /></Field>
              </div>
              <Field label="Farba">
                <Input type="color" value={selected.color ?? "#3b82f6"} onChange={(e) => updateSelected({ color: e.target.value })} />
              </Field>
              {selected.kind === "seats" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Rady"><Input type="number" min={1} value={selected.rows ?? 1} onChange={(e) => updateSelected({ rows: Math.max(1, +e.target.value) })} /></Field>
                    <Field label="Stĺpce"><Input type="number" min={1} value={selected.cols ?? 1} onChange={(e) => updateSelected({ cols: Math.max(1, +e.target.value) })} /></Field>
                    <Field label="Štart rad"><Input type="number" value={selected.startRow ?? 1} onChange={(e) => updateSelected({ startRow: +e.target.value })} /></Field>
                    <Field label="Štart miesto"><Input type="number" value={selected.startSeat ?? 1} onChange={(e) => updateSelected({ startSeat: +e.target.value })} /></Field>
                  </div>
                </>
              )}
              {(selected.kind === "standing" || selected.kind === "vip") && (
                <Field label="Kapacita">
                  <Input type="number" value={selected.capacity ?? 0} onChange={(e) => updateSelected({ capacity: +e.target.value })} />
                </Field>
              )}
              {(selected.kind === "seats" || selected.kind === "standing" || selected.kind === "vip" || selected.kind === "sector") && (
                <Field label="Cenová kategória">
                  <Select value={selected.priceCategory ?? "Regular"} onValueChange={(v) => updateSelected({ priceCategory: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="blocked"
                  checked={!!selected.blocked}
                  onChange={(e) => updateSelected({ blocked: e.target.checked })}
                />
                <Label htmlFor="blocked" className="text-sm">Blokované</Label>
              </div>
              <Button variant="destructive" size="sm" className="w-full gap-1" onClick={deleteSelected}>
                <Trash2 className="h-4 w-4" /> Odstrániť prvok
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ToolBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ShapeView({
  shape,
  selected,
  onMouseDown,
}: {
  shape: Shape;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const stroke = selected ? "#06b6d4" : "rgba(0,0,0,0.35)";
  const strokeWidth = selected ? 2 : 1;

  if (shape.kind === "label") {
    return (
      <g onMouseDown={onMouseDown} style={{ cursor: "move" }}>
        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="transparent" stroke={selected ? stroke : "transparent"} strokeDasharray="4 4" />
        <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} dominantBaseline="middle" textAnchor="middle" fontSize={14} fontWeight={600} fill="hsl(var(--foreground))">
          {shape.label}
        </text>
      </g>
    );
  }

  if (shape.kind === "stage") {
    return (
      <g onMouseDown={onMouseDown} style={{ cursor: "move" }}>
        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} stroke={stroke} strokeWidth={strokeWidth} rx={6} />
        <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} dominantBaseline="middle" textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" letterSpacing={4}>
          {shape.label}
        </text>
      </g>
    );
  }

  if (shape.kind === "seats") {
    const rows = shape.rows ?? 1;
    const cols = shape.cols ?? 1;
    const cellW = shape.width / cols;
    const cellH = shape.height / rows;
    const size = Math.min(cellW, cellH) * 0.75;
    return (
      <g onMouseDown={onMouseDown} style={{ cursor: "move" }}>
        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="rgba(34,197,94,0.05)" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={selected ? "0" : "4 4"} rx={4} />
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const cx = shape.x + c * cellW + cellW / 2;
            const cy = shape.y + r * cellH + cellH / 2;
            return (
              <circle
                key={`${r}-${c}`}
                cx={cx}
                cy={cy}
                r={size / 2}
                fill={shape.blocked ? "#ef4444" : shape.color}
                opacity={0.85}
              />
            );
          })
        )}
        <text x={shape.x + 6} y={shape.y - 4} fontSize={11} fill="hsl(var(--muted-foreground))">
          {shape.label} · {rows}×{cols}
        </text>
      </g>
    );
  }

  // sector / standing / vip / entrance — generic rect
  return (
    <g onMouseDown={onMouseDown} style={{ cursor: "move" }}>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        fill={shape.color}
        fillOpacity={0.25}
        stroke={shape.color}
        strokeWidth={strokeWidth + 1}
        rx={6}
      />
      <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} dominantBaseline="middle" textAnchor="middle" fontSize={13} fontWeight={600} fill="hsl(var(--foreground))">
        {shape.label}
        {shape.capacity ? ` (${shape.capacity})` : ""}
      </text>
      {selected && (
        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="none" stroke="#06b6d4" strokeWidth={2} strokeDasharray="6 4" rx={6} />
      )}
    </g>
  );
}
