// Created: 2026-05-18
// 인수인계 보드 — 간호사 교대 시 환자별 인수인계
"use client";
import { maskName } from "@/lib/mask";
import { clinicContextUrl } from "@/lib/clinic-context";
import { fetchFloorPlans, type FloorPlan } from "@/lib/floor";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { ec } from "@/lib/error-codes";
import {
  fetchHandoffTemplate, submitHandoff, fetchHandoffHistory, fetchHandoffDetail, acknowledgeHandoff,
  type HandoffPatient, type HandoffRecord, type HandoffDetail,
} from "@/lib/workgroup";
import {
  ClipboardList, ChevronRight, ChevronDown, AlertTriangle, Pill, CheckCircle2,
  Clock, Send, History, Loader2, ChevronsUpDown,
} from "lucide-react";

const SC = "HW-HANDOFF";

/** ward_id(층 id)를 사람이 읽는 이름으로. 목록에 없으면 원값 그대로(상세 API는 wardName에 ward_id를 그대로 넣는다) */
function wardLabel(wards: FloorPlan[], id: string): string {
  return wards.find(w => w.id === id)?.name ?? id;
}

const SHIFTS = [
  { id: "night_to_day", label: "야간 → 주간" },
  { id: "day_to_night", label: "주간 → 야간" },
];

const CONDITION_COLOR: Record<string, string> = {
  stable: "text-green-600", improving: "text-blue-600", worsening: "text-amber-600", critical: "text-red-600",
};
const CONDITION_BORDER: Record<string, string> = {
  stable: "border-l-green-400", improving: "border-l-blue-400", worsening: "border-l-amber-400", critical: "border-l-red-400",
};
const PRIORITY_PILLS: { id: string; label: string; active: string; inactive: string }[] = [
  { id: "normal", label: "일반", active: "bg-gray-600 text-white", inactive: "bg-gray-100 text-gray-500" },
  { id: "high", label: "주의", active: "bg-amber-500 text-white", inactive: "bg-amber-50 text-amber-400" },
  { id: "critical", label: "긴급", active: "bg-red-500 text-white", inactive: "bg-red-50 text-red-400" },
];
const MED_ROUTE_COLOR: Record<string, string> = {
  IV: "bg-blue-100 text-blue-700 border-blue-200", PO: "bg-green-100 text-green-700 border-green-200",
  IM: "bg-purple-100 text-purple-700 border-purple-200", SC: "bg-teal-100 text-teal-700 border-teal-200",
  기타: "bg-gray-100 text-gray-600 border-gray-200",
};
const CONDITION_LABEL: Record<string, string> = {
  stable: "안정", improving: "호전", worsening: "악화", critical: "위중",
};

export default function HandoffPage() {
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"write" | "history">("write");
  const [shift, setShift] = useState("night_to_day");
  // 병동(=층) 선택 — 이전엔 "3f" 고정이었다(2026-08-19). 기본값은 유지해 기존 이력과 이어진다.
  const [wardId, setWardId] = useState("3f");
  const [wards, setWards] = useState<FloorPlan[]>([]);
  const [wardsMock, setWardsMock] = useState(false);
  const [patients, setPatients] = useState<(HandoffPatient & { editNotes: string; editPriority: string })[]>([]);
  const [wardName, setWardName] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [history, setHistory] = useState<HandoffRecord[]>([]);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  // 인수자 지정 + 수신 확인 (2026-08-19)
  const [members, setMembers] = useState<{ userId: string; username: string }[]>([]);
  const [toUserId, setToUserId] = useState("");
  const [myUserId, setMyUserId] = useState("");
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const [ackMsg, setAckMsg] = useState("");

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(async ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
      const slug = ctx?.primary?.slug;
      if (slug) {
        try {
          const r = await hfetch(`/api/cafes/${slug}/members?limit=200`);
          const d = await r.json();
          setMembers((d.members ?? []).map((m: { user: { id: string; username: string } }) => ({ userId: m.user.id, username: m.user.username })));
        } catch { /* 멤버 목록 없음 → 인수자 선택 생략 */ }
      }
    }).catch(() => {});
    hfetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d?.user?.id) setMyUserId(d.user.id); }).catch(() => {});
    // 병동 목록 = 층 목록(HIS /floor/plans). 미연동이면 mock 6개 층으로 폴백된다.
    fetchFloorPlans().then(r => { setWards(r.data); setWardsMock(r._source === "mock"); }).catch(() => {});
  }, []);

  const handleAck = async (handoffId: string) => {
    setAckBusy(handoffId); setAckMsg("");
    const r = await acknowledgeHandoff(handoffId);
    if (r.ok) {
      const hist = await fetchHandoffHistory(wardId);
      setHistory(hist.data);
    } else {
      setAckMsg(`${ec(SC, 4)} ${r.error ?? "수신 확인 실패"}`);
    }
    setAckBusy(null);
  };
  const canAck = (h: HandoffRecord) => !h.acknowledgedAt && !!myUserId && h.fromUserId !== myUserId;

  useEffect(() => {
    setLoading(true);
    (async () => {
      const [tpl, hist] = await Promise.all([fetchHandoffTemplate(wardId, shift), fetchHandoffHistory(wardId)]);
      const d = tpl.data;
      setWardName(d.wardName);
      let mapped = d.patients.map(p => ({ ...p, editNotes: p.notes, editPriority: "normal" }));
      let genNotes = "";
      // 오늘·같은 교대의 최근 저장분이 있으면 특이사항을 다시 불러와 이어쓰기(저장 내용 유지)
      const today = new Date().toISOString().slice(0, 10);
      const latest = hist.data.find(h => h.shift === shift && new Date(h.submittedAt).toISOString().slice(0, 10) === today);
      if (latest) {
        const det = await fetchHandoffDetail(latest.handoffId);
        if (det.data) {
          const noteMap = new Map(det.data.patients.map(p => [p.patientId, { notes: p.notes, priority: p.priority }]));
          mapped = mapped.map(p => {
            const s = noteMap.get(p.patientId);
            return s ? { ...p, editNotes: s.notes || p.editNotes, editPriority: s.priority || "normal" } : p;
          });
          genNotes = det.data.generalNotes || "";
        }
      }
      setPatients(mapped);
      setGeneralNotes(genNotes);
      const autoExpand = new Set<string>();
      for (const p of mapped) {
        if (p.alerts.length > 0 || p.condition === "critical" || p.condition === "worsening") autoExpand.add(p.patientId);
      }
      setExpandedCards(autoExpand);
      setHistory(hist.data);
      setLoading(false);
    })();
  }, [wardId, shift]);

  const handleSubmit = async () => {
    setSubmitting(true);
    const result = await submitHandoff({
      wardId,
      shift,
      fromNurseId: "current",
      toNurseId: toUserId || "next",
      toUserId: toUserId || undefined,
      toName: members.find(m => m.userId === toUserId)?.username,
      patients: patients.map(p => ({
        patientId: p.patientId,
        patientName: p.patientName,
        room: p.room,
        bed: p.bed,
        diagnosis: p.diagnosis,
        condition: p.condition,
        vitals: p.vitals,
        notes: p.editNotes,
        alerts: p.alerts,
        priority: p.editPriority,
      })),
      generalNotes,
    });
    setSubmitting(false);
    if (result) {
      setSubmitted(true);
      fetchHandoffHistory(wardId).then(r => setHistory(r.data)); // 최근 인수인계 목록 갱신
      setTimeout(() => setSubmitted(false), 3000);
    }
  };

  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (expandedCards.size === patients.length) {
      setExpandedCards(new Set());
    } else {
      setExpandedCards(new Set(patients.map(p => p.patientId)));
    }
  };
  const allExpanded = expandedCards.size === patients.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* 헤더 — gradient background */}
        <div className="flex items-center justify-between mb-6 -mx-4 -mt-6 px-4 py-5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-500 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <ClipboardList size={22} className="text-indigo-100" />
            <div>
              <h1 className="text-xl font-black text-white">인수인계 보드</h1>
              <p className="text-xs text-indigo-200">{wardName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full p-0.5">
            <button onClick={() => setTab("write")} className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${tab === "write" ? "bg-white text-indigo-700 shadow-sm" : "text-white/80 hover:text-white"}`}>
              <Send size={12} /> 작성
            </button>
            <button onClick={() => setTab("history")} className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${tab === "history" ? "bg-white text-indigo-700 shadow-sm" : "text-white/80 hover:text-white"}`}>
              <History size={12} /> 이력
            </button>
          </div>
        </div>

        {ackMsg && <div className="mb-3 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600">{ackMsg}</div>}
        {tab === "write" ? (
          <>
            {/* 교대 선택 */}
            <div className="flex items-center gap-2 mb-4">
              {SHIFTS.map(s => (
                <button key={s.id} onClick={() => setShift(s.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${shift === s.id ? "bg-indigo-600 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-400 hover:border-indigo-200 hover:text-indigo-500"}`}>
                  {s.label}
                  {shift === s.id && patients.length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/30 text-[10px] font-bold">{patients.length}</span>
                  )}
                </button>
              ))}
              <span className="text-xs text-gray-400 ml-2">
                {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
              </span>
              {wards.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  병동
                  <select value={wardId} onChange={e => setWardId(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs text-gray-700">
                    {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  {wardsMock && <span className="text-[10px] text-amber-500">데모</span>}
                </label>
              )}
              {members.length > 0 && (
                <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
                  인수자
                  <select value={toUserId} onChange={e => setToUserId(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 max-w-[160px]">
                    <option value="">선택 안 함</option>
                    {members.filter(m => m.userId !== myUserId).map(m => <option key={m.userId} value={m.userId}>{m.username}</option>)}
                  </select>
                </label>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-500" size={24} /></div>
            ) : (
              <>
                {/* 모두 펼치기/접기 토글 */}
                {patients.length > 0 && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-gray-400">환자 {patients.length}명</span>
                    <button
                      onClick={toggleAll}
                      className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 font-semibold transition-colors"
                    >
                      <ChevronsUpDown size={12} />
                      {allExpanded ? "모두 접기" : "모두 펼치기"}
                    </button>
                  </div>
                )}

                {/* 환자별 인수인계 카드 */}
                <div className="space-y-3">
                  {patients.map((p, idx) => {
                    const isExpanded = expandedCards.has(p.patientId);
                    return (
                    <div key={p.patientId} className={`bg-white rounded-2xl border border-l-4 ${CONDITION_BORDER[p.condition] ?? "border-l-gray-200"}`}>
                      {/* 환자 헤더 — 클릭하여 펼치기/접기 */}
                      <button
                        type="button"
                        onClick={() => toggleCard(p.patientId)}
                        className="w-full flex items-center justify-between p-4 text-left"
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                          <span className="text-sm font-bold text-gray-900">{p.room} {p.bed}번</span>
                          <span className="text-sm text-gray-700">{maskName(p.patientName)}</span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            p.condition === "stable" ? "bg-green-50 text-green-600" :
                            p.condition === "improving" ? "bg-blue-50 text-blue-600" :
                            p.condition === "worsening" ? "bg-amber-50 text-amber-600" :
                            "bg-red-50 text-red-600"
                          }`}>
                            {CONDITION_LABEL[p.condition] ?? p.condition}
                          </span>
                          {!isExpanded && p.editPriority !== "normal" && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${p.editPriority === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                              {p.editPriority === "critical" ? "긴급" : "주의"}
                            </span>
                          )}
                          {!isExpanded && p.alerts.length > 0 && (
                            <AlertTriangle size={12} className="text-amber-500" />
                          )}
                        </div>
                        {/* 우선순위 pill 버튼 — 펼친 상태에서만 */}
                        {isExpanded && (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            {PRIORITY_PILLS.map(pp => (
                              <button key={pp.id}
                                onClick={() => {
                                  const next = [...patients];
                                  next[idx] = { ...next[idx], editPriority: pp.id };
                                  setPatients(next);
                                }}
                                className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold transition-all ${
                                  p.editPriority === pp.id ? pp.active : pp.inactive
                                }`}
                              >
                                {pp.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </button>

                      {/* 확장된 내용 */}
                      {isExpanded && (
                        <div className="px-4 pb-4 -mt-1">
                          {/* 진단 + 활력징후 mini cards */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[10px] text-gray-500 mr-1">진단: {p.diagnosis}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 font-mono border border-rose-100">BP {p.vitals.bp}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 font-mono border border-orange-100">HR {p.vitals.hr}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-sky-50 text-sky-600 font-mono border border-sky-100">T {p.vitals.temp}°</span>
                          </div>

                          {/* 주의사항 — pulse animation */}
                          {p.alerts.length > 0 && (
                            <div className="flex items-center gap-1.5 mb-2">
                              {p.alerts.map(a => (
                                <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1 animate-[pulse_3s_ease-in-out_infinite]">
                                  <AlertTriangle size={8} /> {a}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* 투약 — pill badges with route colors */}
                          {p.medications.length > 0 && (
                            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                              <Pill size={10} className="text-pink-400 shrink-0" />
                              {p.medications.map(m => (
                                <span key={m.name} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${MED_ROUTE_COLOR[m.route] ?? MED_ROUTE_COLOR["기타"]}`}>
                                  {m.name} <span className="font-semibold">({m.route})</span> {m.schedule}{m.nextDue ? ` → ${m.nextDue}` : ""}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* 대기 처방 — timeline dots */}
                          {p.pendingOrders.length > 0 && (
                            <div className="flex items-start gap-1.5 mb-2 ml-0.5">
                              <Clock size={10} className="text-blue-400 mt-0.5 shrink-0" />
                              <div className="flex flex-col gap-0.5">
                                {p.pendingOrders.map((o, oi) => (
                                  <div key={o} className="flex items-center gap-2">
                                    <div className="flex flex-col items-center">
                                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                      {oi < p.pendingOrders.length - 1 && <span className="w-px h-2.5 bg-blue-200" />}
                                    </div>
                                    <span className="text-[10px] text-blue-600 font-medium">{o}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 특이사항 입력 */}
                          <textarea
                            value={p.editNotes}
                            onChange={e => {
                              const next = [...patients];
                              next[idx] = { ...next[idx], editNotes: e.target.value };
                              setPatients(next);
                            }}
                            placeholder="특이사항을 입력하세요..."
                            className="w-full mt-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs resize-none focus:border-indigo-400 focus:outline-none"
                            rows={2}
                          />
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>

                {/* 전체 특이사항 */}
                <div className="mt-4 bg-white rounded-2xl border p-4">
                  <label className="text-xs font-bold text-gray-700 block mb-2">병동 전체 특이사항</label>
                  <textarea
                    value={generalNotes}
                    onChange={e => setGeneralNotes(e.target.value)}
                    placeholder="병동 전체에 대한 인수인계 사항..."
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs resize-none focus:border-indigo-400 focus:outline-none"
                    rows={2}
                  />
                </div>

                {/* 제출 */}
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100 transition-all duration-200"
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : submitted ? <CheckCircle2 size={14} /> : <Send size={14} />}
                    {submitted ? "인수인계 완료!" : "인수인계 제출"}
                  </button>
                </div>

                {/* 최근 3일 인수인계 */}
                {history.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5">
                      <History size={12} /> 최근 3일 인수인계
                    </h3>
                    <div className="relative ml-2">
                      {/* timeline connector line */}
                      <div className="absolute left-[5px] top-3 bottom-3 w-px bg-indigo-200" />
                      <div className="space-y-1.5">
                        {history.filter(h => {
                          const d = new Date(h.submittedAt);
                          const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
                          return d >= threeDaysAgo;
                        }).map(h => (
                          <div key={h.handoffId} className="flex items-center gap-3">
                            {/* timeline dot */}
                            <span className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 border-2 ${h.acknowledgedAt ? "bg-green-400 border-green-200" : "bg-amber-400 border-amber-200"}`} />
                            <div className="flex-1 bg-gray-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono text-gray-400">
                                  {new Date(h.submittedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                                </span>
                                <span className="text-xs font-medium text-gray-700">
                                  {h.shift === "night_to_day" ? "야간→주간" : "주간→야간"}
                                </span>
                                <span className="text-[10px] text-gray-400">{h.fromNurse} → {h.toNurse}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400">{h.patientCount}명</span>
                                {h.acknowledgedAt ? (
                                  <CheckCircle2 size={10} className="text-green-500" />
                                ) : (
                                  <Clock size={10} className="text-amber-500" />
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          /* 이력 탭 */
          <HistoryTab history={history} canAck={canAck} ackBusy={ackBusy} onAck={handleAck} />
        )}
      </main>
      <HospitalFooter />
    </div>
  );
}

// ── 이력 탭 (날짜 필터 + 상세 펼침) ──────────────
function HistoryTab({ history, canAck, ackBusy, onAck }: { history: HandoffRecord[]; canAck: (h: HandoffRecord) => boolean; ackBusy: string | null; onAck: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HandoffDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const filtered = history.filter(h => new Date(h.submittedAt) >= cutoff);

  const byDate: Record<string, HandoffRecord[]> = {};
  for (const h of filtered) {
    const dateKey = new Date(h.submittedAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(h);
  }

  const toggleDetail = async (handoffId: string) => {
    if (expandedId === handoffId) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(handoffId);
    setDetailLoading(true);
    const r = await fetchHandoffDetail(handoffId);
    setDetail(r.data);
    setDetailLoading(false);
  };

  const PRIORITY_BADGE: Record<string, string> = {
    normal: "", high: "border-l-4 border-l-amber-400", critical: "border-l-4 border-l-red-500 bg-red-50/30",
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {[3, 7, 14, 30].map(d => (
          <button key={d} onClick={() => { setDays(d); setExpandedId(null); }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              days === d ? "bg-indigo-600 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-400 hover:border-indigo-200 hover:text-indigo-500"
            }`}>
            {d}일
          </button>
        ))}
        <span className="text-[10px] text-gray-400 ml-2">{filtered.length}건</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">해당 기간 인수인계 이력 없음</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(byDate).map(([date, records]) => (
            <div key={date}>
              <h4 className="text-[10px] font-bold text-gray-400 mb-1.5">{date}</h4>
              <div className="space-y-1.5">
                {records.map(h => (
                  <div key={h.handoffId}>
                    {/* 요약 행 */}
                    <button
                      onClick={() => toggleDetail(h.handoffId)}
                      className={`w-full bg-white rounded-xl border px-4 py-3 flex items-center justify-between text-left hover:border-indigo-200 transition-colors ${
                        expandedId === h.handoffId ? "border-indigo-300 ring-1 ring-indigo-100" : ""
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900">
                            {h.shift === "night_to_day" ? "야간→주간" : "주간→야간"}
                          </span>
                          <span className="text-[10px] text-gray-400">환자 {h.patientCount}명</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {h.fromNurse} → {h.toNurse}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-[10px] text-gray-400">
                            {new Date(h.submittedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          {h.acknowledgedAt ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">확인됨</span>
                          ) : canAck(h) ? (
                            <span role="button" onClick={(e) => { e.stopPropagation(); if (ackBusy !== h.handoffId) onAck(h.handoffId); }}
                              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white hover:bg-indigo-700">
                              {ackBusy === h.handoffId ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />} 수신 확인
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">대기</span>
                          )}
                        </div>
                        <ChevronRight size={12} className={`text-gray-300 transition-transform ${expandedId === h.handoffId ? "rotate-90" : ""}`} />
                      </div>
                    </button>

                    {/* 상세 내용 (펼침) */}
                    {expandedId === h.handoffId && (
                      <div className="mt-1 bg-indigo-50/30 rounded-xl border border-indigo-200 p-4">
                        {detailLoading ? (
                          <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-indigo-400" /></div>
                        ) : detail ? (
                          <div className="space-y-3">
                            {/* 환자별 인수인계 내용 */}
                            {detail.patients.map(p => (
                              <div key={p.patientId} className={`bg-white rounded-lg p-3 ${PRIORITY_BADGE[p.priority] ?? ""}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-bold text-gray-900">{p.room} {p.bed}번 {maskName(p.patientName)}</span>
                                  <span className={`text-[10px] ${
                                    p.condition === "improving" ? "text-blue-600" :
                                    p.condition === "worsening" ? "text-amber-600" :
                                    p.condition === "critical" ? "text-red-600" : "text-green-600"
                                  }`}>
                                    {p.condition === "stable" ? "안정" : p.condition === "improving" ? "호전" : p.condition === "worsening" ? "악화" : "위중"}
                                  </span>
                                  {p.priority === "high" && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-600">주의</span>}
                                  {p.priority === "critical" && <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-600">긴급</span>}
                                </div>

                                {/* 진단 + 바이탈 */}
                                <div className="flex items-center gap-3 text-[10px] text-gray-400 mb-1.5">
                                  <span>{p.diagnosis}</span>
                                  <span>BP {p.vitals.bp}</span>
                                  <span>HR {p.vitals.hr}</span>
                                  <span>T {p.vitals.temp}°</span>
                                </div>

                                {/* 주의사항 */}
                                {p.alerts.length > 0 && (
                                  <div className="flex items-center gap-1 mb-1.5">
                                    {p.alerts.map(a => (
                                      <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                                        ⚠ {a}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* 인수인계 내용 (핵심) */}
                                {p.notes && (
                                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-700 leading-relaxed">
                                    {p.notes}
                                  </div>
                                )}
                              </div>
                            ))}

                            {/* 병동 전체 특이사항 */}
                            {detail.generalNotes && (
                              <div className="bg-white rounded-lg p-3 border-l-4 border-l-indigo-300">
                                <span className="text-[10px] font-bold text-indigo-500 block mb-1">병동 전체</span>
                                <span className="text-xs text-gray-700">{detail.generalNotes}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 text-center py-4">상세 내용을 불러올 수 없습니다</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
