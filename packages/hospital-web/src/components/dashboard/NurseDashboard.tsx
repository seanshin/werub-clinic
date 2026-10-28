// Created: 2026-05-18
// 간호사 대시보드 — 병동 현황 + 투약 예정 + 인수인계
"use client";
import { maskName } from "@/lib/mask";

import { useState, useEffect } from "react";
import { fetchWardStatus, fetchMedicationSchedule, type WardStatus, type Medication, type DataSource } from "@/lib/workgroup";
import { Bed, Pill, AlertTriangle, Clock, Loader2 } from "lucide-react";
import DataSourceBadge from "@/components/DataSourceBadge";

const CONDITION_DOT: Record<string, string> = {
  stable: "bg-green-500", improving: "bg-blue-500", worsening: "bg-amber-500", critical: "bg-red-500",
};

interface Props { userId: string; wardFloor?: string }

export default function NurseDashboard({ userId, wardFloor = "3f" }: Props) {
  const [ward, setWard] = useState<WardStatus | null>(null);
  const [meds, setMeds] = useState<{ upcoming: Medication[]; overdueCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>("mock");

  useEffect(() => {
    Promise.all([
      fetchWardStatus(wardFloor),
      fetchMedicationSchedule(userId),
    ]).then(([w, m]) => {
      setWard(w.data);
      setMeds(m.data);
      setSource(w._source === "his" ? "his" : "mock");
      setLoading(false);
    });
  }, [userId, wardFloor]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-emerald-500" size={20} /></div>;

  return (
    <div className="space-y-4">
      <DataSourceBadge source={source} />
      {/* 병동 현황 */}
      {ward && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bed size={16} className="text-indigo-500" />
              <h3 className="text-sm font-bold text-gray-900">{ward.floorName}</h3>
            </div>
            <span className="text-xs text-gray-400">{ward.occupiedBeds}/{ward.totalBeds} 병상</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ward.rooms.map(room => (
              <div key={room.roomId} className="bg-gray-50 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-gray-700">{room.roomName}</span>
                  <span className="text-[10px] text-gray-400">{room.patients.length}/{room.capacity}</span>
                </div>
                {room.patients.length === 0 ? (
                  <span className="text-[10px] text-gray-300">빈 병실</span>
                ) : (
                  <div className="space-y-1">
                    {room.patients.map(p => (
                      <div key={p.patientId} className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${CONDITION_DOT[p.condition] ?? "bg-gray-400"}`} />
                        <span className="text-[10px] text-gray-600">{p.bedNumber}번 {maskName(p.patientName)}</span>
                        {p.alerts.length > 0 && <AlertTriangle size={8} className="text-amber-500" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 근무 중 의료진 */}
          {ward.onDutyStaff.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-400">
              <span className="font-medium text-gray-500">근무중:</span>
              {ward.onDutyStaff.map(s => <span key={s.id}>{s.name} ({s.shift === "day" ? "주간" : "야간"})</span>)}
            </div>
          )}
        </div>
      )}

      {/* 투약 예정 */}
      {meds && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Pill size={16} className="text-pink-500" />
              <h3 className="text-sm font-bold text-gray-900">투약 예정</h3>
              <span className="text-xs text-gray-400">{meds.upcoming.length}건</span>
            </div>
            {meds.overdueCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                미투약 {meds.overdueCount}건
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {meds.upcoming.map(m => {
              const scheduledTime = new Date(m.scheduledAt);
              const now = new Date();
              const diffMin = Math.round((scheduledTime.getTime() - now.getTime()) / 60000);
              const timeLabel = diffMin < 0 ? `${Math.abs(diffMin)}분 전` : diffMin === 0 ? "지금" : `${diffMin}분 후`;
              const isUrgent = diffMin <= 5;

              return (
                <div key={m.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${isUrgent ? "bg-red-50 border border-red-100" : "hover:bg-gray-50"}`}>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-mono w-14 ${isUrgent ? "text-red-600 font-bold" : "text-gray-400"}`}>
                      {scheduledTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div>
                      <span className="text-sm text-gray-900">{m.room} {maskName(m.patientName)}</span>
                      <span className="text-xs text-gray-400 ml-2">{m.medication} ({m.route})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${isUrgent ? "text-red-600 font-bold" : "text-gray-400"}`}>{timeLabel}</span>
                    {m.status === "administered" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">완료</span>
                    ) : (
                      <button className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                        투약 ✓
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
