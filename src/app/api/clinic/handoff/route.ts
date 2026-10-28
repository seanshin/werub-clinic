// Created: 2026-07-21
// Updated: 2026-08-19 — 인수자(to_user_id/to_name) 저장 + PATCH 수신 확인(acknowledged_by)
// 인수인계 보드 로컬 저장 API (HIS 미연동 환경에서도 특이사항 입력/저장).
//   POST /api/clinic/handoff            — 인수인계 저장
//   GET  /api/clinic/handoff?wardId=&limit=  — 이력 목록
//   GET  /api/clinic/handoff?id=        — 상세
// 병원/의원 카페로 스코핑(사용자의 clinic 카페 자동 해석). hospital-web가 /api/*를 메인앱으로 프록시.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError, BadRequestError, NotFoundError } from "@/lib/errors";

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
    if (!cafeId) return NextResponse.json({ ok: true, data: { handoffs: [] } });

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const rows = await prisma.$queryRaw<Array<{
        id: string; ward_id: string; shift: string; from_name: string | null;
        general_notes: string; patients: unknown; acknowledged_at: Date | null; created_at: Date;
        from_user_id: string | null; to_user_id: string | null; to_name: string | null; acknowledged_by: string | null;
      }>>`SELECT id, ward_id, shift, from_name, general_notes, patients, acknowledged_at, created_at,
                 from_user_id, to_user_id, to_name, acknowledged_by
          FROM handoff_records WHERE id = ${id} AND cafe_id = ${cafeId} LIMIT 1`;
      const r = rows[0];
      if (!r) throw new NotFoundError("인수인계 기록을 찾을 수 없습니다");
      return NextResponse.json({
        ok: true,
        data: {
          handoffId: r.id, wardName: r.ward_id, shift: r.shift,
          fromNurse: r.from_name ?? "", toNurse: r.to_name ?? "",
          fromUserId: r.from_user_id, toUserId: r.to_user_id, acknowledgedBy: r.acknowledged_by,
          submittedAt: r.created_at, acknowledgedAt: r.acknowledged_at,
          generalNotes: r.general_notes ?? "",
          patients: Array.isArray(r.patients) ? r.patients : [],
        },
      });
    }

    const wardId = url.searchParams.get("wardId");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
    const rows = wardId
      ? await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT id, ward_id, shift, from_name, patient_count, acknowledged_at, created_at, from_user_id, to_user_id, to_name, acknowledged_by
          FROM handoff_records WHERE cafe_id = ${cafeId} AND ward_id = ${wardId}
          ORDER BY created_at DESC LIMIT ${limit}`
      : await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT id, ward_id, shift, from_name, patient_count, acknowledged_at, created_at, from_user_id, to_user_id, to_name, acknowledged_by
          FROM handoff_records WHERE cafe_id = ${cafeId}
          ORDER BY created_at DESC LIMIT ${limit}`;

    const handoffs = rows.map((r) => ({
      handoffId: r.id, wardId: r.ward_id, shift: r.shift,
      fromNurse: (r.from_name as string) ?? "", toNurse: (r.to_name as string) ?? "",
      fromUserId: (r.from_user_id as string) ?? null, toUserId: (r.to_user_id as string) ?? null,
      acknowledgedBy: (r.acknowledged_by as string) ?? null,
      patientCount: Number(r.patient_count ?? 0),
      submittedAt: r.created_at, acknowledgedAt: r.acknowledged_at,
    }));
    return NextResponse.json({ ok: true, data: { handoffs } });
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
    const { wardId, shift, patients, generalNotes, toUserId, toName } = body ?? {};
    if (!wardId || !shift) throw new BadRequestError("wardId, shift가 필요합니다");

    const pts = Array.isArray(patients) ? patients : [];
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    // 인수자(선택): 같은 병원 카페 멤버만 허용 — 아니면 무시(2026-08-19)
    let toUid: string | null = null; let toNm: string | null = null;
    if (typeof toUserId === "string" && toUserId && toUserId !== userId) {
      const m = await prisma.cafeMember.findFirst({ where: { cafeId, userId: toUserId }, select: { user: { select: { username: true } } } });
      if (m) { toUid = toUserId; toNm = (typeof toName === "string" && toName) ? toName : m.user.username; }
    }

    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO handoff_records (cafe_id, ward_id, shift, from_user_id, from_name, general_notes, patients, patient_count, to_user_id, to_name)
      VALUES (${cafeId}, ${wardId}, ${shift}, ${userId}, ${user?.username ?? null},
              ${typeof generalNotes === "string" ? generalNotes : ""},
              ${JSON.stringify(pts)}::jsonb, ${pts.length}, ${toUid}, ${toNm})
      RETURNING id`;

    return NextResponse.json({ ok: true, data: { handoffId: rows[0].id } });
  } catch (error) {
    return handleError(error);
  }
}

/** 수신 확인 — 같은 병원 멤버가 인수인계를 확인(작성자 본인 제외). 인수자가 지정된 기록도 다른 근무자가 대신 확인할 수 있다(교대 현실). 멱등. (2026-08-19) */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const cafeId = await resolveClinicCafe(userId);
    if (!cafeId) throw new BadRequestError("병원/의원 카페를 찾을 수 없습니다");
    const body = await request.json().catch(() => ({}));
    const handoffId = typeof body?.handoffId === "string" ? body.handoffId : "";
    if (!handoffId) throw new BadRequestError("handoffId가 필요합니다");

    const rows = await prisma.$queryRaw<Array<{ id: string; from_user_id: string | null; acknowledged_at: Date | null }>>`
      SELECT id, from_user_id, acknowledged_at FROM handoff_records WHERE id = ${handoffId} AND cafe_id = ${cafeId} LIMIT 1`;
    const r = rows[0];
    if (!r) throw new NotFoundError("인수인계 기록을 찾을 수 없습니다");
    if (r.from_user_id === userId) throw new BadRequestError("작성자 본인은 수신 확인할 수 없습니다");
    if (r.acknowledged_at) return NextResponse.json({ ok: true, data: { handoffId, acknowledgedAt: r.acknowledged_at, already: true } });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const upd = await prisma.$queryRaw<Array<{ acknowledged_at: Date }>>`
      UPDATE handoff_records
         SET acknowledged_at = NOW(), acknowledged_by = ${userId},
             to_user_id = COALESCE(to_user_id, ${userId}), to_name = COALESCE(to_name, ${user?.username ?? null})
       WHERE id = ${handoffId} AND cafe_id = ${cafeId}
       RETURNING acknowledged_at`;
    return NextResponse.json({ ok: true, data: { handoffId, acknowledgedAt: upd[0]?.acknowledged_at ?? null } });
  } catch (error) {
    return handleError(error);
  }
}
