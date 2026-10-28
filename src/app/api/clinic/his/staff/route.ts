// Created: 2026-05-06
// GET /api/clinic/his/staff — 병원 직원 목록 (HIS → Clinic)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");

    const staff = await prisma.$queryRaw<Array<{
      user_id: string; username: string; email: string; profile_image: string | null;
      clinic_role: string; member_status: string; his_role: string | null; department: string | null;
      license_number: string | null; specialties: string[] | null;
      employee_number: string | null; his_status: string | null;
      joined_at: Date;
    }>>`SELECT cm.user_id, u.username, u.email, u.profile_image,
              cm.role as clinic_role, cm.status::text as member_status,
              rm.his_role, rm.department, rm.license_number, rm.specialties,
              rm.metadata->>'employeeNumber' as employee_number,
              COALESCE(rm.metadata->>'status', 'active') as his_status,
              cm.joined_at
       FROM cafe_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN his_role_mappings rm ON rm.cafe_id = cm.cafe_id AND rm.user_id = cm.user_id
       WHERE cm.cafe_id = ${ctx.cafeId}
       ORDER BY
         CASE cm.role WHEN 'OWNER' THEN 1 WHEN 'MANAGER' THEN 2 ELSE 3 END,
         u.username`;

    return NextResponse.json({
      staff: staff.map(s => ({
        id: s.user_id, // = clinicUserId (상신 approvers/drafter·콜백 approvedBy와 동일 식별자)
        employeeNumber: s.employee_number, // HIS 사번 — clinicUserId 매핑 재대조용
        username: s.username,
        email: s.email,
        profileImage: s.profile_image,
        clinicRole: s.clinic_role,
        memberStatus: s.member_status, // ACTIVE | BANNED(퇴사 비활성)
        status: s.his_status,          // active | on_leave | resigned (HIS 재직상태)
        hisRole: s.his_role ?? "Staff",
        department: s.department,
        licenseNumber: s.license_number,
        specialties: s.specialties ?? [],
        joinedAt: s.joined_at,
      })),
      total: staff.length,
    });
  } catch (err) { return handleError(err); }
}
