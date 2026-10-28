// Created: 2026-05-07
// GET /api/clinic/his/organization/department/[deptId] — 부서 상세
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ deptId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const { deptId } = await params;
    // deptId는 "dept-내과" 형식이거나 실제 부서명
    const deptName = deptId.startsWith("dept-") ? decodeURIComponent(deptId.slice(5)) : decodeURIComponent(deptId);

    const members = await prisma.$queryRaw<Array<{
      user_id: string; username: string; email: string; profile_image: string | null;
      his_role: string; license_number: string | null; position: string | null;
      phone: string | null;
    }>>`SELECT rm.user_id, u.username, u.email, u.profile_image,
              rm.his_role, rm.license_number, rm.metadata->>'position' as position,
              rm.metadata->>'phone' as phone
       FROM his_role_mappings rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.cafe_id = ${ctx.cafeId} AND rm.department = ${deptName}
       ORDER BY
         CASE rm.metadata->>'position' WHEN '과장' THEN 1 WHEN '부장' THEN 2 WHEN '팀장' THEN 3 WHEN '수간호사' THEN 4 ELSE 5 END,
         u.username`;

    if (members.length === 0) throw new NotFoundError("부서를 찾을 수 없습니다");

    const head = members.find(m => m.position === "과장" || m.position === "부장" || m.position === "팀장");

    return NextResponse.json({
      id: `dept-${deptName}`,
      name: deptName,
      head: head ? { userId: head.user_id, username: head.username, hisRole: head.his_role, position: head.position, licenseNumber: head.license_number, phone: head.phone } : null,
      members: members.map(m => ({
        userId: m.user_id, username: m.username, email: m.email, profileImage: m.profile_image,
        hisRole: m.his_role, position: m.position ?? m.his_role, licenseNumber: m.license_number, phone: m.phone,
      })),
      memberCount: members.length,
    });
  } catch (err) { return handleError(err); }
}
