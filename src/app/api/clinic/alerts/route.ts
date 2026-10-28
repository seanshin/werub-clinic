// Created: 2026-07-23
// 긴급 알림 확인 상태 로컬 영속화 — 5초 폴링 원복 방지 (handoff 패턴)
//   GET  /api/clinic/alerts  — 확인 상태 목록 (최근 24h)
//   POST /api/clinic/alerts  — { alertId, status } upsert (acknowledged/responding/resolved)
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
    if (!cafeId) return NextResponse.json({ ok: true, data: { acks: [] } });
    const rows = await prisma.$queryRaw<Array<{ alert_id: string; status: string; acked_at: Date }>>`
      SELECT alert_id, status, acked_at FROM alert_acks
      WHERE cafe_id = ${cafeId} AND acked_at >= now() - interval '24 hours'`;
    return NextResponse.json({ ok: true, data: { acks: rows.map(r => ({ alertId: r.alert_id, status: r.status, ackedAt: r.acked_at })) } });
  } catch (err) { return handleError(err); }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) throw new BadRequestError("병원 카페 소속이 아닙니다");
    const { alertId, status } = await request.json() as { alertId?: string; status?: string };
    if (!alertId || !status || !["acknowledged", "responding", "resolved"].includes(status)) {
      throw new BadRequestError("alertId와 status(acknowledged/responding/resolved)가 필요합니다");
    }
    await prisma.$executeRaw`
      INSERT INTO alert_acks (cafe_id, alert_id, status, acked_by, acked_at)
      VALUES (${cafeId}, ${alertId}, ${status}, ${userId}, now())
      ON CONFLICT (cafe_id, alert_id) DO UPDATE SET status = ${status}, acked_by = ${userId}, acked_at = now()`;
    return NextResponse.json({ ok: true });
  } catch (err) { return handleError(err); }
}
