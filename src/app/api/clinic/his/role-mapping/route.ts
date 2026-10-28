// Created: 2026-05-06
// GET/PUT /api/clinic/his/role-mapping — HIS 역할 매핑 관리
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";

// GET — 역할 매핑 목록
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");

    const mappings = await prisma.$queryRaw<Array<{
      user_id: string; username: string; email: string;
      clinic_role: string; his_role: string; department: string | null;
      license_number: string | null; specialties: string[];
    }>>`SELECT rm.user_id, u.username, u.email, cm.role as clinic_role,
              rm.his_role, rm.department, rm.license_number, rm.specialties
       FROM his_role_mappings rm
       JOIN users u ON u.id = rm.user_id
       JOIN cafe_members cm ON cm.cafe_id = rm.cafe_id AND cm.user_id = rm.user_id
       WHERE rm.cafe_id = ${ctx.cafeId}
       ORDER BY rm.his_role, u.username`;

    return NextResponse.json({ mappings });
  } catch (err) { return handleError(err); }
}

// PUT — 역할 매핑 생성/수정
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const body = await request.json();
    const { userId, hisRole, department, licenseNumber, specialties, metadata } = body;

    if (!userId) throw new BadRequestError("userId가 필요합니다");
    if (!hisRole) throw new BadRequestError("hisRole이 필요합니다");

    const validRoles = ["Admin", "Doctor", "Nurse", "Pharmacist", "LabTech", "Staff"];
    if (!validRoles.includes(hisRole)) throw new BadRequestError(`유효한 역할: ${validRoles.join(", ")}`);

    // 해당 병원 멤버인지 확인
    const members = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${ctx.cafeId} AND user_id = ${userId}`;
    if (members.length === 0) throw new BadRequestError("해당 병원 소속 멤버가 아닙니다");

    // UPSERT
    await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, license_number, specialties, metadata, updated_at)
       VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${userId}, ${hisRole}, ${department ?? null}, ${licenseNumber ?? null}, ${specialties ?? []}, ${JSON.stringify(metadata ?? {})}, now())
       ON CONFLICT (cafe_id, user_id) DO UPDATE SET
         his_role = ${hisRole}, department = ${department ?? null}, license_number = ${licenseNumber ?? null}, specialties = ${specialties ?? []},
         metadata = COALESCE(${JSON.stringify(metadata ?? {})}, his_role_mappings.metadata), updated_at = now()`;

    return NextResponse.json({
      ok: true,
      message: `역할 매핑 저장 완료: ${hisRole}`,
    });
  } catch (err) { return handleError(err); }
}
