// Created: 2026-07-22
// 투약 완료 기록 로컬 저장 (HIS 미연동/재진입·15초 자동갱신에도 완료 유지).
//   GET  /api/clinic/medication  — 오늘 완료된 med_id 목록
//   POST /api/clinic/medication  — 투약 완료 기록 저장
// 병원/의원 카페로 스코핑. hospital-web가 /api/*를 메인앱으로 프록시.
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
    if (!cafeId) return NextResponse.json({ administered: [] });
    const rows = await prisma.$queryRaw<{ med_id: string }[]>`
      SELECT med_id FROM medication_admins WHERE cafe_id = ${cafeId} AND admin_date = CURRENT_DATE`;
    return NextResponse.json({ administered: rows.map((r) => r.med_id) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) throw new BadRequestError("병원/의원 카페를 찾을 수 없습니다");

    const body = await request.json();
    const { medId, patientId, medication, scheduledAt, notes } = body ?? {};
    if (!medId || typeof medId !== "string") throw new BadRequestError("medId가 필요합니다");

    await prisma.$executeRaw`
      INSERT INTO medication_admins (cafe_id, med_id, patient_id, medication, scheduled_at, administered_by, notes)
      VALUES (${cafeId}, ${medId}, ${patientId ?? null}, ${medication ?? null},
              ${scheduledAt ? new Date(scheduledAt) : null}, ${userId}, ${typeof notes === "string" ? notes : "투약 완료"})
      ON CONFLICT (cafe_id, med_id, admin_date)
      DO UPDATE SET administered_by = EXCLUDED.administered_by, administered_at = now(), notes = EXCLUDED.notes`;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
