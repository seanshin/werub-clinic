// Created: 2026-05-18
// 병원 평면도 맵 에디터 — 구역 드래그 이동/리사이즈
"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { Zone } from "@/lib/floor";
import { ZONE_TYPE_COLORS, ZONE_TYPE_LABELS } from "@/lib/floor";

const GRID = 32;
const SNAP = 1; // 1 격자 단위 스냅
const HANDLE_SIZE = 8;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

type DragMode = "none" | "move" | "resize";

interface Props {
  zones: Zone[];
  onZonesChange: (zones: Zone[]) => void;
  selectedZoneId: string | null;
  onSelectZone: (id: string | null) => void;
}

export default function FloorEditor({ zones, onZonesChange, selectedZoneId, onSelectZone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // 드래그 상태
  const dragRef = useRef<{
    mode: DragMode;
    zoneId: string;
    startBounds: Zone["bounds"];
    startMouse: { x: number; y: number };
    resizeCorner: "se" | "sw" | "ne" | "nw";
  } | null>(null);

  const snap = (v: number) => Math.round(v / SNAP) * SNAP;

  const toMap = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom / GRID,
      y: (clientY - rect.top - pan.y) / zoom / GRID,
    };
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 배경 — 체크보드
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // 그리드
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= 60; x++) {
      ctx.beginPath();
      ctx.moveTo(x * GRID, 0);
      ctx.lineTo(x * GRID, 40 * GRID);
      ctx.stroke();
    }
    for (let y = 0; y <= 40; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * GRID);
      ctx.lineTo(60 * GRID, y * GRID);
      ctx.stroke();
    }

    // 구역 렌더링
    for (const zone of zones) {
      const { x, y, w, h } = zone.bounds;
      const px = x * GRID;
      const py = y * GRID;
      const pw = w * GRID;
      const ph = h * GRID;

      const color = zone.color ?? ZONE_TYPE_COLORS[zone.type] ?? "#9CA3AF";
      const isSelected = selectedZoneId === zone.id;

      // 배경
      ctx.fillStyle = color + (isSelected ? "30" : "18");
      ctx.fillRect(px, py, pw, ph);

      // 테두리
      ctx.strokeStyle = isSelected ? "#1D4ED8" : color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      if (isSelected) ctx.setLineDash([6, 3]);
      ctx.strokeRect(px, py, pw, ph);
      ctx.setLineDash([]);

      // 라벨
      ctx.fillStyle = "#1E293B";
      ctx.font = "bold 13px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(zone.name, px + 6, py + 18);

      // 유형 라벨
      ctx.fillStyle = "#94A3B8";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.fillText(ZONE_TYPE_LABELS[zone.type] ?? zone.type, px + 6, py + 32);

      // 정원
      ctx.fillText(`정원: ${zone.capacity}명`, px + 6, py + 46);

      // 리사이즈 핸들 (선택 시)
      if (isSelected) {
        const hs = HANDLE_SIZE / zoom;
        ctx.fillStyle = "#1D4ED8";
        // SE corner
        ctx.fillRect(px + pw - hs, py + ph - hs, hs * 2, hs * 2);
        // NW corner
        ctx.fillRect(px - hs, py - hs, hs * 2, hs * 2);
      }
    }

    ctx.restore();
  }, [zones, selectedZoneId, zoom, pan]);

  // 데이터 변경 시에만 렌더링 (rAF 무한 루프 제거 — CPU 절약)
  useEffect(() => {
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const { x: mx, y: my } = toMap(e.clientX, e.clientY);

    // Shift or middle button → pan
    if (e.button === 1 || e.shiftKey) {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // 선택된 구역의 리사이즈 핸들 체크
    if (selectedZoneId) {
      const zone = zones.find(z => z.id === selectedZoneId);
      if (zone) {
        const { x, y, w, h } = zone.bounds;
        const ht = HANDLE_SIZE / zoom / GRID * 2;
        // SE corner
        if (mx >= x + w - ht && mx <= x + w + ht && my >= y + h - ht && my <= y + h + ht) {
          dragRef.current = { mode: "resize", zoneId: zone.id, startBounds: { ...zone.bounds }, startMouse: { x: mx, y: my }, resizeCorner: "se" };
          return;
        }
        // NW corner
        if (mx >= x - ht && mx <= x + ht && my >= y - ht && my <= y + ht) {
          dragRef.current = { mode: "resize", zoneId: zone.id, startBounds: { ...zone.bounds }, startMouse: { x: mx, y: my }, resizeCorner: "nw" };
          return;
        }
      }
    }

    // 구역 클릭 → 선택 + 드래그
    for (const zone of [...zones].reverse()) {
      const { x, y, w, h } = zone.bounds;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        onSelectZone(zone.id);
        dragRef.current = { mode: "move", zoneId: zone.id, startBounds: { ...zone.bounds }, startMouse: { x: mx, y: my }, resizeCorner: "se" };
        return;
      }
    }

    onSelectZone(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanningRef.current) {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    const { x: mx, y: my } = toMap(e.clientX, e.clientY);
    const dx = mx - drag.startMouse.x;
    const dy = my - drag.startMouse.y;

    const updated = zones.map(z => {
      if (z.id !== drag.zoneId) return z;

      if (drag.mode === "move") {
        return {
          ...z,
          bounds: {
            ...z.bounds,
            x: snap(Math.max(0, drag.startBounds.x + dx)),
            y: snap(Math.max(0, drag.startBounds.y + dy)),
          },
        };
      }

      if (drag.mode === "resize") {
        if (drag.resizeCorner === "se") {
          return {
            ...z,
            bounds: {
              ...z.bounds,
              w: snap(Math.max(2, drag.startBounds.w + dx)),
              h: snap(Math.max(2, drag.startBounds.h + dy)),
            },
          };
        }
        if (drag.resizeCorner === "nw") {
          const newX = snap(Math.max(0, drag.startBounds.x + dx));
          const newY = snap(Math.max(0, drag.startBounds.y + dy));
          return {
            ...z,
            bounds: {
              x: newX,
              y: newY,
              w: snap(Math.max(2, drag.startBounds.w - (newX - drag.startBounds.x))),
              h: snap(Math.max(2, drag.startBounds.h - (newY - drag.startBounds.y))),
            },
          };
        }
      }
      return z;
    });

    onZonesChange(updated);
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
    dragRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-white rounded-xl border border-gray-200">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {/* 줌 */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg border px-2 py-1 text-xs">
        <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.2))} className="px-1.5 py-0.5 hover:bg-gray-100 rounded">-</button>
        <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 0.2))} className="px-1.5 py-0.5 hover:bg-gray-100 rounded">+</button>
      </div>
      {/* 안내 */}
      <div className="absolute top-3 left-3 bg-white/90 backdrop-blur rounded-lg border px-3 py-1.5 text-[11px] text-gray-500">
        구역을 드래그하여 이동 | 모서리를 드래그하여 크기 조절 | Shift+드래그로 화면 이동
      </div>
    </div>
  );
}
