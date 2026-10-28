// Created: 2026-07-06 — 인증 캐시(token_version·role) 무효화 크로스 인스턴스 전파 (분산배치 N17)
// PM2 클러스터/다중 서버에서 로컬 Map 무효화가 타 인스턴스에 전파되지 않아 최대 60초 stale.
// board-sse.ts와 동일한 Redis pub/sub 패턴(dynamic import·lazy·graceful fallback). Redis 미가동 시
// in-process(로컬)만 동작 → 기존 60초 TTL 거동으로 안전 폴백.

export type AuthCacheInvalidateType = "tokenVersion" | "role";

// static import 불가 (Turbopack Worker Thread 컴파일 깨짐) → dynamic import
const REDIS_CH = "auth_cache_invalidation";
// 프로세스별 고유 ID — 자신이 발행한 메시지 재처리 방지 (앱 런타임이라 Date.now/random 허용)
const WORKER_ID = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

let _redisPub: { publish(ch: string, msg: string): Promise<number> } | null = null;
let _redisInitStarted = false;
let _onInvalidate: ((type: AuthCacheInvalidateType, userId: string) => void) | null = null;

function initRedis(): void {
  if (_redisInitStarted || !process.env.REDIS_URL) return;
  _redisInitStarted = true;
  const url = process.env.REDIS_URL;

  import("ioredis").then(({ default: Redis }) => {
    // Publisher
    const pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
    pub.on("error", () => {});
    pub.connect().then(() => { _redisPub = pub; }).catch(() => {});

    // Subscriber — 타 인스턴스의 무효화 수신 → 로컬 캐시 삭제
    const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
    sub.on("error", () => {});
    sub.on("message", (_ch, raw) => {
      if (_ch !== REDIS_CH) return;
      try {
        const msg = JSON.parse(raw) as { wid?: string; type: AuthCacheInvalidateType; userId: string };
        if (msg.wid === WORKER_ID) return; // 자신이 발행 → 이미 로컬 삭제됨
        _onInvalidate?.(msg.type, msg.userId);
      } catch { /* malformed */ }
    });
    sub.connect()
      .then(() => sub.subscribe(REDIS_CH))
      .catch(() => {});
  }).catch(() => { /* ioredis 없으면 in-process만 */ });
}

/** 로컬 무효화 후 호출 — 타 인스턴스에 전파(fire-and-forget). Redis 없으면 no-op. */
export function publishAuthCacheInvalidation(type: AuthCacheInvalidateType, userId: string): void {
  initRedis();
  if (!_redisPub) return;
  const msg = JSON.stringify({ wid: WORKER_ID, type, userId });
  _redisPub.publish(REDIS_CH, msg).catch(() => {});
}

/** 구독자 등록 — 수신 시 로컬 캐시를 지우는 콜백 (Node 런타임에서만 호출할 것). */
export function registerAuthCacheInvalidationHandler(
  fn: (type: AuthCacheInvalidateType, userId: string) => void,
): void {
  _onInvalidate = fn;
  initRedis();
}
