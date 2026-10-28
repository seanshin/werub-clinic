// Created: 2026-05-18
// 평면도 툴바 — 층 선택 + 오버레이 모드
"use client";

import type { FloorPlan } from "@/lib/floor";
import { Layers, Eye, Thermometer, Pencil } from "lucide-react";

interface Props {
  floors: FloorPlan[];
  selectedFloor: string;
  onFloorChange: (id: string) => void;
  overlay: "none" | "heatmap";
  onOverlayChange: (mode: "none" | "heatmap") => void;
  onEditClick?: () => void;
  totalPatients?: number;
  totalStaff?: number;
}

export default function FloorToolbar({
  floors, selectedFloor, onFloorChange,
  overlay, onOverlayChange,
  onEditClick, totalPatients = 0, totalStaff = 0,
}: Props) {
  return (
    <div className="flex items-center justify-between bg-white border-b px-4 py-2">
      {/* 층 탭 */}
      <div className="flex items-center gap-1">
        <Layers size={14} className="text-gray-400 mr-1" />
        <button
          onClick={() => onFloorChange("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            selectedFloor === "all"
              ? "bg-emerald-100 text-emerald-700"
              : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          전체
        </button>
        {floors.map(f => (
          <button
            key={f.id}
            onClick={() => onFloorChange(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedFloor === f.id
                ? "bg-emerald-100 text-emerald-700"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* 중앙 — 현황 */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>환자 <strong className="text-gray-900">{totalPatients}</strong>명</span>
        <span>의료진 <strong className="text-gray-900">{totalStaff}</strong>명</span>
      </div>

      {/* 오른쪽 — 모드 + 편집 */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => onOverlayChange("none")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${
              overlay === "none" ? "bg-white shadow text-gray-900" : "text-gray-500"
            }`}
          >
            <Eye size={12} /> 기본
          </button>
          <button
            onClick={() => onOverlayChange("heatmap")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${
              overlay === "heatmap" ? "bg-white shadow text-gray-900" : "text-gray-500"
            }`}
          >
            <Thermometer size={12} /> 히트맵
          </button>
        </div>
        {onEditClick && (
          <button
            onClick={onEditClick}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 border border-emerald-200 transition-colors"
          >
            <Pencil size={12} /> 편집
          </button>
        )}
      </div>
    </div>
  );
}
