// Created: 2026-05-18
// 병원 동선 관리자 설정 — localStorage 기반

export interface FloorSettings {
  // 위젯 표시 층 선택
  widgetFloors: string[];          // ["1f", "2f"]

  // 폴링 주기 (초)
  entityPollingInterval: number;   // 기본 15
  statsPollingInterval: number;    // 기본 30

  // 혼잡도 임계값 (비율, 0~1)
  congestionThresholds: {
    normal: number;  // 기본 0.3 (30% 이상 → normal)
    high: number;    // 기본 0.7 (70% 이상 → high)
    critical: number; // 기본 1.0 (100% 이상 → critical)
  };

  // 알림 설정
  alerts: {
    waitExceeded: { enabled: boolean; thresholdMinutes: number };
    capacityExceeded: { enabled: boolean };
    noStaff: { enabled: boolean };
  };
}

const STORAGE_KEY = "floor_settings";

const DEFAULTS: FloorSettings = {
  widgetFloors: ["1f", "2f"],
  entityPollingInterval: 15,
  statsPollingInterval: 30,
  congestionThresholds: {
    normal: 0.3,
    high: 0.7,
    critical: 1.0,
  },
  alerts: {
    waitExceeded: { enabled: true, thresholdMinutes: 30 },
    capacityExceeded: { enabled: true },
    noStaff: { enabled: false },
  },
};

export function getFloorSettings(): FloorSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    // 2026-08-19: 얕은 병합이면 하위 키 추가 시 기존 저장본에서 undefined 가 된다 → 중첩 객체는 키 단위 병합
    const saved = JSON.parse(raw) as Partial<FloorSettings>;
    return {
      ...DEFAULTS,
      ...saved,
      congestionThresholds: { ...DEFAULTS.congestionThresholds, ...(saved.congestionThresholds ?? {}) },
      alerts: {
        waitExceeded: { ...DEFAULTS.alerts.waitExceeded, ...(saved.alerts?.waitExceeded ?? {}) },
        capacityExceeded: { ...DEFAULTS.alerts.capacityExceeded, ...(saved.alerts?.capacityExceeded ?? {}) },
        noStaff: { ...DEFAULTS.alerts.noStaff, ...(saved.alerts?.noStaff ?? {}) },
      },
    };
  } catch {
    return DEFAULTS;
  }
}

/** 폴링 주기(초) → ms. 잘못된 값은 기본값으로 보정(0/음수/NaN 방지) */
export function pollMs(seconds: number | undefined, fallbackSec: number): number {
  const n = Number(seconds);
  return (Number.isFinite(n) && n >= 3 ? n : fallbackSec) * 1000;
}

export function saveFloorSettings(settings: FloorSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function resetFloorSettings() {
  localStorage.removeItem(STORAGE_KEY);
}

export { DEFAULTS as FLOOR_SETTINGS_DEFAULTS };
