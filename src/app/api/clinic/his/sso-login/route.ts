// Created: 2026-07-17 16:15
// HIS 열람 SSO 티켓 교환 — 브라우저 GET. 단회용 티켓 원자 소비 → 세션 쿠키(.example.org) 발급 → redirect 302.
// 티켓 자체가 자격(256bit 랜덤·60초·단회) — 실패는 로그인 페이지로 안내(원 redirect 유지해 로그인 후 도달 가능).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSsoToken } from "@/lib/his/auth";
import { signToken, setAuthCookies } from "@/lib/auth/core";
import { rateLimit } from "@/lib/rate-limit";
import { handleError } from "@/lib/errors";

const MAIN_HOST = process.env.NEXT_PUBLIC_APP_URL || "https://example.org";

export async function GET(request: NextRequest) {
  try {
    await rateLimit(request, "write");
    const ticket = request.nextUrl.searchParams.get("ticket") ?? "";
    if (!ticket || ticket.length > 200) {
      return NextResponse.redirect(`${MAIN_HOST}/login?error=sso_invalid`);
    }
    const tokenHash = hashSsoToken(ticket);

    // 단회용 원자 소비 (used=false → true, 만료·서비스 동시 검증)
    const rows = await prisma.$queryRaw<{ user_id: string; redirect: string | null }[]>`
      UPDATE his_sso_tokens SET used = true, used_at = now()
      WHERE token_hash = ${tokenHash} AND used = false AND expires_at > now() AND target_service = 'clinic-view'
      RETURNING user_id, redirect`;
    const consumed = rows[0];
    if (!consumed) {
      return NextResponse.redirect(`${MAIN_HOST}/login?error=sso_expired`);
    }

    const users = await prisma.$queryRaw<{ id: string; email: string; role: string; token_version: number; status: string }[]>`
      SELECT id, email, role, token_version, status FROM users WHERE id = ${consumed.user_id} LIMIT 1`;
    const user = users[0];
    if (!user || user.status !== "ACTIVE" || user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      return NextResponse.redirect(`${MAIN_HOST}/login?error=sso_invalid`);
    }

    const token = await signToken({ userId: user.id, email: user.email, role: user.role, tokenVersion: user.token_version });
    const redirect = consumed.redirect && consumed.redirect.startsWith("/") && !consumed.redirect.startsWith("//")
      ? consumed.redirect : "/";
    const res = NextResponse.redirect(`${MAIN_HOST}${redirect}`);
    setAuthCookies(res, token);

    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_SSO_LOGIN", { userId: user.id, redirect });
    } catch {}
    return res;
  } catch (err) { return handleError(err); }
}
