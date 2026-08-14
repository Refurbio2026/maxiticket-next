import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Stage, Layer, Rect, Text as KText, Group, Circle, Transformer } from "react-konva";
import type Konva from "konva";
import {
  computeCapacity,
  uid,
  type CurveGroup,
  type HallLayout,
  type Shape,
  type ShapeKind,
} from "@/lib/layout-types";
import { useUpsertLayout, toLayoutInput } from "@/hooks/use-layouts";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPriceCategories } from "@/lib/price-categories.functions";
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

type Tool = "select" | "sector" | "vip" | "standing" | "stage" | "entrance" | "label" | "seat";

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

/** Záloha, kým sa načíta číselník zo servera — a pre prípad prázdnej tabuľky. */
const FALLBACK_PRICE_CATEGORIES = ["Regular", "VIP", "Premium", "Early Bird", "ZŤP"];

/**
 * Názvy cenových zón z číselníka (Dáta → Cenové kategórie). Editor ich len
 * ponúka a ukladá do tvaru; cenu dostávajú až v konkrétnom podujatí.
 */
function usePriceCategoryNames(): string[] {
  const fetchZones = useServerFn(listPriceCategories);
  const { data } = useQuery({
    queryKey: ["price-categories", "active"],
    queryFn: () => fetchZones({ data: { only_active: true } }),
  });
  return data?.length ? data.map((z) => z.name) : FALLBACK_PRICE_CATEGORIES;
}

const CANVAS_BG = "#f8fafc";

const formatRowLabel = (i: number, mode: "ABC" | "123" = "ABC") =>
  mode === "ABC"
    ? i < 26
      ? String.fromCharCode(65 + i)
      : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26))
    : String(i + 1);

function buildCurveGroupSeats(group: CurveGroup, previous: Shape[] = []): Shape[] {
  const ss = group.seatSize ?? 22;
  const startSeat = group.startSeat ?? 1;
  const existing = new Map(
    previous.map((seat) => [`${seat.startRow ?? 1}:${seat.seatNumber ?? 1}`, seat]),
  );
  const seats: Shape[] = [];
  const totalAngle = group.endAngle - group.startAngle;
  const fullArc = Math.abs(totalAngle) >= 360;

  for (let r = 0; r < Math.max(1, group.rows); r++) {
    const rowRadius = group.radius + r * group.rowSpacing;
    const rowLabel = formatRowLabel(r, group.rowLabelMode ?? "ABC");
    for (let c = 0; c < Math.max(1, group.seatsPerRow); c++) {
      const relativeAngle =
        group.seatsPerRow === 1
          ? group.startAngle + totalAngle / 2
          : group.startAngle +
            (totalAngle * c) / (fullArc ? group.seatsPerRow : group.seatsPerRow - 1);
      const worldAngle = relativeAngle + group.rotation;
      const rad = (worldAngle * Math.PI) / 180;
      const x = group.centerX + rowRadius * Math.cos(rad);
      const y = group.centerY + rowRadius * Math.sin(rad);
      const seatNumber = startSeat + c;
      const old = existing.get(`${r + 1}:${seatNumber}`);

      seats.push({
        id: old?.id ?? uid(),
        kind: "seats",
        x: x - ss / 2,
        y: y - ss / 2,
        width: ss,
        height: ss,
        rotation: (worldAngle + 90) % 360,
        rows: 1,
        cols: 1,
        seatSize: ss,
        color: group.color,
        label: old?.label ?? "",
        priceCategory: group.priceCategoryId ?? "Regular",
        priceCategoryId: group.priceCategoryId,
        row: rowLabel,
        rowLabel,
        seatNumber,
        sectorId: group.sectorId,
        curveGroupId: group.id,
        relativeAngle,
        relativeRadius: rowRadius,
        radius: rowRadius,
        angle: worldAngle,
        startAngle: group.startAngle,
        endAngle: group.endAngle,
        rowSpacing: group.rowSpacing,
        seatSpacing: group.seatSpacing,
        startRow: r + 1,
        startSeat,
      });
    }
  }

  return seats;
}

function getCurveBounds(seats: Shape[]) {
  if (!seats.length) return { x: 0, y: 0, width: 80, height: 80 };
  const minX = Math.min(...seats.map((seat) => seat.x));
  const minY = Math.min(...seats.map((seat) => seat.y));
  const maxX = Math.max(...seats.map((seat) => seat.x + seat.width));
  const maxY = Math.max(...seats.map((seat) => seat.y + seat.height));
  return { x: minX - 10, y: minY - 10, width: maxX - minX + 20, height: maxY - minY + 20 };
}

function normalizeLayout(input: HallLayout): HallLayout {
  const curveGroups = [...(input.curveGroups ?? [])];
  const known = new Set(curveGroups.map((group) => group.id));
  const missingGroupIds = Array.from(
    new Set(
      input.shapes
        .map((shape) => shape.curveGroupId)
        .filter((id): id is string => Boolean(id))
        .filter((id) => !known.has(id)),
    ),
  );

  for (const id of missingGroupIds) {
    const seats = input.shapes.filter((shape) => shape.curveGroupId === id);
    const first = seats[0];
    if (!first) continue;
    const firstAngle = typeof first.angle === "number" ? first.angle : 0;
    const angleDeg =
      Math.abs(firstAngle) <= Math.PI * 2 ? (firstAngle * 180) / Math.PI : firstAngle;
    const radius = first.radius ?? first.relativeRadius ?? 280;
    const centerX = first.x + first.width / 2 - radius * Math.cos((angleDeg * Math.PI) / 180);
    const centerY = first.y + first.height / 2 - radius * Math.sin((angleDeg * Math.PI) / 180);
    const rows = new Set(seats.map((seat) => seat.startRow ?? seat.row ?? "1")).size || 1;
    const seatsPerRow = Math.max(
      ...Object.values(
        seats.reduce<Record<string, number>>((acc, seat) => {
          const key = String(seat.startRow ?? seat.row ?? "1");
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      ),
      1,
    );
    curveGroups.push({
      id,
      name: first.sectorId ?? "Zakrivený blok",
      centerX,
      centerY,
      radius,
      startAngle: first.startAngle ?? 220,
      endAngle: first.endAngle ?? 320,
      rows,
      seatsPerRow,
      rowSpacing: first.rowSpacing ?? 32,
      seatSpacing: first.seatSpacing ?? 30,
      rotation: 0,
      sectorId: first.sectorId,
      priceCategoryId: first.priceCategoryId ?? first.priceCategory,
      color: first.color ?? "#22c55e",
      rowLabelMode: "ABC",
      startSeat: first.startSeat ?? 1,
      seatSize: first.seatSize ?? first.width ?? 22,
    });
  }

  const curveGroupIds = new Set(curveGroups.map((group) => group.id));
  return {
    ...input,
    curveGroups,
    shapes: [
      ...input.shapes.filter(
        (shape) => !shape.curveGroupId || !curveGroupIds.has(shape.curveGroupId),
      ),
      ...curveGroups.flatMap((group) =>
        buildCurveGroupSeats(
          group,
          input.shapes.filter((shape) => shape.curveGroupId === group.id),
        ),
      ),
    ],
  };
}

export function SeatingEditor({
  initial,
  onChange,
}: {
  initial: HallLayout;
  onChange?: (l: HallLayout) => void;
}) {
  const priceCategories = usePriceCategoryNames();

  // ---------- state ----------
  const normalizedInitial = useMemo(() => normalizeLayout(initial), [initial]);
  const [layout, setLayout] = useState<HallLayout>(normalizedInitial);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [history, setHistory] = useState<HallLayout[]>([normalizedInitial]);
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
  const [curvedDialog, setCurvedDialog] = useState(false);
  const [curvedForm, setCurvedForm] = useState({
    rows: 6,
    cols: 16,
    rowLabelMode: "ABC" as "ABC" | "123",
    startSeat: 1,
    radius: 280,
    rowSpacing: 32,
    seatSpacing: 30,
    startAngle: 220, // degrees
    endAngle: 320,
    direction: "ltr" as "ltr" | "rtl",
    faceStage: true,
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
  // Ukladá sa do databázy, nie do localStorage — sála musí byť dostupná na
  // každom zariadení a hlavne serveru, ktorý podľa nej určuje VIP sedadlá.
  const upsert = useUpsertLayout();
  const saveRef = useRef(upsert.mutateAsync);
  saveRef.current = upsert.mutateAsync;

  useEffect(() => {
    const t = setTimeout(() => {
      const next = { ...layout, capacity: computeCapacity(layout.shapes) };
      saveRef
        .current(toLayoutInput(next))
        .then(() => onChange?.(next))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Uloženie sály zlyhalo"));
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
  }, [selectedIds, layout.shapes, layout.curveGroups]);

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

  const getVisibleCenter = () => ({
    x: (size.w / 2 - stagePos.x) / scale,
    y: (size.h / 2 - stagePos.y) / scale,
  });

  const addCurvedRows = (cx: number, cy: number) => {
    const f = curvedForm;
    const group: CurveGroup = {
      id: uid(),
      name: f.sectorName || "Zakrivený blok",
      centerX: cx,
      centerY: cy,
      radius: f.radius,
      startAngle: f.direction === "rtl" ? f.endAngle : f.startAngle,
      endAngle: f.direction === "rtl" ? f.startAngle : f.endAngle,
      rows: f.rows,
      seatsPerRow: f.cols,
      rowSpacing: f.rowSpacing,
      seatSpacing: f.seatSpacing,
      rotation: f.faceStage ? 0 : -90,
      sectorId: f.sectorName,
      priceCategoryId: f.priceCategory,
      color: f.color,
      rowLabelMode: f.rowLabelMode,
      startSeat: f.startSeat,
      seatSize: f.seatSize,
    };
    const newSeats = buildCurveGroupSeats(group);
    setLayout((prev) => {
      const next = {
        ...prev,
        curveGroups: [...(prev.curveGroups ?? []), group],
        shapes: [...prev.shapes, ...newSeats],
      };
      setTimeout(() => pushHistory(next), 0);
      return next;
    });
    setSelectedIds([group.id]);
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
    setLayout((prev) => {
      const selectedGroups = new Set(
        (prev.curveGroups ?? [])
          .filter((group) => selectedIds.includes(group.id))
          .map((group) => group.id),
      );
      const next = {
        ...prev,
        curveGroups: (prev.curveGroups ?? []).filter((group) => !selectedGroups.has(group.id)),
        shapes: prev.shapes.filter(
          (s) => !selectedIds.includes(s.id) && !selectedGroups.has(s.curveGroupId ?? ""),
        ),
      };
      setTimeout(() => pushHistory(next), 0);
      return next;
    });
    setSelectedIds([]);
  };

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const copies: Shape[] = [];
    const groupCopies: CurveGroup[] = [];
    setLayout((prev) => {
      const selectedGroups = (prev.curveGroups ?? []).filter((group) =>
        selectedIds.includes(group.id),
      );
      selectedGroups.forEach((group) => {
        const nextGroup = {
          ...group,
          id: uid(),
          name: `${group.name} (kópia)`,
          centerX: group.centerX + 30,
          centerY: group.centerY + 30,
        };
        groupCopies.push(nextGroup);
        copies.push(...buildCurveGroupSeats(nextGroup));
      });
      prev.shapes.forEach((s) => {
        if (selectedIds.includes(s.id) && !s.curveGroupId) {
          copies.push({ ...s, id: uid(), x: s.x + 20, y: s.y + 20 });
        }
      });
      const next = {
        ...prev,
        curveGroups: [...(prev.curveGroups ?? []), ...groupCopies],
        shapes: [...prev.shapes, ...copies],
      };
      setTimeout(() => pushHistory(next), 0);
      return next;
    });
    setTimeout(
      () =>
        setSelectedIds(groupCopies.length ? groupCopies.map((g) => g.id) : copies.map((c) => c.id)),
      0,
    );
  };

  const updateSelected = (patch: Partial<Shape>) => {
    setShapes(
      (arr) => arr.map((s) => (selectedIds.includes(s.id) ? { ...s, ...patch } : s)),
      false,
    );
  };

  const updateCurveGroup = (groupId: string, patch: Partial<CurveGroup>, commit = false) => {
    setLayout((prev) => {
      const current = (prev.curveGroups ?? []).find((group) => group.id === groupId);
      if (!current) return prev;
      const nextGroup = { ...current, ...patch };
      const previousSeats = prev.shapes.filter((shape) => shape.curveGroupId === groupId);
      const nextSeats = buildCurveGroupSeats(nextGroup, previousSeats);
      const next = {
        ...prev,
        curveGroups: (prev.curveGroups ?? []).map((group) =>
          group.id === groupId ? nextGroup : group,
        ),
        shapes: [...prev.shapes.filter((shape) => shape.curveGroupId !== groupId), ...nextSeats],
      };
      if (commit) setTimeout(() => pushHistory(next), 0);
      return next;
    });
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
    if (
      tool === "label" ||
      tool === "sector" ||
      tool === "vip" ||
      tool === "standing" ||
      tool === "stage" ||
      tool === "entrance"
    ) {
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
    const newScale = Math.max(
      0.2,
      Math.min(3, direction > 0 ? oldScale * factor : oldScale / factor),
    );
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
  const selectedCurveGroup = useMemo(
    () =>
      selectedIds.length === 1
        ? (layout.curveGroups ?? []).find((group) => group.id === selectedIds[0])
        : null,
    [selectedIds, layout.curveGroups],
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
        <ToolBtn icon={CircleIcon} active={false} onClick={() => setCurvedDialog(true)}>
          Zakrivený rad sedadiel…
        </ToolBtn>

        <div className="my-2 border-t border-border/40" />

        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Úpravy
        </div>
        <ToolBtn
          icon={Copy}
          active={false}
          onClick={duplicateSelected}
          disabled={!selectedIds.length}
        >
          Duplikovať
        </ToolBtn>
        <ToolBtn
          icon={Trash2}
          active={false}
          onClick={deleteSelected}
          disabled={!selectedIds.length}
        >
          Zmazať
        </ToolBtn>
        <div className="grid grid-cols-2 gap-1 px-1">
          <Button
            size="sm"
            variant="outline"
            onClick={undo}
            disabled={hIdx <= 0}
            className="gap-1.5"
          >
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setScale((s) => Math.min(3, s * 1.15))}
            className="h-7 w-7 p-0"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setScale((s) => Math.max(0.2, s / 1.15))}
            className="h-7 w-7 p-0"
          >
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
            >
              <Layer ref={layerRef}>
                {/* grid */}
                <GridLayer width={4000} height={3000} step={20} />

                {(layout.curveGroups ?? []).map((group) => {
                  const seats = layout.shapes.filter((shape) => shape.curveGroupId === group.id);
                  return (
                    <CurveGroupNode
                      key={group.id}
                      group={group}
                      seats={seats}
                      selected={selectedIds.includes(group.id)}
                      selectedSeatIds={selectedIds.filter((id) =>
                        seats.some((seat) => seat.id === id),
                      )}
                      onSelect={(shift: boolean) => {
                        if (tool !== "select") return;
                        if (shift) {
                          setSelectedIds((ids) =>
                            ids.includes(group.id)
                              ? ids.filter((i) => i !== group.id)
                              : [...ids, group.id],
                          );
                        } else {
                          setSelectedIds([group.id]);
                        }
                      }}
                      onSeatSelect={(seatId: string, shift: boolean) => {
                        if (tool !== "select") return;
                        if (shift) {
                          setSelectedIds((ids) =>
                            ids.includes(seatId)
                              ? ids.filter((i) => i !== seatId)
                              : [...ids.filter((id) => id !== group.id), seatId],
                          );
                        } else {
                          setSelectedIds([group.id]);
                        }
                      }}
                      onSeatEdit={(seatId: string) => {
                        if (tool !== "select") return;
                        setSelectedIds([seatId]);
                      }}
                      onMove={(dx: number, dy: number) =>
                        updateCurveGroup(
                          group.id,
                          { centerX: group.centerX + dx, centerY: group.centerY + dy },
                          true,
                        )
                      }
                      onCommit={commitChange}
                    />
                  );
                })}

                {layout.shapes
                  .filter((shape) => !shape.curveGroupId)
                  .map((sh) => (
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
                  rotateEnabled={!selectedCurveGroup}
                  resizeEnabled={!selectedCurveGroup}
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
        {!selectedShape && !selectedCurveGroup && (
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
        {selectedCurveGroup && (
          <CurveGroupPropertiesPanel
            group={selectedCurveGroup}
            onChange={(patch: Partial<CurveGroup>) =>
              updateCurveGroup(selectedCurveGroup.id, patch)
            }
            onCommit={() => pushHistory(layout)}
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
            disabled={upsert.isPending}
            onClick={async () => {
              try {
                await upsert.mutateAsync(
                  toLayoutInput({ ...layout, capacity: computeCapacity(layout.shapes) }),
                );
                toast.success("Rozloženie uložené");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Uloženie sály zlyhalo");
              }
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
                onChange={(e) =>
                  setSeatsForm({ ...seatsForm, rows: Math.max(1, +e.target.value || 1) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Miest v rade</Label>
              <Input
                type="number"
                min={1}
                value={seatsForm.cols}
                onChange={(e) =>
                  setSeatsForm({ ...seatsForm, cols: Math.max(1, +e.target.value || 1) })
                }
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
                onChange={(e) =>
                  setSeatsForm({ ...seatsForm, startSeat: Math.max(1, +e.target.value || 1) })
                }
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
                  {priceCategories.map((p) => (
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
                onChange={(e) =>
                  setSeatsForm({ ...seatsForm, seatSize: Math.max(10, +e.target.value || 22) })
                }
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
                const center = getVisibleCenter();
                addSeatGrid(center.x, center.y);
                setSeatsDialog(false);
                toast.success(`Pridaných ${seatsForm.rows * seatsForm.cols} sedadiel`);
              }}
            >
              Vygenerovať
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CURVED ROW DIALOG */}
      <Dialog open={curvedDialog} onOpenChange={setCurvedDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pridať zakrivený rad sedadiel</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-2">
            <Field label="Počet radov">
              <Input
                type="number"
                min={1}
                value={curvedForm.rows}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, rows: Math.max(1, +e.target.value || 1) })
                }
              />
            </Field>
            <Field label="Miest v rade">
              <Input
                type="number"
                min={1}
                value={curvedForm.cols}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, cols: Math.max(1, +e.target.value || 1) })
                }
              />
            </Field>
            <Field label="Počiatočné č. sedadla">
              <Input
                type="number"
                min={1}
                value={curvedForm.startSeat}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, startSeat: Math.max(1, +e.target.value || 1) })
                }
              />
            </Field>
            <Field label="Označenie radov">
              <Select
                value={curvedForm.rowLabelMode}
                onValueChange={(v) =>
                  setCurvedForm({ ...curvedForm, rowLabelMode: v as "ABC" | "123" })
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
            </Field>
            <Field label="Polomer (px)">
              <Input
                type="number"
                min={50}
                value={curvedForm.radius}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, radius: Math.max(50, +e.target.value || 280) })
                }
              />
            </Field>
            <Field label="Vzdialenosť radov">
              <Input
                type="number"
                min={10}
                value={curvedForm.rowSpacing}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, rowSpacing: Math.max(10, +e.target.value || 32) })
                }
              />
            </Field>
            <Field label="Vzdialenosť sedadiel">
              <Input
                type="number"
                min={10}
                value={curvedForm.seatSpacing}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, seatSpacing: Math.max(10, +e.target.value || 30) })
                }
              />
            </Field>
            <Field label="Uhol začiatku (°)">
              <Input
                type="number"
                value={curvedForm.startAngle}
                onChange={(e) => setCurvedForm({ ...curvedForm, startAngle: +e.target.value || 0 })}
              />
            </Field>
            <Field label="Uhol konca (°)">
              <Input
                type="number"
                value={curvedForm.endAngle}
                onChange={(e) => setCurvedForm({ ...curvedForm, endAngle: +e.target.value || 0 })}
              />
            </Field>
            <Field label="Veľkosť sedadla">
              <Input
                type="number"
                min={10}
                max={60}
                value={curvedForm.seatSize}
                onChange={(e) =>
                  setCurvedForm({ ...curvedForm, seatSize: Math.max(10, +e.target.value || 22) })
                }
              />
            </Field>
            <Field label="Smer číslovania">
              <Select
                value={curvedForm.direction}
                onValueChange={(v) =>
                  setCurvedForm({ ...curvedForm, direction: v as "ltr" | "rtl" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ltr">Zľava doprava</SelectItem>
                  <SelectItem value="rtl">Sprava doľava</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Natočiť k pódiu">
              <Select
                value={curvedForm.faceStage ? "yes" : "no"}
                onValueChange={(v) => setCurvedForm({ ...curvedForm, faceStage: v === "yes" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Áno</SelectItem>
                  <SelectItem value="no">Nie</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sektor" className="col-span-2">
              <Input
                value={curvedForm.sectorName}
                onChange={(e) => setCurvedForm({ ...curvedForm, sectorName: e.target.value })}
              />
            </Field>
            <Field label="Cenová kategória">
              <Select
                value={curvedForm.priceCategory}
                onValueChange={(v) => setCurvedForm({ ...curvedForm, priceCategory: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priceCategories.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Farba" className="col-span-3">
              <input
                type="color"
                value={curvedForm.color}
                onChange={(e) => setCurvedForm({ ...curvedForm, color: e.target.value })}
                className="h-9 w-full rounded-md border border-input"
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: pre polkruh nastav uhly 180° → 360°, pre arénové rozloženie 0° → 360°. Stred oblúka
            (pódium) je v strede aktuálneho pohľadu.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCurvedDialog(false)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => {
                const center = getVisibleCenter();
                addCurvedRows(center.x, center.y);
                setCurvedDialog(false);
                toast.success(
                  `Pridaných ${curvedForm.rows * curvedForm.cols} zakrivených sedadiel`,
                );
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

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={["space-y-1.5", className ?? ""].join(" ")}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

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
        active ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground/80",
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
      <Rect
        key={`v${x}`}
        x={x}
        y={0}
        width={1}
        height={height}
        fill="#e2e8f0"
        opacity={x % (step * 5) === 0 ? 0.7 : 0.3}
      />,
    );
  }
  for (let y = 0; y <= height; y += step) {
    lines.push(
      <Rect
        key={`h${y}`}
        x={0}
        y={y}
        width={width}
        height={1}
        fill="#e2e8f0"
        opacity={y % (step * 5) === 0 ? 0.7 : 0.3}
      />,
    );
  }
  return <Group listening={false}>{lines}</Group>;
}

function CurveGroupNode({
  group,
  seats,
  selected,
  selectedSeatIds,
  onSelect,
  onSeatSelect,
  onSeatEdit,
  onMove,
}: {
  group: CurveGroup;
  seats: Shape[];
  selected: boolean;
  selectedSeatIds: string[];
  onSelect: (shift: boolean) => void;
  onSeatSelect: (seatId: string, shift: boolean) => void;
  onSeatEdit: (seatId: string) => void;
  onMove: (dx: number, dy: number) => void;
  onCommit: () => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const bounds = getCurveBounds(seats);

  return (
    <Group
      id={group.id}
      ref={groupRef}
      x={bounds.x}
      y={bounds.y}
      draggable
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(e.evt.shiftKey);
      }}
      onDragStart={() => {
        if (!selected) onSelect(false);
      }}
      onDragEnd={(e) => {
        onMove(e.target.x() - bounds.x, e.target.y() - bounds.y);
      }}
    >
      <Rect
        x={0}
        y={0}
        width={bounds.width}
        height={bounds.height}
        fill="rgba(15,23,42,0.01)"
        stroke={selected ? "#3b82f6" : "transparent"}
        strokeWidth={1.5}
        dash={[6, 4]}
        cornerRadius={6}
      />
      {seats.map((seat) => (
        <Circle
          id={seat.id}
          key={seat.id}
          x={seat.x - bounds.x + seat.width / 2}
          y={seat.y - bounds.y + seat.height / 2}
          radius={Math.min(seat.width, seat.height) / 2}
          fill={seat.color || group.color}
          stroke={selectedSeatIds.includes(seat.id) ? "#f97316" : "#0f172a"}
          strokeWidth={selectedSeatIds.includes(seat.id) ? 2 : 0.8}
          rotation={seat.rotation ?? 0}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onSeatSelect(seat.id, e.evt.shiftKey);
          }}
          onDblClick={(e) => {
            e.cancelBubble = true;
            onSeatEdit(seat.id);
          }}
        />
      ))}
      <KText
        x={8}
        y={6}
        text={group.name}
        fontSize={11}
        fontStyle="bold"
        fill="#0f172a"
        listening={false}
      />
    </Group>
  );
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

function CurveGroupPropertiesPanel({
  group,
  onChange,
  onCommit,
}: {
  group: CurveGroup;
  onChange: (patch: Partial<CurveGroup>) => void;
  onCommit: () => void;
}) {
  const priceCategories = usePriceCategoryNames();
  const numberPatch =
    (key: keyof CurveGroup, min?: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = +e.target.value;
      const value = Number.isFinite(raw) ? raw : 0;
      onChange({
        [key]: typeof min === "number" ? Math.max(min, value) : value,
      } as Partial<CurveGroup>);
    };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-primary/10 px-2 py-1.5 text-xs text-primary">
        <span className="text-muted-foreground">Typ: </span>
        <span className="font-medium uppercase">curve group</span>
      </div>

      <Field label="Názov skupiny">
        <Input
          value={group.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={onCommit}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="centerX">
          <Input
            type="number"
            value={Math.round(group.centerX)}
            onChange={numberPatch("centerX")}
            onBlur={onCommit}
          />
        </Field>
        <Field label="centerY">
          <Input
            type="number"
            value={Math.round(group.centerY)}
            onChange={numberPatch("centerY")}
            onBlur={onCommit}
          />
        </Field>
        <Field label="radius">
          <Input
            type="number"
            min={20}
            value={Math.round(group.radius)}
            onChange={numberPatch("radius", 20)}
            onBlur={onCommit}
          />
        </Field>
        <Field label="rotation">
          <Input
            type="number"
            value={Math.round(group.rotation)}
            onChange={numberPatch("rotation")}
            onBlur={onCommit}
          />
        </Field>
        <Field label="startAngle">
          <Input
            type="number"
            value={Math.round(group.startAngle)}
            onChange={numberPatch("startAngle")}
            onBlur={onCommit}
          />
        </Field>
        <Field label="endAngle">
          <Input
            type="number"
            value={Math.round(group.endAngle)}
            onChange={numberPatch("endAngle")}
            onBlur={onCommit}
          />
        </Field>
        <Field label="Počet radov">
          <Input
            type="number"
            min={1}
            value={group.rows}
            onChange={numberPatch("rows", 1)}
            onBlur={onCommit}
          />
        </Field>
        <Field label="Sedadiel v rade">
          <Input
            type="number"
            min={1}
            value={group.seatsPerRow}
            onChange={numberPatch("seatsPerRow", 1)}
            onBlur={onCommit}
          />
        </Field>
        <Field label="rowSpacing">
          <Input
            type="number"
            min={1}
            value={group.rowSpacing}
            onChange={numberPatch("rowSpacing", 1)}
            onBlur={onCommit}
          />
        </Field>
        <Field label="seatSpacing">
          <Input
            type="number"
            min={1}
            value={group.seatSpacing}
            onChange={numberPatch("seatSpacing", 1)}
            onBlur={onCommit}
          />
        </Field>
      </div>

      <Field label="Sektor">
        <Input
          value={group.sectorId ?? ""}
          onChange={(e) => onChange({ sectorId: e.target.value })}
          onBlur={onCommit}
        />
      </Field>

      <Field label="Cenová kategória">
        <Select
          value={group.priceCategoryId ?? "Regular"}
          onValueChange={(v) => onChange({ priceCategoryId: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {priceCategories.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Farba">
        <input
          type="color"
          value={group.color}
          onChange={(e) => onChange({ color: e.target.value })}
          onBlur={onCommit}
          className="h-9 w-full rounded-md border border-input"
        />
      </Field>
    </div>
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
  const priceCategories = usePriceCategoryNames();
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

      {(shape.kind === "sector" ||
        shape.kind === "vip" ||
        shape.kind === "standing" ||
        shape.kind === "seats") && (
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
                {priceCategories.map((p) => (
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
