// Created: 2026-07-23
// floor 에디터 구역 레이아웃 서버 영속화 — 기기/브라우저 간 동기화 (handoff 패턴)
//   GET  /api/clinic/floor-layout?floorId=  — 저장된 레이아웃(bounds 맵)
//   POST /api/clinic/floor-layout           — { floorId, layout } upsert
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
    const floorId = request.nextUrl.searchParams.get("floorId");
    if (!cafeId || !floorId) return NextResponse.json({ ok: true, data: { layout: null } });
    const rows = await prisma.$queryRaw<{ layout: unknown }[]>`
      SELECT layout FROM floor_layouts WHERE cafe_id = ${cafeId} AND floor_id = ${floorId}`;
    return NextResponse.json({ ok: true, data: { layout: rows[0]?.layout ?? null } });
  } catch (err) { return handleError(err); }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) throw new BadRequestError("병원 카페 소속이 아닙니다");
    const { floorId, layout } = await request.json() as { floorId?: string; layout?: Record<string, unknown> };
    if (!floorId || !layout || typeof layout !== "object") throw new BadRequestError("floorId와 layout이 필요합니다");
    await prisma.$executeRaw`
      INSERT INTO floor_layouts (cafe_id, floor_id, layout, updated_by, updated_at)
      VALUES (${cafeId}, ${floorId}, ${JSON.stringify(layout)}::jsonb, ${userId}, now())
      ON CONFLICT (cafe_id, floor_id) DO UPDATE SET layout = ${JSON.stringify(layout)}::jsonb, updated_by = ${userId}, updated_at = now()`;
    return NextResponse.json({ ok: true });
  } catch (err) { return handleError(err); }
}
