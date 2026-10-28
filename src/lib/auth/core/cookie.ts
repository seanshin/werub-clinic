// Created: 2026-03-19 16:00
// Updated: 2026-03-20 — 세션 쿠키 전환 (maxAge 제거 → 브라우저 종료 시 로그아웃)
// Updated: 2026-04-06 — Web Crypto API로 교체 (edge runtime 호환)
// 쿠키 헬퍼 — set/clear AuthCookies
import { NextResponse } from "next/server";

// Web Crypto API 기반 랜덤 hex (Node.js 18+ + Edge Runtime 모두 호환)
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
import { AUTH_CONFIG, IS_PROD, getCookieDomain } from "../config";

export function setAuthCookies(response: NextResponse, token: string): NextResponse {
  const csrfToken = randomHex(AUTH_CONFIG.csrfTokenBytes);

  // maxAge 미설정 → 세션 쿠키 (브라우저 종료 시 삭제)
  // domain: .example.org → 서브도메인(blog.example.org) SSO 공유
  // sameSite: lax → 서브도메인 간 GET 네비게이션에서 쿠키 전송
  response.cookies.set(AUTH_CONFIG.cookieNames.authToken, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    ...(getCookieDomain() && { domain: getCookieDomain() }),
  });

  response.cookies.set(AUTH_CONFIG.cookieNames.csrfToken, csrfToken, {
    httpOnly: true,    // XSS로 CSRF 토큰 탈취 방지
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    ...(getCookieDomain() && { domain: getCookieDomain() }),
  });

  // 클라이언트 캐시용 — 응답 헤더로 CSRF 토큰 전달
  response.headers.set("X-CSRF-Token", csrfToken);

  return response;
}

// 구 path(/api/auth/refresh)의 refresh 쿠키를 만료시키는 raw Set-Cookie 문자열.
// ⚠️ Next.js ResponseCookies.set()은 '이름'으로 dedupe하므로 같은 werub_rt를 두 번
// .set()하면 뒤엣것이 앞엣것을 덮어쓴다(설정이 사라짐). 같은 이름·다른 path의 Set-Cookie를
// 공존시키려면 headers.append로 raw 헤더를 추가해야 한다.
function legacyRefreshClearCookie(path: string = AUTH_CONFIG.refreshTokenCookieLegacyPath): string {
  const domain = getCookieDomain();
  let c = `${AUTH_CONFIG.cookieNames.refreshToken}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
  if (IS_PROD) c += "; Secure";
  if (domain) c += `; Domain=${domain}`;
  return c;
}
// 2026-08-19: 블로그가 v0.7.6까지 werub_rt를 Path=/ 로 굽던 것도 함께 만료(같은 이름 쿠키 2개 공존 → refresh가
// 폐기된 쪽을 보내 reuse 감지로 전세션 폭파되던 경로). 블로그 v0.8.0부터는 메인과 같은 Path=/api/auth.
function blogLegacyRefreshClearCookie(): string {
  return legacyRefreshClearCookie("/");
}

export function setRefreshTokenCookie(response: NextResponse, rawToken: string): NextResponse {
  const domainOpt = getCookieDomain() ? { domain: getCookieDomain() } : {};
  // maxAge 미설정 → 세션 쿠키 (브라우저 종료 시 삭제)
  response.cookies.set(AUTH_CONFIG.cookieNames.refreshToken, rawToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: AUTH_CONFIG.refreshTokenCookiePath,
    ...domainOpt,
  });
  // 전환 정리(F10): 구 path 쿠키 만료. 회전 후 구·신 path 쿠키 공존 시 refresh가
  // 구(revoked) 토큰을 보내 reuse 감지로 전세션 폭파되는 것을 방지. (append: 위 set 보존)
  response.headers.append("set-cookie", legacyRefreshClearCookie());
  response.headers.append("set-cookie", blogLegacyRefreshClearCookie());
  return response;
}

export function clearAuthCookies(response: NextResponse): NextResponse {
  const domainOpt = getCookieDomain() ? { domain: getCookieDomain() } : {};
  response.cookies.set(AUTH_CONFIG.cookieNames.authToken, "", { maxAge: 0, path: "/", ...domainOpt });
  response.cookies.set(AUTH_CONFIG.cookieNames.csrfToken, "", { maxAge: 0, path: "/", ...domainOpt });
  response.cookies.set(AUTH_CONFIG.cookieNames.refreshToken, "", { maxAge: 0, path: AUTH_CONFIG.refreshTokenCookiePath, ...domainOpt });
  // 전환 정리(F10): 구 path 쿠키도 만료 (append — 위 werub_rt set을 덮어쓰지 않도록)
  response.headers.append("set-cookie", legacyRefreshClearCookie());
  response.headers.append("set-cookie", blogLegacyRefreshClearCookie());
  return response;
}
