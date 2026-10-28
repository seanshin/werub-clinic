// Created: 2026-03-19 16:00
// Updated: 2026-03-27 — cookieDomain 런타임 평가 (Turbopack 인라인 방지)
// Auth 설정 중앙화 — 환경변수 + 상수

export const AUTH_CONFIG = {
  // JWT
  accessTokenMaxAge: 60 * 60,              // 1시간 (초) — Auth Server와 동일
  refreshTokenMaxAge: 60 * 60 * 24 * 14, // 14일 (초)
  accessTokenExpiry: "1h",
  twoFactorTokenExpiry: "5m",

  // 캐시
  tokenVersionCacheTtl: 60_000,   // 60초
  tokenVersionCacheMax: 10_000,
  roleCacheTtl: 60_000,            // 60초 (블루-그린 캐시 동기화 미지원)
  roleCacheMax: 10_000,

  // 쿠키 (werub_ 접두사로 다른 서비스와 충돌 방지)
  cookieNames: {
    authToken: "werub_auth",
    csrfToken: "werub_csrf",
    refreshToken: "werub_rt",
  },
  // F10(2026-06-21): /api/auth로 확장 — refresh 토큰 쿠키가 logout(/api/auth/logout)에도
  // 전송되어야 logout이 해당 세션 refresh를 revoke + token_version을 bump할 수 있다.
  // (구 path "/api/auth/refresh"는 logout에 미전송 → logout이 revoke 불가했음.)
  refreshTokenCookiePath: "/api/auth",
  // 전환용: 구 path 쿠키를 set/clear 시 함께 만료시켜 이중 쿠키(구 revoked 토큰이
  // refresh를 깨뜨리는 문제)를 방지. 모든 세션 회전(≤refresh 수명) 후 제거 가능.
  refreshTokenCookieLegacyPath: "/api/auth/refresh",

  // 보안
  bcryptRounds: 12,  // Auth Server와 동일
  refreshTokenBytes: 48,  // 96자 hex
  csrfTokenBytes: 32,     // 64자 hex
} as const;

// 쿠키 도메인 — 런타임 함수 (Turbopack이 빌드 시 인라인하지 않도록)
// 프로덕션: COOKIE_DOMAIN=.example.org → 서브도메인(blog.example.org) SSO 공유
// 개발: 미설정 → undefined (localhost)
export function getCookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN || undefined;
}

// 하위 호환 (기존 AUTH_CONFIG.cookieDomain 사용처 대응)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(AUTH_CONFIG as any).cookieDomain = undefined; // 정적 접근 차단 — getCookieDomain() 사용

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("FATAL: JWT_SECRET 환경변수가 설정되지 않았습니다");
  }
  console.warn("[auth] JWT_SECRET 미설정 — 개발 전용 시크릿 사용 중 (프로덕션에서는 반드시 설정 필요)");
}

export const EFFECTIVE_SECRET = JWT_SECRET || (
  process.env.NODE_ENV === "development"
    ? "dev-secret-DO-NOT-USE-IN-PRODUCTION"
    : (() => { throw new Error("JWT_SECRET 환경변수가 필요합니다"); })()
);

export const IS_PROD = process.env.NODE_ENV === "production";

// 하위 호환 export
export const ACCESS_TOKEN_MAX_AGE = AUTH_CONFIG.accessTokenMaxAge;
export const REFRESH_TOKEN_MAX_AGE = AUTH_CONFIG.refreshTokenMaxAge;
