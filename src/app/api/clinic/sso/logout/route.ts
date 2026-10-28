// Created: 2026-05-06
// POST /api/clinic/sso/logout — SSO 로그아웃 (양쪽 세션 종료)
import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    // Clinic 세션 종료 (쿠키 삭제)
    const res = NextResponse.json({ ok: true, message: "로그아웃되었습니다" });

    // 인증 쿠키 삭제
    const cookieOpts = { path: "/", maxAge: 0 } as const;
    res.cookies.set("werub_access", "", cookieOpts);
    res.cookies.set("werub_refresh", "", cookieOpts);
    res.cookies.set("werub_csrf", "", cookieOpts);

    return res;
  } catch (err) { return handleError(err); }
}
