// Created: 2026-05-06
// GET /api/clinic/his/staff/online — 현재 출근 중인 직원 목록
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");

    const today = new Date().toISOString().slice(0, 10);
    const rows = await prisma.$queryRaw<Array<{
      user_id: string; username: string; profile_image: string | null;
      status: string; check_in_at: string | null;
      his_role: string | null; department: string | null;
    }>>`SELECT ad.user_id, u.username, u.profile_image,
              ad.status, ad.check_in_at,
              rm.his_role, rm.department
       FROM attendance_daily ad
       JOIN users u ON u.id = ad.user_id
       LEFT JOIN his_role_mappings rm ON rm.cafe_id = ad.cafe_id AND rm.user_id = ad.user_id
       WHERE ad.cafe_id = ${ctx.cafeId} AND ad.date = ${today} AND ad.status = 'checked_in'
       ORDER BY ad.check_in_at`.catch(() => [] as Array<{
      user_id: string; username: string; profile_image: string | null;
      status: string; check_in_at: string | null;
      his_role: string | null; department: string | null;
    }>);

    return NextResponse.json({
      online: rows.map(r => ({
        id: r.user_id,
        username: r.username,
        profileImage: r.profile_image,
        hisRole: r.his_role ?? "Staff",
        department: r.department,
        checkInAt: r.check_in_at,
      })),
      count: rows.length,
    });
  } catch (err) { return handleError(err); }
}
