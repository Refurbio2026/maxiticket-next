import { useEffect, useMemo, useRef, useState } from "react";
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
  if (s.row && s.seatNumber != null) return `Rad ${s.row} · ${s.seatNumber}`;
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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

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

  // Auto-fit on first render
  useEffect(() => {
    const shapes = layout.shapes;
    if (!shapes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) {
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.width);
      maxY = Math.max(maxY, s.y + s.height);
    }
    const pad = 40;
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const k = Math.min(size.w / cw, size.h / ch, 1.5);
    setScale(k);
    setPos({ x: -minX * k + pad, y: -minY * k + pad });
  }, [layout.id, size.w, size.h]);

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
    setPos({ x: ptr.x - mp.x * ns, y: ptr.y - mp.y * ns });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[520px] rounded-xl overflow-hidden border border-border/40 bg-[#f8fafc]"
    >
      <Stage
        width={size.w}
        height={size.h}
        draggable
        x={pos.x}
        y={pos.y}
        scaleX={scale}
        scaleY={scale}
        onWheel={onWheel}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            setPos({ x: e.target.x(), y: e.target.y() });
          }
        }}
      >
        <Layer>
          {layout.shapes.map((s) => {
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
              s.kind === "stage" ? COLORS.stage :
              s.kind === "standing" ? COLORS.standing :
              s.kind === "vip" ? COLORS.vipArea :
              s.kind === "entrance" ? COLORS.entrance :
              s.kind === "bar" ? COLORS.bar :
              s.kind === "wc" ? COLORS.wc :
              s.kind === "tech" ? COLORS.tech :
              s.kind === "label" ? "transparent" :
              s.color ?? COLORS.sector;
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
                      s.kind === "stage" || s.kind === "standing" || s.kind === "vip" || s.kind === "tech"
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
        <span className="ml-auto text-muted-foreground">Scroll = zoom · drag = posun</span>
      </div>
    </div>
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
