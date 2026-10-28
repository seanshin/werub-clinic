// Created: 2026-05-06
// Updated: 2026-05-07 — [H-5] Rate Limit 추가
// GET /api/clinic/verify/[code] — 병원 코드 검증
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, NotFoundError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ code: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    await rateLimit(request, "general");
    const { code } = await params;
    if (!code) throw new BadRequestError("병원 코드를 입력하세요");

    const codeUpper = code.toUpperCase();
    const codeLower = code.toLowerCase();
    const cafes = await prisma.$queryRaw<Array<{
      id: string; name: string; slug: string; cafe_type: string;
      logo: string | null; banner: string | null;
      enterprise_code: string; enterprise_code_active: boolean;
      settings: Record<string, unknown>;
    }>>`SELECT id, name, slug, cafe_type, logo, banner, enterprise_code, enterprise_code_active, settings
       FROM cafes
       WHERE (enterprise_code = ${codeUpper} OR enterprise_custom_slug = ${codeLower})
         AND cafe_type IN ('hospital', 'clinic')
       LIMIT 1`;

    const cafe = cafes[0];
    if (!cafe) throw new NotFoundError("유효하지 않은 병원 코드입니다");
    if (!cafe.enterprise_code_active) throw new BadRequestError("비활성화된 병원 코드입니다");

    const countRows = await prisma.$queryRaw<[{ cnt: bigint }]>`SELECT COUNT(*) as cnt FROM cafe_members WHERE cafe_id = ${cafe.id}`;

    return NextResponse.json({
      valid: true,
      cafe: {
        name: cafe.name,
        slug: cafe.slug,
        type: cafe.cafe_type,
        logo: cafe.logo,
        banner: cafe.banner,
        specialty: (cafe.settings as Record<string, unknown>)?.specialty ?? null,
        memberCount: Number(countRows[0].cnt),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
