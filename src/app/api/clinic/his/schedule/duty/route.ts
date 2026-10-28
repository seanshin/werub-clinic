// Created: 2026-06-08
// GET/PUT /api/clinic/his/schedule/duty — 병원 당직/교대 근무표. clinic_ 키(권한 calendar).
// 전용 테이블 없이 calendar_events(event_type='duty', external_id='duty-{date}-{shift}')로 관리.
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg-pool";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const SHIFT_TIME: Record<string, string> = {
  day: "07:00-15:00", evening: "15:00-23:00", night: "23:00-07:00", duty: "종일",
};
const SHIFT_HOURS: Record<string, [number, number]> = {
  day: [7, 15], evening: [15, 23], night: [23, 31], duty: [0, 24], // night end = 익일 07시
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 날짜 연산은 정오 UTC 기준으로 수행해 타임존 경계(자정) 오프바이원을 피한다.
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}
function dowOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0=일 ~ 6=토
}
function todayKST(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().split("T")[0];
}

// 해당 주의 월요일 (weekOf 미지정 시 이번 주, KST 기준)
function mondayOf(dateStr: string | null): string {
  const ds = dateStr || todayKST();
  return addDays(ds, -((dowOf(ds) + 6) % 7));
}

// ── GET: 주간 당직표 ──
export async function GET(request: NextRequest) {
  try {
    await rateLimit(request, "general");
    const ctx = await requireHisAuth(request, "calendar");
    const url = new URL(request.url);
    const weekOf = mondayOf(url.searchParams.get("weekOf"));
    const department = url.searchParams.get("department");

    // 주 범위 [weekOf, weekOf+7)
    const weekEnd = addDays(weekOf, 7); // [weekOf, weekEnd)

    const events = await pool.query<{ id: string; metadata: { shift?: string; date?: string } }>(
      `SELECT id, metadata FROM calendar_events
       WHERE cafe_id = $1 AND event_type = 'duty'
         AND (metadata->>'date') >= $2 AND (metadata->>'date') < $3`,
      [ctx.cafeId, weekOf, weekEnd],
    );

    // 참석자 + HIS 역할/부서
    const ids = events.rows.map(e => e.id);
    const staffByEvent: Record<string, { userId: string; username: string; hisRole: string | null; department: string | null }[]> = {};
    if (ids.length > 0) {
      const rows = await pool.query<{ event_id: string; user_id: string; username: string; his_role: string | null; department: string | null }>(
        `SELECT a.event_id, a.user_id, u.username, rm.his_role, rm.department
         FROM calendar_attendees a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN his_role_mappings rm ON rm.cafe_id = $1 AND rm.user_id = a.user_id
         WHERE a.event_id = ANY($2)`,
        [ctx.cafeId, ids],
      );
      for (const r of rows.rows) {
        if (department && r.department !== department) continue;
        (staffByEvent[r.event_id] ??= []).push({
          userId: r.user_id, username: r.username, hisRole: r.his_role, department: r.department,
        });
      }
    }

    // date → shift → staff 구성
    const byDate: Record<string, Record<string, typeof staffByEvent[string]>> = {};
    for (const e of events.rows) {
      const d = e.metadata?.date, s = e.metadata?.shift;
      if (!d || !s) continue;
      const staff = staffByEvent[e.id] ?? [];
      if (department && staff.length === 0) continue; // 부서 필터 시 빈 shift 제외
      ((byDate[d] ??= {})[s] = staff);
    }

    const schedule = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekOf, i);
      const shiftsForDate = byDate[date] ?? {};
      const shifts = Object.keys(shiftsForDate).map(shift => ({
        shift, time: SHIFT_TIME[shift] ?? "", staff: shiftsForDate[shift],
      }));
      schedule.push({ date, dayOfWeek: DOW[dowOf(date)], shifts });
    }

    return NextResponse.json({ weekOf, schedule });
  } catch (err) {
    return handleError(err);
  }
}

// ── PUT: 특정 date+shift 당직 배정(교체) ──
const putSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(["day", "evening", "night", "duty"]),
  staff: z.array(z.object({ userId: z.string(), department: z.string().optional() })).max(50),
  reason: z.string().max(300).optional(),
});

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "calendar");
    await rateLimit(request, "write");
    const data = putSchema.parse(await request.json());

    // 멤버 검증
    const memberRows = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM cafe_members WHERE cafe_id = $1 AND status = 'ACTIVE'`, [ctx.cafeId],
    );
    const members = new Set(memberRows.rows.map(r => r.user_id));
    const validStaff = data.staff.filter(s => members.has(s.userId));
    if (data.staff.length > 0 && validStaff.length === 0) {
      throw new BadRequestError("유효한 병원 소속 직원이 없습니다");
    }

    // 시스템 생성자 = 키 발급자
    const keyRow = await pool.query<{ created_by: string }>(
      `SELECT created_by FROM his_api_keys WHERE id = $1`, [ctx.apiKeyId],
    );
    const createdBy = keyRow.rows[0]?.created_by;
    if (!createdBy) throw new BadRequestError("생성자(키 발급자)를 찾을 수 없습니다");

    // 시각 계산 (KST)
    const [sH, eH] = SHIFT_HOURS[data.shift];
    const base = new Date(`${data.date}T00:00:00+09:00`).getTime();
    const startAt = new Date(base + sH * 3600000).toISOString();
    const endAt = new Date(base + eH * 3600000).toISOString();
    const allDay = data.shift === "duty";
    const externalId = `duty-${data.date}-${data.shift}`;
    const title = `🩺 당직(${data.shift})`;
    const meta = JSON.stringify({ shift: data.shift, time: SHIFT_TIME[data.shift], date: data.date, reason: data.reason ?? null, source: "his" });

    const up = await pool.query<{ id: string }>(
      `INSERT INTO calendar_events
         (id, cafe_id, title, event_type, start_at, end_at, all_day, color, external_id, metadata, created_by, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1,$2,'duty',$3,$4,$5,'#8b5cf6',$6,$7::jsonb,$8, now(), now())
       ON CONFLICT (cafe_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET title=$2, start_at=$3, end_at=$4, all_day=$5, metadata=$7::jsonb, updated_at=now()
       RETURNING id`,
      [ctx.cafeId, title, startAt, endAt, allDay, externalId, meta, createdBy],
    );
    const eventId = up.rows[0].id;

    // 참석자 교체 (기존 제거 후 재배정)
    await pool.query(`DELETE FROM calendar_attendees WHERE event_id = $1`, [eventId]);
    for (const s of validStaff) {
      await pool.query(
        `INSERT INTO calendar_attendees (id, event_id, user_id, status)
         VALUES (gen_random_uuid()::text, $1, $2, 'accepted')
         ON CONFLICT (event_id, user_id) DO NOTHING`,
        [eventId, s.userId],
      );
    }

    return NextResponse.json({ ok: true, date: data.date, shift: data.shift, staffCount: validStaff.length });
  } catch (err) {
    return handleError(err);
  }
}
