// Created: 2026-05-18
// 병원 동선 관리자 설정 패널
"use client";

import { useState, useEffect } from "react";
import { getFloorSettings, saveFloorSettings, resetFloorSettings, FLOOR_SETTINGS_DEFAULTS, type FloorSettings } from "@/lib/floor-settings";
import { fetchFloorPlans, type FloorPlan } from "@/lib/floor";
import { Settings, RotateCcw, Save, Bell, Gauge, Timer, Layers } from "lucide-react";

export default function FloorSettingsPanel() {
  const [settings, setSettings] = useState<FloorSettings>(FLOOR_SETTINGS_DEFAULTS);
  const [floors, setFloors] = useState<FloorPlan[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(getFloorSettings());
    fetchFloorPlans().then(r => setFloors(r.data));
  }, []);

  const handleSave = () => {
    saveFloorSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    resetFloorSettings();
    setSettings(FLOOR_SETTINGS_DEFAULTS);
  };

  const update = (patch: Partial<FloorSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  };

  const toggleFloor = (id: string) => {
    const current = settings.widgetFloors;
    const next = current.includes(id)
      ? current.filter(f => f !== id)
      : [...current, id];
    update({ widgetFloors: next });
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-emerald-500" />
          <h2 className="text-lg font-bold text-gray-900">동선 모니터링 설정</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReset} className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">
            <RotateCcw size={12} /> 초기화
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Save size={12} /> {saved ? "저장됨!" : "저장"}
          </button>
        </div>
      </div>

      {/* 1. 위젯 표시 층 선택 */}
      <section className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers size={14} className="text-gray-400" />
          <h3 className="text-sm font-bold text-gray-700">대시보드 위젯 표시 층</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">대시보드 위젯에 표시할 층을 선택합니다.</p>
        <div className="flex flex-wrap gap-2">
          {floors.map(f => (
            <button
              key={f.id}
              onClick={() => toggleFloor(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                settings.widgetFloors.includes(f.id)
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : "bg-gray-50 border-gray-200 text-gray-400"
              }`}
            >
              {f.name} — {f.description}
            </button>
          ))}
        </div>
      </section>

      {/* 2. 폴링 주기 */}
      <section className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Timer size={14} className="text-gray-400" />
          <h3 className="text-sm font-bold text-gray-700">실시간 갱신 주기</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">환자 위치 갱신 (초)</label>
            <select
              value={settings.entityPollingInterval}
              onChange={e => update({ entityPollingInterval: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-gray-50"
            >
              <option value={5}>5초 (실시간)</option>
              <option value={10}>10초</option>
              <option value={15}>15초 (권장)</option>
              <option value={30}>30초</option>
              <option value={60}>1분</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">통계 갱신 (초)</label>
            <select
              value={settings.statsPollingInterval}
              onChange={e => update({ statsPollingInterval: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-gray-50"
            >
              <option value={10}>10초</option>
              <option value={30}>30초 (권장)</option>
              <option value={60}>1분</option>
              <option value={120}>2분</option>
            </select>
          </div>
        </div>
      </section>

      {/* 3. 혼잡도 임계값 */}
      <section className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gauge size={14} className="text-gray-400" />
          <h3 className="text-sm font-bold text-gray-700">혼잡도 판정 기준</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">구역 정원 대비 인원 비율로 혼잡도를 판정합니다.</p>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-xs text-gray-600 w-16">보통</span>
            <input
              type="range" min={10} max={50} step={5}
              value={settings.congestionThresholds.normal * 100}
              onChange={e => update({
                congestionThresholds: { ...settings.congestionThresholds, normal: Number(e.target.value) / 100 }
              })}
              className="flex-1 accent-blue-500"
            />
            <span className="text-xs font-mono w-10 text-right">{Math.round(settings.congestionThresholds.normal * 100)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs text-gray-600 w-16">혼잡</span>
            <input
              type="range" min={50} max={100} step={5}
              value={settings.congestionThresholds.high * 100}
              onChange={e => update({
                congestionThresholds: { ...settings.congestionThresholds, high: Number(e.target.value) / 100 }
              })}
              className="flex-1 accent-amber-500"
            />
            <span className="text-xs font-mono w-10 text-right">{Math.round(settings.congestionThresholds.high * 100)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs text-gray-600 w-16">초과</span>
            <input
              type="range" min={80} max={150} step={5}
              value={settings.congestionThresholds.critical * 100}
              onChange={e => update({
                congestionThresholds: { ...settings.congestionThresholds, critical: Number(e.target.value) / 100 }
              })}
              className="flex-1 accent-red-500"
            />
            <span className="text-xs font-mono w-10 text-right">{Math.round(settings.congestionThresholds.critical * 100)}%</span>
          </div>
        </div>
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[10px] text-amber-700">
          ⚠️ 혼잡도 등급은 현재 <strong>HIS 서버 판정값</strong>을 그대로 사용합니다. 이 임계값은 저장되며, 서버 전달 연동 후 반영됩니다.
        </div>
        <div className="mt-2 bg-gray-50 rounded-lg p-2 text-[10px] text-gray-400">
          여유: 0~{Math.round(settings.congestionThresholds.normal * 100)}% →
          보통: ~{Math.round(settings.congestionThresholds.high * 100)}% →
          혼잡: ~{Math.round(settings.congestionThresholds.critical * 100)}% →
          초과: {Math.round(settings.congestionThresholds.critical * 100)}%+
        </div>
      </section>

      {/* 4. 알림 설정 */}
      <section className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bell size={14} className="text-gray-400" />
          <h3 className="text-sm font-bold text-gray-700">알림 설정</h3>
        </div>

        <div className="space-y-3">
          {/* 대기시간 초과 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-700">대기시간 초과 알림</p>
              <p className="text-[10px] text-gray-400">평균 대기시간이 설정값을 초과하면 알림</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number" min={5} max={120} step={5}
                value={settings.alerts.waitExceeded.thresholdMinutes}
                onChange={e => update({
                  alerts: {
                    ...settings.alerts,
                    waitExceeded: { ...settings.alerts.waitExceeded, thresholdMinutes: Number(e.target.value) }
                  }
                })}
                className="w-16 px-2 py-1 rounded border border-gray-200 text-xs text-center"
                disabled={!settings.alerts.waitExceeded.enabled}
              />
              <span className="text-[10px] text-gray-400">분</span>
              <button
                onClick={() => update({
                  alerts: {
                    ...settings.alerts,
                    waitExceeded: { ...settings.alerts.waitExceeded, enabled: !settings.alerts.waitExceeded.enabled }
                  }
                })}
                className={`w-10 h-5 rounded-full transition-colors ${settings.alerts.waitExceeded.enabled ? "bg-emerald-500" : "bg-gray-300"}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.alerts.waitExceeded.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
          </div>

          {/* 정원 초과 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-700">정원 초과 알림</p>
              <p className="text-[10px] text-gray-400">구역 인원이 정원을 초과하면 알림</p>
            </div>
            <button
              onClick={() => update({
                alerts: {
                  ...settings.alerts,
                  capacityExceeded: { enabled: !settings.alerts.capacityExceeded.enabled }
                }
              })}
              className={`w-10 h-5 rounded-full transition-colors ${settings.alerts.capacityExceeded.enabled ? "bg-emerald-500" : "bg-gray-300"}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.alerts.capacityExceeded.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* 의료진 부재 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-700">의료진 부재 알림</p>
              <p className="text-[10px] text-gray-400">진료실에 의료진이 없을 때 알림</p>
            </div>
            <button
              onClick={() => update({
                alerts: {
                  ...settings.alerts,
                  noStaff: { enabled: !settings.alerts.noStaff.enabled }
                }
              })}
              className={`w-10 h-5 rounded-full transition-colors ${settings.alerts.noStaff.enabled ? "bg-emerald-500" : "bg-gray-300"}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.alerts.noStaff.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
