// Created: 2026-06-08
// GET /api/clinic/his/calendar/events — Clinic 캘린더 일정 조회(inbound). clinic_ 키(권한 calendar).
// ?from=&to=(ISO date, 기본 이번 달) &type=(event_type 필터). 참석자 포함.
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg-pool";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

interface EventRow {
  id: string; external_id: string | null; title: string; event_type: string;
  start_at: Date; end_at: Date | null; all_day: boolean;
  location: string | null; color: string | null; metadata: unknown;
}

export async function GET(request: NextRequest) {
  try {
    await rateLimit(request, "general");
    const ctx = await requireHisAuth(request, "calendar");

    const url = new URL(request.url);
    const now = new Date();
    const from = url.searchParams.get("from") || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = url.searchParams.get("to") || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    const type = url.searchParams.get("type");

    const fromD = new Date(from), toD = new Date(to);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      return NextResponse.json({ error: "from/to 날짜 형식 오류" }, { status: 400 });
    }

    const params: unknown[] = [ctx.cafeId, fromD.toISOString(), toD.toISOString()];
    let where = `cafe_id = $1 AND start_at >= $2 AND start_at <= $3`;
    if (type) { params.push(type); where += ` AND event_type = $4`; }

    const events = await pool.query<EventRow>(
      `SELECT id, external_id, title, event_type, start_at, end_at, all_day, location, color, metadata
       FROM calendar_events WHERE ${where} ORDER BY start_at ASC LIMIT 1000`,
      params,
    );

    // 참석자 일괄 조회
    const ids = events.rows.map(e => e.id);
    const attMap: Record<string, { userId: string; username: string; status: string }[]> = {};
    if (ids.length > 0) {
      const atts = await pool.query<{ event_id: string; user_id: string; username: string; status: string }>(
        `SELECT a.event_id, a.user_id, u.username, a.status
         FROM calendar_attendees a JOIN users u ON u.id = a.user_id
         WHERE a.event_id = ANY($1)`,
        [ids],
      );
      for (const a of atts.rows) {
        (attMap[a.event_id] ??= []).push({ userId: a.user_id, username: a.username, status: a.status });
      }
    }

    return NextResponse.json({
      events: events.rows.map(e => ({
        id: e.id,
        externalId: e.external_id,
        title: e.title,
        type: e.event_type,
        startAt: e.start_at,
        endAt: e.end_at,
        allDay: e.all_day,
        location: e.location,
        color: e.color,
        metadata: e.metadata,
        assignees: attMap[e.id] ?? [],
      })),
      from: fromD.toISOString(),
      to: toD.toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
