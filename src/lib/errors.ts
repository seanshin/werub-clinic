// Created: 2026-02-08
// Updated: 2026-02-24 — M-4: Prisma 에러 분류 및 내부 정보 노출 방지
// Updated: 2026-03-08 — native-app Phase 1: 에러 응답 표준화 { error, code, details }
// Updated: 2026-03-08 — S3-2: P2003 에러에 dev 환경 field 정보 추가
import { NextResponse } from "next/server";
import { ZodError } from "zod";

// ── 에러 코드 상수 ────────────────────────────────────────────────────────────
export const ErrorCode = {
  BAD_REQUEST:        "BAD_REQUEST",
  VALIDATION:         "VALIDATION",
  UNAUTHORIZED:       "UNAUTHORIZED",
  TOKEN_EXPIRED:      "TOKEN_EXPIRED",
  FORBIDDEN:          "FORBIDDEN",
  NOT_FOUND:          "NOT_FOUND",
  CONFLICT:           "CONFLICT",
  CONFLICT_EMAIL:     "CONFLICT_EMAIL",
  CONFLICT_USERNAME:  "CONFLICT_USERNAME",
  RATE_LIMITED:       "RATE_LIMITED",
  INTERNAL_ERROR:     "INTERNAL_ERROR",
  // ── 확장 에러 코드 (Phase 1-B) ───────────────────────────────────────────────
  PAYMENT_REQUIRED:   "PAYMENT_REQUIRED",   // 402 — We Point 부족 등 결제 필요
  GONE:               "GONE",               // 410 — 영구 삭제된 리소스
  UNPROCESSABLE:      "UNPROCESSABLE",      // 422 — 유효성 통과했으나 처리 불가
  QUOTA_EXCEEDED:     "QUOTA_EXCEEDED",     // 429 — AI 호출 등 할당량 초과
  SERVICE_UNAVAILABLE:"SERVICE_UNAVAILABLE",// 503 — 서비스 일시 중단
  TIMEOUT:            "TIMEOUT",            // 408 — 처리 시간 초과
  MAINTENANCE:        "MAINTENANCE",        // 503 — 점검 중
  MALFORMED_MULTIPART:"MALFORMED_MULTIPART",// 400 — multipart/form-data 본문 규격 위반 (클라이언트 조립 오류)
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: ErrorCodeType = ErrorCode.INTERNAL_ERROR,
    public details: unknown = null,
  ) {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "인증이 필요합니다", code: ErrorCodeType = ErrorCode.UNAUTHORIZED) {
    super(401, message, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "권한이 없습니다") {
    super(403, message, ErrorCode.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "리소스를 찾을 수 없습니다") {
    super(404, message, ErrorCode.NOT_FOUND);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "잘못된 요청입니다") {
    super(400, message, ErrorCode.BAD_REQUEST);
  }
}

export class ConflictError extends AppError {
  constructor(message = "이미 존재합니다", code: ErrorCodeType = ErrorCode.CONFLICT) {
    super(409, message, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(public retryAfterSeconds: number = 60) {
    super(429, `요청이 너무 많습니다. ${retryAfterSeconds}초 후 다시 시도해 주세요`, ErrorCode.RATE_LIMITED);
  }
}

// ── 확장 에러 클래스 (Phase 1-B) ───────────────────────────────────────────────
export class PaymentRequiredError extends AppError {
  constructor(message = "We Point가 부족합니다") {
    super(402, message, ErrorCode.PAYMENT_REQUIRED);
  }
}

export class GoneError extends AppError {
  constructor(message = "해당 리소스는 영구 삭제되었습니다") {
    super(410, message, ErrorCode.GONE);
  }
}

export class UnprocessableError extends AppError {
  constructor(message = "요청을 처리할 수 없습니다") {
    super(422, message, ErrorCode.UNPROCESSABLE);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = "AI 호출 할당량을 초과했습니다", public retryAfterSeconds = 3600) {
    super(429, message, ErrorCode.QUOTA_EXCEEDED);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "서비스를 일시적으로 사용할 수 없습니다") {
    super(503, message, ErrorCode.SERVICE_UNAVAILABLE);
  }
}

export class TimeoutError extends AppError {
  constructor(message = "요청 처리 시간이 초과되었습니다") {
    super(408, message, ErrorCode.TIMEOUT);
  }
}

export class MaintenanceError extends AppError {
  constructor(message = "서버 점검 중입니다. 잠시 후 다시 시도해 주세요") {
    super(503, message, ErrorCode.MAINTENANCE);
  }
}

/** 500 로그에 붙일 요청 컨텍스트 — 어느 라우트에서 터졌는지 남기기 위한 최소 정보 */
export interface ErrorContext {
  url?: string;
  method?: string;
  userId?: string;
}

/** NextRequest/Request를 그대로 넘겨도 되고, 직접 만든 컨텍스트를 넘겨도 된다 */
function toContext(ctx?: ErrorContext | Request): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  if (typeof (ctx as Request).headers === "object" && typeof (ctx as Request).url === "string") {
    const r = ctx as Request;
    // 쿼리스트링은 토큰이 실릴 수 있어 제거 — 경로만 남긴다
    let path = r.url;
    try { path = new URL(r.url).pathname; } catch { /* 상대 URL — 원문 유지 */ }
    return { url: path, method: r.method };
  }
  const c = ctx as ErrorContext;
  return { url: c.url, method: c.method, userId: c.userId };
}

export function handleError(error: unknown, ctx?: ErrorContext | Request) {
  // 클라이언트가 조립한 multipart 본문이 규격을 벗어난 경우 — 서버 장애가 아니므로 400이지만,
  // 어느 클라이언트가 무엇을 잘못 보내는지 추적할 수 있게 경고로 남긴다(CH-SRV-05).
  if (error instanceof AppError && error.code === ErrorCode.MALFORMED_MULTIPART) {
    import("@/lib/logger").then(({ logger }) => {
      logger.warn("MALFORMED_MULTIPART", "multipart 본문 파싱 실패", {
        ...toContext(ctx),
        diagnosis: error.details,
      });
    }).catch(() => {});
  }
  if (error instanceof TooManyRequestsError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: null },
      {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      },
    );
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details ?? null },
      { status: error.statusCode },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: error.issues[0]?.message || "잘못된 요청입니다",
        code: ErrorCode.VALIDATION,
        details: error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }
  // JSON 파싱 에러 (request.json() 실패 — 클라이언트가 잘못된 body 전송)
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: "잘못된 요청 형식입니다", code: ErrorCode.BAD_REQUEST, details: null },
      { status: 400 },
    );
  }
  // Prisma 에러 분류 — 내부 DB 오류가 클라이언트에 노출되지 않도록 처리
  if (
    error instanceof Object &&
    "code" in error &&
    "name" in error &&
    (error as { name: string }).name === "PrismaClientKnownRequestError"
  ) {
    const prismaError = error as { code: string };
    if (prismaError.code === "P2002") {
      return NextResponse.json({ error: "이미 존재하는 데이터입니다", code: ErrorCode.CONFLICT, details: null }, { status: 409 });
    }
    if (prismaError.code === "P2025") {
      return NextResponse.json({ error: "리소스를 찾을 수 없습니다", code: ErrorCode.NOT_FOUND, details: null }, { status: 404 });
    }
    if (prismaError.code === "P2003") {
      // S3-2: dev 환경에서 FK 위반 필드 정보 포함 (프로덕션은 내부 정보 비노출)
      const field = (error as { meta?: { field_name?: string } }).meta?.field_name ?? undefined;
      return NextResponse.json({
        error: "잘못된 참조 데이터입니다",
        code: ErrorCode.BAD_REQUEST,
        details: process.env.NODE_ENV !== "production" && field ? { field } : null,
      }, { status: 400 });
    }
    import("@/lib/logger").then(({ logger }) => {
      logger.error("Prisma Known Error", error, { ...toContext(ctx), code: (error as unknown as { code: string }).code });
    }).catch(() => {});
    return NextResponse.json({ error: "서버 내부 오류가 발생했습니다", code: ErrorCode.INTERNAL_ERROR, details: null }, { status: 500 });
  }
  // 알 수 없는 에러 — logger로 기록 + 텔레그램 알림
  const ctxData = toContext(ctx);
  import("@/lib/logger").then(({ logger }) => {
    logger.error(ctxData?.url ? `API 500 ${ctxData.method ?? ""} ${ctxData.url}`.trim() : "API 500", error, ctxData);
  }).catch(() => {});
  return NextResponse.json(
    { error: "서버 내부 오류가 발생했습니다", code: ErrorCode.INTERNAL_ERROR, details: null },
    { status: 500 },
  );
}
