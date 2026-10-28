// Created: 2026-05-06
// Logger 싱글턴 — 로그 시스템 단일 진입점
//
// 사용법:
//   import { logger } from "@/lib/logger";
//   logger.error("api/comments", error);           // 서버 에러 (DB + 텔레그램)
//   logger.audit("ADMIN_COMMENT_DELETE", { ... });  // 감사 로그 (관리자 행위)
//   logger.warn("RATE_LIMIT_HIT", "IP xxx");        // 경고
//   logger.info("DEPLOY_EVENT", "v8.2.0 deployed"); // 정보
//
// 성능 원칙:
//   - 모든 메서드는 void 반환 (await 불가)
//   - DB INSERT / 텔레그램 알림은 fire-and-forget
//   - API 응답 경로에 동기 대기 없음

import type { LogCategory, LogEntry, ClientErrorPayload } from "./types";
import { writeLog } from "./writer";
import { sanitizeString } from "./sanitizer";
import { sanitize } from "./sanitizer";
import { sendAlert } from "./alert";

class Logger {
  /**
   * 서버 에러 로그 — DB 저장 + 텔레그램 알림 (프로덕션)
   * PII 자동 마스킹 적용
   */
  error(context: string, error: unknown, extra?: Record<string, unknown>): void {
    const errMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    writeLog({
      level: "ERROR",
      source: "server",
      category: "SERVER_500",
      message: sanitizeString(errMsg.slice(0, 2000)),
      stack: stack ? sanitizeString(stack.slice(0, 5000)) : undefined,
      // extra에 url/userId가 있으면 전용 컬럼에도 채운다 — jsonb만으로는 라우트별 조회가 어렵다
      url: typeof extra?.url === "string" ? extra.url : undefined,
      userId: typeof extra?.userId === "string" ? extra.userId : undefined,
      extra,
    });

    // 프로덕션에서만 텔레그램 알림
    if (process.env.NODE_ENV === "production") {
      sendAlert(context, errMsg);
    }
  }

  /** 경고 로그 — DB 저장 (텔레그램 미발송) */
  warn(category: LogCategory, message: string, extra?: Record<string, unknown>): void {
    writeLog({
      level: "WARN",
      source: "server",
      category,
      message: sanitizeString(message),
      url: typeof extra?.url === "string" ? extra.url : undefined,
      userId: typeof extra?.userId === "string" ? extra.userId : undefined,
      extra,
    });
  }

  /** 정보 로그 — DB 저장 */
  info(category: LogCategory, message: string, extra?: Record<string, unknown>): void {
    writeLog({
      level: "INFO",
      source: "server",
      category,
      message: sanitizeString(message),
      extra,
    });
  }

  /**
   * 감사 로그 — 관리자 행위 기록
   * source: "admin", level: "INFO"
   * data 전체가 extra JSONB로 저장됨
   */
  audit(action: LogCategory, data: Record<string, unknown>): void {
    const userId = (data.deletedBy ?? data.userId ?? data.adminId) as string | undefined;
    writeLog({
      level: "INFO",
      source: "admin",
      category: action,
      message: `${action}: ${JSON.stringify(data).slice(0, 500)}`,
      userId,
      extra: data,
    });
  }

  /**
   * 클라이언트 에러 수신 — API route에서 호출
   * PII 마스킹 + DB 저장 + Log Monitor 중계
   */
  ingestClientError(payload: ClientErrorPayload, ip: string): void {
    const clean = sanitize(payload);
    const category = clean.type === "JS_ERROR"
      ? "CLIENT_JS_ERROR" as const
      : clean.type === "REACT_ERROR"
        ? "CLIENT_REACT_ERROR" as const
        : "CLIENT_NETWORK_ERROR" as const;

    const errorCode = clean.message?.match(/\[E-[A-Z0-9-]+-\d{3}\]/)?.[0];

    writeLog({
      level: "ERROR",
      source: "client",
      category,
      errorCode: errorCode ?? undefined,
      url: clean.url,
      fetchUrl: clean.fetchUrl as string | undefined,
      status: clean.status as number | undefined,
      message: clean.message,
      stack: (clean.stack ?? clean.componentStack) as string | undefined,
      userId: clean.userId,
      userAgent: clean.userAgent,
      ip,
    });

    // Log Monitor로 중계 (fire-and-forget)
    const ingestUrl = process.env.LOG_MONITOR_INGEST_URL ?? "http://localhost:3001/api/logs/ingest";
    fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        category,
        source: "client",
        url: clean.url,
        userId: clean.userId,
        message: clean.message,
        stack: clean.stack ?? clean.componentStack,
        count: 1,
      }),
    }).catch(() => {});
  }
}

/** 로그 시스템 싱글턴 — 전역에서 import하여 사용 */
export const logger = new Logger();

// 타입 re-export (외부에서 logger/types.ts 직접 import 불필요하게)
export type { LogCategory, LogEntry, ClientErrorPayload } from "./types";
export { CATEGORY_LABELS, AUDIT_CATEGORIES, ERROR_CATEGORIES } from "./categories";
