// Created: 2026-02-26
// Updated: 2026-04-14 — max 10→4 (PM2 2인스턴스 × (prisma 3 + pg-pool 4) = 14, Supabase 한도 이내)
// Updated: 2026-06-23 — max 4→6 (perf P9★ acquire 경합 완화): (prisma 3 + pg-pool 6) × 2 = 18.
//   실측 헤드룸 충분(Postgres max_connections=60, 관측 total 18/active 1, min=0로 유휴 반환).
//   추가 상향은 S2 로깅의 acquire 분포 측정 후 결정([[sql-tuning.plan]]).
// 공유 pg Pool 인스턴스 — 매 요청마다 new Client() 대신 사용
// 커넥션 풀링으로 TCP 연결 고갈 방지
import { Pool, types, type PoolConfig, type QueryConfig, type QueryResult, type QueryResultRow } from "pg";

// timestamp without time zone → 서버 TZ(KST)로 저장된 값을 UTC ISO 문자열로 변환
// PostgreSQL OID: 1114 = timestamp, 1184 = timestamptz
// Supabase DB 타임존이 UTC이므로, timestamp without tz 값은 이미 UTC — 그대로 'Z' 접미사 추가
types.setTypeParser(1114, (val: string) => val + "Z");

// DIRECT_URL(5432, session mode) 우선 — read-after-write 정합성 보장
// PgBouncer transaction mode(6543)는 커넥션마다 다른 백엔드 → 쓰기 직후 읽기 불일치 발생
// PM2 2인스턴스 × (prisma 3 + pg-pool 4) = 14 (pool_size 40 이내)
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || (
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다"); })()
    : "postgresql://postgres:postgres@localhost:5432/werub_community"
);

// Supabase 등 외부 호스팅 DB는 SSL 필수
const needsSsl = DB_URL.includes("supabase.com") || DB_URL.includes("sslmode=require") || process.env.DB_SSL === "true";

// 싱글턴 Pool (dev 환경 hot-reload 대응)
const globalForPg = globalThis as unknown as { __pgPool?: Pool };

function createPool(): Pool {
  const config: PoolConfig = {
    connectionString: DB_URL,
    min: 0,                           // 유휴 시 연결 0으로 — Supabase Nano 커넥션 절약
    max: 6,                           // P9★: PM2 2인스턴스 × (prisma 3 + pg-pool 6) = 18 (max_connections 60·pool_size 40 이내)
    // 유휴 반환 10s → 30s (2026-08-12, T5): 12일 pgss에서 DISCARD ALL 33,827회(session 모드
    // 클라이언트 disconnect마다, mean 10ms) — 10초 반환은 저부하 시간대에 "쓰고 → 반환 → 10초 뒤
    // 재연결"을 반복시킨다. 30초로 churn을 줄이되, min:0이라 유휴 연결이 눌러앉지는 않는다
    // (관측 total 18 / pool_size 40 — 헤드룸 확인 후 변경). 08-19 재측정: DISCARD ALL 일 2,819→993.
    // ⚠️ 정정(2026-08-19): `pgbouncer.get_auth`는 새 연결 인증이 **아니다** — Supavisor SecretChecker가
    // 풀(pool id)마다 15초(+지터)에 한 번 돌리는 비밀번호 회전 감시 쿼리다(풀 3개 × 5.5K = 일 16.4K 고정).
    // 통제 실험: 연결 10개 열고 닫아도 +0, 15초 대기마다 +3. 우리 idle/max 설정으로는 변하지 않는다.
    // 연결 churn 지표는 DISCARD ALL만 본다.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // pg_stat_activity에서 프로세스별 귀속이 되도록 — PM2가 process.env.name을 넣어준다
    // (werub-app / werub-cron / werub-socket). ※ pg_stat_statements에는 이 차원이 없다 —
    // pgss 귀속은 여전히 쿼리 모양으로 한다.
    application_name: process.env.name || "werub-app",
    // statement_timeout: transaction mode에서는 SET 명령 유지 불가 — 제거
  };
  if (needsSsl) config.ssl = { rejectUnauthorized: false };
  const p = new Pool(config);

  // DB 타임존은 이미 UTC — SET timezone 불필요 (types.setTypeParser로 해결)

  // S2(sql-tuning): 슬로우 쿼리 로깅 — 커넥션 획득(acquire)과 실행(exec)을 분리 계측.
  // 기존 래퍼는 pool.query(=획득 대기 + 실행 + 반환)를 통째로 측정해, 풀(max=4) 경합 시의
  // "획득 대기"가 "쿼리 시간"으로 오인됨(EXPLAIN상 실행은 0.5~3.7ms인데 로그는 500ms).
  // → connect()로 획득시간, client.query()로 실행시간을 각각 재서 원인을 구분한다.
  type QueryFn = (q: string | QueryConfig, v?: unknown[]) => Promise<QueryResult<QueryResultRow>>;
  const EXEC_WARN = 200;   // 실행 자체가 느린 진짜 튜닝 대상(인덱스/쿼리)
  const TOTAL_WARN = 500;  // 벽시계 임계 — 대부분 풀 획득 대기(앱/풀 사이징 대상)

  (p as unknown as { query: QueryFn }).query = async (q, v) => {
    const t0 = Date.now();
    const client = await p.connect();
    const tAcquired = Date.now();
    try {
      const result = (v !== undefined
        ? await client.query(q as string, v as unknown[])
        : await client.query(q as string)) as QueryResult<QueryResultRow>;
      const acquire = tAcquired - t0;
      const exec = Date.now() - tAcquired;
      if (exec > EXEC_WARN || acquire + exec > TOTAL_WARN) {
        const sql = typeof q === "string" ? q.slice(0, 120) : q.text?.slice(0, 120) ?? "(config query)";
        // exec가 임계 초과면 진짜 느린 쿼리(:exec), 아니면 풀 경합(:pool)으로 태깅
        const tag = exec > EXEC_WARN ? "slow-query:exec" : "slow-query:pool";
        console.warn(`[${tag}] acquire=${acquire}ms exec=${exec}ms | ${sql.replace(/\s+/g, " ")}`);
      }
      return result;
    } finally {
      client.release();
    }
  };

  return p;
}

export const pool: Pool =
  globalForPg.__pgPool ?? createPool();

if (!globalForPg.__pgPool) {
  globalForPg.__pgPool = pool;

  // 프로세스 종료 시 풀 정리 — PM2 restart/reload 시 커넥션 누수 방지
  // SIGTERM 수신 후 5초 대기 → 진행 중인 쿼리/타이머 완료 대기 후 pool.end()
  const cleanup = () => {
    setTimeout(() => {
      pool.end().catch(() => {});
      globalForPg.__pgPool = undefined;
    }, 5000);
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}
