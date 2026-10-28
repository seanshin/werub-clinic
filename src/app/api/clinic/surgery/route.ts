// Created: 2026-07-23
// 수술보드 상태 로컬 영속화 — HIS 미연동/폴링 원복 방지 (handoff 패턴)
//   GET  /api/clinic/surgery  — 오늘 상태 오버라이드 목록
//   POST /api/clinic/surgery  — { surgeryId, status } upsert
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError, BadRequestError } from "@/lib/errors";

async function resolveClinicCafe(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ cafe_id: string }[]>`
    SELECT cm.cafe_id FROM cafe_members cm
    JOIN cafes c ON c.id = cm.cafe_id
    WHERE cm.user_id = ${userId} AND cm.status = 'ACTIVE' AND c.cafe_type IN ('hospital', 'clinic')
    ORDER BY cm.joined_at ASC LIMIT 1`;
  return rows[0]?.cafe_id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) return NextResponse.json({ ok: true, data: { overrides: [] } });
    const rows = await prisma.$queryRaw<Array<{ surgery_id: string; status: string; updated_at: Date }>>`
      SELECT surgery_id, status, updated_at FROM surgery_status_overrides
      WHERE cafe_id = ${cafeId} AND updated_at >= CURRENT_DATE`;
    return NextResponse.json({ ok: true, data: { overrides: rows.map(r => ({ surgeryId: r.surgery_id, status: r.status, updatedAt: r.updated_at })) } });
  } catch (err) { return handleError(err); }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) throw new BadRequestError("병원 카페 소속이 아닙니다");
    const { surgeryId, status } = await request.json() as { surgeryId?: string; status?: string };
    if (!surgeryId || !status) throw new BadRequestError("surgeryId와 status가 필요합니다");
    await prisma.$executeRaw`
      INSERT INTO surgery_status_overrides (cafe_id, surgery_id, status, updated_by, updated_at)
      VALUES (${cafeId}, ${surgeryId}, ${status}, ${userId}, now())
      ON CONFLICT (cafe_id, surgery_id) DO UPDATE SET status = ${status}, updated_by = ${userId}, updated_at = now()`;
    return NextResponse.json({ ok: true });
  } catch (err) { return handleError(err); }
}
