// Created: 2026-05-18
// Updated: 2026-05-20 — 데이터 소스 표시 + 에러 로깅
// 병원 동선 모니터링 — HIS Floor API 타입 + 호출 함수

import { hfetch } from "./api";
import type { DataSource, Sourced } from "./workgroup";

function sourced<T>(data: T, source: DataSource): Sourced<T> {
  return { data, _source: source };
}

function logFallback(fn: string, err: unknown) {
  console.warn(`[HIS-Floor] ${fn} → mock 폴백`, err instanceof Error ? err.message : err);
}

// ── 타입 ──────────────────────────────────────────────────

export type ZoneType =
  | "reception" | "waiting" | "treatment" | "lab" | "pharmacy"
  | "surgery" | "ward" | "nurse_station" | "other";

export type EntityType = "patient" | "doctor" | "nurse" | "staff";
export type Congestion = "low" | "normal" | "high" | "critical";

export interface FloorPlan {
  id: string;
  name: string;
  description: string;
  zoneCount: number;
  hasMapData: boolean;
}

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  capacity: number;
  bounds: { x: number; y: number; w: number; h: number };
  color?: string;
}

export interface Entity {
  id: string;
  type: EntityType;
  label: string;
  zoneId: string;
  status: string;
  waitMinutes?: number;
  arrivedAt?: string;
  department?: string;
}

export interface ZoneStats {
  zoneId: string;
  zoneName: string;
  currentCount: number;
  capacity: number;
  avgWaitMinutes: number;
  maxWaitMinutes: number;
  congestion: Congestion;
  todayTotal: number;
}

export interface FloorSummary {
  floorId: string;
  floorName: string;
  totalPatients: number;
  totalStaff: number;
  avgWaitMinutes: number;
  bottleneck: { zoneId: string; zoneName: string; currentCount: number; avgWaitMinutes: number };
  congestion: string;
  zonesSummary: { zoneId: string; name: string; count: number; congestion: string }[];
}

export interface EntityHistory {
  entityId: string;
  label: string;
  movements: {
    zoneId: string;
    zoneName: string;
    enterAt: string;
    leaveAt: string;
    durationMinutes: number;
  }[];
  totalMinutes: number;
  totalWaitMinutes: number;
}

// ── P2/P3 동선 시각화 (HIS 신규 API) ───────────────────────

/** 존간 전이 집계 (OD) — 흐름선 */
export interface FloorFlow {
  fromZone: string;
  toZone: string;
  count: number;          // 이동 건수 (흐름선 두께)
  avgMinutes: number;     // 평균 소요
  p90Minutes?: number;    // 지연 판정용
}

/** 존별 SLA/기대치 — "지연" 자동 판정 */
export interface ZoneSla {
  zoneId: string;
  targetWaitMinutes?: number;
  targetThroughputPerHour?: number;
  maxCapacity?: number;
  expectedByHour?: { hour: number; expectedCount: number }[];
}

/** 흐름 차단/이슈 컨텍스트 */
export interface FloorIssue {
  scope: "zone" | "entity";
  zoneId?: string;
  entityId?: string;
  type: string;           // equipment_down | isolation | urgent | staff_shortage | blocked | congestion
  severity: "low" | "medium" | "high";
  since?: string;
  note?: string;
}

/** 존 토폴로지 (인접·복도 경로) — 흐름선 라우팅 */
export interface TopologyEdge {
  a: string;
  b: string;
  polyline?: [number, number][];
  distance?: number;
  bidirectional?: boolean;
}
export interface FloorTopology {
  nodes: { zoneId: string; door?: { x: number; y: number } }[];
  edges: TopologyEdge[];
}

// ── 구역 유형별 기본 색상 ─────────────────────────────────

export const ZONE_TYPE_COLORS: Record<ZoneType, string> = {
  reception: "#3B82F6",
  waiting: "#F59E0B",
  treatment: "#10B981",
  lab: "#8B5CF6",
  pharmacy: "#EF4444",
  surgery: "#DC2626",
  ward: "#6366F1",
  nurse_station: "#059669",
  other: "#9CA3AF",
};

export const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  reception: "접수",
  waiting: "대기실",
  treatment: "진료실",
  lab: "검사실",
  pharmacy: "약국",
  surgery: "수술실",
  ward: "병실",
  nurse_station: "간호스테이션",
  other: "기타",
};

export const CONGESTION_COLORS: Record<Congestion, string> = {
  low: "#22C55E",
  normal: "#3B82F6",
  high: "#F59E0B",
  critical: "#EF4444",
};

export const ENTITY_COLORS: Record<EntityType, string> = {
  patient: "#3B82F6",
  doctor: "#10B981",
  nurse: "#8B5CF6",
  staff: "#6B7280",
};

// ── API 호출 ──────────────────────────────────────────────

export async function fetchFloorPlans(): Promise<Sourced<FloorPlan[]>> {
  try {
    const res = await hfetch("/api/clinic/his/floor/plans");
    const data = await res.json();
    if (data.ok) return sourced(data.data.floors, "his");
    logFallback("fetchFloorPlans", data.error);
    return sourced(MOCK_FLOORS, "mock");
  } catch (e) { logFallback("fetchFloorPlans", e); return sourced(MOCK_FLOORS, "mock"); }
}

export async function fetchZones(floorId: string): Promise<Sourced<Zone[]>> {
  try {
    await syncLayoutFromServer(floorId);
    const res = await hfetch(`/api/clinic/his/floor/zones/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.zones, "his");
    logFallback("fetchZones", data.error);
    return sourced(MOCK_ZONES[floorId] ?? [], "mock");
  } catch (e) { logFallback("fetchZones", e); return sourced(MOCK_ZONES[floorId] ?? [], "mock"); }
}

export async function fetchEntities(floorId: string): Promise<Sourced<{ entities: Entity[]; totalPatients: number; totalStaff: number }>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/entities/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchEntities", data.error);
    return sourced(MOCK_ENTITIES[floorId] ?? MOCK_ENTITIES_DEFAULT, "mock");
  } catch (e) { logFallback("fetchEntities", e); return sourced(MOCK_ENTITIES[floorId] ?? MOCK_ENTITIES_DEFAULT, "mock"); }
}

export async function fetchStats(floorId: string): Promise<Sourced<ZoneStats[]>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/stats/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.stats, "his");
    logFallback("fetchStats", data.error);
    return sourced(MOCK_STATS[floorId] ?? [], "mock");
  } catch (e) { logFallback("fetchStats", e); return sourced(MOCK_STATS[floorId] ?? [], "mock"); }
}

export async function fetchSummary(floorId: string): Promise<Sourced<FloorSummary | null>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/stats/${floorId}/summary`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchSummary", data.error);
    return sourced(MOCK_SUMMARY, "mock");
  } catch (e) { logFallback("fetchSummary", e); return sourced(MOCK_SUMMARY, "mock"); }
}

export async function fetchHistory(entityId: string): Promise<Sourced<EntityHistory | null>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/history/${entityId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchHistory", data.error);
    return sourced(null, "mock");
  } catch (e) { logFallback("fetchHistory", e); return sourced(null, "mock"); }
}

// ── P2 동선 API (HIS 신규) ─────────────────────────────────

/** 존간 전이 집계 (OD) — 흐름선 */
export async function fetchFlows(floorId: string, windowMin = 60): Promise<Sourced<FloorFlow[]>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/flows/${floorId}?window=${windowMin}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.flows ?? [], "his");
    logFallback("fetchFlows", data.error);
    return sourced([], "mock");
  } catch (e) { logFallback("fetchFlows", e); return sourced([], "mock"); }
}

/** 존별 SLA/기대치 */
export async function fetchSla(floorId: string): Promise<Sourced<ZoneSla[]>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/sla/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.zones ?? [], "his");
    logFallback("fetchSla", data.error);
    return sourced([], "mock");
  } catch (e) { logFallback("fetchSla", e); return sourced([], "mock"); }
}

/** 흐름 차단/이슈 */
export async function fetchIssues(floorId: string): Promise<Sourced<FloorIssue[]>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/issues/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.issues ?? [], "his");
    logFallback("fetchIssues", data.error);
    return sourced([], "mock");
  } catch (e) { logFallback("fetchIssues", e); return sourced([], "mock"); }
}

/** 존 토폴로지 (인접·복도 경로) */
export async function fetchTopology(floorId: string): Promise<Sourced<FloorTopology | null>> {
  try {
    const res = await hfetch(`/api/clinic/his/floor/topology/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchTopology", data.error);
    return sourced(null, "mock");
  } catch (e) { logFallback("fetchTopology", e); return sourced(null, "mock"); }
}

/** 층 단위 이력 일괄 — 리플레이 (HIS 경로: floor-history/{floorId}) */
export async function fetchFloorHistory(
  floorId: string,
  params?: { from?: string; to?: string; types?: string },
): Promise<Sourced<{ entities: EntityHistory[] }>> {
  try {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.types) q.set("types", params.types);
    const qs = q.toString();
    const res = await hfetch(`/api/clinic/his/floor/floor-history/${floorId}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchFloorHistory", data.error);
    return sourced({ entities: [] }, "mock");
  } catch (e) { logFallback("fetchFloorHistory", e); return sourced({ entities: [] }, "mock"); }
}

// ── 레이아웃 로컬 저장/로드 ───────────────────────────────

export function saveLayout(floorId: string, zones: Zone[]) {
  const key = `floor_layout_${floorId}`;
  const boundsMap: Record<string, Zone["bounds"]> = {};
  for (const z of zones) boundsMap[z.id] = z.bounds;
  localStorage.setItem(key, JSON.stringify(boundsMap));
  // 서버 이중 저장 — 기기/브라우저 간 동기화 (실패해도 로컬은 유지)
  hfetch(`/api/clinic/floor-layout`, { method: "POST", body: JSON.stringify({ floorId, layout: boundsMap }) }).catch(() => {});
}

/** 서버 저장 레이아웃 → localStorage 동기화 (fetchZones에서 호출 — applyLayout 전에 최신화) */
export async function syncLayoutFromServer(floorId: string): Promise<void> {
  try {
    const res = await hfetch(`/api/clinic/floor-layout?floorId=${encodeURIComponent(floorId)}`);
    const data = await res.json();
    if (data?.ok && data.data?.layout && typeof data.data.layout === "object") {
      localStorage.setItem(`floor_layout_${floorId}`, JSON.stringify(data.data.layout));
    }
  } catch { /* 서버 미가용 — 로컬 유지 */ }
}

export function loadLayout(floorId: string): Record<string, Zone["bounds"]> | null {
  const key = `floor_layout_${floorId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function applyLayout(zones: Zone[], floorId: string): Zone[] {
  const layout = loadLayout(floorId);
  if (!layout) return zones;
  return zones.map(z => ({
    ...z,
    bounds: layout[z.id] ?? z.bounds,
  }));
}

// ── Mock 데이터 (HIS 미연결 시 폴백) ─────────────────────

const MOCK_FLOORS: FloorPlan[] = [
  { id: "1f", name: "1층", description: "로비/응급", zoneCount: 6, hasMapData: true },
  { id: "2f", name: "2층", description: "외래 진료", zoneCount: 8, hasMapData: true },
  { id: "3f", name: "3층", description: "내과 병동", zoneCount: 6, hasMapData: true },
  { id: "4f", name: "4층", description: "외과 병동", zoneCount: 4, hasMapData: true },
  { id: "5f", name: "5층", description: "소아/산부 병동", zoneCount: 4, hasMapData: true },
  { id: "6f", name: "6층", description: "정형외과 병동", zoneCount: 4, hasMapData: true },
];

const MOCK_ZONES: Record<string, Zone[]> = {
  "1f": [
    { id: "z-reception", name: "접수", type: "reception", capacity: 5, bounds: { x: 2, y: 2, w: 5, h: 3 } },
    { id: "z-waiting-1", name: "대기실", type: "waiting", capacity: 20, bounds: { x: 9, y: 2, w: 7, h: 5 } },
    { id: "z-treatment-1", name: "진료실 1", type: "treatment", capacity: 1, bounds: { x: 18, y: 2, w: 5, h: 4 } },
    { id: "z-treatment-2", name: "진료실 2", type: "treatment", capacity: 1, bounds: { x: 18, y: 7, w: 5, h: 4 } },
    { id: "z-lab", name: "검사실", type: "lab", capacity: 3, bounds: { x: 25, y: 2, w: 5, h: 4 } },
    { id: "z-pharmacy", name: "약국", type: "pharmacy", capacity: 10, bounds: { x: 25, y: 7, w: 5, h: 4 } },
    { id: "z-er", name: "응급실", type: "other", capacity: 10, bounds: { x: 2, y: 8, w: 7, h: 5 }, color: "#DC2626" },
    { id: "z-icu", name: "ICU", type: "other", capacity: 6, bounds: { x: 11, y: 8, w: 5, h: 5 }, color: "#B91C1C" },
    { id: "z-recovery", name: "회복실", type: "other", capacity: 4, bounds: { x: 18, y: 8, w: 5, h: 5 }, color: "#7C3AED" },
  ],
  "2f": [
    { id: "z-waiting-2f", name: "내과 대기실", type: "waiting", capacity: 15, bounds: { x: 2, y: 2, w: 7, h: 5 } },
    { id: "z-clinic-int", name: "내과 진료", type: "treatment", capacity: 1, bounds: { x: 11, y: 2, w: 5, h: 4 } },
    { id: "z-clinic-surg", name: "외과 진료", type: "treatment", capacity: 1, bounds: { x: 11, y: 7, w: 5, h: 4 } },
    { id: "z-imaging", name: "영상의학실", type: "lab", capacity: 2, bounds: { x: 18, y: 2, w: 6, h: 5 } },
    { id: "z-blood-test", name: "채혈실", type: "lab", capacity: 3, bounds: { x: 18, y: 8, w: 6, h: 4 } },
    { id: "z-ecg", name: "심전도/기초검사", type: "lab", capacity: 2, bounds: { x: 26, y: 2, w: 6, h: 5 } },
    { id: "z-endoscopy", name: "내시경실", type: "lab", capacity: 1, bounds: { x: 26, y: 8, w: 6, h: 4 } },
    { id: "z-ward-301", name: "301호", type: "ward", capacity: 4, bounds: { x: 2, y: 9, w: 4, h: 4 } },
  ],
  "3f": [
    { id: "z-3f-ns", name: "간호스테이션", type: "nurse_station", capacity: 5, bounds: { x: 14, y: 5, w: 5, h: 3 } },
    { id: "z-301", name: "301호 (4인실)", type: "ward", capacity: 4, bounds: { x: 2, y: 2, w: 5, h: 4 } },
    { id: "z-302", name: "302호 (4인실)", type: "ward", capacity: 4, bounds: { x: 8, y: 2, w: 5, h: 4 } },
    { id: "z-303", name: "303호 (2인실)", type: "ward", capacity: 2, bounds: { x: 14, y: 2, w: 4, h: 3 } },
    { id: "z-304", name: "304호 (2인실)", type: "ward", capacity: 2, bounds: { x: 2, y: 7, w: 4, h: 4 } },
    { id: "z-305", name: "305호 (1인실)", type: "ward", capacity: 1, bounds: { x: 7, y: 7, w: 3, h: 4 } },
  ],
  "4f": [
    { id: "z-4f-ns", name: "간호스테이션", type: "nurse_station", capacity: 4, bounds: { x: 2, y: 6, w: 5, h: 3 } },
    { id: "z-401", name: "401호 (4인실)", type: "ward", capacity: 4, bounds: { x: 2, y: 2, w: 6, h: 4 } },
    { id: "z-402", name: "402호 (4인실)", type: "ward", capacity: 4, bounds: { x: 9, y: 2, w: 6, h: 4 } },
    { id: "z-403", name: "403호 (2인실)", type: "ward", capacity: 2, bounds: { x: 9, y: 7, w: 4, h: 4 } },
  ],
  "5f": [
    { id: "z-5f-ns", name: "간호스테이션", type: "nurse_station", capacity: 4, bounds: { x: 15, y: 2, w: 5, h: 3 } },
    { id: "z-501", name: "501호 (소아 6인)", type: "ward", capacity: 6, bounds: { x: 2, y: 2, w: 6, h: 5 } },
    { id: "z-502", name: "502호 (산부 4인)", type: "ward", capacity: 4, bounds: { x: 9, y: 2, w: 5, h: 4 } },
    { id: "z-503", name: "신생아실", type: "ward", capacity: 8, bounds: { x: 2, y: 8, w: 7, h: 4 }, color: "#F472B6" },
  ],
  "6f": [
    { id: "z-6f-ns", name: "간호스테이션", type: "nurse_station", capacity: 4, bounds: { x: 2, y: 2, w: 5, h: 3 } },
    { id: "z-601", name: "601호 (4인실)", type: "ward", capacity: 4, bounds: { x: 8, y: 2, w: 5, h: 4 } },
    { id: "z-602", name: "602호 (4인실)", type: "ward", capacity: 4, bounds: { x: 14, y: 2, w: 5, h: 4 } },
    { id: "z-603", name: "재활치료실", type: "other", capacity: 6, bounds: { x: 2, y: 6, w: 8, h: 5 }, color: "#F59E0B" },
  ],
};

const MOCK_ENTITIES_DEFAULT = { entities: [], totalPatients: 0, totalStaff: 0 };

const MOCK_ENTITIES: Record<string, { entities: Entity[]; totalPatients: number; totalStaff: number }> = {
  "1f": {
    entities: [
      { id: "p-001", type: "patient", label: "김O수", zoneId: "z-waiting-1", status: "waiting", waitMinutes: 18, department: "내과" },
      { id: "p-002", type: "patient", label: "이O미", zoneId: "z-waiting-1", status: "waiting", waitMinutes: 12, department: "내과" },
      { id: "p-003", type: "patient", label: "박O진", zoneId: "z-treatment-1", status: "in-treatment", waitMinutes: 0, department: "내과" },
      { id: "p-004", type: "patient", label: "최O영", zoneId: "z-reception", status: "waiting", waitMinutes: 3, department: "외과" },
      { id: "p-005", type: "patient", label: "정O현", zoneId: "z-lab", status: "in-lab", waitMinutes: 5, department: "내과" },
      { id: "p-010", type: "patient", label: "한O석", zoneId: "z-er", status: "waiting", waitMinutes: 8, department: "응급" },
      { id: "p-011", type: "patient", label: "윤O희", zoneId: "z-er", status: "in-treatment", waitMinutes: 0, department: "응급" },
      { id: "p-012", type: "patient", label: "송O우", zoneId: "z-er", status: "waiting", waitMinutes: 22, department: "응급" },
      { id: "p-013", type: "patient", label: "임O정", zoneId: "z-icu", status: "admitted", department: "중환자" },
      { id: "p-014", type: "patient", label: "강O민", zoneId: "z-icu", status: "admitted", department: "중환자" },
      { id: "p-015", type: "patient", label: "조O빈", zoneId: "z-recovery", status: "admitted", department: "외과" },
      { id: "s-001", type: "doctor", label: "박의사", zoneId: "z-treatment-1", status: "in-treatment", department: "내과" },
      { id: "s-002", type: "nurse", label: "최간호사", zoneId: "z-waiting-1", status: "active", department: "내과" },
      { id: "s-010", type: "doctor", label: "김응급의", zoneId: "z-er", status: "active", department: "응급의학" },
      { id: "s-011", type: "nurse", label: "이간호사", zoneId: "z-er", status: "active", department: "응급" },
      { id: "s-012", type: "nurse", label: "박간호사", zoneId: "z-icu", status: "active", department: "중환자" },
    ],
    totalPatients: 11,
    totalStaff: 5,
  },
  "3f": {
    entities: [
      { id: "p-301", type: "patient", label: "오O택", zoneId: "z-301", status: "admitted", department: "내과" },
      { id: "p-302", type: "patient", label: "신O호", zoneId: "z-301", status: "admitted", department: "내과" },
      { id: "p-303", type: "patient", label: "배O연", zoneId: "z-302", status: "admitted", department: "내과" },
      { id: "p-304", type: "patient", label: "유O진", zoneId: "z-302", status: "admitted", department: "내과" },
      { id: "p-305", type: "patient", label: "서O준", zoneId: "z-302", status: "admitted", department: "내과" },
      { id: "p-306", type: "patient", label: "전O란", zoneId: "z-303", status: "admitted", department: "내과" },
      { id: "p-307", type: "patient", label: "홍O기", zoneId: "z-305", status: "admitted", department: "내과" },
      { id: "s-301", type: "nurse", label: "김간호사", zoneId: "z-3f-ns", status: "active", department: "내과병동" },
      { id: "s-302", type: "nurse", label: "이간호사", zoneId: "z-3f-ns", status: "active", department: "내과병동" },
      { id: "s-303", type: "doctor", label: "정의사", zoneId: "z-301", status: "active", department: "내과" },
    ],
    totalPatients: 7,
    totalStaff: 3,
  },
  "4f": {
    entities: [
      { id: "p-401", type: "patient", label: "문O식", zoneId: "z-401", status: "admitted", department: "외과" },
      { id: "p-402", type: "patient", label: "양O아", zoneId: "z-401", status: "admitted", department: "외과" },
      { id: "p-403", type: "patient", label: "권O혁", zoneId: "z-402", status: "admitted", department: "외과" },
      { id: "p-404", type: "patient", label: "황O은", zoneId: "z-403", status: "admitted", department: "외과" },
      { id: "s-401", type: "nurse", label: "조간호사", zoneId: "z-4f-ns", status: "active", department: "외과병동" },
      { id: "s-402", type: "doctor", label: "한의사", zoneId: "z-402", status: "active", department: "외과" },
    ],
    totalPatients: 4,
    totalStaff: 2,
  },
  "5f": {
    entities: [
      { id: "p-501", type: "patient", label: "나O린", zoneId: "z-501", status: "admitted", department: "소아과" },
      { id: "p-502", type: "patient", label: "장O우", zoneId: "z-501", status: "admitted", department: "소아과" },
      { id: "p-503", type: "patient", label: "심O영", zoneId: "z-502", status: "admitted", department: "산부인과" },
      { id: "s-501", type: "nurse", label: "윤간호사", zoneId: "z-5f-ns", status: "active", department: "소아병동" },
    ],
    totalPatients: 3,
    totalStaff: 1,
  },
  "6f": {
    entities: [
      { id: "p-601", type: "patient", label: "차O훈", zoneId: "z-601", status: "admitted", department: "정형외과" },
      { id: "p-602", type: "patient", label: "주O미", zoneId: "z-602", status: "admitted", department: "정형외과" },
      { id: "p-603", type: "patient", label: "우O성", zoneId: "z-603", status: "admitted", department: "재활" },
      { id: "s-601", type: "nurse", label: "백간호사", zoneId: "z-6f-ns", status: "active", department: "정형외과병동" },
    ],
    totalPatients: 3,
    totalStaff: 1,
  },
};

const MOCK_STATS: Record<string, ZoneStats[]> = {
  "1f": [
    { zoneId: "z-reception", zoneName: "접수", currentCount: 1, capacity: 5, avgWaitMinutes: 3, maxWaitMinutes: 5, congestion: "low", todayTotal: 34 },
    { zoneId: "z-waiting-1", zoneName: "대기실", currentCount: 2, capacity: 20, avgWaitMinutes: 15, maxWaitMinutes: 25, congestion: "normal", todayTotal: 28 },
    { zoneId: "z-treatment-1", zoneName: "진료실 1", currentCount: 2, capacity: 1, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "high", todayTotal: 12 },
    { zoneId: "z-treatment-2", zoneName: "진료실 2", currentCount: 0, capacity: 1, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 10 },
    { zoneId: "z-lab", zoneName: "검사실", currentCount: 1, capacity: 3, avgWaitMinutes: 5, maxWaitMinutes: 8, congestion: "low", todayTotal: 8 },
    { zoneId: "z-pharmacy", zoneName: "약국", currentCount: 0, capacity: 10, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 15 },
    { zoneId: "z-er", zoneName: "응급실", currentCount: 3, capacity: 10, avgWaitMinutes: 15, maxWaitMinutes: 22, congestion: "normal", todayTotal: 18 },
    { zoneId: "z-icu", zoneName: "ICU", currentCount: 2, capacity: 6, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "normal", todayTotal: 3 },
    { zoneId: "z-recovery", zoneName: "회복실", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 5 },
  ],
  "3f": [
    { zoneId: "z-3f-ns", zoneName: "간호스테이션", currentCount: 2, capacity: 5, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-301", zoneName: "301호", currentCount: 3, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "normal", todayTotal: 0 },
    { zoneId: "z-302", zoneName: "302호", currentCount: 3, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "normal", todayTotal: 0 },
    { zoneId: "z-303", zoneName: "303호", currentCount: 1, capacity: 2, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-304", zoneName: "304호", currentCount: 0, capacity: 2, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-305", zoneName: "305호", currentCount: 1, capacity: 1, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "normal", todayTotal: 0 },
  ],
  "4f": [
    { zoneId: "z-4f-ns", zoneName: "간호스테이션", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-401", zoneName: "401호", currentCount: 2, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-402", zoneName: "402호", currentCount: 2, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-403", zoneName: "403호", currentCount: 1, capacity: 2, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
  ],
  "5f": [
    { zoneId: "z-5f-ns", zoneName: "간호스테이션", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-501", zoneName: "501호", currentCount: 2, capacity: 6, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-502", zoneName: "502호", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-503", zoneName: "503호", currentCount: 0, capacity: 8, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
  ],
  "6f": [
    { zoneId: "z-6f-ns", zoneName: "간호스테이션", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-601", zoneName: "601호", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-602", zoneName: "602호", currentCount: 1, capacity: 4, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
    { zoneId: "z-603", zoneName: "603호", currentCount: 1, capacity: 2, avgWaitMinutes: 0, maxWaitMinutes: 0, congestion: "low", todayTotal: 0 },
  ],
};

const MOCK_SUMMARY: FloorSummary = {
  floorId: "1f",
  floorName: "1층",
  totalPatients: 11,
  totalStaff: 5,
  avgWaitMinutes: 15,
  bottleneck: { zoneId: "z-er", zoneName: "응급실", currentCount: 3, avgWaitMinutes: 15 },
  congestion: "normal",
  zonesSummary: [
    { zoneId: "z-reception", name: "접수", count: 1, congestion: "low" },
    { zoneId: "z-waiting-1", name: "대기", count: 2, congestion: "normal" },
    { zoneId: "z-treatment-1", name: "진료1", count: 2, congestion: "high" },
    { zoneId: "z-er", name: "응급실", count: 3, congestion: "normal" },
    { zoneId: "z-icu", name: "ICU", count: 2, congestion: "normal" },
    { zoneId: "z-pharmacy", name: "약국", count: 0, congestion: "low" },
  ],
};
