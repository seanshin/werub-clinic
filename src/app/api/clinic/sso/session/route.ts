// Created: 2026-05-06
// GET /api/clinic/sso/session — 현재 세션 상태 확인
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const cafes = await prisma.$queryRaw<Array<{
      cafe_id: string; name: string; cafe_type: string; enterprise_code: string; role: string;
    }>>`SELECT cm.cafe_id, c.name, c.cafe_type, c.enterprise_code, cm.role
       FROM cafe_members cm JOIN cafes c ON c.id = cm.cafe_id
       WHERE cm.user_id = ${user.userId} AND cm.status = 'ACTIVE' AND c.cafe_type IN ('hospital', 'clinic') AND c.cafe_status = 'active'
       LIMIT 1`;

    if (cafes.length === 0) {
      return NextResponse.json({ authenticated: true, hospital: null });
    }

    const cafe = cafes[0];
    return NextResponse.json({
      authenticated: true,
      user: { id: user.userId, role: user.role },
      hospital: {
        id: cafe.cafe_id,
        name: cafe.name,
        type: cafe.cafe_type,
        code: cafe.enterprise_code,
        memberRole: cafe.role,
      },
    });
  } catch {
    return NextResponse.json({ authenticated: false, hospital: null });
  }
}
