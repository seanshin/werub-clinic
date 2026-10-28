// Created: 2026-05-07
// Updated: 2026-06-08 — leave_requests 실제 저장 + 정책/잔여 검증 + 안전 알림(COMMENT enum)
// POST /api/clinic/his/leave/request — HIS에서 직원 연차 신청(inbound). clinic_ 키(권한 leave).
// 내부 회사 휴가(/cafes/[slug]/leave POST)와 동일한 leave_* 테이블에 기록해 일관성 유지.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pool } from "@/lib/pg-pool";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError, NotFoundError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createNotification } from "@/lib/services/notification.service";
import { z } from "zod";

const leaveSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  policyType: z.enum(["annual", "sick", "special"]).optional().default("annual"),
  leaveType: z.enum(["full", "half"]).optional().default("full"),
  reason: z.string().max(500).optional(),
});

const DEFAULT_POLICIES = [
  { name: "연차", type: "annual", days: 15 },
  { name: "병가", type: "sick", days: 3 },
  { name: "경조사", type: "special", days: 5 },
];

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "leave");
    await rateLimit(request, "write");
    const data = leaveSchema.parse(await request.json());

    // 직원 식별 (userId 우선, email 폴백)
    let userId = data.userId?.trim();
    if (!userId && data.email) {
      const u = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase().trim() }, select: { id: true },
      });
      userId = u?.id;
    }
    if (!userId) throw new BadRequestError("userId 또는 email이 필요합니다");

    // 소속 병원 멤버 검증
    const member = await prisma.cafeMember.findUnique({
      where: { cafeId_userId: { cafeId: ctx.cafeId, userId } }, select: { userId: true },
    });
    if (!member) throw new NotFoundError("해당 병원 소속 직원이 아닙니다");

    // 정책 확보 (없으면 기본 생성)
    let policies = await pool.query<{ id: string; type: string; default_days: number }>(
      `SELECT id, type, default_days FROM leave_policies WHERE cafe_id = $1`, [ctx.cafeId],
    );
    if (policies.rows.length === 0) {
      for (const d of DEFAULT_POLICIES) {
        await pool.query(
          `INSERT INTO leave_policies (cafe_id, name, type, default_days) VALUES ($1,$2,$3,$4)
           ON CONFLICT (cafe_id, type) DO NOTHING`,
          [ctx.cafeId, d.name, d.type, d.days],
        );
      }
      policies = await pool.query(`SELECT id, type, default_days FROM leave_policies WHERE cafe_id = $1`, [ctx.cafeId]);
    }
    const policy = policies.rows.find(p => p.type === data.policyType);
    if (!policy) throw new BadRequestError(`휴가 정책(${data.policyType})을 찾을 수 없습니다`);

    // 일수 계산 (반차 = 0.5, 그 외 날짜 차이 + 1)
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (end < start) throw new BadRequestError("종료일이 시작일보다 빠를 수 없습니다");
    const days = data.leaveType === "half"
      ? 0.5
      : Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days <= 0 || days > 30) throw new BadRequestError("신청 일수가 올바르지 않습니다");

    // 잔여 확보 (없으면 기본 생성) + 검증
    const year = start.getFullYear();
    let bal = await pool.query<{ total_days: number; used_days: number; carried_days: number }>(
      `SELECT total_days, used_days, carried_days FROM leave_balances
       WHERE cafe_id=$1 AND user_id=$2 AND policy_id=$3 AND year=$4`,
      [ctx.cafeId, userId, policy.id, year],
    );
    if (bal.rows.length === 0) {
      await pool.query(
        `INSERT INTO leave_balances (cafe_id, user_id, policy_id, year, total_days)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cafe_id, user_id, policy_id, year) DO NOTHING`,
        [ctx.cafeId, userId, policy.id, year, policy.default_days],
      );
      bal = await pool.query(
        `SELECT total_days, used_days, carried_days FROM leave_balances
         WHERE cafe_id=$1 AND user_id=$2 AND policy_id=$3 AND year=$4`,
        [ctx.cafeId, userId, policy.id, year],
      );
    }
    const b = bal.rows[0];
    const remaining = Number(b.total_days) - Number(b.used_days) + Number(b.carried_days);
    if (days > remaining) throw new BadRequestError(`잔여 휴가가 부족합니다 (잔여 ${remaining}일)`);

    // 신청 기록
    const reasonVal = data.reason?.trim() || "개인 사유";
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO leave_requests (cafe_id, user_id, policy_id, start_date, end_date, days, leave_type, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [ctx.cafeId, userId, policy.id, data.startDate, data.endDate, days, data.leaveType, reasonVal,
        JSON.stringify({ source: "his" })],
    );
    const requestId = ins.rows[0].id;

    // 관리자 알림 (안전한 enum 타입 COMMENT — 내부 휴가 라우트와 동일)
    const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const managers = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM cafe_members WHERE cafe_id=$1 AND role IN ('OWNER','MANAGER') AND status='ACTIVE'`,
      [ctx.cafeId],
    );
    for (const m of managers.rows) {
      createNotification({
        userId: m.user_id,
        type: "COMMENT",
        title: "🏖️ 연차 신청 (HIS)",
        message: `${userRow?.username ?? "직원"}님이 ${data.startDate}~${data.endDate} (${days}일) 휴가를 신청했습니다`,
        linkUrl: `/cafes/${ctx.cafeId}/attendance?tab=leave`,
        actorId: userId,
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      requestId,
      status: "pending",
      days,
      remaining: remaining - days,
      approvers: managers.rows.map(m => m.user_id),
    });
  } catch (err) {
    return handleError(err);
  }
}
