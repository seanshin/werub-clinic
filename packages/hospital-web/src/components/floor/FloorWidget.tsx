// Created: 2026-05-18
// Updated: 2026-05-18 — 1F+2F 동시 표시
// 대시보드 미니 위젯 — 병원 동선 요약
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchStats, fetchEntities, CONGESTION_COLORS, type ZoneStats, type Congestion } from "@/lib/floor";
import { getFloorSettings, pollMs } from "@/lib/floor-settings";
import { MapPin, Users, Clock, AlertTriangle, ChevronRight } from "lucide-react";

interface FloorRow {
  floorId: string;
  floorName: string;
  totalPatients: number;
  totalStaff: number;
  avgWaitMinutes: number;
  congestion: Congestion;
  zones: { name: string; count: number; congestion: Congestion }[];
  bottleneck?: { name: string; count: number };
}

export default function FloorWidget() {
  const router = useRouter();
  const [rows, setRows] = useState<FloorRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const settings = getFloorSettings();
      const floors = settings.widgetFloors;
      const results = await Promise.all(
        floors.map(async fid => {
          const [entsResult, statsResult] = await Promise.all([
            fetchEntities(fid),
            fetchStats(fid),
          ]);
          const ents = entsResult.data;
          const stats = statsResult.data;

          const floorNames: Record<string, string> = { "1f": "1층", "2f": "2층", "3f": "3층", "4f": "4층", "5f": "5층", "6f": "6층" };

          const worstCongestion = stats.reduce<Congestion>((w, s) => {
            const order: Congestion[] = ["low", "normal", "high", "critical"];
            return order.indexOf(s.congestion) > order.indexOf(w) ? s.congestion : w;
          }, "low");

          const avgWait = stats.length > 0
            ? Math.round(stats.reduce((sum, s) => sum + s.avgWaitMinutes, 0) / stats.length)
            : 0;

          const bottleneckZone = stats.reduce<ZoneStats | null>((worst, s) =>
            !worst || s.currentCount > worst.currentCount ? s : worst, null);

          return {
            floorId: fid,
            floorName: floorNames[fid] ?? fid.toUpperCase(),
            totalPatients: ents.totalPatients,
            totalStaff: ents.totalStaff,
            avgWaitMinutes: avgWait,
            congestion: worstCongestion,
            zones: stats.map(s => ({ name: s.zoneName, count: s.currentCount, congestion: s.congestion })),
            bottleneck: bottleneckZone && bottleneckZone.currentCount > 0
              ? { name: bottleneckZone.zoneName, count: bottleneckZone.currentCount }
              : undefined,
          };
        }),
      );
      setRows(results);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, pollMs(getFloorSettings().statsPollingInterval, 30)); // 설정 소비(2026-08-19)
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-24 mb-3" />
        <div className="h-20 bg-gray-50 rounded" />
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <button
      onClick={() => router.push("/floor")}
      className="w-full bg-white rounded-2xl border border-gray-200 p-4 hover:border-emerald-300 hover:shadow-md transition-all text-left group"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-emerald-500" />
          <span className="text-sm font-bold text-gray-900">병원 동선</span>
        </div>
        <ChevronRight size={14} className="text-gray-300 group-hover:text-emerald-400 transition-colors" />
      </div>

      {/* 층별 현황 */}
      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.floorId}>
            {/* 층 헤더 */}
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                style={{ background: CONGESTION_COLORS[row.congestion] + "20", color: CONGESTION_COLORS[row.congestion] }}
              >
                {row.floorName}
              </span>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span className="flex items-center gap-0.5">
                  <Users size={10} /> 환자 <strong className="text-gray-900">{row.totalPatients}</strong>
                </span>
                {row.avgWaitMinutes > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Clock size={10} /> 평균 <strong className="text-gray-900">{row.avgWaitMinutes}분</strong>
                  </span>
                )}
              </div>
            </div>

            {/* 구역 태그 */}
            <div className="flex items-center gap-1 flex-wrap">
              {row.zones.filter(z => z.count > 0 || row.floorId === "1f").slice(0, 8).map(z => (
                <span
                  key={z.name}
                  className="text-[10px] px-1.5 py-0.5 rounded-full border"
                  style={{
                    borderColor: CONGESTION_COLORS[z.congestion] + "40",
                    color: CONGESTION_COLORS[z.congestion],
                  }}
                >
                  {z.name} {z.count}
                </span>
              ))}
            </div>

            {/* 병목 경고 */}
            {(row.congestion === "high" || row.congestion === "critical") && row.bottleneck && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                <AlertTriangle size={9} />
                병목: {row.bottleneck.name} ({row.bottleneck.count}명)
              </div>
            )}
          </div>
        ))}
      </div>
    </button>
  );
}
