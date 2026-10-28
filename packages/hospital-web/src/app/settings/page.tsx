// Created: 2026-05-18
// 병원 관리 설정 페이지
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import FloorSettingsPanel from "@/components/floor/FloorSettingsPanel";
import { hfetch } from "@/lib/api";
import { ArrowLeft, MapPin, Settings } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

const TABS = [
  { id: "floor", label: "동선 모니터링", icon: MapPin },
];

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState("floor");
  const [hospitalName, setHospitalName] = useState("");

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* 상단 */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push("/dashboard")} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={18} />
          </button>
          <Settings size={20} className="text-emerald-500" />
          <h1 className="text-xl font-black text-gray-900">관리 설정</h1>
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1 mb-6 border-b">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? "border-emerald-500 text-emerald-700"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "floor" && <FloorSettingsPanel />}
      </main>
      <HospitalFooter />
    </div>
  );
}
