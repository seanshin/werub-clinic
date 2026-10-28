// Created: 2026-05-06
// Updated: 2026-05-06 — cafe_status 반환 (승인 상태 체크용)
// Updated: 2026-08-19 — ?cafe= 선호 병원(소속 검증 후) primary · memberStatus(PENDING 가입 승인제) 노출·BANNED 제외
// GET /api/clinic/context — 사용자의 병원/의원 카페 자동 감지
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);

    const cafes = await prisma.$queryRaw<Array<{
      cafe_id: string; slug: string; name: string; cafe_type: string;
      cafe_status: string; logo: string | null; role: string; member_status: string;
    }>>`SELECT cm.cafe_id, c.slug, c.name, c.cafe_type, c.cafe_status, c.logo, cm.role, cm.status::text AS member_status
       FROM cafe_members cm
       JOIN cafes c ON c.id = cm.cafe_id
       WHERE cm.user_id = ${userId}
         AND c.cafe_type IN ('hospital', 'clinic')
       ORDER BY cm.joined_at ASC
       LIMIT 5`;

    if (cafes.length === 0) {
      return NextResponse.json({ found: false, cafes: [] });
    }

    // 2026-08-19: ?cafe=<slug> 가 본인 소속이면 그것을 primary로(병원 코드로 로그인한 병원 우선). 아니면 최초 가입순.
    // 이전엔 무조건 가장 오래된 소속이라 코드 Y로 로그인해도 X 병원으로 들어갔다.
    // BANNED 는 제외, PENDING(가입 승인제)은 memberStatus 로 내려 병원웹이 대기 화면을 보이게 한다.
    const visible = cafes.filter(c => c.member_status !== "BANNED");
    if (visible.length === 0) return NextResponse.json({ found: false, cafes: [] });
    const preferred = request.nextUrl.searchParams.get("cafe");
    const primaryRow = (preferred && visible.find(c => c.slug === preferred)) || visible.find(c => c.member_status === "ACTIVE") || visible[0];

    return NextResponse.json({
      found: true,
      primary: {
        id: primaryRow.cafe_id,
        slug: primaryRow.slug,
        name: primaryRow.name,
        type: primaryRow.cafe_type,
        status: primaryRow.cafe_status,
        memberStatus: primaryRow.member_status,
        logo: primaryRow.logo,
        role: primaryRow.role,
      },
      cafes: visible.map(c => ({
        id: c.cafe_id,
        slug: c.slug,
        name: c.name,
        type: c.cafe_type,
        status: c.cafe_status,
        memberStatus: c.member_status,
        logo: c.logo,
        role: c.role,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
