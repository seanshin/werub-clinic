// Created: 2026-06-08
// GET /api/clinic/his/leave — 병원 직원 연차 현황 조회(inbound). clinic_ 키(권한 leave).
// ?userId=&year= — userId 지정 시 해당 직원(잔여 없으면 기본 생성 후 반환), 미지정 시 잔여 보유 직원 전체.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pool } from "@/lib/pg-pool";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, NotFoundError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

const DEFAULT_POLICIES = [
  { name: "연차", type: "annual", days: 15 },
  { name: "병가", type: "sick", days: 3 },
  { name: "경조사", type: "special", days: 5 },
];

export async function GET(request: NextRequest) {
  try {
    await rateLimit(request, "general");
    const ctx = await requireHisAuth(request, "leave");

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId")?.trim() || null;
    const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

    // 특정 직원 조회 시: 멤버 검증 + 정책/잔여 기본 생성(없을 때)
    if (userId) {
      const member = await prisma.cafeMember.findUnique({
        where: { cafeId_userId: { cafeId: ctx.cafeId, userId } }, select: { userId: true },
      });
      if (!member) throw new NotFoundError("해당 병원 소속 직원이 아닙니다");

      let policies = await pool.query<{ id: string; default_days: number }>(
        `SELECT id, default_days FROM leave_policies WHERE cafe_id=$1`, [ctx.cafeId],
      );
      if (policies.rows.length === 0) {
        for (const d of DEFAULT_POLICIES) {
          await pool.query(
            `INSERT INTO leave_policies (cafe_id, name, type, default_days) VALUES ($1,$2,$3,$4)
             ON CONFLICT (cafe_id, type) DO NOTHING`,
            [ctx.cafeId, d.name, d.type, d.days],
          );
        }
        policies = await pool.query(`SELECT id, default_days FROM leave_policies WHERE cafe_id=$1`, [ctx.cafeId]);
      }
      for (const p of policies.rows) {
        await pool.query(
          `INSERT INTO leave_balances (cafe_id, user_id, policy_id, year, total_days)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cafe_id, user_id, policy_id, year) DO NOTHING`,
          [ctx.cafeId, userId, p.id, year, p.default_days],
        );
      }
    }

    // 집계 (정책 합산)
    const balParams: unknown[] = [ctx.cafeId, year];
    let balWhere = `lb.cafe_id=$1 AND lb.year=$2`;
    if (userId) { balParams.push(userId); balWhere += ` AND lb.user_id=$3`; }

    const balances = await pool.query<{
      user_id: string; username: string; total: number; used: number; carried: number;
    }>(
      `SELECT lb.user_id, u.username,
              SUM(lb.total_days) AS total, SUM(lb.used_days) AS used, SUM(lb.carried_days) AS carried
       FROM leave_balances lb JOIN users u ON u.id = lb.user_id
       WHERE ${balWhere}
       GROUP BY lb.user_id, u.username
       ORDER BY u.username`,
      balParams,
    );

    // 대기 중 신청 수
    const pendParams: unknown[] = [ctx.cafeId];
    let pendWhere = `cafe_id=$1 AND status='pending'`;
    if (userId) { pendParams.push(userId); pendWhere += ` AND user_id=$2`; }
    const pending = await pool.query<{ user_id: string; cnt: string }>(
      `SELECT user_id, COUNT(*)::text AS cnt FROM leave_requests WHERE ${pendWhere} GROUP BY user_id`,
      pendParams,
    );
    const pendMap = Object.fromEntries(pending.rows.map(r => [r.user_id, Number(r.cnt)]));

    const staff = balances.rows.map(r => {
      const total = Number(r.total), used = Number(r.used), carried = Number(r.carried);
      return {
        userId: r.user_id,
        username: r.username,
        totalDays: total,
        usedDays: used,
        remainingDays: total - used + carried,
        pendingRequests: pendMap[r.user_id] ?? 0,
      };
    });

    return NextResponse.json({ staff, year });
  } catch (err) {
    return handleError(err);
  }
}
