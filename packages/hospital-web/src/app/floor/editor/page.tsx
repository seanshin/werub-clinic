// Created: 2026-05-18
// 병원 평면도 맵 에디터 — 구역 배치/크기 조절
"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HospitalHeader } from "@/components/HospitalHeader";
import FloorEditor from "@/components/floor/FloorEditor";
import { fetchZones, applyLayout, saveLayout, type Zone, ZONE_TYPE_LABELS } from "@/lib/floor";
import { hfetch } from "@/lib/api";
import { Save, RotateCcw, ArrowLeft, Loader2 } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

function EditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const floorId = searchParams?.get("floor") ?? "1f";

  const [zones, setZones] = useState<Zone[]>([]);
  const [originalZones, setOriginalZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
    fetchZones(floorId).then(r => {
      const applied = applyLayout(r.data, floorId);
      setZones(applied);
      setOriginalZones(applied);
      setLoading(false);
    });
  }, [floorId]);

  const handleSave = () => {
    saveLayout(floorId, zones);
    setOriginalZones(zones);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setZones(originalZones);
    setSelectedZoneId(null);
  };

  const hasChanges = JSON.stringify(zones) !== JSON.stringify(originalZones);
  const selectedZone = zones.find(z => z.id === selectedZoneId);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" size={24} />
      </div>
    );
  }

  return (
    <>
      <HospitalHeader showNav hospitalName={hospitalName} />
      {/* 상단 바 */}
      <div className="flex items-center justify-between bg-white border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/floor")} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft size={14} /> 평면도로 돌아가기
          </button>
          <span className="text-xs text-gray-400">|</span>
          <span className="text-sm font-bold text-gray-900">맵 에디터</span>
          <span className="text-xs text-gray-400">{floorId.toUpperCase()} — {zones.length}개 구역</span>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button onClick={handleReset} className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">
              <RotateCcw size={12} /> 초기화
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            <Save size={12} /> {saved ? "저장됨!" : "저장"}
          </button>
        </div>
      </div>

      {/* 에디터 영역 */}
      <div className="flex-1 flex">
        {/* 캔버스 */}
        <div className="flex-1 p-4">
          <FloorEditor
            zones={zones}
            onZonesChange={setZones}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
          />
        </div>

        {/* 속성 패널 */}
        <div className="w-72 bg-white border-l overflow-y-auto">
          <div className="p-4 border-b">
            <h3 className="text-sm font-bold text-gray-900 mb-1">구역 목록</h3>
            <p className="text-[10px] text-gray-400">클릭하여 선택 후 드래그로 배치</p>
          </div>
          <div className="p-2 space-y-1">
            {zones.map(z => (
              <button
                key={z.id}
                onClick={() => setSelectedZoneId(z.id === selectedZoneId ? null : z.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  selectedZoneId === z.id ? "bg-emerald-50 border border-emerald-200" : "hover:bg-gray-50"
                }`}
              >
                <div className="font-medium text-gray-900">{z.name}</div>
                <div className="text-gray-400 mt-0.5">
                  {ZONE_TYPE_LABELS[z.type]} | 정원 {z.capacity}명 | ({z.bounds.x},{z.bounds.y}) {z.bounds.w}x{z.bounds.h}
                </div>
              </button>
            ))}
          </div>

          {/* 선택된 구역 상세 */}
          {selectedZone && (
            <div className="p-4 border-t">
              <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">선택된 구역</h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">이름</span>
                  <span className="font-medium">{selectedZone.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">유형</span>
                  <span>{ZONE_TYPE_LABELS[selectedZone.type]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">위치</span>
                  <span className="font-mono">({selectedZone.bounds.x}, {selectedZone.bounds.y})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">크기</span>
                  <span className="font-mono">{selectedZone.bounds.w} x {selectedZone.bounds.h}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">정원</span>
                  <span>{selectedZone.capacity}명</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function FloorEditorPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={24} /></div>}>
        <EditorContent />
      </Suspense>
    </div>
  );
}
