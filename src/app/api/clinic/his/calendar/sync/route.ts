// Created: 2026-06-08
// POST /api/clinic/his/calendar/sync — HIS 일정 → Clinic 캘린더 일괄 동기화(inbound).
// clinic_ 키(권한 calendar). external_id 기준 upsert + 참석자(assignees) 반영 + deleteIds 삭제.
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg-pool";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const eventSchema = z.object({
  externalId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  type: z.enum(["surgery", "appointment", "duty", "meeting", "other"]).optional().default("other"),
  startTime: z.string(),
  endTime: z.string().optional(),
  allDay: z.boolean().optional().default(false),
  assignees: z.array(z.string()).optional().default([]),
  location: z.string().max(200).optional(),
  color: z.string().max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const syncSchema = z.object({
  events: z.array(eventSchema).max(500).optional().default([]),
  deleteIds: z.array(z.string()).max(500).optional().default([]),
});

// HIS 유형 → calendar_events.event_type (other는 일반 event)
const TYPE_MAP: Record<string, string> = {
  surgery: "surgery", appointment: "appointment", duty: "duty", meeting: "meeting", other: "event",
};
const TYPE_COLOR: Record<string, string> = {
  surgery: "#ef4444", appointment: "#3b82f6", duty: "#8b5cf6", meeting: "#10b981", event: "#6366f1",
};

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "calendar");
    await rateLimit(request, "write");
    const data = syncSchema.parse(await request.json());

    // 시스템 폴백 생성자 = 키 발급자(유효 user)
    const keyRow = await pool.query<{ created_by: string }>(
      `SELECT created_by FROM his_api_keys WHERE id = $1`, [ctx.apiKeyId],
    );
    const systemCreator = keyRow.rows[0]?.created_by ?? null;

    // 카페 멤버 집합(assignee 검증용)
    const memberRows = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM cafe_members WHERE cafe_id = $1 AND status = 'ACTIVE'`, [ctx.cafeId],
    );
    const members = new Set(memberRows.rows.map(r => r.user_id));

    const errors: { externalId: string; error: string }[] = [];
    let synced = 0;

    for (const e of data.events) {
      try {
        const eventType = TYPE_MAP[e.type];
        const start = new Date(e.startTime);
        if (Number.isNaN(start.getTime())) { errors.push({ externalId: e.externalId, error: "startTime 형식 오류" }); continue; }
        const end = e.endTime ? new Date(e.endTime) : null;
        if (end && Number.isNaN(end.getTime())) { errors.push({ externalId: e.externalId, error: "endTime 형식 오류" }); continue; }

        const validAssignees = e.assignees.filter(u => members.has(u));
        const createdBy = validAssignees[0] ?? systemCreator;
        if (!createdBy) { errors.push({ externalId: e.externalId, error: "유효한 생성자 없음(assignee/키 발급자 부재)" }); continue; }

        const color = e.color ?? TYPE_COLOR[eventType] ?? "#6366f1";
        const meta = JSON.stringify({ ...(e.metadata ?? {}), source: "his" });

        const up = await pool.query<{ id: string }>(
          `INSERT INTO calendar_events
             (id, cafe_id, title, event_type, start_at, end_at, all_day, location, color, external_id, metadata, created_by, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11, now(), now())
           ON CONFLICT (cafe_id, external_id) WHERE external_id IS NOT NULL
           DO UPDATE SET title=$2, event_type=$3, start_at=$4, end_at=$5, all_day=$6,
             location=$7, color=$8, metadata=$10::jsonb, updated_at=now()
           RETURNING id`,
          [ctx.cafeId, e.title, eventType, start.toISOString(), end ? end.toISOString() : null,
            e.allDay, e.location ?? null, color, e.externalId, meta, createdBy],
        );
        const eventId = up.rows[0].id;

        // 참석자 반영 (추가형 — 빠진 사람 제거는 하지 않음)
        for (const u of validAssignees) {
          await pool.query(
            `INSERT INTO calendar_attendees (id, event_id, user_id, status)
             VALUES (gen_random_uuid()::text, $1, $2, 'accepted')
             ON CONFLICT (event_id, user_id) DO NOTHING`,
            [eventId, u],
          );
        }
        synced++;
      } catch (inner) {
        errors.push({ externalId: e.externalId, error: inner instanceof Error ? inner.message : "처리 실패" });
      }
    }

    // 삭제 (externalId 기준)
    let deleted = 0;
    if (data.deleteIds.length > 0) {
      const del = await pool.query(
        `DELETE FROM calendar_events WHERE cafe_id = $1 AND external_id = ANY($2)`,
        [ctx.cafeId, data.deleteIds],
      );
      deleted = del.rowCount ?? 0;
    }

    return NextResponse.json({ synced, deleted, errors });
  } catch (err) {
    return handleError(err);
  }
}
