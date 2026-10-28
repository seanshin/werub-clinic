// Created: 2026-06-09
// W.Channel 알림 환경설정 서비스 — DND(방해금지) 시간대 + 키워드 알림
import { prisma } from "@/lib/prisma";
import { PRESENCE_STATUSES, type PresenceStatusKey } from "@/lib/presence-status";

export interface NotifyPrefs {
  dndEnabled: boolean;
  dndStartMin: number | null;
  dndEndMin: number | null;
  keywords: string[];
}

const DEFAULT_PREFS: NotifyPrefs = { dndEnabled: false, dndStartMin: null, dndEndMin: null, keywords: [] };

export async function getNotifyPrefs(userId: string): Promise<NotifyPrefs> {
  try {
    const rows = await prisma.$queryRaw<
      { dnd_enabled: boolean; dnd_start_min: number | null; dnd_end_min: number | null; keywords: string[] }[]
    >`SELECT dnd_enabled, dnd_start_min, dnd_end_min, keywords FROM board_notify_prefs WHERE user_id = ${userId}`;
    if (rows.length === 0) return DEFAULT_PREFS;
    const r = rows[0];
    return {
      dndEnabled: r.dnd_enabled,
      dndStartMin: r.dnd_start_min,
      dndEndMin: r.dnd_end_min,
      keywords: r.keywords ?? [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setNotifyPrefs(userId: string, p: NotifyPrefs): Promise<void> {
  const kw = (p.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 30);
  await prisma.$executeRaw`
    INSERT INTO board_notify_prefs (user_id, dnd_enabled, dnd_start_min, dnd_end_min, keywords, updated_at)
    VALUES (${userId}, ${!!p.dndEnabled}, ${p.dndStartMin}, ${p.dndEndMin}, ${kw}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      dnd_enabled = ${!!p.dndEnabled}, dnd_start_min = ${p.dndStartMin},
      dnd_end_min = ${p.dndEndMin}, keywords = ${kw}, updated_at = now()`;
}

/** 현재 시각(KST)이 사용자 DND 구간에 있는지 — 푸시 억제 판단용 */
export async function isInDnd(userId: string): Promise<boolean> {
  const p = await getNotifyPrefs(userId);
  if (!p.dndEnabled || p.dndStartMin == null || p.dndEndMin == null || p.dndStartMin === p.dndEndMin) return false;
  // 현재 KST 분 계산
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((x) => x.type === "hour")?.value ?? "0");
  const m = Number(parts.find((x) => x.type === "minute")?.value ?? "0");
  const now = (h % 24) * 60 + m;
  const { dndStartMin: s, dndEndMin: e } = p;
  return s < e ? now >= s && now < e : now >= s || now < e; // 야간(자정 넘김) 처리
}

/** 사용자의 현재 수동 상태가 방해금지(dnd) 상태(바쁨/휴가)인지 — 푸시 억제 판단용 (lazy 만료 반영) */
export async function isPresenceDnd(userId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ presence_status: string | null; status_clear_at: Date | null }[]>`
      SELECT presence_status, status_clear_at FROM users WHERE id = ${userId}`;
    if (rows.length === 0) return false;
    const { presence_status, status_clear_at } = rows[0];
    if (!presence_status || !(presence_status in PRESENCE_STATUSES)) return false;
    // lazy 만료: 종료 시각이 지났으면 상태 해제로 간주
    if (status_clear_at && new Date(status_clear_at).getTime() <= Date.now()) return false;
    return PRESENCE_STATUSES[presence_status as PresenceStatusKey].dnd;
  } catch {
    return false;
  }
}

/** 채널 멤버 중 키워드가 메시지 내용과 매칭되는 사용자 목록 (작성자/기존 멘션 제외는 호출부에서) */
export async function getKeywordMatches(userIds: string[], content: string): Promise<string[]> {
  if (userIds.length === 0 || !content.trim()) return [];
  const lc = content.toLowerCase();
  try {
    const rows = await prisma.$queryRaw<{ user_id: string; keywords: string[] }[]>`
      SELECT user_id, keywords FROM board_notify_prefs
      WHERE user_id = ANY(${userIds}) AND array_length(keywords, 1) > 0`;
    return rows.filter((r) => (r.keywords ?? []).some((k) => k && lc.includes(k))).map((r) => r.user_id);
  } catch {
    return [];
  }
}
