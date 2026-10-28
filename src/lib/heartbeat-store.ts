// Created: 2026-05-28 14:00
// Heartbeat 기반 온라인 상태 관리 — Socket.IO 없이도 동작
// W.Channel 등 독립 서비스에서 HTTP heartbeat로 온라인 표시

const g = global as typeof global & {
  _heartbeats?: Map<string, number>;
};

if (!g._heartbeats) g._heartbeats = new Map();

const heartbeats = g._heartbeats;

const ONLINE_THRESHOLD_MS = 90_000; // 90초 — heartbeat 주기(30초)의 3배
const CLEANUP_INTERVAL_MS = 120_000; // 2분마다 정리

/** Heartbeat 기록 */
export function setHeartbeat(userId: string) {
  heartbeats.set(userId, Date.now());
}

/** Heartbeat 기반 온라인 여부 */
export function isHeartbeatOnline(userId: string): boolean {
  const last = heartbeats.get(userId);
  return !!last && (Date.now() - last) < ONLINE_THRESHOLD_MS;
}

/** 온라인 유저 ID 목록 */
export function getHeartbeatOnlineUserIds(): string[] {
  const now = Date.now();
  const result: string[] = [];
  heartbeats.forEach((ts, uid) => {
    if (now - ts < ONLINE_THRESHOLD_MS) result.push(uid);
  });
  return result;
}

// 만료된 heartbeat 자동 정리
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    heartbeats.forEach((ts, uid) => {
      if (now - ts > ONLINE_THRESHOLD_MS * 2) heartbeats.delete(uid);
    });
  }, CLEANUP_INTERVAL_MS);
}
