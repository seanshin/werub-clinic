// Created: 2026-05-07
// GET /api/clinic/his/organization — 조직도 전체 트리
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");

    // 역할 매핑에서 부서별 그룹핑
    const rows = await prisma.$queryRaw<Array<{
      user_id: string; username: string; profile_image: string | null;
      his_role: string; department: string | null; license_number: string | null;
      position: string | null; clinic_role: string;
    }>>`SELECT rm.user_id, u.username, u.profile_image,
              rm.his_role, rm.department, rm.license_number,
              rm.metadata->>'position' as position,
              cm.role as clinic_role
       FROM his_role_mappings rm
       JOIN users u ON u.id = rm.user_id
       JOIN cafe_members cm ON cm.cafe_id = rm.cafe_id AND cm.user_id = rm.user_id
       WHERE rm.cafe_id = ${ctx.cafeId}
       ORDER BY rm.department, rm.his_role, u.username`;

    // 부서별 그룹핑
    const deptMap = new Map<string, typeof rows>();
    for (const r of rows) {
      const dept = r.department ?? "미배정";
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(r);
    }

    const departments = Array.from(deptMap.entries()).map(([name, members]) => {
      const head = members.find(m => m.position === "과장" || m.position === "부장" || m.position === "팀장" || m.clinic_role === "OWNER");
      return {
        id: `dept-${name}`,
        name,
        parentId: null,
        head: head ? { userId: head.user_id, username: head.username, hisRole: head.his_role, position: head.position ?? head.clinic_role } : null,
        children: [],
        members: members.filter(m => m !== head).map(m => ({
          userId: m.user_id, username: m.username, hisRole: m.his_role, position: m.position ?? m.his_role,
        })),
      };
    });

    return NextResponse.json({ departments, total: departments.length });
  } catch (err) { return handleError(err); }
}
