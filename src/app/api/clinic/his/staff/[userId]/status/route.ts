// Created: 2026-05-06
// GET /api/clinic/his/staff/[userId]/status — 직원 근무 상태 조회
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const { userId } = await params;

    // 근태 상태 조회
    const today = new Date().toISOString().slice(0, 10);
    const rows = await prisma.$queryRaw<Array<{
      status: string; check_in_at: string | null; check_out_at: string | null;
    }>>`SELECT status, check_in_at, check_out_at FROM attendance_daily
       WHERE cafe_id = ${ctx.cafeId} AND user_id = ${userId} AND date = ${today}
       LIMIT 1`.catch(() => [] as Array<{ status: string; check_in_at: string | null; check_out_at: string | null }>);

    const attendance = rows[0];

    return NextResponse.json({
      userId,
      workStatus: attendance?.status ?? "none",
      checkInAt: attendance?.check_in_at ?? null,
      checkOutAt: attendance?.check_out_at ?? null,
      date: today,
    });
  } catch (err) { return handleError(err); }
}
