// Created: 2026-05-18
// 구역 상세 사이드 패널 — 구역 정보 + 환자 목록
"use client";

import type { Zone, Entity, ZoneStats } from "@/lib/floor";
import { ZONE_TYPE_LABELS, CONGESTION_COLORS, ENTITY_COLORS } from "@/lib/floor";
import { X, Clock, Users, AlertTriangle } from "lucide-react";

interface Props {
  zone: Zone;
  entities: Entity[];
  stats: ZoneStats | null;
  onClose: () => void;
}

export default function ZoneDetailPanel({ zone, entities, stats, onClose }: Props) {
  const zoneEntities = entities.filter(e => e.zoneId === zone.id);
  const patients = zoneEntities.filter(e => e.type === "patient");
  const staff = zoneEntities.filter(e => e.type !== "patient");

  return (
    <div className="w-80 bg-white border-l border-gray-200 h-full overflow-y-auto">
      {/* 헤더 */}
      <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-900">{zone.name}</h3>
          <span className="text-xs text-gray-500">{ZONE_TYPE_LABELS[zone.type]} | 정원 {zone.capacity}명</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
          <X size={16} />
        </button>
      </div>

      {/* 통계 */}
      {stats && (
        <div className="px-4 py-3 border-b">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Users size={12} /> 현재 인원
              </div>
              <div className="text-lg font-bold" style={{ color: CONGESTION_COLORS[stats.congestion] }}>
                {stats.currentCount}
                <span className="text-xs font-normal text-gray-400">/{stats.capacity}</span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Clock size={12} /> 평균 대기
              </div>
              <div className="text-lg font-bold text-gray-900">
                {stats.avgWaitMinutes}<span className="text-xs font-normal text-gray-400">분</span>
              </div>
            </div>
          </div>
          {stats.congestion === "critical" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">
              <AlertTriangle size={12} /> 정원 초과 상태
            </div>
          )}
          {stats.congestion === "high" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
              <AlertTriangle size={12} /> 혼잡
            </div>
          )}
        </div>
      )}

      {/* 환자 목록 */}
      <div className="px-4 py-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">환자 ({patients.length}명)</h4>
        {patients.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">현재 환자 없음</p>
        ) : (
          <div className="space-y-1.5">
            {patients.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: ENTITY_COLORS.patient }} />
                  <span className="text-sm font-medium text-gray-900">{p.label}</span>
                  {p.department && <span className="text-[10px] text-gray-400">{p.department}</span>}
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-500">
                    {p.status === "waiting" ? `대기 ${p.waitMinutes ?? 0}분` : p.status === "in-treatment" ? "진료중" : p.status === "admitted" ? "입원" : p.status === "in-lab" ? "검사중" : p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 의료진 */}
      {staff.length > 0 && (
        <div className="px-4 py-3 border-t">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">의료진 ({staff.length}명)</h4>
          <div className="space-y-1.5">
            {staff.map(s => (
              <div key={s.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full" style={{ background: ENTITY_COLORS[s.type] }} />
                <span className="text-sm font-medium text-gray-900">{s.label}</span>
                <span className="text-[10px] text-gray-400">{s.department}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 오늘 통계 */}
      {stats && (
        <div className="px-4 py-3 border-t">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>오늘 방문</span>
            <span className="font-medium text-gray-700">{stats.todayTotal}명</span>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
            <span>최대 대기</span>
            <span className="font-medium text-gray-700">{stats.maxWaitMinutes}분</span>
          </div>
        </div>
      )}
    </div>
  );
}
