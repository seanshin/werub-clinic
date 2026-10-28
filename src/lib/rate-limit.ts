// Created: 2026-02-23
// Updated: 2026-06-21 — Redis 명령 에러 시 인메모리 폴백 복구(C-I: 폴백 스킵=rate-limit 무력화 버그)
// Updated: 2026-04-12 — Redis 기반 슬라이딩 윈도우 (PM2 멀티프로세스 공유)
// Redis 미연결 시 인메모리 폴백 (기존 동작 유지)
// C-2 보안 감사 대응: 브루트포스/DoS 방지

import { NextRequest } from "next/server";
import { TooManyRequestsError } from "@/lib/errors";
import { getClientIp } from "@/lib/get-client-ip";
export { getClientIp } from "@/lib/get-client-ip";

// 티어별 제한 설정
const TIER_CONFIG = {
  auth:       { maxRequests: 5,  windowSec: 60 },
  twoFactor:  { maxRequests: 5,  windowSec: 60 },
  upload:     { maxRequests: 60, windowSec: 60 },  // 다중 이미지 업로드 대응
  ai:         { maxRequests: 5,  windowSec: 60 },
  // 대체 텍스트 생성 — 에디터가 이미지 업로드마다 자동 호출한다. `ai`(5회/분)를 쓰면
  // 한 번에 6장 이상 올릴 때 뒤쪽 이미지의 alt가 **조용히 비어버린다**(접근성 저하).
  // GPU 독점 방지는 클라이언트 직렬화 + AI 서버의 순차 추론이 담당하므로, 여기서는
  // 정상적인 다중 업로드를 막지 않을 만큼만 둔다(호출 1건이 7~19초라 실제 상한은 지연이 정한다).
  aiAlt:      { maxRequests: 20, windowSec: 60 },
  refresh:    { maxRequests: 20, windowSec: 60 },
  write:      { maxRequests: 20, windowSec: 60 },
  chat:       { maxRequests: 60, windowSec: 60 },  // 채널 메시지 (활발한 대화 대응)
  search:     { maxRequests: 30, windowSec: 60 },
  vote:       { maxRequests: 30, windowSec: 60 },
  general:    { maxRequests: 60, windowSec: 60 },
  wsignMut:   { maxRequests: 30, windowSec: 60 },
  wsignRead:  { maxRequests: 100, windowSec: 60 },
  webhook:    { maxRequests: 300, windowSec: 60 },  // Incoming Webhook (외부 서비스)
} as const;

export type RateLimitTier = keyof typeof TIER_CONFIG;

// ── Redis 기반 rate limit ────────────────────────────────────────────────
import { getRedis } from "@/lib/redis";

// Redis 판정 결과. ok=true면 Redis가 권위 있는 답(exceeded)을 준 것이고,
// ok=false면 Redis 미연결 또는 명령 에러 → 호출 측이 인메모리 폴백으로 처리해야 한다.
// (과거 boolean 반환은 '미초과(false)'와 '에러로 폴백(false)'을 구분하지 못해,
//  호출 측 `if(redis) return`이 Redis 명령 에러 시에도 인메모리까지 스킵 →
//  rate-limit 완전 무력화. 로그인/2FA brute-force 노출.)
type RedisVerdict = { ok: true; exceeded: boolean } | { ok: false };

async function redisRateLimit(storeKey: string, maxRequests: number, windowSec: number): Promise<RedisVerdict> {
  const redis = getRedis();
  if (!redis) return { ok: false }; // Redis 미연결 → 폴백

  try {
    const key = `rl:${storeKey}`;
    const count = await redis.incr(key);
    if (count === 1) {
      // 첫 요청: TTL 설정
      await redis.expire(key, windowSec);
    }
    return { ok: true, exceeded: count > maxRequests };
  } catch {
    // Redis 명령 에러 → 비권위 신호. 호출 측이 인메모리 폴백을 돌린다.
    return { ok: false };
  }
}

// ── 인메모리 폴백 (Redis 미연결 시) ──────────────────────────────────────
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const MAX_ENTRIES = 50_000;
const memStore = new Map<string, RateLimitEntry>();

const _rlCleanup = setInterval(() => {
  const now = Date.now();
  memStore.forEach((entry, key) => {
    if (now - entry.windowStart > 120_000) memStore.delete(key);
  });
  if (memStore.size > MAX_ENTRIES) {
    const excess = memStore.size - MAX_ENTRIES;
    let i = 0;
    for (const key of memStore.keys()) {
      if (i++ >= excess) break;
      memStore.delete(key);
    }
  }
}, 2 * 60 * 1000);
_rlCleanup.unref?.();

function memoryRateLimit(storeKey: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = memStore.get(storeKey);

  if (!entry || now - entry.windowStart >= windowMs) {
    memStore.set(storeKey, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}

// ── 통합 rate limit ─────────────────────────────────────────────────────

/**
 * Rate Limit 검사 — Redis 우선, 미연결 시 인메모리 폴백.
 * PM2 멀티프로세스에서도 Redis 통해 정확한 카운팅.
 * 초과 시 TooManyRequestsError throw.
 */
export async function rateLimit(
  request: NextRequest,
  tier: RateLimitTier,
  key?: string,
): Promise<void> {
  const config = TIER_CONFIG[tier];
  const identifier = key ?? getClientIp(request);
  const storeKey = `${tier}:${identifier}`;

  // Redis 우선
  const verdict = await redisRateLimit(storeKey, config.maxRequests, config.windowSec);
  if (verdict.ok) {
    // Redis가 권위 있는 답을 줬으니 인메모리는 스킵 (이중 카운팅 방지)
    if (verdict.exceeded) throw new TooManyRequestsError(config.windowSec);
    return;
  }

  // Redis 미연결/에러 → 인메모리 폴백 (fail-closed: 무제한 통과 금지).
  // 인증 티어도 이 폴백으로 프로세스별 카운팅이 유지되어 brute-force가 차단된다.
  if (memoryRateLimit(storeKey, config.maxRequests, config.windowSec * 1000)) {
    throw new TooManyRequestsError(config.windowSec);
  }
}
