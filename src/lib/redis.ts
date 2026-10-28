// Created: 2026-03-06
// Updated: 2026-03-18 — 재연결 로직 추가 (M-3: 연결 실패 시 인스턴스 리셋)
// Updated: 2026-05-26 — Upstash Edge 코드 제거 (미사용), ioredis 단일 클라이언트
// ioredis 싱글턴 클라이언트 (Node.js)
// REDIS_URL 미설정 시 null 반환 → 모든 호출처에서 graceful skip

import Redis from "ioredis";

let _redis: Redis | null = null;
let _connectFailed = false;
let _lastRetry = 0;
const RETRY_INTERVAL_MS = 30_000; // 연결 실패 후 30초 후 재시도

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;

  // 연결 실패 상태 — 30초 후 재시도
  if (_connectFailed) {
    if (Date.now() - _lastRetry < RETRY_INTERVAL_MS) return null;
    // 재시도: 기존 인스턴스 정리 후 새로 생성
    _redis?.disconnect();
    _redis = null;
    _connectFailed = false;
  }

  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 5000,
      reconnectOnError: (err) => {
        console.error("[redis] 연결 오류:", err.message);
        return true;
      },
    });

    _redis.on("error", (err) => {
      console.error("[redis] 클라이언트 오류:", err.message);
    });

    _redis.on("close", () => {
      // 연결 종료 시 상태 리셋 (다음 호출에서 재연결 시도)
      _connectFailed = true;
      _lastRetry = Date.now();
    });

    _redis.connect().catch((err) => {
      console.error("[redis] 초기 연결 실패:", err.message);
      _connectFailed = true;
      _lastRetry = Date.now();
    });
  }

  return _redis;
}

export const REDIS_TTL = {
  MSG: 86400,     // 24h — 메시지 캐시
  ROOM: 3600,     // 1h  — 방 메타정보
  ONLINE: 300,    // 5m  — 온라인 멤버
  READ: 86400,    // 24h — 읽음 처리
  MEMBER: 300,    // 5m  — 멤버십 검증 캐시
} as const;
