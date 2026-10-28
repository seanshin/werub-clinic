// Created: 2026-02-08
// Updated: 2026-04-14 — pg.Pool max 6→3 (PM2 2인스턴스 × 합산 7 = 14, Supabase 커넥션 한도 이내)
//                        Edge 번들에 pg가 들어가지 않도록 dynamic require 유지

// ── BigInt JSON 직렬화 — prisma $queryRawUnsafe가 bigint 반환 시 필요 ───
// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
(BigInt.prototype as BigInt & { toJSON: () => number }).toJSON = function () { return Number(this); };

// ── 타입 전용 import (번들 영향 없음) ─────────────────────────────────────
import type { PrismaClient } from "@/generated/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getClient(): any {
  if (_client) return _client;

  // Node.js only: driver adapter 방식 (Prisma v7 필수)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: NodePrismaClient } = require("@/generated/prisma");

  const globalForPrisma = globalThis as unknown as { _prismaNode?: typeof _client };

  if (!globalForPrisma._prismaNode) {
    // DATABASE_URL(6543 transaction mode) 사용 — session mode 한도 초과 방지
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
      max: 3,
      min: 0,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool);
    globalForPrisma._prismaNode = new NodePrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

    // 프로세스 종료 시 풀 정리 + 전역 참조 해제 (PM2 reload 시 새 pool 생성 보장)
    const cleanup = () => {
      pool.end().catch(() => {});
      globalForPrisma._prismaNode = undefined;
      _client = null;
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  _client = globalForPrisma._prismaNode;

  return _client;
}

// ── Lazy Proxy — 첫 번째 프로퍼티 접근 시 실제 클라이언트 초기화 ───────────
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return getClient()[prop];
  },
  set(_target, prop, value) {
    getClient()[prop] = value;
    return true;
  },
});
