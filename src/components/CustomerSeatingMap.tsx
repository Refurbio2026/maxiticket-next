import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Stage, Layer, Rect, Text as KText, Group } from "react-konva";
import type Konva from "konva";
import type { HallLayout, Shape } from "@/lib/layouts-db";
import type { SeatInventoryRow } from "@/lib/ticketing-db";

export type CustomerSeat = {
  seat_id: string;
  label: string;
  price: number;
  is_vip: boolean;
};

type Props = {
  layout: HallLayout;
  basePrice: number;
  vipPrice: number;
  inventory: SeatInventoryRow[];
  selected: string[];
  onToggle: (seat: CustomerSeat) => void;
  customerSeatMapMode?: boolean;
};

const COLORS = {
  available: "#22c55e",
  selected: "#3b82f6",
  reserved: "#f59e0b",
  sold: "#737373",
  vipAvailable: "#eab308",
  stage: "#0f172a",
  sector: "#1e293b",
  standing: "#f59e0b",
  vipArea: "#a855f7",
  entrance: "#475569",
  bar: "#7c2d12",
  wc: "#0e7490",
  tech: "#3f3f46",
  label: "#94a3b8",
};

function seatLabel(s: Shape): string {
  if (s.row && s.seatNumber != null) return `${s.label || "Sektor"} · Rad ${s.row} · ${s.seatNumber}`;
  if (s.label) return s.label;
  return "Sedadlo";
}

export function CustomerSeatingMap({
  layout,
  basePrice,
  vipPrice,
  inventory,
  selected,
  onToggle,
  customerSeatMapMode = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const canPan = panMode || spaceDown;
  const stageCanDrag = customerSeatMapMode ? canPan : true;

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = containerRef.current!.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(360, r.height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const invMap = useMemo(() => {
    const m = new Map<string, SeatInventoryRow>();
    for (const r of inventory) m.set(r.seat_id, r);
    return m;
  }, [inventory]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const bounds = useMemo(() => {
    const shapes = layout.shapes;
    if (!shapes.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.width);
      maxY = Math.max(maxY, s.y + s.height);
    }
    return { minX, minY, maxX, maxY };
  }, [layout.shapes]);

  const getBoundedPosition = useCallback(
    (next: { x: number; y: number }, targetScale: number) => {
      if (!bounds) return next;
      const pad = 28;
      const contentW = (bounds.maxX - bounds.minX) * targetScale;
      const contentH = (bounds.maxY - bounds.minY) * targetScale;

      const boundAxis = (
        value: number,
        containerSize: number,
        contentSize: number,
        minContent: number,
        maxContent: number,
      ) => {
        if (contentSize + pad * 2 <= containerSize) {
          return (containerSize - contentSize) / 2 - minContent * targetScale;
        }
        const min = containerSize - pad - maxContent * targetScale;
        const max = pad - minContent * targetScale;
        return Math.min(max, Math.max(min, value));
      };

      return {
        x: boundAxis(next.x, size.w, contentW, bounds.minX, bounds.maxX),
        y: boundAxis(next.y, size.h, contentH, bounds.minY, bounds.maxY),
      };
    },
    [bounds, size.h, size.w],
  );

  const fitView = useCallback(() => {
    if (!bounds) return;
    const pad = 48;
    const cw = bounds.maxX - bounds.minX + pad * 2;
    const ch = bounds.maxY - bounds.minY + pad * 2;
    const k = Math.min(size.w / cw, size.h / ch, 1.5);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    setScale(k);
    setPos(getBoundedPosition({ x: size.w / 2 - centerX * k, y: size.h / 2 - centerY * k }, k));
  }, [bounds, getBoundedPosition, size.h, size.w]);

  useEffect(() => {
    fitView();
  }, [fitView, layout.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const zoomBy = (factor: number) => {
    const oldScale = scale;
    const ns = Math.max(0.3, Math.min(4, oldScale * factor));
    const ptr = { x: size.w / 2, y: size.h / 2 };
    const mp = { x: (ptr.x - pos.x) / oldScale, y: (ptr.y - pos.y) / oldScale };
    setScale(ns);
    setPos(getBoundedPosition({ x: ptr.x - mp.x * ns, y: ptr.y - mp.y * ns }, ns));
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const oldScale = scale;
    const stage = e.target.getStage();
    if (!stage) return;
    const ptr = stage.getPointerPosition();
    if (!ptr) return;
    const mp = { x: (ptr.x - pos.x) / oldScale, y: (ptr.y - pos.y) / oldScale };
    const dir = e.evt.deltaY > 0 ? -1 : 1;
    const ns = Math.max(0.3, Math.min(4, oldScale * (1 + dir * 0.1)));
    setScale(ns);
    setPos(getBoundedPosition({ x: ptr.x - mp.x * ns, y: ptr.y - mp.y * ns }, ns));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[520px] rounded-xl overflow-hidden border border-border/40 bg-[#f8fafc]"
    >
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 rounded-lg border border-border/50 bg-background/95 p-2 shadow-sm backdrop-blur">
        <MapControlButton onClick={() => zoomBy(1.18)}>+</MapControlButton>
        <MapControlButton onClick={() => zoomBy(0.85)}>−</MapControlButton>
        <button
          type="button"
          onClick={fitView}
          className="h-8 rounded-md border border-border/60 bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
        >
          Reset zobrazenia
        </button>
        <button
          type="button"
          onClick={() => setPanMode((v) => !v)}
          className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${
            canPan
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/60 bg-background text-foreground hover:bg-muted"
          }`}
        >
          Presun mapy
        </button>
      </div>
      <Stage
        width={size.w}
        height={size.h}
        draggable={stageCanDrag}
        dragBoundFunc={(next) => getBoundedPosition(next, scale)}
        x={pos.x}
        y={pos.y}
        scaleX={scale}
        scaleY={scale}
        onWheel={onWheel}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = stageCanDrag ? "grab" : "default";
        }}
        onDragStart={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "grabbing";
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            setPos(getBoundedPosition({ x: e.target.x(), y: e.target.y() }, scale));
          }
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = stageCanDrag ? "grab" : "default";
        }}
      >
        <Layer>
          {layout.shapes.map((s) => {
            // Expand a "seats" grid (rows x cols) into individual clickable seats
            if (s.kind === "seats" && (s.rows ?? 0) * (s.cols ?? 0) > 1) {
              const rows = s.rows ?? 1;
              const cols = s.cols ?? 1;
              const ss = s.seatSize ?? 22;
              const gap = 6;
              const padX = 10;
              const padY = 20;
              const startRow = s.startRow ?? 1;
              const startSeat = s.startSeat ?? 1;
              const rowLabel = (i: number) => String.fromCharCode(64 + startRow + i);
              const isVipGrid = s.priceCategory === "VIP";
              const nodes: React.ReactNode[] = [];
              if (s.label) {
                nodes.push(
                  <KText
                    key={`hdr-${s.id}`}
                    x={padX}
                    y={2}
                    text={s.label}
                    fontSize={11}
                    fontStyle="bold"
                    fill="#0f172a"
                  />,
                );
              }
              for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                  const seatId = `${s.id}::r${r}c${c}`;
                  const inv = invMap.get(seatId);
                  const isVip = !!inv?.is_vip || isVipGrid;
                  let fill = isVip ? COLORS.vipAvailable : COLORS.available;
                  let status: "available" | "reserved" | "sold" | "selected" = "available";
                  if (inv?.status === "sold") {
                    fill = COLORS.sold;
                    status = "sold";
                  } else if (inv?.status === "reserved") {
                    fill = COLORS.reserved;
                    status = "reserved";
                  }
                  if (selectedSet.has(seatId)) {
                    fill = COLORS.selected;
                    status = "selected";
                  }
                  const clickable = status === "available" || status === "selected";
                  const label = `${s.label || "Sektor"} · Rad ${rowLabel(r)} · ${startSeat + c}`;
                  nodes.push(
                    <Rect
                      key={seatId}
                      x={padX + c * (ss + gap)}
                      y={padY + r * (ss + gap)}
                      width={ss}
                      height={ss}
                      fill={fill}
                      cornerRadius={3}
                      stroke={status === "selected" ? "#1d4ed8" : "rgba(0,0,0,0.18)"}
                      strokeWidth={status === "selected" ? 1.6 : 0.5}
                      onMouseEnter={(e) => {
                        if (!clickable) return;
                        const stage = e.target.getStage();
                        if (stage) stage.container().style.cursor = "pointer";
                      }}
                      onMouseLeave={(e) => {
                        const stage = e.target.getStage();
                        if (stage) stage.container().style.cursor = "default";
                      }}
                      onClick={() => {
                        if (!clickable) return;
                        onToggle({
                          seat_id: seatId,
                          label,
                          price: isVip ? vipPrice : basePrice,
                          is_vip: isVip,
                        });
                      }}
                      onTap={() => {
                        if (!clickable) return;
                        onToggle({
                          seat_id: seatId,
                          label,
                          price: isVip ? vipPrice : basePrice,
                          is_vip: isVip,
                        });
                      }}
                    />,
                  );
                }
                nodes.push(
                  <KText
                    key={`lbl-${s.id}-${r}`}
                    x={padX - 14}
                    y={padY + r * (ss + gap) + ss / 2 - 6}
                    text={rowLabel(r)}
                    fontSize={10}
                    fill="#64748b"
                  />,
                );
              }
              return (
                <Group key={s.id} x={s.x} y={s.y} rotation={s.rotation ?? 0}>
                  {nodes}
                </Group>
              );
            }

            if (s.kind === "seats") {
              const inv = invMap.get(s.id);
              const isVip = !!inv?.is_vip || s.priceCategory === "VIP";
              let fill = isVip ? COLORS.vipAvailable : COLORS.available;
              let status: "available" | "reserved" | "sold" | "selected" = "available";
              if (inv?.status === "sold") {
                fill = COLORS.sold;
                status = "sold";
              } else if (inv?.status === "reserved") {
                fill = COLORS.reserved;
                status = "reserved";
              }
              if (selectedSet.has(s.id)) {
                fill = COLORS.selected;
                status = "selected";
              }
              const clickable = status === "available" || status === "selected";
              return (
                <Group
                  key={s.id}
                  x={s.x}
                  y={s.y}
                  rotation={s.rotation ?? 0}
                  onMouseEnter={(e) => {
                    if (clickable) {
                      const stage = e.target.getStage();
                      if (stage) stage.container().style.cursor = "pointer";
                    }
                  }}
                  onMouseLeave={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = "default";
                  }}
                  onClick={() => {
                    if (!clickable) return;
                    onToggle({
                      seat_id: s.id,
                      label: seatLabel(s),
                      price: isVip ? vipPrice : basePrice,
                      is_vip: isVip,
                    });
                  }}
                  onTap={() => {
                    if (!clickable) return;
                    onToggle({
                      seat_id: s.id,
                      label: seatLabel(s),
                      price: isVip ? vipPrice : basePrice,
                      is_vip: isVip,
                    });
                  }}
                >
                  <Rect
                    width={s.width}
                    height={s.height}
                    fill={fill}
                    cornerRadius={3}
                    stroke={status === "selected" ? "#1d4ed8" : "rgba(0,0,0,0.15)"}
                    strokeWidth={status === "selected" ? 2 : 0.5}
                  />
                </Group>
              );
            }
            // non-seat shapes (sector, stage, standing, vip area, label, etc.)
            const fill =
              s.kind === "stage"
                ? COLORS.stage
                : s.kind === "standing"
                  ? COLORS.standing
                  : s.kind === "vip"
                    ? COLORS.vipArea
                    : s.kind === "entrance"
                      ? COLORS.entrance
                      : s.kind === "bar"
                        ? COLORS.bar
                        : s.kind === "wc"
                          ? COLORS.wc
                          : s.kind === "tech"
                            ? COLORS.tech
                            : s.kind === "label"
                              ? "transparent"
                              : (s.color ?? COLORS.sector);
            return (
              <Group key={s.id} x={s.x} y={s.y} rotation={s.rotation ?? 0}>
                <Rect
                  width={s.width}
                  height={s.height}
                  fill={fill}
                  opacity={s.kind === "sector" ? 0.15 : 0.85}
                  cornerRadius={6}
                  stroke={s.kind === "sector" ? "rgba(15,23,42,0.4)" : "transparent"}
                  strokeWidth={1}
                  dash={s.kind === "sector" ? [6, 4] : undefined}
                />
                {s.label && (
                  <KText
                    text={s.label}
                    width={s.width}
                    height={s.height}
                    align="center"
                    verticalAlign="middle"
                    fontStyle="bold"
                    fontSize={Math.max(12, Math.min(22, s.height / 4))}
                    fill={
                      s.kind === "stage" ||
                      s.kind === "standing" ||
                      s.kind === "vip" ||
                      s.kind === "tech"
                        ? "#fff"
                        : "#0f172a"
                    }
                  />
                )}
              </Group>
            );
          })}
        </Layer>
      </Stage>

      {/* Legend overlay */}
      <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-3 rounded-lg bg-background/90 backdrop-blur px-3 py-2 text-[11px] border border-border/40">
        <LegendDot color={COLORS.available} label="Voľné" />
        <LegendDot color={COLORS.selected} label="Vybrané" />
        <LegendDot color={COLORS.reserved} label="Rezervované" />
        <LegendDot color={COLORS.sold} label="Predané" />
        <LegendDot color={COLORS.vipAvailable} label="VIP" />
        <span className="ml-auto text-muted-foreground">
          Scroll = zoom · posun len cez „Presun mapy“ alebo Space
        </span>
      </div>
    </div>
  );
}

function MapControlButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md border border-border/60 bg-background text-base font-semibold text-foreground hover:bg-muted"
    >
      {children}
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
