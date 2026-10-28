// Created: 2026-03-19 16:00
// CSRF Double Submit Cookie 검증
// Updated: 2026-04-10 — constant-time 비교 (crypto 모듈 없이, 클라이언트 번들 누출 방지)
import { NextRequest } from "next/server";
import { ForbiddenError } from "@/lib/errors";
import { AUTH_CONFIG } from "../config";

/** Node.js crypto 없이 constant-time 문자열 비교 (timing side-channel 방어) */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyCsrf(request: NextRequest): void {
  const cookieCsrf = request.cookies.get(AUTH_CONFIG.cookieNames.csrfToken)?.value;
  const headerCsrf = request.headers.get("x-csrf-token");
  if (!cookieCsrf || !headerCsrf || cookieCsrf.length !== headerCsrf.length) {
    throw new ForbiddenError("CSRF 토큰이 유효하지 않습니다");
  }
  if (!constantTimeEqual(cookieCsrf, headerCsrf)) {
    throw new ForbiddenError("CSRF 토큰이 유효하지 않습니다");
  }
}
