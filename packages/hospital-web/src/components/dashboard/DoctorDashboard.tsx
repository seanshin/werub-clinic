// Created: 2026-05-18
// 의사 대시보드 — 오늘 진료 + 수술 + 담당 입원환자
"use client";
import { maskName } from "@/lib/mask";

import { useState, useEffect } from "react";
import { fetchDoctorSchedule, fetchSurgeryToday, fetchWardPatients, fetchDutySchedule, type Appointment, type Surgery, type WardPatient, type DataSource } from "@/lib/workgroup";
import { Stethoscope, Clock, Bed, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import DataSourceBadge from "@/components/DataSourceBadge";

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  waiting: { label: "대기", color: "bg-amber-100 text-amber-700" },
  in_progress: { label: "진료중", color: "bg-blue-100 text-blue-700" },
  completed: { label: "완료", color: "bg-green-100 text-green-700" },
  no_show: { label: "미방문", color: "bg-gray-100 text-gray-500" },
};

const CONDITION_COLOR: Record<string, string> = {
  stable: "text-green-600", improving: "text-blue-600", worsening: "text-amber-600", critical: "text-red-600",
};

interface Props { userId: string }

export default function DoctorDashboard({ userId }: Props) {
  const [schedule, setSchedule] = useState<{ appointments: Appointment[]; total: number; completed: number } | null>(null);
  const [surgeries, setSurgeries] = useState<Surgery[]>([]);
  const [patients, setPatients] = useState<WardPatient[]>([]);
  const [duty, setDuty] = useState<{ name: string; shift: string; department: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>("mock");

  useEffect(() => {
    Promise.all([
      fetchDoctorSchedule(userId),
      fetchSurgeryToday(),
      fetchWardPatients(userId),
      fetchDutySchedule(),
    ]).then(([s, su, p, d]) => {
      setSchedule(s.data);
      setSurgeries(su.data);
      setPatients(p.data);
      setDuty(d.data.today);
      setSource(s._source === "his" ? "his" : "mock");
      setLoading(false);
    });
  }, [userId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-emerald-500" size={20} /></div>;

  return (
    <div className="space-y-4">
      <DataSourceBadge source={source} />
      {/* 오늘 진료 */}
      <div className="bg-white rounded-2xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Stethoscope size={16} className="text-emerald-500" />
            <h3 className="text-sm font-bold text-gray-900">오늘 진료</h3>
          </div>
          <span className="text-xs text-gray-400">{schedule?.completed ?? 0}/{schedule?.total ?? 0}건 완료</span>
        </div>
        <div className="space-y-1.5">
          {schedule?.appointments.slice(0, 6).map(apt => {
            const badge = STATUS_BADGE[apt.status] ?? STATUS_BADGE.waiting;
            return (
              <div key={apt.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-400 w-10">{apt.time}</span>
                  <span className="text-sm font-medium text-gray-900">{maskName(apt.patientName)}</span>
                  <span className="text-[10px] text-gray-400">{apt.type === "first_visit" ? "초진" : apt.type === "revisit" ? "재진" : "경과"}</span>
                  {apt.chiefComplaint && <span className="text-[10px] text-gray-400">— {apt.chiefComplaint}</span>}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.label}</span>
              </div>
            );
          })}
          {(schedule?.total ?? 0) > 6 && <p className="text-[10px] text-gray-400 text-center pt-1">+{(schedule?.total ?? 0) - 6}건 더 보기</p>}
        </div>
      </div>

      {/* 수술 일정 */}
      {surgeries.length > 0 && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-red-500" />
            <h3 className="text-sm font-bold text-gray-900">수술 일정</h3>
          </div>
          {surgeries.map(s => (
            <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-400">{s.startTime}~{s.endTime}</span>
                <span className="text-sm font-medium text-gray-900">{maskName(s.patientName)}</span>
                <span className="text-xs text-gray-500">{s.procedure}</span>
                <span className="text-[10px] text-gray-400">{s.operatingRoom}</span>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                s.status === "in_progress" ? "bg-red-100 text-red-700" :
                s.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>{s.status === "scheduled" ? "예정" : s.status === "in_progress" ? "진행중" : s.status === "completed" ? "완료" : s.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* 담당 입원환자 */}
      {patients.length > 0 && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bed size={16} className="text-indigo-500" />
            <h3 className="text-sm font-bold text-gray-900">담당 입원환자</h3>
            <span className="text-xs text-gray-400">{patients.length}명</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {patients.map(p => (
              <div key={p.patientId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{p.room} {maskName(p.patientName)}</span>
                    <span className={`text-[10px] font-medium ${CONDITION_COLOR[p.condition] ?? ""}`}>
                      {p.condition === "stable" ? "안정" : p.condition === "improving" ? "호전" : p.condition === "worsening" ? "악화" : "위중"}
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-400">{p.diagnosis}</span>
                </div>
                {p.alerts.length > 0 && (
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 오늘 당직 */}
      {duty.length > 0 && (
        <div className="bg-gray-50 rounded-xl px-4 py-2.5 flex items-center gap-3 text-xs text-gray-500">
          <span className="font-medium text-gray-700">오늘 당직</span>
          {duty.map((d, i) => (
            <span key={i}>{d.name} ({d.shift === "night" ? "야간" : d.shift === "er" ? "응급" : d.shift})</span>
          ))}
        </div>
      )}
    </div>
  );
}
