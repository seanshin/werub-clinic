// Created: 2026-05-06
// PII(개인정보) 마스킹 — 모든 로그(클라이언트+서버)에 적용
// 동기 regex 치환, <1ms, 성능 영향 없음
// 기존 lib/log-sanitizer.ts에서 이전

const MASK_PATTERNS: Array<[RegExp, string]> = [
  [/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  [/Bearer\s+[\w.-]+/gi, "Bearer [TOKEN]"],
  [/"password"\s*:\s*"[^"]+"/gi, '"password":"[REDACTED]"'],
  [/\b\d{3}-\d{4}-\d{4}\b/g, "[PHONE]"],
  [/\b\d{6}-[1-4]\d{6}\b/g, "[RESIDENT_NUM]"],
  [/auth_token=[^&\s"]+/gi, "auth_token=[REDACTED]"],
];

/** 문자열에서 PII를 마스킹 */
export function sanitizeString(str: string): string {
  let result = str;
  for (const [pattern, replacement] of MASK_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** 객체의 message/stack 필드를 마스킹 (원본 변경 없이 복사본 반환) */
export function sanitize<T extends { message?: string; stack?: string; [key: string]: unknown }>(payload: T): T {
  const clean = { ...payload };
  if (typeof clean.message === "string") clean.message = sanitizeString(clean.message);
  if (typeof clean.stack === "string") clean.stack = sanitizeString(clean.stack);
  return clean;
}
