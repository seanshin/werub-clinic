// Created: 2026-05-18
// 수술 보드 — 오늘 수술 실시간 현황
"use client";
import { maskName } from "@/lib/mask";

import { useState, useEffect, useMemo } from "react";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { fetchSurgeryToday, updateSurgeryStatus, type Surgery } from "@/lib/workgroup";
import { Scissors, Clock, CheckCircle2, Loader2, List, LayoutList } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  scheduled: { label: "예정", color: "text-gray-600", bg: "bg-gray-100", dot: "bg-gray-300" },
  preparing: { label: "준비중", color: "text-amber-600", bg: "bg-amber-100", dot: "bg-amber-400" },
  in_progress: { label: "진행중", color: "text-red-600", bg: "bg-red-100", dot: "bg-red-500" },
  completed: { label: "완료", color: "text-green-600", bg: "bg-green-100", dot: "bg-green-500" },
  recovery: { label: "회복실", color: "text-purple-600", bg: "bg-purple-100", dot: "bg-purple-500" },
};

const PROGRESS_STEPS = ["scheduled", "preparing", "in_progress", "completed", "recovery"] as const;
const PROGRESS_LABELS = ["예정", "준비", "진행", "완료", "회복"];
const RING_COLORS: Record<string, string> = {
  scheduled: "ring-gray-200",
  preparing: "ring-amber-200",
  in_progress: "ring-red-200",
  completed: "ring-green-200",
  recovery: "ring-purple-200",
};

/** startTime "HH:MM" 을 분으로 변환 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function SurgeryBoardPage() {
  const [hospitalName, setHospitalName] = useState("");
  const [surgeries, setSurgeries] = useState<Surgery[]>([]);
  const [loading, setLoading] = useState(true);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchSurgeryToday().then(s => { setSurgeries(s.data); setLoading(false); });
    const interval = setInterval(() => fetchSurgeryToday().then(s => setSurgeries(s.data)), 30000);
    return () => clearInterval(interval);
  }, []);

  // 진행중 수술 (sticky)
  const activeSurgeries = useMemo(() => surgeries.filter(s => s.status === "in_progress"), [surgeries]);
  const nonActiveSurgeries = useMemo(() => surgeries.filter(s => s.status !== "in_progress"), [surgeries]);

  // 오전/오후 분류
  const amSurgeries = useMemo(() => nonActiveSurgeries.filter(s => timeToMinutes(s.startTime) < 720), [nonActiveSurgeries]);
  const pmSurgeries = useMemo(() => nonActiveSurgeries.filter(s => timeToMinutes(s.startTime) >= 720), [nonActiveSurgeries]);

  // 완료율
  const completedCount = surgeries.filter(s => s.status === "completed" || s.status === "recovery").length;
  const completionPct = surgeries.length > 0 ? Math.round((completedCount / surgeries.length) * 100) : 0;

  const todayStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  // OR 별로 그룹핑 (기존 유지용)
  const byOR: Record<string, Surgery[]> = {};
  for (const s of surgeries) {
    if (!byOR[s.operatingRoom]) byOR[s.operatingRoom] = [];
    byOR[s.operatingRoom].push(s);
  }

  /** 개별 수술 카드 — 상세 모드 */
  const renderDetailCard = (s: Surgery) => {
    const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.scheduled;
    const isActive = s.status === "in_progress";
    const currentIdx = PROGRESS_STEPS.indexOf(s.status as typeof PROGRESS_STEPS[number]);
    return (
      <div key={s.id} className={`px-4 py-3 transition-colors ${isActive ? "border-l-[3px] border-l-red-500 bg-red-50/40" : "hover:bg-gray-50/50"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* 시간 */}
            <div className="text-center w-20">
              <div className={`text-xs font-mono ${isActive ? "text-red-600 font-bold" : "text-gray-500"}`}>{s.startTime}</div>
              <div className="text-[10px] text-gray-300">~{s.endTime}</div>
            </div>
            {/* 환자 + 수술명 */}
            <div>
              <div className="flex items-center gap-2">
                {isActive && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                <span className={`text-sm font-medium ${isActive ? "text-red-900" : "text-gray-900"}`}>{maskName(s.patientName)}</span>
                <span className="text-xs text-gray-500">{s.procedure}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-400 mt-0.5">
                <span>집도: {s.surgeon}</span>
                <span>마취: {s.anesthesiologist}</span>
              </div>
            </div>
          </div>
          {/* 상태 + 다음 단계 */}
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
            {s.status !== "completed" && (() => {
              const next: Record<string, string> = { scheduled: "preparing", preparing: "in_progress", in_progress: "completed", recovery: "completed" };
              const nextStatus = next[s.status];
              const btnConfig: Record<string, { label: string; bg: string; hover: string }> = {
                scheduled: { label: "준비 시작", bg: "bg-amber-500 text-white shadow-amber-500/20", hover: "hover:bg-amber-600" },
                preparing: { label: "수술 시작", bg: "bg-blue-500 text-white shadow-blue-500/20", hover: "hover:bg-blue-600" },
                in_progress: { label: "수술 완료", bg: "bg-green-500 text-white shadow-green-500/20", hover: "hover:bg-green-600" },
                recovery: { label: "퇴실", bg: "bg-green-500 text-white shadow-green-500/20", hover: "hover:bg-green-600" },
              };
              const bc = btnConfig[s.status] ?? btnConfig.scheduled;
              return nextStatus ? (
                <button
                  onClick={async () => {
                    await updateSurgeryStatus(s.id, nextStatus);
                    setSurgeries(prev => prev.map(x => x.id === s.id ? { ...x, status: nextStatus as Surgery["status"] } : x));
                  }}
                  className={`text-[10px] px-3 py-1 rounded-full font-semibold shadow-sm transition-all ${bc.bg} ${bc.hover}`}
                >
                  {bc.label}
                </button>
              ) : null;
            })()}
          </div>
        </div>
        {/* 진행 타임라인 */}
        <div className="flex items-center gap-0 mt-2.5 ml-20">
          {PROGRESS_STEPS.map((step, idx) => {
            const reached = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            const stepCfg = STATUS_CONFIG[step];
            return (
              <div key={step} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`w-2.5 h-2.5 rounded-full transition-all ${isCurrent ? `${stepCfg.dot} ring-2 ring-offset-1 ${RING_COLORS[step]}` : reached ? stepCfg.dot : "bg-gray-200"}`} />
                  <span className={`text-[8px] mt-0.5 ${isCurrent ? "font-bold " + stepCfg.color : reached ? "text-gray-500" : "text-gray-300"}`}>
                    {PROGRESS_LABELS[idx]}
                  </span>
                </div>
                {idx < PROGRESS_STEPS.length - 1 && (
                  <div className={`w-8 h-[2px] mb-3 mx-0.5 ${idx < currentIdx ? "bg-gray-300" : "bg-gray-100"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /** 개별 수술 카드 — 간략 모드 */
  const renderCompactCard = (s: Surgery) => {
    const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.scheduled;
    const isActive = s.status === "in_progress";
    return (
      <div key={s.id} className={`px-4 py-2 flex items-center justify-between transition-colors ${isActive ? "border-l-[3px] border-l-red-500 bg-red-50/40" : "hover:bg-gray-50/50"}`}>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono w-16 ${isActive ? "text-red-600 font-bold" : "text-gray-500"}`}>{s.startTime}</span>
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
          <span className={`text-sm font-medium ${isActive ? "text-red-900" : "text-gray-900"}`}>{maskName(s.patientName)}</span>
          <span className="text-xs text-gray-400 truncate max-w-[180px]">{s.procedure}</span>
          <span className="text-[10px] text-gray-300">{s.operatingRoom}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
          {s.status !== "completed" && (() => {
            const next: Record<string, string> = { scheduled: "preparing", preparing: "in_progress", in_progress: "completed", recovery: "completed" };
            const nextStatus = next[s.status];
            const btnConfig: Record<string, { label: string; bg: string; hover: string }> = {
              scheduled: { label: "준비", bg: "bg-amber-500 text-white", hover: "hover:bg-amber-600" },
              preparing: { label: "시작", bg: "bg-blue-500 text-white", hover: "hover:bg-blue-600" },
              in_progress: { label: "완료", bg: "bg-green-500 text-white", hover: "hover:bg-green-600" },
              recovery: { label: "퇴실", bg: "bg-green-500 text-white", hover: "hover:bg-green-600" },
            };
            const bc = btnConfig[s.status] ?? btnConfig.scheduled;
            return nextStatus ? (
              <button
                onClick={async () => {
                  await updateSurgeryStatus(s.id, nextStatus);
                  setSurgeries(prev => prev.map(x => x.id === s.id ? { ...x, status: nextStatus as Surgery["status"] } : x));
                }}
                className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold shadow-sm transition-all ${bc.bg} ${bc.hover}`}
              >
                {bc.label}
              </button>
            ) : null;
          })()}
        </div>
      </div>
    );
  };

  /** 시간대 섹션 렌더 (상세/간략 모드 공통) */
  const renderTimeSection = (label: string, icon: string, items: Surgery[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="flex items-center gap-2 mb-2 mt-1">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</span>
          <span className="text-[10px] text-gray-300">{items.length}건</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <div className="bg-white rounded-2xl border overflow-hidden shadow-sm divide-y divide-gray-100">
          {items.map(s => compact ? renderCompactCard(s) : renderDetailCard(s))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Scissors size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900">수술 보드</h1>
              <p className="text-xs text-gray-400">오늘 수술 일정 · 30초 자동 갱신</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 상세/간략 토글 */}
            <button
              onClick={() => setCompact(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
              title={compact ? "상세 보기" : "간략 보기"}
            >
              {compact ? <LayoutList size={14} className="text-gray-500" /> : <List size={14} className="text-gray-500" />}
              <span className="text-xs font-medium text-gray-600">{compact ? "간략" : "상세"}</span>
            </button>
            <div className="px-4 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm">
              <span className="text-sm font-semibold text-gray-700">
                {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-red-500" size={24} /></div>
        ) : surgeries.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
              <Scissors size={28} className="opacity-30" />
            </div>
            <p className="text-base font-medium text-gray-500 mb-1">오늘 예정된 수술이 없습니다</p>
            <p className="text-xs text-gray-400">{todayStr} 기준</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 현재 진행중 수술 — sticky 배너 */}
            {activeSurgeries.length > 0 && (
              <div className="sticky top-0 z-10">
                <div className="bg-gradient-to-r from-red-500 to-rose-600 rounded-2xl shadow-lg shadow-red-500/20 overflow-hidden">
                  <div className="px-4 py-2 flex items-center gap-2 border-b border-red-400/30">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    <span className="text-xs font-bold text-white/90 uppercase tracking-wider">현재 진행중</span>
                    <span className="text-[10px] text-white/60">{activeSurgeries.length}건</span>
                  </div>
                  <div className="divide-y divide-red-400/20">
                    {activeSurgeries.map(s => (
                      <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="text-center w-16">
                            <div className="text-xs font-mono text-white font-bold">{s.startTime}</div>
                            <div className="text-[10px] text-white/50">~{s.endTime}</div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white">{maskName(s.patientName)}</span>
                              <span className="text-xs text-white/70">{s.procedure}</span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-white/50 mt-0.5">
                              <span>{s.operatingRoom}</span>
                              <span>집도: {s.surgeon}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            await updateSurgeryStatus(s.id, "completed");
                            setSurgeries(prev => prev.map(x => x.id === s.id ? { ...x, status: "completed" as Surgery["status"] } : x));
                          }}
                          className="text-[10px] px-3 py-1 rounded-full font-semibold bg-white text-red-600 hover:bg-red-50 shadow-sm transition-all"
                        >
                          수술 완료
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 오전 수술 */}
            {renderTimeSection("오전 수술", "\u2600\uFE0F", amSurgeries)}

            {/* 오후 수술 */}
            {renderTimeSection("오후 수술", "\uD83C\uDF19", pmSurgeries)}

            {/* 요약 카드 */}
            <div className="grid grid-cols-4 gap-3 pt-2">
              <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 text-center shadow-sm">
                <div className="text-lg font-black text-gray-800">{surgeries.length}</div>
                <div className="text-[10px] font-medium text-gray-400 mt-0.5">전체</div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-white rounded-xl border border-red-100 px-4 py-3 text-center shadow-sm">
                <div className="text-lg font-black text-red-600">{activeSurgeries.length}</div>
                <div className="text-[10px] font-medium text-red-400 mt-0.5">진행중</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-white rounded-xl border border-green-100 px-4 py-3 text-center shadow-sm">
                <div className="text-lg font-black text-green-600">{completedCount}</div>
                <div className="text-[10px] font-medium text-green-400 mt-0.5">완료</div>
              </div>
              <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-100 px-4 py-3 text-center shadow-sm">
                <div className="text-lg font-black text-gray-600">{surgeries.filter(s => s.status === "scheduled").length}</div>
                <div className="text-[10px] font-medium text-gray-400 mt-0.5">예정</div>
              </div>
            </div>

            {/* 진행률 바 */}
            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-600">오늘 수술 진행률</span>
                <span className="text-xs font-mono font-bold text-gray-800">{completionPct}%</span>
              </div>
              <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-400">
                <span>완료 {completedCount} / 전체 {surgeries.length}</span>
                <span>남은 수술 {surgeries.length - completedCount}건</span>
              </div>
            </div>
          </div>
        )}
      </main>
      <HospitalFooter />
    </div>
  );
}
