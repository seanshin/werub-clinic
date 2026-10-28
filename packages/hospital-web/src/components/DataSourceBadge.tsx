// Created: 2026-05-20
// HIS 데이터 소스 표시 배지 — 실데이터/mock 구분
"use client";

import type { DataSource } from "@/lib/workgroup";

interface Props { source: DataSource }

export default function DataSourceBadge({ source }: Props) {
  if (source === "his") {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        HIS 실시간
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-amber-600">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      데모 데이터
    </div>
  );
}
