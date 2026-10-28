// Created: 2026-07-23
// 당직 교대 요청 로컬 영속화 — HIS 미연동 시 조용한 유실 방지 (handoff 패턴)
//   GET  /api/clinic/duty-swap  — 최근 요청 목록 (본인 것 우선 30건)
//   POST /api/clinic/duty-swap  — { dutyDate, dutyType, targetName, reason } 저장
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
    if (!cafeId) return NextResponse.json({ ok: true, data: { requests: [] } });
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, requester_id, requester_name, duty_date, duty_type, target_name, reason, status, created_at
      FROM duty_swap_requests WHERE cafe_id = ${cafeId}
      ORDER BY (requester_id = ${userId}) DESC, created_at DESC LIMIT 30`;
    return NextResponse.json({ ok: true, data: { requests: rows } });
  } catch (err) { return handleError(err); }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) throw new BadRequestError("병원 카페 소속이 아닙니다");
    const { dutyDate, dutyType, targetName, reason } = await request.json() as Record<string, string | undefined>;
    if (!dutyDate || !reason?.trim()) throw new BadRequestError("dutyDate와 reason이 필요합니다");
    const requester = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO duty_swap_requests (cafe_id, requester_id, requester_name, duty_date, duty_type, target_name, reason)
      VALUES (${cafeId}, ${userId}, ${requester?.username ?? ""}, ${dutyDate}, ${dutyType ?? null}, ${targetName ?? null}, ${reason.trim()})
      RETURNING id`;
    return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
  } catch (err) { return handleError(err); }
}
