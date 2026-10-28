// Created: 2026-05-07
// GET /api/clinic/his/hospital — 병원 기본 정보
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");

    const rows = await prisma.$queryRaw<Array<{
      id: string; name: string; cafe_type: string; enterprise_code: string;
      business_number: string | null; representative: string | null;
      settings: Record<string, unknown> | null; created_at: Date;
      member_count: bigint;
    }>>`SELECT c.id, c.name, c.cafe_type, c.enterprise_code, c.business_number, c.representative, c.settings, c.created_at,
              (SELECT COUNT(*) FROM cafe_members WHERE cafe_id = c.id) as member_count
       FROM cafes c WHERE c.id = ${ctx.cafeId}`;
    const c = rows[0];
    const s = (c?.settings ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      id: c.id, name: c.name, code: c.enterprise_code, type: c.cafe_type,
      businessNumber: c.business_number, representative: c.representative,
      specialty: s.specialty ?? null,
      contactEmail: s.contactEmail ?? null, contactPhone: s.contactPhone ?? null,
      staffCount: Number(c.member_count), hisEnabled: !!s.hisEnabled,
      features: s.groupwareFeatures ?? {},
      createdAt: c.created_at,
    });
  } catch (err) { return handleError(err); }
}
