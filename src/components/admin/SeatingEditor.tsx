import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Stage,
  Layer,
  Rect,
  Text as KText,
  Group,
  Circle,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import {
  computeCapacity,
  uid,
  upsertLayout,
  type HallLayout,
  type Shape,
  type ShapeKind,
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MousePointer2,
  Square,
  Star,
  Users,
  Mic2,
  DoorOpen,
  Type as TypeIcon,
  Grid3x3,
  Circle as CircleIcon,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Save,
  Maximize,
} from "lucide-react";
import { toast } from "sonner";

type Tool =
  | "select"
  | "sector"
  | "vip"
  | "standing"
  | "stage"
  | "entrance"
  | "label"
  | "seat";

const SHAPE_COLOR: Record<ShapeKind, string> = {
  sector: "#3b82f6",
  vip: "#a855f7",
  standing: "#f59e0b",
  stage: "#0f172a",
  entrance: "#64748b",
  label: "#94a3b8",
  seats: "#22c55e",
  bar: "#ef4444",
  wc: "#06b6d4",
  tech: "#737373",
};

const PRICE_CATEGORIES = ["Regular", "VIP", "Premium", "Early Bird", "ZŤP"];

const CANVAS_BG = "#f8fafc";

export function SeatingEditor({
  initial,
  onChange,
}: {
  initial: HallLayout;
  onChange?: (l: HallLayout) => void;
}) {
  // ---------- state ----------
  const [layout, setLayout] = useState<HallLayout>(initial);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [history, setHistory] = useState<HallLayout[]>([initial]);
  const [hIdx, setHIdx] = useState(0);
  const [seatsDialog, setSeatsDialog] = useState(false);
  const [seatsForm, setSeatsForm] = useState({
    rows: 8,
    cols: 12,
    rowLabelMode: "ABC" as "ABC" | "123",
    startSeat: 1,
    seatSize: 22,
    sectorName: "Sektor A",
    priceCategory: "Regular",
    color: "#22c55e",
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const layerRef = useRef<Konva.Layer | null>(null);

  // ---------- responsive canvas size ----------
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---------- persistence (debounced) ----------
  useEffect(() => {
    const t = setTimeout(() => {
      const next = { ...layout, capacity: computeCapacity(layout.shapes) };
      upsertLayout(next);
      onChange?.(next);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // ---------- history ----------
  const pushHistory = useCallback(
    (next: HallLayout) => {
      const trimmed = history.slice(0, hIdx + 1);
      const newH = [...trimmed, next].slice(-100);
      setHistory(newH);
      setHIdx(newH.length - 1);
    },
    [history, hIdx],
  );

  const setShapes = useCallback(
    (updater: (prev: Shape[]) => Shape[], commit = true) => {
      setLayout((prev) => {
        const next = { ...prev, shapes: updater(prev.shapes) };
        if (commit) {
          setTimeout(() => pushHistory(next), 0);
        }
        return next;
      });
    },
    [pushHistory],
  );

  const undo = () => {
    if (hIdx <= 0) return;
    const i = hIdx - 1;
    setHIdx(i);
    setLayout(history[i]);
  };
  const redo = () => {
    if (hIdx >= history.length - 1) return;
    const i = hIdx + 1;
    setHIdx(i);
    setLayout(history[i]);
  };

  // ---------- transformer attach ----------
  useEffect(() => {
    if (!trRef.current || !layerRef.current) return;
    const nodes = selectedIds
      .map((id) => layerRef.current!.findOne(`#${id}`))
      .filter(Boolean) as Konva.Node[];
    trRef.current.nodes(nodes);
    trRef.current.getLayer()?.batchDraw();
  }, [selectedIds, layout.shapes]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length) {
          e.preventDefault();
          deleteSelected();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === "Escape") {
        setSelectedIds([]);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, hIdx, history]);

  // ---------- helpers ----------
  const addShape = (kind: ShapeKind, x: number, y: number) => {
    const base: Shape = {
      id: uid(),
      kind,
      x,
      y,
      width: 200,
      height: 120,
      rotation: 0,
      color: SHAPE_COLOR[kind],
      label:
        kind === "sector"
          ? "Sektor"
          : kind === "vip"
          ? "VIP"
          : kind === "standing"
          ? "Státie"
          : kind === "stage"
          ? "PÓDIUM"
          : kind === "entrance"
          ? "Vstup"
          : kind === "label"
          ? "Text"
          : "",
      priceCategory: kind === "vip" ? "VIP" : "Regular",
      capacity: kind === "standing" ? 200 : kind === "vip" ? 40 : undefined,
    };
    if (kind === "stage") {
      base.width = 400;
      base.height = 60;
    } else if (kind === "entrance") {
      base.width = 90;
      base.height = 30;
    } else if (kind === "label") {
      base.width = 140;
      base.height = 32;
      base.color = "transparent";
    }
    setShapes((s) => [...s, base]);
    setSelectedIds([base.id]);
    setTool("select");
  };

  const addSingleSeat = (x: number, y: number) => {
    const s: Shape = {
      id: uid(),
      kind: "seats",
      x,
      y,
      width: 26,
      height: 26,
      rows: 1,
      cols: 1,
      seatSize: 22,
      color: "#22c55e",
      label: "",
      priceCategory: "Regular",
      startRow: 1,
      startSeat: 1,
    };
    setShapes((sh) => [...sh, s]);
    setSelectedIds([s.id]);
    setTool("select");
  };

  const addSeatGrid = (cx: number, cy: number) => {
    const f = seatsForm;
    const ss = f.seatSize;
    const gap = 6;
    const w = f.cols * (ss + gap) + 20;
    const h = f.rows * (ss + gap) + 30;
    const s: Shape = {
      id: uid(),
      kind: "seats",
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h,
      rows: f.rows,
      cols: f.cols,
      seatSize: ss,
      color: f.color,
      label: f.sectorName,
      priceCategory: f.priceCategory,
      startRow: 1,
      startSeat: f.startSeat,
    };
    setShapes((arr) => [...arr, s]);
    setSelectedIds([s.id]);
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    setShapes((arr) => arr.filter((s) => !selectedIds.includes(s.id)));
    setSelectedIds([]);
  };

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const copies: Shape[] = [];
    setShapes((arr) => {
      arr.forEach((s) => {
        if (selectedIds.includes(s.id)) {
          copies.push({ ...s, id: uid(), x: s.x + 20, y: s.y + 20 });
        }
      });
      return [...arr, ...copies];
    });
    setTimeout(() => setSelectedIds(copies.map((c) => c.id)), 0);
  };

  const updateSelected = (patch: Partial<Shape>) => {
    setShapes(
      (arr) => arr.map((s) => (selectedIds.includes(s.id) ? { ...s, ...patch } : s)),
      false,
    );
  };

  const commitChange = () => {
    pushHistory(layout);
  };

  // ---------- canvas events ----------
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // click empty area
    const clickedOnEmpty = e.target === e.target.getStage();
    if (!clickedOnEmpty) return;
    if (tool === "select") {
      setSelectedIds([]);
      return;
    }
    if (tool === "seat") {
      const pos = getRelPointer();
      if (pos) addSingleSeat(pos.x, pos.y);
      return;
    }
    if (tool === "label" || tool === "sector" || tool === "vip" || tool === "standing" || tool === "stage" || tool === "entrance") {
      const pos = getRelPointer();
      if (pos) addShape(tool as ShapeKind, pos.x - 100, pos.y - 60);
    }
  };

  const getRelPointer = () => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const t = stage.getAbsoluteTransform().copy().invert();
    return t.point(pos);
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.08;
    const newScale = Math.max(0.2, Math.min(3, direction > 0 ? oldScale * factor : oldScale / factor));
    setScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const fitToScreen = () => {
    setScale(1);
    setStagePos({ x: 0, y: 0 });
  };

  // ---------- selected shape ----------
  const selectedShape = useMemo(
    () => (selectedIds.length === 1 ? layout.shapes.find((s) => s.id === selectedIds[0]) : null),
    [selectedIds, layout.shapes],
  );

  const capacity = useMemo(() => computeCapacity(layout.shapes), [layout.shapes]);

  // ---------- render ----------
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* LEFT TOOLBAR */}
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border/40 bg-card/50 p-2 overflow-y-auto">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Nástroje
        </div>
        <ToolBtn icon={MousePointer2} active={tool === "select"} onClick={() => setTool("select")}>
          Vybrať
        </ToolBtn>
        <ToolBtn icon={Square} active={tool === "sector"} onClick={() => setTool("sector")}>
          Sektor
        </ToolBtn>
        <ToolBtn icon={Star} active={tool === "vip"} onClick={() => setTool("vip")}>
          VIP sektor
        </ToolBtn>
        <ToolBtn icon={Users} active={tool === "standing"} onClick={() => setTool("standing")}>
          Státie
        </ToolBtn>
        <ToolBtn icon={Mic2} active={tool === "stage"} onClick={() => setTool("stage")}>
          Pódium
        </ToolBtn>
        <ToolBtn icon={DoorOpen} active={tool === "entrance"} onClick={() => setTool("entrance")}>
          Vstup
        </ToolBtn>
        <ToolBtn icon={TypeIcon} active={tool === "label"} onClick={() => setTool("label")}>
          Text
        </ToolBtn>
        <ToolBtn icon={CircleIcon} active={tool === "seat"} onClick={() => setTool("seat")}>
          Sedadlo
        </ToolBtn>
        <ToolBtn icon={Grid3x3} active={false} onClick={() => setSeatsDialog(true)}>
          Rad sedadiel…
        </ToolBtn>

        <div className="my-2 border-t border-border/40" />

        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Úpravy
        </div>
        <ToolBtn icon={Copy} active={false} onClick={duplicateSelected} disabled={!selectedIds.length}>
          Duplikovať
        </ToolBtn>
        <ToolBtn icon={Trash2} active={false} onClick={deleteSelected} disabled={!selectedIds.length}>
          Zmazať
        </ToolBtn>
        <div className="grid grid-cols-2 gap-1 px-1">
          <Button size="sm" variant="outline" onClick={undo} disabled={hIdx <= 0} className="gap-1.5">
            <Undo2 className="h-3.5 w-3.5" /> Späť
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={redo}
            disabled={hIdx >= history.length - 1}
            className="gap-1.5"
          >
            <Redo2 className="h-3.5 w-3.5" /> Vpred
          </Button>
        </div>

        <div className="my-2 border-t border-border/40" />
        <div className="px-2 text-[10px] text-muted-foreground">
          Tip: koliesko = zoom, ťahaním plátna = pan, Shift+klik = multi-select.
        </div>
      </aside>

      {/* CENTER CANVAS */}
      <div className="relative flex-1 min-w-0">
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border/40 bg-card/80 backdrop-blur px-2 py-1 shadow-sm">
          <Button size="sm" variant="ghost" onClick={() => setScale((s) => Math.min(3, s * 1.15))} className="h-7 w-7 p-0">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
          <Button size="sm" variant="ghost" onClick={() => setScale((s) => Math.max(0.2, s / 1.15))} className="h-7 w-7 p-0">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={fitToScreen} className="h-7 w-7 p-0">
            <Maximize className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="absolute right-3 top-3 z-10 rounded-md border border-border/40 bg-card/80 backdrop-blur px-3 py-1 text-xs shadow-sm">
          <span className="text-muted-foreground">Kapacita: </span>
          <span className="font-semibold tabular-nums">{capacity}</span>
        </div>

        <div ref={containerRef} className="absolute inset-0" style={{ background: CANVAS_BG }}>
          {size.w > 0 && size.h > 0 && (
            <Stage
              ref={stageRef}
              width={size.w}
              height={size.h}
              x={stagePos.x}
              y={stagePos.y}
              scaleX={scale}
              scaleY={scale}
              draggable={tool === "select"}
              onDragEnd={(e) => {
                if (e.target === e.target.getStage()) {
                  setStagePos({ x: e.target.x(), y: e.target.y() });
                }
              }}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown}
              onTouchStart={handleStageMouseDown}
            >
              <Layer ref={layerRef}>
                {/* grid */}
                <GridLayer width={4000} height={3000} step={20} />

                {layout.shapes.map((sh) => (
                  <ShapeNode
                    key={sh.id}
                    shape={sh}
                    selected={selectedIds.includes(sh.id)}
                    onSelect={(shift) => {
                      if (tool !== "select") return;
                      if (shift) {
                        setSelectedIds((ids) =>
                          ids.includes(sh.id) ? ids.filter((i) => i !== sh.id) : [...ids, sh.id],
                        );
                      } else {
                        setSelectedIds([sh.id]);
                      }
                    }}
                    onChange={(patch) => {
                      setShapes(
                        (arr) => arr.map((s) => (s.id === sh.id ? { ...s, ...patch } : s)),
                        false,
                      );
                    }}
                    onCommit={commitChange}
                  />
                ))}

                <Transformer
                  ref={trRef}
                  rotateEnabled
                  flipEnabled={false}
                  anchorSize={8}
                  anchorStroke="#3b82f6"
                  borderStroke="#3b82f6"
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 20 || newBox.height < 20) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          )}
        </div>
      </div>

      {/* RIGHT PROPERTIES */}
      <aside className="flex w-72 shrink-0 flex-col gap-3 border-l border-border/40 bg-card/50 p-3 overflow-y-auto">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Vlastnosti
        </div>
        {!selectedShape && (
          <p className="text-sm text-muted-foreground">
            {selectedIds.length > 1
              ? `${selectedIds.length} objektov označených`
              : "Vyber objekt na plátne pre úpravu jeho vlastností."}
          </p>
        )}
        {selectedShape && (
          <PropertiesPanel
            shape={selectedShape}
            onChange={(patch) => updateSelected(patch)}
            onCommit={commitChange}
          />
        )}

        <div className="mt-auto pt-3 border-t border-border/40 space-y-2">
          <Label className="text-xs">Názov haly</Label>
          <Input
            value={layout.name}
            onChange={(e) => setLayout({ ...layout, name: e.target.value })}
            onBlur={commitChange}
          />
          <Label className="text-xs">Poznámka</Label>
          <Textarea
            rows={2}
            value={layout.note ?? ""}
            onChange={(e) => setLayout({ ...layout, note: e.target.value })}
            onBlur={commitChange}
          />
          <Button
            className="w-full gap-2"
            onClick={() => {
              upsertLayout({ ...layout, capacity: computeCapacity(layout.shapes) });
              toast.success("Rozloženie uložené");
            }}
          >
            <Save className="h-4 w-4" />
            Uložiť rozloženie
          </Button>
        </div>
      </aside>

      {/* SEATS ROW DIALOG */}
      <Dialog open={seatsDialog} onOpenChange={setSeatsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pridať rad sedadiel</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Počet radov</Label>
              <Input
                type="number"
                min={1}
                value={seatsForm.rows}
                onChange={(e) => setSeatsForm({ ...seatsForm, rows: Math.max(1, +e.target.value || 1) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Miest v rade</Label>
              <Input
                type="number"
                min={1}
                value={seatsForm.cols}
                onChange={(e) => setSeatsForm({ ...seatsForm, cols: Math.max(1, +e.target.value || 1) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Označenie radov</Label>
              <Select
                value={seatsForm.rowLabelMode}
                onValueChange={(v) =>
                  setSeatsForm({ ...seatsForm, rowLabelMode: v as "ABC" | "123" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ABC">A, B, C…</SelectItem>
                  <SelectItem value="123">1, 2, 3…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Počiatočné č. sedadla</Label>
              <Input
                type="number"
                min={1}
                value={seatsForm.startSeat}
                onChange={(e) => setSeatsForm({ ...seatsForm, startSeat: Math.max(1, +e.target.value || 1) })}
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Názov sektora</Label>
              <Input
                value={seatsForm.sectorName}
                onChange={(e) => setSeatsForm({ ...seatsForm, sectorName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cenová kategória</Label>
              <Select
                value={seatsForm.priceCategory}
                onValueChange={(v) => setSeatsForm({ ...seatsForm, priceCategory: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_CATEGORIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Veľkosť sedadla</Label>
              <Input
                type="number"
                min={10}
                max={60}
                value={seatsForm.seatSize}
                onChange={(e) => setSeatsForm({ ...seatsForm, seatSize: Math.max(10, +e.target.value || 22) })}
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Farba</Label>
              <input
                type="color"
                value={seatsForm.color}
                onChange={(e) => setSeatsForm({ ...seatsForm, color: e.target.value })}
                className="h-9 w-full rounded-md border border-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSeatsDialog(false)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => {
                const stage = stageRef.current;
                const cx = stage ? (size.w / 2 - stagePos.x) / scale : 200;
                const cy = stage ? (size.h / 2 - stagePos.y) / scale : 200;
                addSeatGrid(cx, cy);
                setSeatsDialog(false);
                toast.success(`Pridaných ${seatsForm.rows * seatsForm.cols} sedadiel`);
              }}
            >
              Vygenerovať
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =================== sub components ===================

function ToolBtn({
  icon: Icon,
  active,
  disabled,
  children,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
        active
          ? "bg-primary/15 text-primary font-medium"
          : "hover:bg-muted text-foreground/80",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ].join(" ")}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}

function GridLayer({ width, height, step }: { width: number; height: number; step: number }) {
  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= width; x += step) {
    lines.push(
      <Rect key={`v${x}`} x={x} y={0} width={1} height={height} fill="#e2e8f0" opacity={x % (step * 5) === 0 ? 0.7 : 0.3} />,
    );
  }
  for (let y = 0; y <= height; y += step) {
    lines.push(
      <Rect key={`h${y}`} x={0} y={y} width={width} height={1} fill="#e2e8f0" opacity={y % (step * 5) === 0 ? 0.7 : 0.3} />,
    );
  }
  return <Group listening={false}>{lines}</Group>;
}

function ShapeNode({
  shape,
  selected,
  onSelect,
  onChange,
  onCommit,
}: {
  shape: Shape;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onChange: (patch: Partial<Shape>) => void;
  onCommit: () => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);

  const handleTransformEnd = () => {
    const node = groupRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      x: node.x(),
      y: node.y(),
      width: Math.max(20, shape.width * scaleX),
      height: Math.max(20, shape.height * scaleY),
      rotation: node.rotation(),
    });
    onCommit();
  };

  const common = {
    id: shape.id,
    ref: groupRef,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation ?? 0,
    draggable: true,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      onSelect(e.evt.shiftKey);
    },
    onDragStart: () => {
      if (!selected) onSelect(false);
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onChange({ x: e.target.x(), y: e.target.y() });
      onCommit();
    },
    onTransformEnd: handleTransformEnd,
  };

  // SEATS grid renders circles
  if (shape.kind === "seats" && (shape.rows ?? 0) * (shape.cols ?? 0) > 1) {
    const rows = shape.rows ?? 1;
    const cols = shape.cols ?? 1;
    const ss = shape.seatSize ?? 22;
    const gap = 6;
    const padX = 10;
    const padY = 20;
    const seatNodes: React.ReactNode[] = [];
    const rowLabel = (i: number) => String.fromCharCode(65 + i);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = padX + c * (ss + gap) + ss / 2;
        const cy = padY + r * (ss + gap) + ss / 2;
        seatNodes.push(
          <Circle
            key={`${r}-${c}`}
            x={cx}
            y={cy}
            radius={ss / 2}
            fill={shape.color || "#22c55e"}
            stroke="#0f172a"
            strokeWidth={0.6}
            opacity={0.9}
          />,
        );
      }
      seatNodes.push(
        <KText
          key={`l${r}`}
          x={padX - 8}
          y={padY + r * (ss + gap) + ss / 2 - 6}
          text={rowLabel(r)}
          fontSize={10}
          fill="#64748b"
          align="right"
        />,
      );
    }
    return (
      <Group {...common}>
        {shape.label && (
          <KText x={padX} y={2} text={shape.label} fontSize={11} fontStyle="bold" fill="#0f172a" />
        )}
        {seatNodes}
        {selected && (
          <Rect
            x={0}
            y={0}
            width={shape.width}
            height={shape.height}
            stroke="#3b82f6"
            dash={[4, 4]}
            listening={false}
          />
        )}
      </Group>
    );
  }

  // Single seat
  if (shape.kind === "seats") {
    return (
      <Group {...common}>
        <Circle
          x={shape.width / 2}
          y={shape.height / 2}
          radius={Math.min(shape.width, shape.height) / 2}
          fill={shape.color || "#22c55e"}
          stroke="#0f172a"
          strokeWidth={0.8}
        />
      </Group>
    );
  }

  // Label (text only)
  if (shape.kind === "label") {
    return (
      <Group {...common}>
        <Rect
          width={shape.width}
          height={shape.height}
          fill="transparent"
          stroke={selected ? "#3b82f6" : "transparent"}
          dash={[3, 3]}
        />
        <KText
          width={shape.width}
          height={shape.height}
          text={shape.label || "Text"}
          fontSize={16}
          fontStyle="bold"
          fill="#0f172a"
          align="center"
          verticalAlign="middle"
        />
      </Group>
    );
  }

  // Generic rect (sector, vip, standing, stage, entrance)
  const isStage = shape.kind === "stage";
  return (
    <Group {...common}>
      <Rect
        width={shape.width}
        height={shape.height}
        fill={shape.color || SHAPE_COLOR[shape.kind]}
        opacity={isStage ? 0.95 : 0.18}
        stroke={shape.color || SHAPE_COLOR[shape.kind]}
        strokeWidth={2}
        cornerRadius={shape.kind === "entrance" ? 4 : 8}
      />
      <KText
        width={shape.width}
        height={shape.height}
        text={shape.label || ""}
        fontSize={isStage ? 18 : 14}
        fontStyle="bold"
        fill={isStage ? "#fff" : shape.color || "#0f172a"}
        align="center"
        verticalAlign="middle"
        padding={6}
      />
    </Group>
  );
}

function PropertiesPanel({
  shape,
  onChange,
  onCommit,
}: {
  shape: Shape;
  onChange: (patch: Partial<Shape>) => void;
  onCommit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted/40 px-2 py-1.5 text-xs">
        <span className="text-muted-foreground">Typ: </span>
        <span className="font-medium uppercase">{shape.kind}</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Názov / popis</Label>
        <Input
          value={shape.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          onBlur={onCommit}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Farba</Label>
        <input
          type="color"
          value={shape.color ?? "#3b82f6"}
          onChange={(e) => onChange({ color: e.target.value })}
          onBlur={onCommit}
          className="h-9 w-full rounded-md border border-input"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">X</Label>
          <Input
            type="number"
            value={Math.round(shape.x)}
            onChange={(e) => onChange({ x: +e.target.value || 0 })}
            onBlur={onCommit}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Y</Label>
          <Input
            type="number"
            value={Math.round(shape.y)}
            onChange={(e) => onChange({ y: +e.target.value || 0 })}
            onBlur={onCommit}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Šírka</Label>
          <Input
            type="number"
            value={Math.round(shape.width)}
            onChange={(e) => onChange({ width: Math.max(20, +e.target.value || 20) })}
            onBlur={onCommit}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Výška</Label>
          <Input
            type="number"
            value={Math.round(shape.height)}
            onChange={(e) => onChange({ height: Math.max(20, +e.target.value || 20) })}
            onBlur={onCommit}
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Rotácia (°)</Label>
          <Input
            type="number"
            value={Math.round(shape.rotation ?? 0)}
            onChange={(e) => onChange({ rotation: +e.target.value || 0 })}
            onBlur={onCommit}
          />
        </div>
      </div>

      {(shape.kind === "sector" || shape.kind === "vip" || shape.kind === "standing" || shape.kind === "seats") && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Cenová kategória</Label>
            <Select
              value={shape.priceCategory ?? "Regular"}
              onValueChange={(v) => {
                onChange({ priceCategory: v });
                setTimeout(onCommit, 0);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_CATEGORIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(shape.kind === "standing" || shape.kind === "vip" || shape.kind === "sector") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Kapacita</Label>
              <Input
                type="number"
                value={shape.capacity ?? 0}
                onChange={(e) => onChange({ capacity: Math.max(0, +e.target.value || 0) })}
                onBlur={onCommit}
              />
            </div>
          )}

          {shape.kind === "seats" && (shape.rows ?? 0) * (shape.cols ?? 0) > 1 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Radov</Label>
                <Input
                  type="number"
                  min={1}
                  value={shape.rows ?? 1}
                  onChange={(e) => onChange({ rows: Math.max(1, +e.target.value || 1) })}
                  onBlur={onCommit}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Miest v rade</Label>
                <Input
                  type="number"
                  min={1}
                  value={shape.cols ?? 1}
                  onChange={(e) => onChange({ cols: Math.max(1, +e.target.value || 1) })}
                  onBlur={onCommit}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
