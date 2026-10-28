// Created: 2026-02-27
// Updated: 2026-04-10 — 인앱/푸시 독립 설정 (push_enabled 컬럼 추가)
// 알림 설정 서비스 — 유형별 인앱 On/Off + 푸시 On/Off 독립 제어

import { prisma } from "@/lib/prisma";

// ── 인메모리 캐시: userId:type:field → boolean (60s TTL) ─────────────
const prefCache = new Map<string, { value: boolean; expiry: number }>();
const PREF_CACHE_TTL = 60_000;
const PREF_CACHE_MAX = 5_000;

function getCached(key: string): boolean | undefined {
  const entry = prefCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) { prefCache.delete(key); return undefined; }
  return entry.value;
}

function setCache(key: string, value: boolean): void {
  if (prefCache.size >= PREF_CACHE_MAX) {
    const keys = Array.from(prefCache.keys());
    for (let i = 0; i < Math.max(1, keys.length * 0.1); i++) prefCache.delete(keys[i]);
  }
  prefCache.set(key, { value, expiry: Date.now() + PREF_CACHE_TTL });
}

/** 캐시 무효화 (설정 변경 시 호출) */
export function invalidatePrefCache(userId: string): void {
  for (const key of prefCache.keys()) {
    if (key.startsWith(`${userId}:`)) prefCache.delete(key);
  }
}

const ALL_TYPES = [
  "PUSH_ENABLED",
  "COMMENT", "REPLY", "ANSWER_ACCEPTED", "NEW_ANSWER", "LEVEL_UP",
  "WE_RECEIVED", "CAFE_INVITED", "MENTION", "ELECTION_STARTED",
  "ELECTION_RESULT", "POST_VOTE", "FOLLOW", "BOARD_MENTION",
  "OPEN_CHANNEL_MENTION", "OPEN_CHANNEL_MESSAGE",
  "SUB_CAFE_POST", "SUB_CAFE_EVENT",
  // ISSUESCAPE 소셜 알림 (2026-03-31)
  "ISSUE_EVOLVED", "ISSUE_REPLY", "ISSUE_SCOUT", "KEYWORD_TREND", "TIER_UP",
  // 카페 AI 다이제스트 (2026-03-31)
  "WEEKLY_DIGEST",
  // W.Sign 전자결재 (2026-04-10)
  "WSIGN_APPROVAL_REQUEST", "WSIGN_APPROVED", "WSIGN_REJECTED", "WSIGN_RECALLED",
  // 캘린더 (2026-04-10)
  "CALENDAR_INVITED", "CALENDAR_REMINDER",
] as const;

export type NotifPrefItem = { type: string; enabled: boolean; pushEnabled: boolean };

/** 유저의 전체 알림 설정 조회 (없는 타입은 기본 true) */
export async function getPreferences(userId: string): Promise<NotifPrefItem[]> {
  const rows = await prisma.$queryRaw<{ type: string; enabled: boolean; push_enabled: boolean }[]>`
    SELECT type, enabled, push_enabled FROM notification_preferences WHERE user_id = ${userId}
  `;
  const map = new Map(rows.map((r) => [r.type, { enabled: r.enabled, pushEnabled: r.push_enabled }]));
  return ALL_TYPES.map((t) => ({
    type: t,
    enabled: map.get(t)?.enabled ?? true,
    pushEnabled: map.get(t)?.pushEnabled ?? true,
  }));
}

/** 단일 타입 인앱 활성화 여부 (DB에 없으면 true, 60s 캐시) */
export async function isTypeEnabled(userId: string, type: string): Promise<boolean> {
  const key = `${userId}:${type}:enabled`;
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const rows = await prisma.$queryRaw<{ enabled: boolean; push_enabled: boolean }[]>`
    SELECT enabled, push_enabled FROM notification_preferences WHERE user_id = ${userId} AND type = ${type}
  `;
  const enabled = rows.length === 0 ? true : rows[0].enabled;
  const pushEnabled = rows.length === 0 ? true : rows[0].push_enabled;
  setCache(key, enabled);
  setCache(`${userId}:${type}:push`, pushEnabled);
  return enabled;
}

/** 단일 타입 푸시 활성화 여부 (DB에 없으면 true, 60s 캐시) */
export async function isPushTypeEnabled(userId: string, type: string): Promise<boolean> {
  const key = `${userId}:${type}:push`;
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const rows = await prisma.$queryRaw<{ push_enabled: boolean }[]>`
    SELECT push_enabled FROM notification_preferences WHERE user_id = ${userId} AND type = ${type}
  `;
  const pushEnabled = rows.length === 0 ? true : rows[0].push_enabled;
  setCache(key, pushEnabled);
  return pushEnabled;
}

/** 푸시 마스터 토글 확인 (DB에 없으면 true) */
export async function isPushEnabled(userId: string): Promise<boolean> {
  return isTypeEnabled(userId, "PUSH_ENABLED");
}

/** 설정 UPSERT (여러 타입 한번에) — enabled + pushEnabled 독립 저장 */
export async function setPreferences(
  userId: string,
  prefs: { type: string; enabled?: boolean; pushEnabled?: boolean }[],
): Promise<void> {
  const valid = prefs.filter((p) => ALL_TYPES.includes(p.type as (typeof ALL_TYPES)[number]));
  if (valid.length === 0) return;

  invalidatePrefCache(userId);
  for (const p of valid) {
    if (p.enabled !== undefined && p.pushEnabled !== undefined) {
      await prisma.$executeRaw`
        INSERT INTO notification_preferences (user_id, type, enabled, push_enabled)
        VALUES (${userId}, ${p.type}, ${p.enabled}, ${p.pushEnabled})
        ON CONFLICT (user_id, type) DO UPDATE SET enabled = EXCLUDED.enabled, push_enabled = EXCLUDED.push_enabled, updated_at = now()
      `;
    } else if (p.enabled !== undefined) {
      await prisma.$executeRaw`
        INSERT INTO notification_preferences (user_id, type, enabled)
        VALUES (${userId}, ${p.type}, ${p.enabled})
        ON CONFLICT (user_id, type) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
      `;
    } else if (p.pushEnabled !== undefined) {
      await prisma.$executeRaw`
        INSERT INTO notification_preferences (user_id, type, push_enabled)
        VALUES (${userId}, ${p.type}, ${p.pushEnabled})
        ON CONFLICT (user_id, type) DO UPDATE SET push_enabled = EXCLUDED.push_enabled, updated_at = now()
      `;
    }
  }
}
