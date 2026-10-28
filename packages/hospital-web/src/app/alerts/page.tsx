// Created: 2026-05-18
// 긴급 알림 — Code Blue, 긴급 수혈, 낙상 등 실시간 알림
"use client";
import { maskName } from "@/lib/mask";

import { useState, useEffect, useCallback, useRef } from "react";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { fetchActiveAlerts, acknowledgeAlert, type Alert } from "@/lib/workgroup";
import { Siren, Bell, CheckCircle2, Clock, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";
import { getFloorSettings } from "@/lib/floor-settings";

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; icon: string; leftBorder: string }> = {
  critical: { color: "text-red-700", bg: "bg-red-50", border: "border-red-300", icon: "🚨", leftBorder: "#ef4444" },
  warning: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-300", icon: "⚠️", leftBorder: "#f59e0b" },
  info: { color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-300", icon: "ℹ️", leftBorder: "#3b82f6" },
};

const TYPE_LABELS: Record<string, string> = {
  code_blue: "CODE BLUE",
  urgent_transfusion: "긴급 수혈",
  stat_lab: "긴급 검사",
  fall: "낙상 발생",
  wait_exceeded: "대기 초과",
  capacity_exceeded: "정원 초과",
  no_staff: "의료진 부재",
};

export default function AlertsPage() {
  const [hospitalName, setHospitalName] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "all">("active");

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
  }, []);

  const loadAlerts = useCallback(() => {
    fetchActiveAlerts().then(r => {
      setAlerts(r.data);
      setLoading(false);
    });
  }, []);

  // 5초 폴링
  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 5000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  // 브라우저 알림 — 설정 토글 소비 + 같은 알림 재발송 억제(2026-08-19)
  //   이전: 5초 폴링마다 같은 critical 알림을 계속 다시 띄웠고, 설정의 알림 3종 토글은 어디에도 쓰이지 않았다.
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const st = getFloorSettings();
    const disabled = (type: string) =>
      (type === "wait_exceeded" && !st.alerts.waitExceeded.enabled)
      || (type === "capacity_exceeded" && !st.alerts.capacityExceeded.enabled)
      || (type === "no_staff" && !st.alerts.noStaff.enabled);

    for (const a of alerts) {
      if (a.severity !== "critical" || a.status !== "active") continue;
      if (disabled(a.type) || notifiedRef.current.has(a.id)) continue;
      notifiedRef.current.add(a.id);
      new Notification(`${TYPE_LABELS[a.type] ?? a.type} — ${a.room}`, {
        body: a.message,
        icon: "/favicon.ico",
        requireInteraction: true,
      });
    }
    // 해소된 알림은 재발송 대상으로 되돌린다(같은 상황이 다시 발생하면 알려야 함)
    const activeIds = new Set(alerts.filter(a => a.status === "active").map(a => a.id));
    notifiedRef.current.forEach(id => { if (!activeIds.has(id)) notifiedRef.current.delete(id); });
  }, [alerts]);

  const handleAcknowledge = async (alertId: string, action: string) => {
    const success = await acknowledgeAlert(alertId, action);
    if (success) {
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: action === "resolved" ? "resolved" as const : "acknowledged" as const } : a));
    } else {
      // mock 모드: 로컬 상태만 변경
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: action === "resolved" ? "resolved" as const : "acknowledged" as const } : a));
    }
  };

  const activeAlerts = alerts.filter(a => a.status === "active");
  const filtered = filter === "active" ? activeAlerts : alerts;

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Siren size={22} className="text-red-500" />
            <div>
              <h1 className="text-xl font-black text-gray-900">긴급 알림</h1>
              <p className="text-xs text-gray-400">5초 자동 갱신 · 브라우저 알림</p>
            </div>
          </div>
          {activeAlerts.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 border border-red-300 animate-[pulse_2s_ease-in-out_infinite]">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-xs font-bold text-red-700">활성 {activeAlerts.length}건</span>
            </div>
          )}
        </div>

        {/* 필터 */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setFilter("active")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === "active" ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-gray-200 text-gray-400"}`}>
            활성 알림 {activeAlerts.length > 0 && <span className="ml-1 font-bold">{activeAlerts.length}</span>}
          </button>
          <button onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === "all" ? "bg-gray-100 border-gray-300 text-gray-700" : "bg-white border-gray-200 text-gray-400"}`}>
            전체 {alerts.length}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-red-500" size={24} /></div>
        ) : filtered.length === 0 ? (
          /* 빈 상태 — 친근한 일러스트 스타일 */
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
              <ShieldCheck size={36} className="text-green-400" />
            </div>
            <p className="text-base font-semibold text-gray-500 mb-1">
              {filter === "active" ? "활성 알림이 없습니다" : "알림 이력이 없습니다"}
            </p>
            <p className="text-sm text-gray-300">긴급 상황 발생 시 여기에 실시간으로 표시됩니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(a => {
              const cfg = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.info;
              const isActive = a.status === "active";
              const isCritical = a.severity === "critical" && isActive;

              return (
                <div
                  key={a.id}
                  className={`rounded-2xl border overflow-hidden transition-all duration-300 ${
                    isActive ? `${cfg.bg} ${cfg.border}` : "bg-white border-gray-200 opacity-70"
                  } ${isCritical ? "animate-[pulse_3s_ease-in-out_infinite] shadow-md shadow-red-100" : ""}`}
                  style={{
                    borderLeftWidth: isActive ? 5 : 1,
                    borderLeftColor: isActive ? cfg.leftBorder : undefined,
                  }}
                >
                  <div className="flex items-start p-4 gap-3">
                    {/* 좌측 심각도 아이콘 배지 */}
                    <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl ${
                      a.severity === "critical" ? "bg-red-100" :
                      a.severity === "warning" ? "bg-amber-100" : "bg-blue-100"
                    }`}>
                      {cfg.icon}
                    </div>

                    {/* 중앙 콘텐츠 */}
                    <div className="flex-1 min-w-0">
                      {/* 유형 + 심각도 */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-black ${cfg.color}`}>
                          {TYPE_LABELS[a.type] ?? a.type}
                        </span>
                        {a.room && <span className="text-xs text-gray-500">-- {a.room}</span>}
                        {a.patientName && <span className="text-xs text-gray-500">{maskName(a.patientName)}</span>}
                      </div>

                      {/* 메시지 */}
                      <p className="text-sm text-gray-700 mb-2">{a.message}</p>

                      {/* 메타 */}
                      <div className="flex items-center gap-3 text-[10px] text-gray-400">
                        <span className="flex items-center gap-0.5"><Clock size={9} /> {new Date(a.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                        <span>보고: {a.reportedBy}</span>
                        {a.status !== "active" && (
                          <span className={`px-1.5 py-0.5 rounded-full ${a.status === "resolved" ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600"}`}>
                            {a.status === "resolved" ? "해결됨" : "확인됨"}
                          </span>
                        )}
                      </div>

                      {/* 액션 버튼 — 세로 배치, 풀 너비, 색상 배경 */}
                      {isActive && (
                        <div className="flex flex-col gap-1.5 mt-3">
                          <button onClick={() => handleAcknowledge(a.id, "acknowledged")}
                            className="w-full px-4 py-2 rounded-xl text-xs font-bold bg-blue-500 text-white hover:bg-blue-600 transition-colors shadow-sm">
                            확인
                          </button>
                          <button onClick={() => handleAcknowledge(a.id, "responding")}
                            className="w-full px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm">
                            대응중
                          </button>
                          <button onClick={() => handleAcknowledge(a.id, "resolved")}
                            className="w-full px-4 py-2 rounded-xl text-xs font-bold bg-green-500 text-white hover:bg-green-600 transition-colors shadow-sm">
                            해결
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
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
