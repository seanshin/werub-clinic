// Created: 2026-03-12
// Updated: 2026-03-24 — BroadcastChannel 발행+수신 통합 (Turbopack Worker Thread 간 SSE 전달)
// CaféBoard SSE 이벤트 발행 — 채널별 실시간 메시지/리액션/핀 업데이트
// Turbopack dev: API Route가 다른 Worker Thread에서 실행 → global._boardListeners 격리
// → BroadcastChannel로 다른 Worker의 emitBoardEvent 호출

const MAX_LISTENERS_PER_CHANNEL = 150;
const MAX_LISTENERS_GLOBAL = 5000;
const MAX_CONNECTIONS_PER_USER = 5; // perf P1: 유저당 동시 board SSE 연결 상한(폭주/슬롯 고갈 방어)
const BC_NAME = "board_bc_v1";

interface SSEListener {
  send: (event: string, data: unknown) => void;
  userId?: string;
}

type ListenerMap = Map<string, Set<SSEListener>>;

function getListeners(): ListenerMap {
  const g = global as typeof global & { _boardListeners?: ListenerMap };
  if (!g._boardListeners) g._boardListeners = new Map();
  return g._boardListeners;
}

/** 전역 리스너 수 카운트 */
function getGlobalListenerCount(): number {
  let count = 0;
  getListeners().forEach((set) => { count += set.size; });
  return count;
}

// ── BroadcastChannel (같은 프로세스 내 Worker Thread 간 IPC) ─────────────────
let _bc: BroadcastChannel | null = null;

// BroadcastChannel 중복 방지용 워커 ID (BC 초기화가 Redis보다 먼저이므로 여기서 선언)
const BC_WORKER_ID = `bc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function getBC(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (_bc) return _bc;
  try {
    _bc = new BroadcastChannel(BC_NAME);
    _bc.onmessage = (e: MessageEvent) => {
      const msg = e.data as { wid?: string; type: string; targetId: string; event: string; data: unknown };
      // 자기 자신이 보낸 메시지는 스킵 (이미 in-process로 처리됨)
      if (msg.wid === BC_WORKER_ID) return;

      if (msg.type === "channel") emitBoardEvent(msg.targetId, msg.event, msg.data);
      else if (msg.type === "cafe") emitBoardCafeEvent(msg.targetId, msg.event, msg.data);
      else if (msg.type === "user") emitBoardUserEvent(msg.targetId, msg.event, msg.data);
    };
  } catch { /* BroadcastChannel 지원 안 되면 in-process만 */ }
  return _bc;
}

// 모듈 로드 시 BroadcastChannel 수신 시작
getBC();

// ── 유저당 연결 제한 (perf P1) ───────────────────────────────────────────────
function getUserConnCounts(): Map<string, number> {
  const g = global as typeof global & { _boardUserConns?: Map<string, number> };
  if (!g._boardUserConns) g._boardUserConns = new Map();
  return g._boardUserConns;
}

/** 유저당 동시 board SSE 연결 1개 등록 (상한 초과 시 null). 연결당 1회 호출, 반환 함수로 해제. */
export function registerUserConnection(userId: string): (() => void) | null {
  const counts = getUserConnCounts();
  const cur = counts.get(userId) ?? 0;
  if (cur >= MAX_CONNECTIONS_PER_USER) return null;
  counts.set(userId, cur + 1);
  let released = false;
  return () => {
    if (released) return; // 멱등 — 여러 cleanup 경로에서 중복 호출 안전
    released = true;
    const n = (counts.get(userId) ?? 1) - 1;
    if (n <= 0) counts.delete(userId);
    else counts.set(userId, n);
  };
}

// ── SSE 구독 ────────────────────────────────────────────────────────────────

/** 채널 SSE 구독 등록 (상한 초과 시 null 반환) */
export function subscribeBoardChannel(channelId: string, listener: SSEListener): (() => void) | null {
  const map = getListeners();
  const key = `board:${channelId}`;
  const existing = map.get(key);
  if (existing && existing.size >= MAX_LISTENERS_PER_CHANNEL) return null;
  if (getGlobalListenerCount() >= MAX_LISTENERS_GLOBAL) return null;

  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(listener);
  return () => {
    map.get(key)?.delete(listener);
    if (map.get(key)?.size === 0) map.delete(key);
  };
}

/** 카페 SSE 구독 등록 (카테고리 등 카페 전체 이벤트, 상한 초과 시 null 반환) */
export function subscribeBoardCafe(cafeId: string, listener: SSEListener): (() => void) | null {
  const map = getListeners();
  const key = `board:cafe:${cafeId}`;
  const existing = map.get(key);
  if (existing && existing.size >= MAX_LISTENERS_PER_CHANNEL) return null;
  if (getGlobalListenerCount() >= MAX_LISTENERS_GLOBAL) return null;

  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(listener);
  return () => {
    map.get(key)?.delete(listener);
    if (map.get(key)?.size === 0) map.delete(key);
  };
}

// ── 이벤트 발행 (in-process) ─────────────────────────────────────────────────

/** 채널 이벤트 발행 — in-process 전용 (send 실패 시 좀비 리스너 자동 제거) */
export function emitBoardEvent(channelId: string, event: string, data: unknown) {
  const key = `board:${channelId}`;
  const listeners = getListeners().get(key);
  if (!listeners) return;
  listeners.forEach((listener) => {
    try {
      listener.send(event, data);
    } catch {
      listeners.delete(listener);
    }
  });
  if (listeners.size === 0) getListeners().delete(key);
}

/** 카페 이벤트 발행 — in-process 전용 */
export function emitBoardCafeEvent(cafeId: string, event: string, data: unknown) {
  const key = `board:cafe:${cafeId}`;
  const listeners = getListeners().get(key);
  if (!listeners) return;
  listeners.forEach((listener) => {
    try {
      listener.send(event, data);
    } catch {
      listeners.delete(listener);
    }
  });
  if (listeners.size === 0) getListeners().delete(key);
}

/** 유저 이벤트 발행 — in-process 전용 (비밀대화 등 1:1 전용) */
export function emitBoardUserEvent(userId: string, event: string, data: unknown) {
  const key = `board:user:${userId}`;
  const listeners = getListeners().get(key);
  if (!listeners) return;
  listeners.forEach((listener) => {
    try {
      listener.send(event, data);
    } catch {
      listeners.delete(listener);
    }
  });
  if (listeners.size === 0) getListeners().delete(key);
}

/** 유저 SSE 구독 등록 */
export function subscribeBoardUser(userId: string, listener: SSEListener): () => void {
  const map = getListeners();
  const key = `board:user:${userId}`;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(listener);
  return () => {
    map.get(key)?.delete(listener);
    if (map.get(key)?.size === 0) map.delete(key);
  };
}

// ── Redis pub/sub (Worker Thread 간 전달) ─────────────────────────────────────
// BroadcastChannel은 Turbopack Worker 간 동작 안 함 → Redis pub/sub 사용
// static import 불가 (Turbopack 컴파일 깨짐) → dynamic import 사용
const REDIS_CH = "board_events";
const WORKER_ID = `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let _redisPub: { publish(ch: string, msg: string): Promise<number> } | null = null;
let _redisInitStarted = false;

function initRedis(): void {
  if (_redisInitStarted || !process.env.REDIS_URL) return;
  _redisInitStarted = true;
  const url = process.env.REDIS_URL;

  import("ioredis").then(({ default: Redis }) => {
    // Publisher
    const pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
    pub.on("error", () => {});
    pub.connect().then(() => { _redisPub = pub; }).catch(() => {});

    // Subscriber
    const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
    sub.on("error", () => {});
    sub.on("message", (_ch, raw) => {
      if (_ch !== REDIS_CH) return;
      try {
        const msg = JSON.parse(raw) as { wid?: string; type: string; targetId: string; event: string; data: unknown };
        if (msg.wid === WORKER_ID) return; // 자신이 발행한 메시지 → 이미 in-process로 처리됨
        if (msg.type === "channel") emitBoardEvent(msg.targetId, msg.event, msg.data);
        else if (msg.type === "cafe") emitBoardCafeEvent(msg.targetId, msg.event, msg.data);
        else if (msg.type === "user") emitBoardUserEvent(msg.targetId, msg.event, msg.data);
      } catch { /* malformed */ }
    });
    sub.connect()
      .then(() => sub.subscribe(REDIS_CH))
      .catch(() => {});
  }).catch(() => { /* ioredis 없으면 in-process만 */ });
}

// 모듈 로드 시 Redis 초기화 시작 (비동기, 수초 내 완료)
initRedis();

// ── 이벤트 발행 (in-process + Redis pub/sub) ─────────────────────────────────

/** 채널 이벤트 발행 — in-process + BroadcastChannel + Redis로 다른 Worker에 전달 */
export function publishBoardEvent(channelId: string, event: string, data: unknown) {
  emitBoardEvent(channelId, event, data);
  // BroadcastChannel — 같은 프로세스 내 다른 Worker Thread에 전달
  const bc = getBC();
  if (bc) {
    try { bc.postMessage({ wid: BC_WORKER_ID, type: "channel", targetId: channelId, event, data }); } catch { /* closed */ }
  }
  if (_redisPub) {
    const msg = JSON.stringify({ wid: WORKER_ID, type: "channel", targetId: channelId, event, data });
    _redisPub.publish(REDIS_CH, msg).catch(() => {});
  }
}

/** 유저 이벤트 발행 — in-process + BroadcastChannel + Redis로 다른 Worker에 전달 */
export function publishBoardUserEvent(userId: string, event: string, data: unknown) {
  emitBoardUserEvent(userId, event, data);
  const bc = getBC();
  if (bc) {
    try { bc.postMessage({ wid: BC_WORKER_ID, type: "user", targetId: userId, event, data }); } catch { /* closed */ }
  }
  if (_redisPub) {
    const msg = JSON.stringify({ wid: WORKER_ID, type: "user", targetId: userId, event, data });
    _redisPub.publish(REDIS_CH, msg).catch(() => {});
  }
}

/** 카페 이벤트 발행 — in-process + BroadcastChannel + Redis로 다른 Worker에 전달 */
export function publishBoardCafeEvent(cafeId: string, event: string, data: unknown) {
  emitBoardCafeEvent(cafeId, event, data);
  // BroadcastChannel — 같은 프로세스 내 다른 Worker Thread에 전달
  const bc = getBC();
  if (bc) {
    try { bc.postMessage({ wid: BC_WORKER_ID, type: "cafe", targetId: cafeId, event, data }); } catch { /* closed */ }
  }
  if (_redisPub) {
    const msg = JSON.stringify({ wid: WORKER_ID, type: "cafe", targetId: cafeId, event, data });
    _redisPub.publish(REDIS_CH, msg).catch(() => {});
  }
}

/** 채널의 현재 연결 사용자 ID 목록 */
export function getChannelPresence(channelId: string): string[] {
  const listeners = getListeners().get(`board:${channelId}`);
  if (!listeners) return [];
  const userIds = new Set<string>();
  listeners.forEach((l) => {
    if (l.userId) userIds.add(l.userId);
  });
  return Array.from(userIds);
}

// 60초마다 좀비 리스너 sweep (send 실패 = 연결 끊김)
const _boardSseSweep = setInterval(() => {
  const map = getListeners();
  map.forEach((listeners, key) => {
    listeners.forEach((listener) => {
      try {
        listener.send("ping", null);
      } catch {
        listeners.delete(listener);
      }
    });
    if (listeners.size === 0) map.delete(key);
  });
}, 60_000);
_boardSseSweep.unref?.();

/** 이벤트 타입 */
export type BoardEventType =
  | "board:message:new"
  | "board:message:update"
  | "board:message:delete"
  | "board:reaction:update"
  | "board:pin:update"
  | "board:poll:update"
  | "board:channel:update"
  | "board:typing"
  | "board:category:update"
  | "board:presence:status"
  | "wsign:card:update";
