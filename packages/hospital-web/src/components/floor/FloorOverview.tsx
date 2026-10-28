// Created: 2026-05-18
// 전체 층 한눈에 보기 — 모든 층을 그리드로 표시
"use client";

import { useState, useEffect } from "react";
import {
  fetchZones, fetchEntities, fetchStats, applyLayout,
  ZONE_TYPE_COLORS, CONGESTION_COLORS, ENTITY_COLORS,
  type FloorPlan, type Zone, type Entity, type ZoneStats, type Congestion,
} from "@/lib/floor";
import { Users, Clock, AlertTriangle } from "lucide-react";
import { getFloorSettings, pollMs } from "@/lib/floor-settings";

interface Props {
  floors: FloorPlan[];
  onFloorClick: (floorId: string) => void;
  onTotals?: (patients: number, staff: number) => void;
}

interface FloorData {
  floorId: string;
  zones: Zone[];
  entities: Entity[];
  stats: ZoneStats[];
  totalPatients: number;
  totalStaff: number;
}

export default function FloorOverview({ floors, onFloorClick, onTotals }: Props) {
  const [floorData, setFloorData] = useState<FloorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      const results = await Promise.all(
        floors.map(async f => {
          const [zonesResult, entResult, statsResult] = await Promise.all([
            fetchZones(f.id),
            fetchEntities(f.id),
            fetchStats(f.id),
          ]);
          return {
            floorId: f.id,
            zones: applyLayout(zonesResult.data, f.id),
            entities: entResult.data.entities,
            stats: statsResult.data,
            totalPatients: entResult.data.totalPatients,
            totalStaff: entResult.data.totalStaff,
          };
        }),
      );
      setFloorData(results);
      setLoading(false);
      // 전체 합계를 상단 카운터로 전달 (개요 모드에서 0명 표시되던 문제 해결)
      onTotals?.(
        results.reduce((s, r) => s + r.totalPatients, 0),
        results.reduce((s, r) => s + r.totalStaff, 0),
      );
    }
    loadAll();
    const interval = setInterval(loadAll, pollMs(getFloorSettings().statsPollingInterval, 30)); // 설정 소비(2026-08-19)
    return () => clearInterval(interval);
  }, [floors, onTotals]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-gray-400 text-sm">전체 층 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl mx-auto">
        {floors.map(floor => {
          const data = floorData.find(d => d.floorId === floor.id);
          if (!data) return null;

          const statsMap: Record<string, ZoneStats> = {};
          for (const s of data.stats) statsMap[s.zoneId] = s;

          const entityByZone: Record<string, Entity[]> = {};
          for (const e of data.entities) {
            if (!entityByZone[e.zoneId]) entityByZone[e.zoneId] = [];
            entityByZone[e.zoneId].push(e);
          }

          const worstCongestion = data.stats.reduce<Congestion>((worst, s) => {
            const order: Congestion[] = ["low", "normal", "high", "critical"];
            return order.indexOf(s.congestion) > order.indexOf(worst) ? s.congestion : worst;
          }, "low");

          return (
            <button
              key={floor.id}
              onClick={() => onFloorClick(floor.id)}
              className="bg-white rounded-2xl border border-gray-200 p-4 hover:border-emerald-300 hover:shadow-lg transition-all text-left group"
            >
              {/* 층 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-gray-900">{floor.name}</span>
                  <span className="text-xs text-gray-400">{floor.description}</span>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: CONGESTION_COLORS[worstCongestion] + "20", color: CONGESTION_COLORS[worstCongestion] }}
                >
                  {worstCongestion === "low" ? "여유" : worstCongestion === "normal" ? "보통" : worstCongestion === "high" ? "혼잡" : "초과"}
                </span>
              </div>

              {/* 요약 통계 */}
              <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Users size={11} /> 환자 <strong className="text-gray-900">{data.totalPatients}</strong></span>
                <span className="flex items-center gap-1"><Users size={11} /> 의료진 <strong className="text-gray-900">{data.totalStaff}</strong></span>
                {data.stats.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> 평균
                    <strong className="text-gray-900">
                      {Math.round(data.stats.reduce((sum, s) => sum + s.avgWaitMinutes, 0) / data.stats.length)}분
                    </strong>
                  </span>
                )}
              </div>

              {/* 미니 구역 맵 */}
              <div className="relative bg-slate-50 rounded-xl p-3 min-h-[120px]">
                <div className="flex flex-wrap gap-1.5">
                  {data.zones.map(zone => {
                    const s = statsMap[zone.id];
                    const congestion: Congestion = s?.congestion ?? "low";
                    const color = zone.color ?? ZONE_TYPE_COLORS[zone.type];
                    const ents = entityByZone[zone.id] ?? [];

                    return (
                      <div
                        key={zone.id}
                        className="rounded-lg px-2.5 py-1.5 border text-[10px] leading-tight"
                        style={{
                          borderColor: color + "60",
                          background: color + "12",
                          minWidth: Math.max(60, zone.bounds.w * 12),
                        }}
                      >
                        <div className="font-medium text-gray-800 truncate">{zone.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span style={{ color: CONGESTION_COLORS[congestion] }} className="font-bold">
                            {s?.currentCount ?? 0}명
                          </span>
                          {s && s.avgWaitMinutes > 0 && (
                            <span className="text-gray-400">{s.avgWaitMinutes}분</span>
                          )}
                        </div>
                        {/* 엔티티 도트 */}
                        {ents.length > 0 && (
                          <div className="flex gap-0.5 mt-1 flex-wrap">
                            {ents.slice(0, 8).map(e => (
                              <span key={e.id} className="w-1.5 h-1.5 rounded-full" style={{ background: ENTITY_COLORS[e.type] }} />
                            ))}
                            {ents.length > 8 && <span className="text-[8px] text-gray-400">+{ents.length - 8}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 병목 경고 */}
                {data.stats.some(s => s.congestion === "critical" || s.congestion === "high") && (
                  <div className="absolute top-2 right-2">
                    <AlertTriangle size={14} className="text-amber-500" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
