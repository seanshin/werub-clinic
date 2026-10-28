// Created: 2026-04-29
// Updated: 2026-08-19 — 진입 게이트(세션 쿠키 없으면 /login?redirect=)
// Hospital Web — 진입 게이트
import { NextRequest, NextResponse } from "next/server";

// ── 진입 게이트 (2026-08-19, CLI-70 2차) ─────────────────────────────────────
// 세션 쿠키(werub_auth, .example.org 공유)가 없는 요청은 보호 경로에서 즉시 /login?redirect= 로 보낸다.
// 이전엔 서버측 가드가 없어 빈 화면을 그린 뒤 API 401 → 클라이언트가 제각각 처리해 진입로가 엉켰다.
// 존재 검사만 한다(JWT 검증은 메인앱 API 몫) — 만료된 액세스는 페이지의 API 401 → refresh 흐름이 처리한다.
const SESSION_COOKIE = "werub_auth";
const PUBLIC_EXACT = new Set(["/", "/login", "/register", "/signup"]);
const PUBLIC_PREFIX: string[] = [];
function isPublicPath(p: string): boolean {
  // 정적 자원·API·확장자 있는 파일은 게이트 대상이 아니다(matcher 와 이중 안전장치 — 채널은 matcher 없이 전 경로를 지난다)
  if (p.startsWith("/_next/") || p.startsWith("/api/") || /\.[a-z0-9]+$/i.test(p)) return true;
  if (PUBLIC_EXACT.has(p)) return true;
  return PUBLIC_PREFIX.some((x) => p === x || p.startsWith(x + "/"));
}
function entryGate(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return null;
  if (request.cookies.has(SESSION_COOKIE)) return null;
  // 절대 URL은 요청 Host/X-Forwarded-Proto 로 만든다 — nextUrl.host 가 바인딩 주소(localhost:포트)로 나오는 버전이 있다(오피스 실측)
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  return NextResponse.redirect(`${proto}://${host}/login?redirect=${encodeURIComponent(pathname + search)}`);
}

export function middleware(request: NextRequest) {
  return entryGate(request) ?? NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|api/|favicon.ico|.*\\..*).*)"] };
