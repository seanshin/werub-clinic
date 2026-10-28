// Created: 2026-05-06
// DB 저장 — fire-and-forget (void 반환, await 금지)
// pool.query 캡슐화, 저장 실패 시 무시 (API 응답에 영향 없음)

import { pool } from "@/lib/pg-pool";
import type { LogEntry } from "./types";

/**
 * error_logs 테이블에 로그 1건 저장.
 * ⚠️ void 반환 — 호출자가 await할 수 없음 (설계 의도)
 */
export function writeLog(entry: LogEntry): void {
  pool.query(
    `INSERT INTO error_logs (level, source, category, error_code, url, fetch_url, status, message, stack, user_id, user_agent, ip, extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      entry.level,
      entry.source,
      entry.category,
      entry.errorCode ?? null,
      entry.url ?? null,
      entry.fetchUrl ?? null,
      entry.status ?? null,
      entry.message,
      entry.stack ?? null,
      entry.userId ?? null,
      entry.userAgent ?? null,
      entry.ip ?? null,
      entry.extra ? JSON.stringify(entry.extra) : null,
    ],
  ).catch(() => { /* 테이블 미존재 등 무시 */ });
}
