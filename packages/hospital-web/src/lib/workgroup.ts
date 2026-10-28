// Created: 2026-05-18
// Updated: 2026-05-20 — 데이터 소스 표시 + 에러 로깅
// 워크그룹 API 타입 + 호출 — HIS workgroup 연동

import { hfetch } from "./api";

const WG = "/api/clinic/his/workgroup";

/** 데이터 소스: "his" = 실데이터, "mock" = 폴백 */
export type DataSource = "his" | "mock";

/** API 응답 래퍼 — 실데이터/mock 구분 */
export interface Sourced<T> { data: T; _source: DataSource }

function sourced<T>(data: T, source: DataSource): Sourced<T> {
  return { data, _source: source };
}

function logFallback(fn: string, err: unknown) {
  console.warn(`[HIS-WG] ${fn} → mock 폴백`, err instanceof Error ? err.message : err);
}

// ── 타입 ──────────────────────────────────────────

export interface Appointment {
  id: string;
  time: string;
  patientId: string;
  patientName: string;
  type: "first_visit" | "revisit" | "follow_up";
  department: string;
  chiefComplaint: string | null;
  status: "waiting" | "in_progress" | "completed" | "no_show";
}

export interface Surgery {
  id: string;
  operatingRoom: string;
  startTime: string;
  endTime: string;
  patientName: string;
  procedure: string;
  surgeon: string;
  anesthesiologist: string;
  status: "scheduled" | "preparing" | "in_progress" | "completed" | "recovery";
}

export interface WardPatient {
  patientId: string;
  patientName: string;
  room: string;
  floor: string;
  admittedAt: string;
  diagnosis: string;
  condition: "stable" | "improving" | "worsening" | "critical";
  alerts: string[];
}

export interface WardRoom {
  roomId: string;
  roomName: string;
  capacity: number;
  patients: {
    patientId: string;
    patientName: string;
    bedNumber: number;
    condition: string;
    alerts: string[];
    doctor: string;
  }[];
}

export interface WardStatus {
  floorId: string;
  floorName: string;
  totalBeds: number;
  occupiedBeds: number;
  rooms: WardRoom[];
  onDutyStaff: { id: string; name: string; role: string; shift: string }[];
}

export interface ReceptionStatus {
  waiting: number;
  inProgress: number;
  completed: number;
  avgWaitMinutes: number;
  departments: { name: string; waiting: number; avgWaitMinutes: number }[];
  alerts: { department: string; message: string; severity: string }[];
}

export interface BillingSummary {
  date: string;
  totalReceipts: number;
  unpaid: number;
  totalAmount: number;
  insurance: { pending: number; rejected: number; approved: number };
}

export interface Medication {
  id: string;
  patientId: string;
  patientName: string;
  room: string;
  medication: string;
  route: string;
  frequency: string;
  scheduledAt: string;
  status: "pending" | "administered" | "skipped" | "overdue";
  isOverdue: boolean;
  notes: string;
}

export interface DutyShift {
  date: string;
  shifts: { shift: string; staff: { id: string; name: string; role: string; department: string }[] }[];
}

// ── API 호출 ──────────────────────────────────────

export async function fetchDoctorSchedule(doctorId: string): Promise<Sourced<{ appointments: Appointment[]; total: number; completed: number }>> {
  try {
    const res = await hfetch(`${WG}/schedule/doctor/${doctorId}`);
    const data = await res.json();
    if (data.ok) return sourced({ appointments: data.data.appointments ?? data.data.schedule ?? [], total: data.data.totalAppointments ?? 0, completed: data.data.completed ?? data.data.completedAppointments ?? 0 }, "his");
    logFallback("fetchDoctorSchedule", data.error);
    return sourced(MOCK.doctor, "mock");
  } catch (e) { logFallback("fetchDoctorSchedule", e); return sourced(MOCK.doctor, "mock"); }
}

// 로컬 저장 상태 오버레이 — HIS/mock 원본에 사용자가 바꾼 상태를 덮어씀 (재진입/폴링 원복 방지)
async function fetchSurgeryOverrides(): Promise<Map<string, string>> {
  try {
    const res = await hfetch(`/api/clinic/surgery`);
    const data = await res.json();
    const m = new Map<string, string>();
    for (const o of data?.data?.overrides ?? []) m.set(o.surgeryId, o.status);
    return m;
  } catch { return new Map(); }
}

export async function fetchSurgeryToday(): Promise<Sourced<Surgery[]>> {
  const overrides = await fetchSurgeryOverrides();
  const apply = (list: Surgery[]) => list.map(s => overrides.has(s.id) ? { ...s, status: overrides.get(s.id)! as Surgery["status"] } : s);
  try {
    const res = await hfetch(`${WG}/surgery/today`);
    const data = await res.json();
    if (data.ok) return sourced(apply(data.data.surgeries ?? []), "his");
    logFallback("fetchSurgeryToday", data.error);
    return sourced(apply(MOCK.surgeries), "mock");
  } catch (e) { logFallback("fetchSurgeryToday", e); return sourced(apply(MOCK.surgeries), "mock"); }
}

export async function fetchWardPatients(doctorId: string): Promise<Sourced<WardPatient[]>> {
  try {
    const res = await hfetch(`${WG}/ward/patients/${doctorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.patients ?? [], "his");
    logFallback("fetchWardPatients", data.error);
    return sourced(MOCK.wardPatients, "mock");
  } catch (e) { logFallback("fetchWardPatients", e); return sourced(MOCK.wardPatients, "mock"); }
}

export async function fetchWardStatus(floorId: string): Promise<Sourced<WardStatus | null>> {
  try {
    const res = await hfetch(`${WG}/ward/status/${floorId}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchWardStatus", data.error);
    return sourced(MOCK.wardStatus, "mock");
  } catch (e) { logFallback("fetchWardStatus", e); return sourced(MOCK.wardStatus, "mock"); }
}

export async function fetchReceptionStatus(): Promise<Sourced<ReceptionStatus>> {
  try {
    const res = await hfetch(`${WG}/reception/status`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchReceptionStatus", data.error);
    return sourced(MOCK.reception, "mock");
  } catch (e) { logFallback("fetchReceptionStatus", e); return sourced(MOCK.reception, "mock"); }
}

export async function fetchBillingSummary(): Promise<Sourced<BillingSummary>> {
  try {
    const res = await hfetch(`${WG}/billing/summary`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchBillingSummary", data.error);
    return sourced(MOCK.billing, "mock");
  } catch (e) { logFallback("fetchBillingSummary", e); return sourced(MOCK.billing, "mock"); }
}

export async function fetchMedicationSchedule(nurseId: string): Promise<Sourced<{ upcoming: Medication[]; overdueCount: number }>> {
  try {
    const res = await hfetch(`${WG}/medication/schedule/${nurseId}?hours=4`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchMedicationSchedule", data.error);
    return sourced(MOCK.medication, "mock");
  } catch (e) { logFallback("fetchMedicationSchedule", e); return sourced(MOCK.medication, "mock"); }
}

export async function fetchDutySchedule(): Promise<Sourced<{ today: { name: string; shift: string; department: string }[] }>> {
  try {
    const res = await hfetch(`${WG}/duty/schedule?month=${new Date().toISOString().slice(0, 7)}`);
    const data = await res.json();
    if (data.ok) return sourced({ today: data.data.today?.onDuty ?? [] }, "his");
    logFallback("fetchDutySchedule", data.error);
    return sourced(MOCK.duty, "mock");
  } catch (e) { logFallback("fetchDutySchedule", e); return sourced(MOCK.duty, "mock"); }
}

// ── Phase 2: 인수인계 ─────────────────────────────

export interface HandoffPatient {
  patientId: string;
  patientName: string;
  room: string;
  bed: number;
  diagnosis: string;
  condition: string;
  vitals: { bp: string; hr: number; temp: number };
  notes: string;
  alerts: string[];
  medications: { name: string; route: string; schedule: string; nextDue: string | null }[];
  pendingOrders: string[];
}

export interface HandoffRecord {
  handoffId: string;
  wardId: string;
  shift: string;
  fromNurse: string;
  toNurse: string;
  fromUserId?: string | null;
  toUserId?: string | null;
  acknowledgedBy?: string | null;
  patientCount: number;
  submittedAt: string;
  acknowledgedAt: string | null;
}

export async function fetchHandoffTemplate(wardId: string, shift: string): Promise<Sourced<{ wardName: string; patients: HandoffPatient[] }>> {
  try {
    const res = await hfetch(`${WG}/handoff/template/${wardId}?shift=${shift}`);
    const data = await res.json();
    if (data.ok) return sourced({ wardName: data.data.wardName, patients: data.data.patients }, "his");
    logFallback("fetchHandoffTemplate", data.error);
    return sourced(MOCK.handoffTemplate, "mock");
  } catch (e) { logFallback("fetchHandoffTemplate", e); return sourced(MOCK.handoffTemplate, "mock"); }
}

export async function submitHandoff(body: {
  wardId: string; shift: string; fromNurseId: string; toNurseId: string;
  /** 인수자(선택) — 같은 병원 멤버 userId/표시명 (2026-08-19) */
  toUserId?: string; toName?: string;
  // patientId/notes/alerts/priority는 필수, 그 외 표시 필드(patientName·room·vitals 등)는 상세 이력용으로 함께 저장
  patients: Array<{ patientId: string; notes: string; alerts: string[]; priority: string } & Record<string, unknown>>;
  generalNotes: string;
}): Promise<{ handoffId: string } | null> {
  try {
    // 로컬 저장(HIS 미연동 환경에서도 특이사항 입력/저장). HIS 정본 연동은 별도 동기화로 처리.
    const res = await hfetch(`/api/clinic/handoff`, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json();
    return data.ok ? data.data : null;
  } catch { return null; }
}

export interface HandoffDetail {
  handoffId: string;
  wardName: string;
  shift: string;
  fromNurse: string;
  toNurse: string;
  submittedAt: string;
  acknowledgedAt: string | null;
  generalNotes: string;
  patients: {
    patientId: string;
    patientName: string;
    room: string;
    bed: number;
    diagnosis: string;
    condition: string;
    vitals: { bp: string; hr: number; temp: number };
    notes: string;
    alerts: string[];
    priority: string;
  }[];
}

/** 수신 확인 — 인수자/다른 근무자가 인수인계를 확인(작성자 본인 불가). 반환 = 성공 여부 (2026-08-19) */
export async function acknowledgeHandoff(handoffId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await hfetch(`/api/clinic/handoff`, { method: "PATCH", body: JSON.stringify({ handoffId }) });
    const data = await res.json();
    return data.ok ? { ok: true } : { ok: false, error: data.error?.message ?? data.error ?? "확인 실패" };
  } catch { return { ok: false, error: "네트워크 오류" }; }
}

export async function fetchHandoffDetail(handoffId: string): Promise<Sourced<HandoffDetail | null>> {
  try {
    const res = await hfetch(`/api/clinic/handoff?id=${encodeURIComponent(handoffId)}`);
    const data = await res.json();
    if (data.ok) return sourced(data.data, "his");
    logFallback("fetchHandoffDetail", data.error);
    return sourced(MOCK.handoffDetail, "mock");
  } catch (e) { logFallback("fetchHandoffDetail", e); return sourced(MOCK.handoffDetail, "mock"); }
}

export async function fetchHandoffHistory(wardId: string): Promise<Sourced<HandoffRecord[]>> {
  try {
    const res = await hfetch(`/api/clinic/handoff?wardId=${encodeURIComponent(wardId)}&limit=20`);
    const data = await res.json();
    if (data.ok) return sourced(data.data.handoffs ?? [], "his");
    logFallback("fetchHandoffHistory", data.error);
    return sourced(MOCK.handoffHistory, "mock");
  } catch (e) { logFallback("fetchHandoffHistory", e); return sourced(MOCK.handoffHistory, "mock"); }
}

// ── Phase 3: 당직 + 수술 ─────────────────────────

export interface DutyDay {
  date: string;
  dayOfWeek: string;
  shifts: { shift: string; staff: { id: string; name: string; role: string; department: string }[] }[];
  nurseShifts: { ward: string; shift: string; nurses: string[] }[];
}

export async function fetchDutyMonth(month?: string): Promise<Sourced<{ schedules: DutyDay[]; today: { name: string; shift: string; department: string }[] }>> {
  try {
    const m = month ?? new Date().toISOString().slice(0, 7);
    const res = await hfetch(`${WG}/duty/schedule?month=${m}`);
    const data = await res.json();
    if (data.ok) return sourced({ schedules: data.data.schedules ?? [], today: data.data.today?.onDuty ?? [] }, "his");
    logFallback("fetchDutyMonth", data.error);
    return sourced(MOCK.dutyMonth, "mock");
  } catch (e) { logFallback("fetchDutyMonth", e); return sourced(MOCK.dutyMonth, "mock"); }
}

export async function requestDutySwap(body: {
  requesterId: string; targetId: string;
  originalDate: string; originalShift: string;
  swapDate: string; swapShift: string;
  reason: string;
}): Promise<{ requestId: string; status: string } | null> {
  // 로컬 저장 선행 — HIS 미연동 시에도 요청 유실 방지
  let localId: string | null = null;
  try {
    const r = await hfetch(`/api/clinic/duty-swap`, {
      method: "POST",
      body: JSON.stringify({ dutyDate: body.originalDate, dutyType: body.originalShift, targetName: body.targetId, reason: body.reason }),
    });
    const d = await r.json();
    if (d?.ok) localId = d.id;
  } catch { /* */ }
  try {
    const res = await hfetch(`${WG}/duty/swap-request`, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) return data.data;
    return localId ? { requestId: localId, status: "pending_local" } : null;
  } catch { return localId ? { requestId: localId, status: "pending_local" } : null; }
}

export async function updateSurgeryStatus(surgeryId: string, status: string, notes?: string): Promise<boolean> {
  // 로컬 영속화 우선 (HIS 미연동/실패해도 유지)
  let localOk = false;
  try {
    const r = await hfetch(`/api/clinic/surgery`, { method: "POST", body: JSON.stringify({ surgeryId, status }) });
    localOk = (await r.json())?.ok ?? false;
  } catch { /* */ }
  try {
    const res = await hfetch(`${WG}/surgery/${surgeryId}/status`, {
      method: "PATCH", body: JSON.stringify({ status, notes }),
    });
    const data = await res.json();
    return (data.ok ?? false) || localOk;
  } catch { return localOk; }
}

// ── Phase 5: 알림 ─────────────────────────────────

export interface Alert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  room: string;
  patientName: string;
  message: string;
  reportedBy: string;
  createdAt: string;
  status: "active" | "acknowledged" | "resolved";
}

async function fetchAlertAcks(): Promise<Map<string, string>> {
  try {
    const res = await hfetch(`/api/clinic/alerts`);
    const data = await res.json();
    const m = new Map<string, string>();
    for (const a of data?.data?.acks ?? []) m.set(a.alertId, a.status);
    return m;
  } catch { return new Map(); }
}

export async function fetchActiveAlerts(): Promise<Sourced<Alert[]>> {
  const acks = await fetchAlertAcks();
  // 로컬 확인 상태 오버레이: resolved는 목록 유지하되 상태 반영 (5초 폴링 원복 방지)
  const apply = (list: Alert[]) => list.map(a => {
    const s = acks.get(a.id);
    if (!s) return a;
    return { ...a, status: (s === "resolved" ? "resolved" : "acknowledged") as Alert["status"] };
  });
  try {
    const res = await hfetch(`${WG}/alerts/active`);
    const data = await res.json();
    if (data.ok) return sourced(apply(data.data.alerts ?? []), "his");
    logFallback("fetchActiveAlerts", data.error);
    return sourced([], "mock");
  } catch (e) { logFallback("fetchActiveAlerts", e); return sourced([], "mock"); }
}

export async function acknowledgeAlert(alertId: string, action: string, notes?: string): Promise<boolean> {
  // 로컬 영속화 (acknowledge/respond/resolve → acknowledged/responding/resolved)
  const statusMap: Record<string, string> = { acknowledge: "acknowledged", respond: "responding", resolve: "resolved" };
  let localOk = false;
  try {
    const r = await hfetch(`/api/clinic/alerts`, { method: "POST", body: JSON.stringify({ alertId, status: statusMap[action] ?? "acknowledged" }) });
    localOk = (await r.json())?.ok ?? false;
  } catch { /* */ }
  try {
    const res = await hfetch(`${WG}/alerts/${alertId}/acknowledge`, {
      method: "PATCH", body: JSON.stringify({ action, notes }),
    });
    const data = await res.json();
    return (data.ok ?? false) || localOk;
  } catch { return localOk; }
}

// ── Mock 데이터 ───────────────────────────────────

const MOCK = {
  doctor: {
    appointments: [
      { id: "apt-1", time: "09:00", patientId: "p-001", patientName: "김O수", type: "revisit" as const, department: "내과", chiefComplaint: "혈압 경과", status: "completed" as const },
      { id: "apt-2", time: "09:20", patientId: "p-002", patientName: "이O미", type: "first_visit" as const, department: "내과", chiefComplaint: "두통", status: "in_progress" as const },
      { id: "apt-3", time: "09:40", patientId: "p-003", patientName: "박O진", type: "follow_up" as const, department: "내과", chiefComplaint: "검사결과", status: "waiting" as const },
      { id: "apt-4", time: "10:00", patientId: "p-004", patientName: "최O영", type: "revisit" as const, department: "내과", chiefComplaint: null, status: "waiting" as const },
      { id: "apt-5", time: "10:20", patientId: "p-005", patientName: "정O현", type: "revisit" as const, department: "내과", chiefComplaint: null, status: "waiting" as const },
    ],
    total: 12, completed: 1,
  },
  surgeries: [
    { id: "s-1", operatingRoom: "OR-1", startTime: "14:00", endTime: "16:00", patientName: "최O영", procedure: "무릎 관절경", surgeon: "박의사", anesthesiologist: "김마취과", status: "scheduled" as const },
  ],
  wardPatients: [
    { patientId: "p-301", patientName: "오O택", room: "301호", floor: "3f", admittedAt: "2026-05-15", diagnosis: "폐렴", condition: "improving" as const, alerts: ["낙상 위험"] },
    { patientId: "p-302", patientName: "신O호", room: "302호", floor: "3f", admittedAt: "2026-05-16", diagnosis: "충수절제 후", condition: "stable" as const, alerts: [] },
  ],
  wardStatus: {
    floorId: "3f", floorName: "3층 내과병동", totalBeds: 13, occupiedBeds: 7,
    rooms: [
      { roomId: "z-301", roomName: "301호", capacity: 4, patients: [
        { patientId: "p-301", patientName: "오O택", bedNumber: 1, condition: "improving", alerts: ["낙상 위험"], doctor: "정의사" },
        { patientId: "p-302", patientName: "신O호", bedNumber: 2, condition: "stable", alerts: [], doctor: "정의사" },
      ]},
    ],
    onDutyStaff: [{ id: "s-301", name: "김간호사", role: "nurse", shift: "day" }],
  } as WardStatus,
  reception: {
    waiting: 12, inProgress: 3, completed: 52, avgWaitMinutes: 18,
    departments: [
      { name: "내과", waiting: 5, avgWaitMinutes: 22 },
      { name: "외과", waiting: 3, avgWaitMinutes: 15 },
      { name: "소아과", waiting: 4, avgWaitMinutes: 12 },
    ],
    alerts: [{ department: "내과", message: "대기 30분 초과", severity: "warning" }],
  },
  billing: {
    date: new Date().toISOString().slice(0, 10), totalReceipts: 52, unpaid: 15, totalAmount: 12500000,
    insurance: { pending: 23, rejected: 2, approved: 48 },
  },
  medication: {
    upcoming: [
      { id: "m-1", patientId: "p-301", patientName: "오O택", room: "301호", medication: "세파졸린 1g", route: "IV", frequency: "1일 3회", scheduledAt: new Date(Date.now() + 30 * 60000).toISOString(), status: "pending" as const, isOverdue: false, notes: "" },
      { id: "m-2", patientId: "p-302", patientName: "신O호", room: "302호", medication: "아테놀롤 50mg", route: "PO", frequency: "1일 1회", scheduledAt: new Date(Date.now() + 60 * 60000).toISOString(), status: "pending" as const, isOverdue: false, notes: "" },
    ],
    overdueCount: 0,
  },
  duty: { today: [{ name: "박의사", shift: "night", department: "내과" }, { name: "김응급의", shift: "er", department: "응급의학" }] },
  handoffTemplate: {
    wardName: "3층 내과병동",
    patients: [
      { patientId: "p-301", patientName: "오O택", room: "301호", bed: 1, diagnosis: "폐렴", condition: "improving",
        vitals: { bp: "130/80", hr: 78, temp: 36.8 }, notes: "", alerts: ["낙상 위험"],
        medications: [{ name: "세파졸린", route: "IV", schedule: "1일 3회", nextDue: "09:30" }],
        pendingOrders: ["혈액검사 (08:00)"] },
      { patientId: "p-302", patientName: "신O호", room: "302호", bed: 2, diagnosis: "충수절제 후", condition: "stable",
        vitals: { bp: "120/75", hr: 72, temp: 37.1 }, notes: "", alerts: [],
        medications: [{ name: "트라마돌", route: "IV", schedule: "PRN", nextDue: null }],
        pendingOrders: ["배액량 확인 (4시간)"] },
    ],
  },
  handoffDetail: {
    handoffId: "ho-001",
    wardName: "3층 내과병동",
    shift: "night_to_day",
    fromNurse: "야간 박간호사",
    toNurse: "주간 김간호사",
    submittedAt: "2026-05-18T07:05:00Z",
    acknowledgedAt: "2026-05-18T07:10:00Z",
    generalNotes: "병동 전체 특이사항 없음. 소독 완료.",
    patients: [
      { patientId: "p-301", patientName: "오O택", room: "301호", bed: 1, diagnosis: "폐렴", condition: "improving",
        vitals: { bp: "130/80", hr: 78, temp: 36.8 },
        notes: "야간 발열 38.2° → 해열제 투여, 현재 36.8°로 하강. 기침 횟수 감소.",
        alerts: ["낙상 위험"], priority: "normal" },
      { patientId: "p-302", patientName: "신O호", room: "302호", bed: 2, diagnosis: "충수절제 후", condition: "stable",
        vitals: { bp: "120/75", hr: 72, temp: 37.1 },
        notes: "통증 호소 → 트라마돌 IV 추가 투여. 배액량 200ml/4hr, 정상 범위. 내일 배액관 제거 예정.",
        alerts: ["배액량 확인"], priority: "high" },
    ],
  } as HandoffDetail,
  handoffHistory: [
    { handoffId: "ho-001", wardId: "3f", shift: "night_to_day", fromNurse: "야간 박간호사", toNurse: "주간 김간호사", patientCount: 7, submittedAt: "2026-05-18T07:05:00Z", acknowledgedAt: "2026-05-18T07:10:00Z" },
    { handoffId: "ho-002", wardId: "3f", shift: "day_to_night", fromNurse: "주간 김간호사", toNurse: "야간 박간호사", patientCount: 7, submittedAt: "2026-05-17T19:05:00Z", acknowledgedAt: "2026-05-17T19:08:00Z" },
  ] as HandoffRecord[],
  dutyMonth: {
    schedules: [
      { date: "2026-05-18", dayOfWeek: "mon", shifts: [
        { shift: "day", staff: [{ id: "s-012", name: "박의사", role: "doctor", department: "내과" }] },
        { shift: "night", staff: [{ id: "s-013", name: "이의사", role: "doctor", department: "내과" }] },
        { shift: "er", staff: [{ id: "s-020", name: "김응급의", role: "doctor", department: "응급의학" }] },
      ], nurseShifts: [
        { ward: "3f", shift: "day", nurses: ["김간호사", "이간호사"] },
        { ward: "3f", shift: "night", nurses: ["박간호사"] },
      ]},
      { date: "2026-05-19", dayOfWeek: "tue", shifts: [
        { shift: "day", staff: [{ id: "s-013", name: "이의사", role: "doctor", department: "내과" }] },
        { shift: "night", staff: [{ id: "s-012", name: "박의사", role: "doctor", department: "내과" }] },
        { shift: "er", staff: [{ id: "s-020", name: "김응급의", role: "doctor", department: "응급의학" }] },
      ], nurseShifts: [
        { ward: "3f", shift: "day", nurses: ["박간호사", "최간호사"] },
        { ward: "3f", shift: "night", nurses: ["김간호사"] },
      ]},
    ] as DutyDay[],
    today: [{ name: "이의사", shift: "night", department: "내과" }, { name: "김응급의", shift: "er", department: "응급의학" }],
  },
};
