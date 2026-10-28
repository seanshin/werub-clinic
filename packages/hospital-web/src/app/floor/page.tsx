// Created: 2026-05-18
// 병원 동선 모니터링 — 실시간 평면도
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import FloorCanvas from "@/components/floor/FloorCanvas";
import FloorToolbar from "@/components/floor/FloorToolbar";
import ZoneDetailPanel from "@/components/floor/ZoneDetailPanel";
import FloorOverview from "@/components/floor/FloorOverview";
import {
  fetchFloorPlans, fetchZones, fetchEntities, fetchStats, applyLayout,
  fetchFlows, fetchIssues, fetchSla, fetchTopology, fetchFloorHistory,
  type FloorPlan, type Zone, type Entity, type ZoneStats,
  type FloorFlow, type FloorIssue, type ZoneSla, type FloorTopology, type EntityHistory,
} from "@/lib/floor";
import { hfetch } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";
import { getFloorSettings, FLOOR_SETTINGS_DEFAULTS, pollMs } from "@/lib/floor-settings";

export default function FloorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hospitalName, setHospitalName] = useState("");
  const [floors, setFloors] = useState<FloorPlan[]>([]);
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [zones, setZones] = useState<Zone[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [stats, setStats] = useState<ZoneStats[]>([]);
  const [totalPatients, setTotalPatients] = useState(0);
  const [totalStaff, setTotalStaff] = useState(0);
  const [overlay, setOverlay] = useState<"none" | "heatmap">("none");
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  // P2 동선 — 흐름(OD)/이슈/SLA/토폴로지
  const [flows, setFlows] = useState<FloorFlow[]>([]);
  const [issues, setIssues] = useState<FloorIssue[]>([]);
  const [sla, setSla] = useState<ZoneSla[]>([]);
  const [topology, setTopology] = useState<FloorTopology | null>(null);
  // 리플레이(타임랩스)
  const [replayMode, setReplayMode] = useState(false);
  const [replayHist, setReplayHist] = useState<EntityHistory[]>([]);
  const [replayRange, setReplayRange] = useState({ from: 0, to: 0 });
  const [replayTime, setReplayTime] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(60);

  // 인증 + 초기 로드
  useEffect(() => {
    Promise.all([
      hfetch("/api/auth/me").then(r => r.ok ? r.json() : null).catch(() => null),
      hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchFloorPlans(),
    ]).then(([, ctx, fResult]) => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
      setFloors(fResult.data);
      setLoading(false);
    });
  }, []);

  // 층 변경 시 구역 로드 (all이면 스킵)
  useEffect(() => {
    if (selectedFloor === "all") return;
    setSelectedZone(null);
    fetchZones(selectedFloor).then(r => setZones(applyLayout(r.data, selectedFloor)));
  }, [selectedFloor]);

  // 설정(폴링 주기) 소비 — 저장만 되고 쓰이지 않던 값을 실제 주기로(2026-08-19)
  const [settings, setSettings] = useState(FLOOR_SETTINGS_DEFAULTS);
  useEffect(() => { setSettings(getFloorSettings()); }, []);

  // 실시간 폴링 — 엔티티 (15초)
  useEffect(() => {
    if (selectedFloor === "all") return;
    const load = () => {
      fetchEntities(selectedFloor).then(r => {
        setEntities(r.data.entities);
        setTotalPatients(r.data.totalPatients);
        setTotalStaff(r.data.totalStaff);
      });
    };
    load();
    const interval = setInterval(load, pollMs(settings.entityPollingInterval, 15));
    return () => clearInterval(interval);
  }, [selectedFloor, settings.entityPollingInterval]);

  // 실시간 폴링 — 통계 (30초)
  useEffect(() => {
    if (selectedFloor === "all") return;
    const load = () => fetchStats(selectedFloor).then(r => setStats(r.data));
    load();
    const interval = setInterval(load, pollMs(settings.statsPollingInterval, 30));
    return () => clearInterval(interval);
  }, [selectedFloor, settings.statsPollingInterval]);

  // 토폴로지 + SLA (층 변경 시 1회 — 정적)
  useEffect(() => {
    if (selectedFloor === "all") { setTopology(null); setSla([]); return; }
    fetchTopology(selectedFloor).then(r => setTopology(r.data));
    fetchSla(selectedFloor).then(r => setSla(r.data));
  }, [selectedFloor]);

  // 실시간 폴링 — 흐름(OD) + 이슈 (30초)
  useEffect(() => {
    if (selectedFloor === "all") { setFlows([]); setIssues([]); return; }
    const load = () => {
      fetchFlows(selectedFloor).then(r => setFlows(r.data));
      fetchIssues(selectedFloor).then(r => setIssues(r.data));
    };
    load();
    const interval = setInterval(load, pollMs(settings.statsPollingInterval, 30));
    return () => clearInterval(interval);
  }, [selectedFloor, settings.statsPollingInterval]);

  // P3 실시간 — SSE 이동 이벤트(move/enter/leave) → 엔티티 라이브 갱신 (폴링은 백업 유지)
  useEffect(() => {
    if (selectedFloor === "all") return;
    let es: EventSource;
    try {
      es = new EventSource(`/api/clinic/his/floor/events/${selectedFloor}`, { withCredentials: true });
    } catch { return; }
    const onMove = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.entityId && d.toZone) setEntities(prev => prev.map(e => e.id === d.entityId ? { ...e, zoneId: d.toZone } : e));
      } catch { /* ignore */ }
    };
    const onEnter = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data);
        if (!d.entityId || !d.toZone) return;
        setEntities(prev => prev.some(e => e.id === d.entityId)
          ? prev
          : [...prev, { id: d.entityId, type: d.entityType ?? "patient", label: d.label ?? d.entityId, zoneId: d.toZone, status: "" }]);
      } catch { /* ignore */ }
    };
    const onLeave = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.entityId) setEntities(prev => prev.filter(e => e.id !== d.entityId));
      } catch { /* ignore */ }
    };
    es.addEventListener("move", onMove as EventListener);
    es.addEventListener("enter", onEnter as EventListener);
    es.addEventListener("leave", onLeave as EventListener);
    // 에러 시 EventSource가 자동 재연결 — 15s 엔티티 폴링이 백업으로 정합성 보정
    return () => es.close();
  }, [selectedFloor]);

  const handleZoneClick = useCallback((zone: Zone) => {
    if (!zone?.id) { setSelectedZone(null); return; }
    setSelectedZone(zone);
  }, []);

  // 개요(전체) 모드 상단 카운터 — 전 층 합계 반영
  const handleOverviewTotals = useCallback((p: number, s: number) => {
    setTotalPatients(p);
    setTotalStaff(s);
  }, []);

  // 리플레이 — 최근 2시간 동선 로드 후 재생
  const startReplay = useCallback(async () => {
    if (selectedFloor === "all") return;
    const now = Date.now();
    const from = now - 2 * 3600_000;
    const r = await fetchFloorHistory(selectedFloor, { from: new Date(from).toISOString(), to: new Date(now).toISOString() });
    setReplayHist(r.data.entities ?? []);
    setReplayRange({ from, to: now });
    setReplayTime(from);
    setReplayPlaying(true);
    setReplayMode(true);
  }, [selectedFloor]);

  // 재생 루프 (200ms 틱 × 속도)
  useEffect(() => {
    if (!replayMode || !replayPlaying) return;
    const id = setInterval(() => {
      setReplayTime(t => {
        const nt = t + replaySpeed * 200;
        if (nt >= replayRange.to) { setReplayPlaying(false); return replayRange.to; }
        return nt;
      });
    }, 200);
    return () => clearInterval(id);
  }, [replayMode, replayPlaying, replaySpeed, replayRange.to]);

  // 층 변경 시 리플레이 종료
  useEffect(() => { setReplayMode(false); setReplayPlaying(false); }, [selectedFloor]);

  // 리플레이 시점(replayTime)의 엔티티 위치 계산
  const replayEntities = useMemo<Entity[]>(() => {
    if (!replayMode) return [];
    const out: Entity[] = [];
    for (const h of replayHist) {
      for (const m of h.movements) {
        const enter = new Date(m.enterAt).getTime();
        const leave = m.leaveAt ? new Date(m.leaveAt).getTime() : replayRange.to;
        if (enter <= replayTime && replayTime < leave) {
          out.push({ id: h.entityId, type: "patient", label: h.label, zoneId: m.zoneId, status: "" });
          break;
        }
      }
    }
    return out;
  }, [replayMode, replayHist, replayTime, replayRange.to]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" size={24} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <FloorToolbar
        floors={floors}
        selectedFloor={selectedFloor}
        onFloorChange={setSelectedFloor}
        overlay={overlay}
        onOverlayChange={setOverlay}
        onEditClick={selectedFloor !== "all" ? () => router.push(`/floor/editor?floor=${selectedFloor}`) : undefined}
        totalPatients={totalPatients}
        totalStaff={totalStaff}
      />
      {selectedFloor === "all" ? (
        <FloorOverview floors={floors} onFloorClick={setSelectedFloor} onTotals={handleOverviewTotals} />
      ) : (
        <div className="flex-1 flex">
          <div className="flex-1 p-4 flex flex-col min-h-0">
            {/* 리플레이(타임랩스) 컨트롤 */}
            <div className="mb-2 flex items-center gap-2 text-xs">
              {!replayMode ? (
                <button onClick={startReplay} className="px-2.5 py-1 rounded-lg border bg-white hover:bg-gray-50 text-gray-600 flex items-center gap-1">
                  ⏱ 리플레이 <span className="text-gray-400">최근 2시간</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-1 bg-white border rounded-lg px-3 py-1.5">
                  <button onClick={() => setReplayPlaying(p => !p)} className="w-6 text-base leading-none">{replayPlaying ? "⏸" : "▶"}</button>
                  <input type="range" min={replayRange.from} max={replayRange.to} value={replayTime}
                    onChange={e => { setReplayTime(Number(e.target.value)); setReplayPlaying(false); }} className="flex-1 accent-emerald-500" />
                  <span className="font-mono text-gray-700 w-12 text-center">{new Date(replayTime).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <select value={replaySpeed} onChange={e => setReplaySpeed(Number(e.target.value))} className="border rounded px-1 py-0.5 text-[11px]">
                    <option value={30}>×30</option><option value={60}>×60</option><option value={120}>×120</option>
                  </select>
                  <button onClick={() => { setReplayMode(false); setReplayPlaying(false); }} className="text-gray-400 hover:text-gray-700">나가기</button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <FloorCanvas
                zones={zones}
                entities={replayMode ? replayEntities : entities}
                stats={replayMode ? [] : stats}
                flows={replayMode ? [] : flows}
                issues={replayMode ? [] : issues}
                sla={sla}
                topology={topology}
                overlay={overlay}
                selectedZoneId={selectedZone?.id ?? null}
                onZoneClick={handleZoneClick}
              />
            </div>
          </div>
          {selectedZone && (
            <ZoneDetailPanel
              zone={selectedZone}
              entities={entities}
              stats={stats.find(s => s.zoneId === selectedZone.id) ?? null}
              onClose={() => setSelectedZone(null)}
            />
          )}
        </div>
      )}
      <HospitalFooter />
    </div>
  );
}
