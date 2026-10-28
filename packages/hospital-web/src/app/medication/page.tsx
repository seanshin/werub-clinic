// Created: 2026-05-18
// 투약 관리 — 투약 스케줄 + 완료 기록 + 미투약 목록
"use client";
import { maskName } from "@/lib/mask";

import { useState, useEffect, useCallback, useMemo } from "react";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { fetchMedicationSchedule, type Medication } from "@/lib/workgroup";
import { Pill, Clock, AlertTriangle, CheckCircle2, Bell, Loader2, Check, ChevronDown, ChevronRight } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

const ROUTE_LABEL: Record<string, string> = { PO: "경구", IV: "정맥", IM: "근육", SC: "피하", INH: "흡입" };

/** 환자 그룹 키 생성 */
function patientKey(m: Medication): string {
  return `${m.room}|${m.patientName}`;
}

interface PatientGroup {
  key: string;
  room: string;
  patientName: string;
  meds: Medication[];
  pendingCount: number;
  hasOverdue: boolean;
}

export default function MedicationPage() {
  const [hospitalName, setHospitalName] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [filter, setFilter] = useState<"all" | "pending" | "overdue" | "administered">("all");
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      hfetch("/api/auth/me").then(r => r.ok ? r.json() : null),
      hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null),
    ]).then(([auth, ctx]) => {
      if (auth?.user?.id) setUserId(auth.user.id);
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
  }, []);

  const loadMeds = useCallback(() => {
    if (!userId) return;
    Promise.all([
      fetchMedicationSchedule(userId),
      hfetch(`/api/clinic/medication`).then(r => r.ok ? r.json() : { administered: [] }).catch(() => ({ administered: [] })),
    ]).then(([r, admin]) => {
      // 로컬에 저장된 오늘 완료분을 병합 — 재진입/자동갱신에도 완료 상태 유지
      const done = new Set<string>(admin.administered ?? []);
      const merged = r.data.upcoming.map(m => done.has(m.id) ? { ...m, status: "administered" as const, isOverdue: false } : m);
      setMeds(merged);
      setOverdueCount(merged.filter(m => m.isOverdue).length);
      setLoading(false);
    });
  }, [userId]);

  useEffect(() => {
    loadMeds();
    const interval = setInterval(loadMeds, 15000);
    return () => clearInterval(interval);
  }, [loadMeds]);

  // 브라우저 알림 권한 요청
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // 미투약 알림
  useEffect(() => {
    if (overdueCount > 0 && "Notification" in window && Notification.permission === "granted") {
      new Notification("투약 알림", { body: `미투약 ${overdueCount}건이 있습니다`, icon: "/favicon.ico" });
    }
  }, [overdueCount]);

  const handleAdminister = async (medId: string) => {
    // 체크 애니메이션 시작
    setAnimatingIds(prev => new Set(prev).add(medId));
    setTimeout(() => {
      setAnimatingIds(prev => {
        const next = new Set(prev);
        next.delete(medId);
        return next;
      });
    }, 600);

    // 낙관적 갱신
    setMeds(prev => prev.map(m => m.id === medId ? { ...m, status: "administered" as const, isOverdue: false } : m));
    const med = meds.find(m => m.id === medId);
    try {
      // 로컬 저장(재진입/자동갱신에도 유지). HIS 정본 연동은 별도 동기화로 처리.
      await hfetch(`/api/clinic/medication`, {
        method: "POST",
        body: JSON.stringify({ medId, patientId: med?.patientId, medication: med?.medication, scheduledAt: med?.scheduledAt, notes: "투약 완료" }),
      });
    } catch { /* 실패해도 낙관적 상태 유지 */ }
  };

  const now = new Date();

  const filtered = meds.filter(m => {
    if (filter === "pending") return m.status === "pending";
    if (filter === "overdue") return m.isOverdue;
    if (filter === "administered") return m.status === "administered";
    return true;
  });

  // 다음 투약 (가장 긴급한 pending 중 미래 시간 기준)
  const nextUpcoming = useMemo(() => {
    const pending = meds.filter(m => m.status === "pending" && !m.isOverdue);
    if (pending.length === 0) return null;
    return pending.reduce((closest, m) => {
      const mTime = new Date(m.scheduledAt).getTime();
      const cTime = new Date(closest.scheduledAt).getTime();
      const nowMs = now.getTime();
      const mDiff = Math.abs(mTime - nowMs);
      const cDiff = Math.abs(cTime - nowMs);
      return mDiff < cDiff ? m : closest;
    });
  }, [meds, now]);

  // 환자별 그룹핑
  const patientGroups = useMemo((): PatientGroup[] => {
    const map = new Map<string, PatientGroup>();
    for (const m of filtered) {
      const key = patientKey(m);
      if (!map.has(key)) {
        map.set(key, { key, room: m.room, patientName: m.patientName, meds: [], pendingCount: 0, hasOverdue: false });
      }
      const g = map.get(key)!;
      g.meds.push(m);
      if (m.status === "pending") g.pendingCount++;
      if (m.isOverdue || (m.status === "pending" && new Date(m.scheduledAt).getTime() < now.getTime())) g.hasOverdue = true;
    }
    // 미투약 있는 그룹 먼저, 그 다음 대기 많은 순
    return Array.from(map.values()).sort((a, b) => {
      if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
      return b.pendingCount - a.pendingCount;
    });
  }, [filtered, now]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const filterConfig = {
    all: { active: "bg-gray-800 text-white border-gray-800", label: "전체" },
    pending: { active: "bg-emerald-500 text-white border-emerald-500", label: "대기" },
    overdue: { active: "bg-red-500 text-white border-red-500", label: "미투약" },
    administered: { active: "bg-gray-400 text-white border-gray-400", label: "완료" },
  } as const;

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Pill size={22} className="text-pink-500" />
            <div>
              <h1 className="text-xl font-black text-gray-900">투약 관리</h1>
              <p className="text-xs text-gray-400">15초 자동 갱신 · 브라우저 알림 활성</p>
            </div>
          </div>
          {overdueCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 animate-[pulse_2s_ease-in-out_infinite]">
              <Bell size={14} className="text-red-500 animate-bounce" />
              <span className="text-xs font-bold text-red-600">미투약 {overdueCount}건</span>
            </div>
          )}
        </div>

        {/* 다음 투약 하이라이트 */}
        {nextUpcoming && (
          <div className="mb-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                <Clock size={16} className="text-white" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">다음 투약</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-bold text-gray-900">
                    {new Date(nextUpcoming.scheduledAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-xs text-gray-600">{nextUpcoming.room} {maskName(nextUpcoming.patientName)}</span>
                  <span className="text-xs text-gray-500">{nextUpcoming.medication}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-medium">
                    {ROUTE_LABEL[nextUpcoming.route] ?? nextUpcoming.route}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => handleAdminister(nextUpcoming.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
            >
              <CheckCircle2 size={14} />
              투약 완료
            </button>
          </div>
        )}

        {/* 필터 — pill-shaped toggle group */}
        <div className="inline-flex items-center gap-0 bg-gray-100 rounded-full p-1 mb-4">
          {([
            { id: "all", count: meds.length },
            { id: "pending", count: meds.filter(m => m.status === "pending").length },
            { id: "overdue", count: meds.filter(m => m.isOverdue).length },
            { id: "administered", count: meds.filter(m => m.status === "administered").length },
          ] as const).map(f => {
            const cfg = filterConfig[f.id];
            const isActive = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 ${
                  isActive ? cfg.active + " shadow-sm" : "bg-transparent border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {cfg.label}
                {f.count > 0 && (
                  <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold ${
                    isActive ? "bg-white/30 text-current" : "bg-gray-200 text-gray-500"
                  }`}>
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-pink-500" size={24} /></div>
        ) : patientGroups.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <CheckCircle2 size={32} className="mx-auto mb-3 opacity-30" />
            <p>{filter === "overdue" ? "미투약 없음" : "투약 스케줄 없음"}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {patientGroups.map(group => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <div
                  key={group.key}
                  className={`bg-white rounded-xl border overflow-hidden shadow-sm transition-all ${
                    group.hasOverdue ? "border-red-200 ring-1 ring-red-100" : "border-gray-200"
                  }`}
                >
                  {/* 환자 헤더 */}
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className={`w-full px-4 py-2.5 flex items-center justify-between transition-colors ${
                      group.hasOverdue ? "bg-red-50/60" : "bg-gray-50/80"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {isCollapsed
                        ? <ChevronRight size={14} className="text-gray-400" />
                        : <ChevronDown size={14} className="text-gray-400" />
                      }
                      <span className="text-xs font-bold text-gray-500">{group.room}</span>
                      <span className="text-sm font-bold text-gray-900">{maskName(group.patientName)}</span>
                      {group.hasOverdue && <AlertTriangle size={12} className="text-red-500" />}
                    </div>
                    <div className="flex items-center gap-2">
                      {group.pendingCount > 0 && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          group.hasOverdue ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600"
                        }`}>
                          대기 {group.pendingCount}건
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">{group.meds.length}건</span>
                    </div>
                  </button>

                  {/* 투약 목록 */}
                  {!isCollapsed && (
                    <div className="divide-y divide-gray-100">
                      {group.meds.map(m => {
                        const scheduledTime = new Date(m.scheduledAt);
                        const diffMin = Math.round((scheduledTime.getTime() - now.getTime()) / 60000);
                        const isOverdue = m.isOverdue || (m.status === "pending" && diffMin < 0);
                        const isDone = m.status === "administered";

                        return (
                          <div
                            key={m.id}
                            className={`px-4 py-2 flex items-center justify-between transition-colors ${
                              isOverdue ? "bg-red-50/30" : isDone ? "opacity-50" : "hover:bg-gray-50/50"
                            }`}
                            style={{ borderLeftWidth: 3, borderLeftColor: isDone ? "#d1d5db" : isOverdue ? "#ef4444" : "#22c55e" }}
                          >
                            <div className="flex items-center gap-3">
                              {/* 시간 */}
                              <span className={`text-xs font-mono w-14 ${isOverdue ? "text-red-600 font-bold" : isDone ? "text-gray-400" : "text-gray-500"}`}>
                                {scheduledTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {/* 약물명 */}
                              <span className={`text-sm ${isDone ? "text-gray-400 line-through" : "text-gray-800"}`}>{m.medication}</span>
                              {/* 투여경로 뱃지 */}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                isDone ? "bg-gray-100 text-gray-400" : "bg-gray-100 text-gray-600"
                              }`}>
                                {ROUTE_LABEL[m.route] ?? m.route}
                              </span>
                              {m.frequency && <span className="text-[10px] text-gray-400">{m.frequency}</span>}
                              {isOverdue && <AlertTriangle size={10} className="text-red-500" />}
                            </div>
                            {/* 액션 */}
                            {isDone ? (
                              <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
                                <CheckCircle2 size={12} /> 완료
                              </span>
                            ) : (
                              <button
                                onClick={() => handleAdminister(m.id)}
                                className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 shadow-sm ${
                                  animatingIds.has(m.id)
                                    ? "bg-green-500 text-white scale-95"
                                    : isOverdue
                                      ? "bg-red-600 text-white hover:bg-red-700"
                                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                                }`}
                              >
                                <span className={`transition-transform duration-300 ${animatingIds.has(m.id) ? "scale-125" : ""}`}>
                                  {animatingIds.has(m.id) ? <Check size={12} strokeWidth={3} /> : <CheckCircle2 size={12} />}
                                </span>
                                {animatingIds.has(m.id) ? "완료!" : "투약"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <HospitalFooter />
    </div>
  );
}
