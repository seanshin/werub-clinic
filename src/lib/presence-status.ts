// Created: 2026-06-09
// W.Channel 멤버 수동 프레즌스 상태 레지스트리 (메인앱)
// ⚠️ packages/channel-web/src/lib/presence-status.ts 와 동일하게 유지 (소형 상수 중복)

export const PRESENCE_STATUSES = {
  available: { label: "대화가능", emoji: "🟢", color: "#22c55e", dnd: false },
  away: { label: "자리비움", emoji: "🌙", color: "#f59e0b", dnd: false },
  busy: { label: "바쁨", emoji: "⛔", color: "#ef4444", dnd: true },
  vacation: { label: "휴가중", emoji: "🏖️", color: "#0ea5e9", dnd: true },
  business_trip: { label: "출장중", emoji: "✈️", color: "#8b5cf6", dnd: false },
  field_work: { label: "외근중", emoji: "🚗", color: "#14b8a6", dnd: false },
  home_office: { label: "재택근무중", emoji: "🏠", color: "#6366f1", dnd: false },
} as const;

export type PresenceStatusKey = keyof typeof PRESENCE_STATUSES;

export const PRESENCE_STATUS_KEYS = Object.keys(PRESENCE_STATUSES) as PresenceStatusKey[];

export function isPresenceStatusKey(v: unknown): v is PresenceStatusKey {
  return typeof v === "string" && v in PRESENCE_STATUSES;
}

export function getPresenceStatus(key: string | null | undefined) {
  if (key && key in PRESENCE_STATUSES) return PRESENCE_STATUSES[key as PresenceStatusKey];
  return null;
}
