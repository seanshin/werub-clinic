// Created: 2026-06-08
// POST /api/clinic/his/attendance — HIS/외부 단말기에서 직원 출퇴근을 weRub에 기록(inbound).
// clinic_ API 키(권한 staff) 인증. 메타버스 근태(/cafes/[slug]/attendance)와 동일한
// attendance_logs/attendance_daily 에 기록해 데이터 일관성 유지.

import { NextRequest, NextResponse } from "next/server";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError, NotFoundError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { pool } from "@/lib/pg-pool";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    await rateLimit(request, "general");
    const ctx = await requireHisAuth(request, "staff");

    const body = (await request.json()) as {
      userId?: string;
      email?: string;
      action?: "checkin" | "checkout";
      at?: string; // 단말기 시각(ISO). 없으면 서버 현재 시각
      note?: string;
      source?: string;
    };

    if (body.action !== "checkin" && body.action !== "checkout") {
      throw new BadRequestError("action은 checkin 또는 checkout 이어야 합니다");
    }

    // 직원 식별: userId 우선, email 폴백
    let userId = body.userId?.trim();
    if (!userId && body.email) {
      const u = await prisma.user.findUnique({
        where: { email: body.email.toLowerCase().trim() }, select: { id: true },
      });
      userId = u?.id;
    }
    if (!userId) throw new BadRequestError("userId 또는 email이 필요합니다");

    // 키가 발급된 병원(ctx.cafeId) 소속 직원만 기록 가능
    const member = await prisma.cafeMember.findUnique({
      where: { cafeId_userId: { cafeId: ctx.cafeId, userId } }, select: { userId: true },
    });
    if (!member) throw new NotFoundError("해당 병원 소속 직원이 아닙니다");

    // 타임스탬프: 단말기 시각 허용(현재 ±36h 이내), 미지정 시 서버 현재
    let at = new Date();
    if (body.at) {
      const parsed = new Date(body.at);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestError("at 형식이 올바르지 않습니다");
      if (Math.abs(Date.now() - parsed.getTime()) > 36 * 3600 * 1000) {
        throw new BadRequestError("at은 현재 기준 ±36시간 이내여야 합니다");
      }
      at = parsed;
    }
    const atIso = at.toISOString();
    const date = atIso.split("T")[0];
    const source = body.source?.trim() || "his";
    const note = body.note?.trim() || null;

    if (body.action === "checkin") {
      await pool.query(
        `INSERT INTO attendance_logs (cafe_id, user_id, status_zone, action, recorded_at, date, note, source)
         VALUES ($1, $2, 'working', 'enter', $3, $4, $5, $6)`,
        [ctx.cafeId, userId, atIso, date, note, source],
      );
      await pool.query(
        `INSERT INTO attendance_daily (cafe_id, user_id, date, check_in_at, status)
         VALUES ($1, $2, $3, $4, 'checked_in')
         ON CONFLICT (cafe_id, user_id, date)
         DO UPDATE SET
           check_in_at = COALESCE(attendance_daily.check_in_at, $4),
           check_out_at = NULL,
           status = 'checked_in',
           updated_at = now()`,
        [ctx.cafeId, userId, date, atIso],
      );
    } else {
      await pool.query(
        `INSERT INTO attendance_logs (cafe_id, user_id, status_zone, action, recorded_at, date, note, source)
         VALUES ($1, $2, 'off_duty', 'enter', $3, $4, $5, $6)`,
        [ctx.cafeId, userId, atIso, date, note, source],
      );
      await pool.query(
        `INSERT INTO attendance_daily (cafe_id, user_id, date, check_out_at, status)
         VALUES ($1, $2, $3, $4, 'checked_out')
         ON CONFLICT (cafe_id, user_id, date)
         DO UPDATE SET
           check_out_at = $4,
           status = 'checked_out',
           work_minutes = EXTRACT(EPOCH FROM ($4::timestamptz - COALESCE(attendance_daily.check_in_at, $4::timestamptz))) / 60,
           updated_at = now()`,
        [ctx.cafeId, userId, date, atIso],
      );
    }

    const { rows } = await pool.query(
      `SELECT status, check_in_at, check_out_at, work_minutes
       FROM attendance_daily WHERE cafe_id = $1 AND user_id = $2 AND date = $3`,
      [ctx.cafeId, userId, date],
    );
    const r = rows[0] ?? {};
    return NextResponse.json({
      ok: true,
      userId,
      date,
      action: body.action,
      status: r.status ?? null,
      checkInAt: r.check_in_at ?? null,
      checkOutAt: r.check_out_at ?? null,
      workMinutes: r.work_minutes != null ? Math.round(Number(r.work_minutes)) : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
