// Created: 2026-05-18
// Updated: 2026-06-06 — P1 동선 시각화: 병목 펄스 + 존간 흐름 파티클(스냅샷 비교) + 이슈 배지 + 애니메이션 루프
// 병원 평면도 2D 캔버스 렌더러 — 구역 + 엔티티 + 히트맵 + 흐름/이슈
"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { Zone, Entity, ZoneStats, Congestion, FloorFlow, FloorIssue, ZoneSla, FloorTopology } from "@/lib/floor";
import { ZONE_TYPE_COLORS, CONGESTION_COLORS, ENTITY_COLORS } from "@/lib/floor";

// 이슈 유형별 아이콘
const ISSUE_ICONS: Record<string, string> = {
  equipment_down: "🔧",
  isolation: "🚧",
  urgent: "🚨",
  staff_shortage: "👥",
  blocked: "⛔",
  congestion: "⚠",
};

const ZONE_TYPE_ICONS: Record<string, string> = {
  reception: "🏥",
  waiting: "🪑",
  treatment: "🩺",
  lab: "🔬",
  pharmacy: "💊",
  surgery: "🏥",
  ward: "🛏️",
  nurse_station: "👩‍⚕️",
  other: "📍",
};

const GRID = 32; // 1 격자 = 32px
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const FLOW_TTL = 6000;        // 흐름 파티클 수명(ms)
const LONG_WAIT_MIN = 30;     // 장기 대기 이슈 임계(분)

interface FlowEvent { from: string; to: string; born: number; }

interface Props {
  zones: Zone[];
  entities: Entity[];
  stats: ZoneStats[];
  flows?: FloorFlow[];
  issues?: FloorIssue[];
  sla?: ZoneSla[];
  topology?: FloorTopology | null;
  overlay?: "none" | "heatmap";
  selectedZoneId?: string | null;
  onZoneClick?: (zone: Zone) => void;
}

export default function FloorCanvas({ zones, entities, stats, flows = [], issues = [], sla = [], topology = null, overlay = "none", selectedZoneId, onZoneClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const statsMap = useRef<Record<string, ZoneStats>>({});
  useEffect(() => {
    const m: Record<string, ZoneStats> = {};
    for (const s of stats) m[s.zoneId] = s;
    statsMap.current = m;
  }, [stats]);

  // 구역별 엔티티 그룹핑
  const entityByZone = useRef<Record<string, Entity[]>>({});
  useEffect(() => {
    const m: Record<string, Entity[]> = {};
    for (const e of entities) {
      if (!m[e.zoneId]) m[e.zoneId] = [];
      m[e.zoneId].push(e);
    }
    entityByZone.current = m;
  }, [entities]);

  // 존 중심 좌표 캐시
  const zoneCenterRef = useRef<Record<string, { cx: number; cy: number }>>({});
  useEffect(() => {
    const m: Record<string, { cx: number; cy: number }> = {};
    for (const z of zones) {
      m[z.id] = { cx: (z.bounds.x + z.bounds.w / 2) * GRID, cy: (z.bounds.y + z.bounds.h / 2) * GRID };
    }
    zoneCenterRef.current = m;
  }, [zones]);

  // P2 동선 데이터 — 매 프레임 최신값(ref) + lookup
  const flowsDataRef = useRef<FloorFlow[]>([]);
  const issueByZoneRef = useRef<Record<string, FloorIssue[]>>({});
  const slaMapRef = useRef<Record<string, ZoneSla>>({});
  const topoEdgeRef = useRef<Record<string, [number, number][]>>({}); // "a|b" → polyline(격자)
  useEffect(() => { flowsDataRef.current = flows; }, [flows]);
  useEffect(() => {
    const m: Record<string, FloorIssue[]> = {};
    for (const it of issues) { if (it.zoneId) (m[it.zoneId] ??= []).push(it); }
    issueByZoneRef.current = m;
  }, [issues]);
  useEffect(() => {
    const m: Record<string, ZoneSla> = {};
    for (const s of sla) m[s.zoneId] = s;
    slaMapRef.current = m;
  }, [sla]);
  useEffect(() => {
    const m: Record<string, [number, number][]> = {};
    for (const e of topology?.edges ?? []) {
      if (e.polyline && e.polyline.length >= 2) {
        m[`${e.a}|${e.b}`] = e.polyline;
        if (e.bidirectional !== false) m[`${e.b}|${e.a}`] = [...e.polyline].reverse();
      }
    }
    topoEdgeRef.current = m;
  }, [topology]);

  // 예상 동선 — OD 전이확률(fromZone→toZone) 계산: 현재 데이터로 다음 행선지 예측
  const predRef = useRef<Record<string, { toZone: string; prob: number }[]>>({});
  useEffect(() => {
    const byFrom: Record<string, { toZone: string; count: number }[]> = {};
    for (const f of flows) (byFrom[f.fromZone] ??= []).push({ toZone: f.toZone, count: f.count });
    const pred: Record<string, { toZone: string; prob: number }[]> = {};
    for (const from in byFrom) {
      const arr = byFrom[from];
      const total = arr.reduce((s, a) => s + a.count, 0) || 1;
      pred[from] = arr
        .map(a => ({ toZone: a.toZone, prob: a.count / total }))
        .sort((a, b) => b.prob - a.prob)
        .slice(0, 2)
        .filter(p => p.prob >= 0.2); // 확률 20% 이상만
    }
    predRef.current = pred;
  }, [flows]);

  // 스냅샷 비교로 존간 이동(흐름) 감지 — HIS 변경 없이 현재 데이터로 동선 표현
  const prevZoneRef = useRef<Map<string, string>>(new Map());
  const flowsRef = useRef<FlowEvent[]>([]);
  useEffect(() => {
    const now = performance.now();
    const cur = new Map<string, string>();
    for (const e of entities) cur.set(e.id, e.zoneId);
    if (prevZoneRef.current.size > 0) {
      for (const [id, zoneId] of cur) {
        const prev = prevZoneRef.current.get(id);
        if (prev && prev !== zoneId) flowsRef.current.push({ from: prev, to: zoneId, born: now });
      }
      // 폭주 방지 상한
      if (flowsRef.current.length > 400) flowsRef.current = flowsRef.current.slice(-400);
    }
    prevZoneRef.current = cur;
  }, [entities]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 배경
    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // 그리드
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < 60; x++) {
      ctx.beginPath();
      ctx.moveTo(x * GRID, 0);
      ctx.lineTo(x * GRID, 40 * GRID);
      ctx.stroke();
    }
    for (let y = 0; y < 40; y++) {
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

      const s = statsMap.current[zone.id];
      const congestion: Congestion = s?.congestion ?? "low";
      const color = zone.color ?? ZONE_TYPE_COLORS[zone.type] ?? "#9CA3AF";

      // 히트맵 모드
      if (overlay === "heatmap" && s) {
        const ratio = s.capacity > 0 ? s.currentCount / s.capacity : 0;
        const alpha = Math.min(0.2 + ratio * 0.6, 0.8);
        ctx.fillStyle = CONGESTION_COLORS[congestion];
        ctx.globalAlpha = alpha;
        ctx.fillRect(px, py, pw, ph);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color + "18";
        ctx.fillRect(px, py, pw, ph);
      }

      // 병목 펄스 — high/critical 존은 맥동 글로우 (대기시간 비례 속도)
      if (congestion === "high" || congestion === "critical") {
        const intense = congestion === "critical";
        const period = intense ? 1100 : 1700;
        const phase = (now % period) / period;            // 0..1
        const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); // 0..1 부드러운 맥동
        const grow = wave * (intense ? 10 : 6);
        ctx.strokeStyle = CONGESTION_COLORS[congestion];
        ctx.globalAlpha = (intense ? 0.55 : 0.4) * (1 - wave * 0.6);
        ctx.lineWidth = (intense ? 3 : 2);
        ctx.strokeRect(px - grow, py - grow, pw + grow * 2, ph + grow * 2);
        ctx.globalAlpha = 1;
      }

      // 테두리
      ctx.strokeStyle = selectedZoneId === zone.id ? "#1D4ED8" : color;
      ctx.lineWidth = selectedZoneId === zone.id ? 3 : 1.5;
      ctx.strokeRect(px, py, pw, ph);

      // 구역 유형 아이콘 + 라벨
      const typeIcon = ZONE_TYPE_ICONS[zone.type] ?? "";
      ctx.fillStyle = "#1E293B";
      ctx.font = `bold ${Math.max(11, 13 / zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(`${typeIcon} ${zone.name}`, px + 6, py + 16);

      // 통계 배지
      if (s) {
        const badge = `${s.currentCount}명`;
        ctx.font = `${Math.max(10, 11 / zoom)}px -apple-system, sans-serif`;
        ctx.fillStyle = CONGESTION_COLORS[congestion];
        ctx.fillText(badge, px + 6, py + 30);

        const slaZone = slaMapRef.current[zone.id];
        const slaDelay = slaZone?.targetWaitMinutes != null && s.avgWaitMinutes > slaZone.targetWaitMinutes;
        if (s.avgWaitMinutes > 0) {
          ctx.fillStyle = slaDelay ? "#DC2626" : "#64748B"; // SLA 목표 초과 시 빨강
          ctx.fillText(`${s.avgWaitMinutes}분${slaDelay ? " ⬆" : ""}`, px + 6 + ctx.measureText(badge).width + 8, py + 30);
        }

        // 이슈 배지 — HIS issues 우선, 없으면 자동(용량/대기/SLA/critical)
        const zoneIssues = issueByZoneRef.current[zone.id] ?? [];
        const cap = slaZone?.maxCapacity ?? s.capacity;
        const overCap = cap > 0 && s.currentCount > cap;
        const longWait = s.maxWaitMinutes >= LONG_WAIT_MIN;
        if (zoneIssues.length > 0 || overCap || longWait || slaDelay || congestion === "critical") {
          const blink = 0.6 + 0.4 * Math.sin(now / 300);
          let icon = "⚠";
          let critical = overCap || slaDelay || congestion === "critical";
          if (zoneIssues.length > 0) {
            const high = zoneIssues.find(i => i.severity === "high") ?? zoneIssues[0];
            icon = ISSUE_ICONS[high.type] ?? "⚠";
            if (high.severity === "high") critical = true;
          } else if (longWait) icon = "⏱";
          ctx.globalAlpha = blink;
          ctx.font = `${Math.max(12, 14 / zoom)}px -apple-system, sans-serif`;
          ctx.textAlign = "right";
          ctx.fillStyle = critical ? "#DC2626" : "#D97706";
          ctx.fillText(icon, px + pw - 6, py + 16);
          ctx.globalAlpha = 1;
          ctx.textAlign = "left";
        }
      }

      // 엔티티 표시 — 환자(좌측), 의료진(우측)
      const ents = entityByZone.current[zone.id];
      if (ents && ents.length > 0) {
        const patients = ents.filter(e => e.type === "patient");
        const staff = ents.filter(e => e.type !== "patient");
        const fontSize = Math.max(9, 10 / zoom);
        const lineH = fontSize + 4;
        const startY = py + 42;

        ctx.textAlign = "left";
        patients.slice(0, 12).forEach((p, i) => {
          const cy = startY + i * lineH;
          if (cy > py + ph - 8) return;
          ctx.beginPath();
          ctx.arc(px + 10, cy - 3, 3, 0, Math.PI * 2);
          ctx.fillStyle = ENTITY_COLORS.patient;
          ctx.fill();
          ctx.fillStyle = "#334155";
          ctx.font = `${fontSize}px -apple-system, sans-serif`;
          const num = p.id.replace(/^p-/, "");
          ctx.fillText(`#${num} ${p.label}`, px + 18, cy);
          if (p.waitMinutes && p.waitMinutes > 0) {
            ctx.fillStyle = p.waitMinutes >= LONG_WAIT_MIN ? "#DC2626" : "#94A3B8";
            ctx.fillText(`${p.waitMinutes}분`, px + 18 + ctx.measureText(`#${num} ${p.label}`).width + 4, cy);
          }
        });
        if (patients.length > 12) {
          ctx.fillStyle = "#94A3B8";
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillText(`+${patients.length - 12}명`, px + 18, startY + 12 * lineH);
        }

        ctx.textAlign = "right";
        staff.slice(0, 6).forEach((st, i) => {
          const cy = startY + i * lineH;
          if (cy > py + ph - 8) return;
          ctx.beginPath();
          ctx.arc(px + pw - 10, cy - 3, 3, 0, Math.PI * 2);
          ctx.fillStyle = ENTITY_COLORS[st.type];
          ctx.fill();
          ctx.fillStyle = "#334155";
          ctx.font = `${fontSize}px -apple-system, sans-serif`;
          const roleLabel = st.type === "doctor" ? "Dr." : st.type === "nurse" ? "Ns." : "";
          ctx.fillText(`${roleLabel} ${st.label}`, px + pw - 18, cy);
        });
        ctx.textAlign = "left";
      }
    }

    // ── 존간 흐름(동선) — OD 집계(flows) 우선, 없으면 스냅샷 전이 폴백 ──
    const centers = zoneCenterRef.current;

    // from→to 경로점 배열 (topology polyline 우선, 없으면 곡선 샘플)
    const pathOf = (from: string, to: string): { x: number; y: number }[] | null => {
      const poly = topoEdgeRef.current[`${from}|${to}`];
      if (poly) return poly.map(([gx, gy]) => ({ x: gx * GRID, y: gy * GRID }));
      const a = centers[from], b = centers[to];
      if (!a || !b) return null;
      const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      const len = Math.hypot(dx, dy) || 1;
      const cxp = mx - (dy / len) * 24, cyp = my + (dx / len) * 24;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, it = 1 - t;
        pts.push({ x: it * it * a.cx + 2 * it * t * cxp + t * t * b.cx, y: it * it * a.cy + 2 * it * t * cyp + t * t * b.cy });
      }
      return pts;
    };
    // 경로 위 분율 f(0..1) 좌표 (세그먼트 길이 기준)
    const pointAt = (pts: { x: number; y: number }[], f: number) => {
      let total = 0; const seg: number[] = [];
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
      let target = f * total, acc = 0;
      for (let i = 0; i < seg.length; i++) {
        if (acc + seg[i] >= target) { const t = (target - acc) / (seg[i] || 1); return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }; }
        acc += seg[i];
      }
      return pts[pts.length - 1];
    };

    const odFlows = flowsDataRef.current;
    if (odFlows.length > 0) {
      const maxCount = odFlows.reduce((m, f) => Math.max(m, f.count), 1);
      for (const f of odFlows) {
        const pts = pathOf(f.fromZone, f.toZone);
        if (!pts || pts.length < 2) continue;
        const ratio = f.count / maxCount;
        const slow = f.avgMinutes > 60 ? "#DC2626" : f.avgMinutes > 30 ? "#F59E0B" : "#6366F1"; // 정체=빨강
        // 흐름선 (두께 = 건수)
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = slow;
        ctx.globalAlpha = 0.15 + ratio * 0.25;
        ctx.lineWidth = 1.5 + ratio * 5;
        ctx.lineCap = "round";
        ctx.stroke();
        // 흐르는 파티클 (개수 ∝ 건수, 속도 ∝ 1/평균소요 → 정체일수록 느림)
        const nP = Math.min(6, 1 + Math.round(ratio * 5));
        const period = 700 + Math.min(f.avgMinutes, 90) * 25;
        const base = (now / period) % 1;
        for (let k = 0; k < nP; k++) {
          const p = pointAt(pts, (base + k / nP) % 1);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = slow;
          ctx.globalAlpha = 0.85;
          ctx.fill();
        }
        // 도착 방향 화살촉
        const tip = pointAt(pts, 0.98), pre = pointAt(pts, 0.9);
        const ang = Math.atan2(tip.y - pre.y, tip.x - pre.x);
        ctx.fillStyle = slow;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - 7 * Math.cos(ang - 0.4), tip.y - 7 * Math.sin(ang - 0.4));
        ctx.lineTo(tip.x - 7 * Math.cos(ang + 0.4), tip.y - 7 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // 라이브 이동 — SSE/스냅샷 전이를 OD 위에 항상 표시 (실시간 개별 이동)
    if (flowsRef.current.length > 0) {
      flowsRef.current = flowsRef.current.filter(f => now - f.born < FLOW_TTL);
      for (const f of flowsRef.current) {
        const pts = pathOf(f.from, f.to);
        if (!pts || pts.length < 2) continue;
        const fade = 1 - (now - f.born) / FLOW_TTL;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = "#6366F1";
        ctx.globalAlpha = 0.18 * fade;
        ctx.lineWidth = 2;
        ctx.stroke();
        const base = (now / 900) % 1;
        for (let k = 0; k < 3; k++) {
          const p = pointAt(pts, (base + k / 3) % 1);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#4F46E5";
          ctx.globalAlpha = 0.7 * fade;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ── 예상 동선(통계) — 환자 있는 존에서 다음 행선지로 점선 + 깜빡이는 셰브론(예정 표시등) ──
    const pred = predRef.current;
    if (Object.keys(pred).length > 0) {
      const dash = 8;
      ctx.setLineDash([dash, dash]);
      ctx.lineDashOffset = -(now / 45) % (dash * 2); // 마칭앤츠(흐르는 점선)
      const blink = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(now / 380));
      for (const z of zones) {
        const s = statsMap.current[z.id];
        if (!s || s.currentCount <= 0) continue;       // 환자 있는 존만 예측
        const nexts = pred[z.id];
        if (!nexts) continue;
        for (const p of nexts) {
          const pts = pathOf(z.id, p.toZone);
          if (!pts || pts.length < 2) continue;
          // 예상 점선 (teal = 예측, 실선 실제 흐름과 구분)
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = "#0D9488";
          ctx.globalAlpha = 0.2 + p.prob * 0.3;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // 예정 표시등 — 도착측 깜빡이는 셰브론(›)
          const tip = pointAt(pts, 0.95), pre = pointAt(pts, 0.85);
          const ang = Math.atan2(tip.y - pre.y, tip.x - pre.x);
          ctx.setLineDash([]);
          ctx.globalAlpha = (0.4 + p.prob * 0.5) * blink;
          ctx.strokeStyle = "#0D9488";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(tip.x - 9 * Math.cos(ang - 0.42), tip.y - 9 * Math.sin(ang - 0.42));
          ctx.lineTo(tip.x, tip.y);
          ctx.lineTo(tip.x - 9 * Math.cos(ang + 0.42), tip.y - 9 * Math.sin(ang + 0.42));
          ctx.stroke();
          ctx.setLineDash([dash, dash]);
        }
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    // entities/stats는 ref(entityByZone/statsMap)로 매 프레임 최신값을 읽으므로 deps 제외
  }, [zones, overlay, selectedZoneId, zoom, pan]);

  // 연속 애니메이션 루프 — 항상 최신 draw 호출 (펄스/파티클/이슈 깜빡임)
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => {
    let raf = 0;
    const loop = () => { drawRef.current(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 마우스 이벤트 — 클릭, 팬
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.shiftKey) {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (onZoneClick) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;

      for (const zone of [...zones].reverse()) {
        const { x, y, w, h } = zone.bounds;
        if (mx >= x * GRID && mx <= (x + w) * GRID && my >= y * GRID && my <= (y + h) * GRID) {
          onZoneClick(zone);
          return;
        }
      }
      onZoneClick(null as unknown as Zone);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  };

  const handleMouseUp = () => { isPanningRef.current = false; };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-slate-50 rounded-xl border border-gray-200">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {/* 줌 컨트롤 */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg border px-2 py-1 text-xs">
        <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.2))} className="px-1.5 py-0.5 hover:bg-gray-100 rounded">-</button>
        <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 0.2))} className="px-1.5 py-0.5 hover:bg-gray-100 rounded">+</button>
      </div>
      {/* 범례 */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-white/90 backdrop-blur rounded-lg border px-3 py-1.5 text-[10px] text-gray-500">
        {(["patient", "doctor", "nurse"] as const).map(t => (
          <span key={t} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: ENTITY_COLORS[t] }} />
            {t === "patient" ? "환자" : t === "doctor" ? "의사" : "간호사"}
          </span>
        ))}
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />흐름</span>
        <span className="flex items-center gap-1 text-teal-600">⇢ 예상</span>
        <span className="flex items-center gap-1 text-red-500">⚠ 이슈</span>
      </div>
    </div>
  );
}
