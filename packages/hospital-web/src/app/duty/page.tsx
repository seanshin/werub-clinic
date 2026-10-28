// Created: 2026-05-18
// 당직표 — 월간 스케줄 + 오늘 당직
"use client";

import { useState, useEffect } from "react";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { fetchDutyMonth, type DutyDay } from "@/lib/workgroup";
import { Calendar, Moon, Sun, AlertCircle, Loader2, ArrowLeftRight } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const SHIFT_ICON: Record<string, { icon: typeof Sun; label: string; color: string }> = {
  day: { icon: Sun, label: "주간", color: "text-amber-500" },
  night: { icon: Moon, label: "야간", color: "text-indigo-500" },
  er: { icon: AlertCircle, label: "응급", color: "text-red-500" },
};

export default function DutyPage() {
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [schedules, setSchedules] = useState<DutyDay[]>([]);
  const [today, setToday] = useState<{ name: string; shift: string; department: string }[]>([]);

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchDutyMonth(month).then(r => {
      setSchedules(r.data.schedules);
      setToday(r.data.today);
      setLoading(false);
    });
  }, [month]);

  const [showSwap, setShowSwap] = useState(false);
  const [swapDate, setSwapDate] = useState("");
  const [swapShift, setSwapShift] = useState("night");
  const [swapTargetDate, setSwapTargetDate] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapDone, setSwapDone] = useState(false);

  const handleSwapRequest = async () => {
    if (!swapDate || !swapTargetDate) return;
    setSwapSubmitting(true);
    const { requestDutySwap } = await import("@/lib/workgroup");
    const result = await requestDutySwap({
      requesterId: "current", targetId: "auto",
      originalDate: swapDate, originalShift: swapShift,
      swapDate: swapTargetDate, swapShift: swapShift,
      reason: swapReason,
    });
    setSwapSubmitting(false);
    // 로컬/HIS 어느 쪽도 저장 못 했으면 성공으로 표시하지 않음
    if (!result) {
      alert("교대 요청 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setSwapDone(true);
    setTimeout(() => { setSwapDone(false); setShowSwap(false); }, 2000);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Calendar size={18} className="text-white" />
            </div>
            <h1 className="text-xl font-black text-gray-900">당직표</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSwap(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors">
              <ArrowLeftRight size={13} /> 교대 요청
            </button>
            {/* 월 네비게이션 */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => { const d = new Date(month + "-01"); d.setMonth(d.getMonth() - 1); setMonth(d.toISOString().slice(0, 7)); }}
                className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors text-sm"
              >‹</button>
              <div className="px-4 py-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white text-sm font-bold shadow-md shadow-indigo-500/20 min-w-[100px] text-center">
                {new Date(month + "-01").toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}
              </div>
              <button
                onClick={() => { const d = new Date(month + "-01"); d.setMonth(d.getMonth() + 1); setMonth(d.toISOString().slice(0, 7)); }}
                className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors text-sm"
              >›</button>
            </div>
          </div>
        </div>

        {/* 오늘 당직 */}
        {today.length > 0 && (
          <div className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-blue-500 rounded-2xl p-5 mb-6 shadow-lg shadow-indigo-500/20">
            <h3 className="text-xs font-bold text-indigo-200 mb-3 uppercase tracking-wider">오늘 당직</h3>
            <div className="flex items-center gap-5 flex-wrap">
              {today.map((d, i) => {
                const si = SHIFT_ICON[d.shift] ?? SHIFT_ICON.day;
                const Icon = si.icon;
                return (
                  <div key={i} className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5">
                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                      <Icon size={16} className="text-white" />
                    </div>
                    <div>
                      <span className="text-base font-bold text-white block leading-tight">{d.name}</span>
                      <span className="text-[11px] text-indigo-200">{d.department} · {si.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-500" size={24} /></div>
        ) : (
          /* 당직 테이블 */
          <div className="bg-white rounded-2xl border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-2.5 text-xs font-bold text-gray-500 text-left w-24">날짜</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-amber-500 text-left">주간</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-indigo-500 text-left">야간</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-red-500 text-left">응급</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-gray-500 text-left">간호 (3F)</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(day => {
                  const isToday = day.date === todayStr;
                  const dayShift = day.shifts.find(s => s.shift === "day");
                  const nightShift = day.shifts.find(s => s.shift === "night");
                  const erShift = day.shifts.find(s => s.shift === "er");
                  const nurse3f = day.nurseShifts.find(n => n.ward === "3f");

                  return (
                    <tr key={day.date} className={`border-b transition-colors ${isToday ? "bg-indigo-50/60 border-l-[3px] border-l-indigo-500" : "hover:bg-gray-50/80"}`}>
                      <td className="px-4 py-2.5">
                        <div className={`text-xs font-medium ${isToday ? "text-indigo-600 font-bold" : "text-gray-700"}`}>
                          {isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1.5 align-middle" />}
                          {day.date.slice(5)} ({DAY_LABELS[new Date(day.date).getDay()]})
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700">
                        {dayShift?.staff.map(s => s.name).join(", ") ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700">
                        {nightShift?.staff.map(s => s.name).join(", ") ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700">
                        {erShift?.staff.map(s => s.name).join(", ") ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[10px] text-gray-400">
                        {nurse3f ? (
                          <>
                            <span className="text-amber-600">D: {nurse3f.nurses.filter((_, i) => nurse3f.shift === "day" || i < 2).join(", ")}</span>
                          </>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {schedules.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-sm text-gray-400 py-8">당직 데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {/* 교대 요청 모달 */}
        {showSwap && (
          <>
            <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowSwap(false)} />
            <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md bg-white rounded-2xl shadow-2xl border p-0 overflow-hidden">
              {/* 모달 헤더 */}
              <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 px-6 py-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ArrowLeftRight size={18} className="text-indigo-200" /> 당직 교대 요청
                </h3>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-2">내 당직일</label>
                  <input type="date" value={swapDate} onChange={e => setSwapDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-gray-50 focus:bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-2">근무 형태</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "day", label: "주간", icon: Sun, activeColor: "bg-amber-500 text-white shadow-amber-500/30", inactiveColor: "bg-amber-50 text-amber-600 hover:bg-amber-100" },
                      { value: "night", label: "야간", icon: Moon, activeColor: "bg-indigo-500 text-white shadow-indigo-500/30", inactiveColor: "bg-indigo-50 text-indigo-600 hover:bg-indigo-100" },
                      { value: "er", label: "응급", icon: AlertCircle, activeColor: "bg-red-500 text-white shadow-red-500/30", inactiveColor: "bg-red-50 text-red-600 hover:bg-red-100" },
                    ].map(opt => {
                      const ShiftIcon = opt.icon;
                      return (
                        <button key={opt.value} onClick={() => setSwapShift(opt.value)}
                          className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${swapShift === opt.value ? `${opt.activeColor} shadow-md` : opt.inactiveColor}`}>
                          <ShiftIcon size={14} />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-2">교대 희망일</label>
                  <input type="date" value={swapTargetDate} onChange={e => setSwapTargetDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-gray-50 focus:bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-2">사유</label>
                  <textarea value={swapReason} onChange={e => setSwapReason(e.target.value)}
                    placeholder="교대 요청 사유를 입력하세요..."
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-gray-50 focus:bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all resize-none" rows={2} />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-6 pb-5">
                <button onClick={() => setShowSwap(false)} className="px-5 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">취소</button>
                <button onClick={handleSwapRequest} disabled={swapSubmitting || !swapDate || !swapTargetDate}
                  className="px-5 py-2.5 text-xs font-bold bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-40 shadow-md shadow-indigo-500/20 transition-all">
                  {swapDone ? "요청 완료!" : swapSubmitting ? "처리중..." : "교대 요청"}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
      <HospitalFooter />
    </div>
  );
}
