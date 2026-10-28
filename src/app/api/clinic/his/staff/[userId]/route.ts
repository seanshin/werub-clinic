// Created: 2026-05-06
// GET /api/clinic/his/staff/[userId] — 직원 상세
// PATCH /api/clinic/his/staff/[userId] — 직원 HIS 정보 수정
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const { userId } = await params;

    const rows = await prisma.$queryRaw<Array<{
      user_id: string; username: string; email: string; profile_image: string | null;
      clinic_role: string; his_role: string | null; department: string | null;
      license_number: string | null; specialties: string[] | null;
      metadata: Record<string, unknown> | null; joined_at: Date;
    }>>`SELECT cm.user_id, u.username, u.email, u.profile_image,
              cm.role as clinic_role,
              rm.his_role, rm.department, rm.license_number, rm.specialties, rm.metadata,
              cm.joined_at
       FROM cafe_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN his_role_mappings rm ON rm.cafe_id = cm.cafe_id AND rm.user_id = cm.user_id
       WHERE cm.cafe_id = ${ctx.cafeId} AND cm.user_id = ${userId}`;

    if (rows.length === 0) throw new NotFoundError("직원을 찾을 수 없습니다");
    const s = rows[0];

    return NextResponse.json({
      id: s.user_id,
      username: s.username,
      email: s.email,
      profileImage: s.profile_image,
      clinicRole: s.clinic_role,
      hisRole: s.his_role ?? "Staff",
      department: s.department,
      licenseNumber: s.license_number,
      specialties: s.specialties ?? [],
      metadata: s.metadata ?? {},
      joinedAt: s.joined_at,
    });
  } catch (err) { return handleError(err); }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const { userId } = await params;
    const body = await request.json();

    // 병원 멤버 확인
    const members = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${ctx.cafeId} AND user_id = ${userId}`;
    if (members.length === 0) throw new NotFoundError("직원을 찾을 수 없습니다");

    const { hisRole, department, licenseNumber, specialties, metadata } = body;

    // UPSERT role mapping
    const _hisRole = hisRole ?? "Staff";
    const _department = department ?? null;
    const _licenseNumber = licenseNumber ?? null;
    const _specialties = specialties ?? [];
    const _metadata = JSON.stringify(metadata ?? {});
    await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, license_number, specialties, metadata, updated_at)
       VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${userId}, ${_hisRole}, ${_department}, ${_licenseNumber}, ${_specialties}, ${_metadata}, now())
       ON CONFLICT (cafe_id, user_id) DO UPDATE SET
         his_role = COALESCE(${_hisRole}, his_role_mappings.his_role),
         department = COALESCE(${_department}, his_role_mappings.department),
         license_number = COALESCE(${_licenseNumber}, his_role_mappings.license_number),
         specialties = COALESCE(${_specialties}, his_role_mappings.specialties),
         metadata = his_role_mappings.metadata || COALESCE(${_metadata}, '{}'::jsonb),
         updated_at = now()`;

    return NextResponse.json({ ok: true, message: "직원 정보가 수정되었습니다" });
  } catch (err) { return handleError(err); }
}
