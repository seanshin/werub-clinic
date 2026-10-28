// Created: 2026-05-07
// POST /api/clinic/his/calendar/surgery — 수술 일정 → Clinic 캘린더 동기화
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const surgerySchema = z.object({
  surgeryId: z.string(),
  procedureName: z.string().min(1).max(200),
  procedureCode: z.string().optional(),
  scheduledAt: z.string(),
  estimatedDuration: z.number().int().positive().optional().default(60),
  surgeonId: z.string(),
  anesthetistId: z.string().optional(),
  operatingRoom: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "calendar");
    await rateLimit(request, "write");
    const body = await request.json();
    const data = surgerySchema.parse(body);

    const startTime = new Date(data.scheduledAt);
    const endTime = new Date(startTime.getTime() + data.estimatedDuration * 60 * 1000);
    const externalId = `his-surgery-${data.surgeryId}`;

    // UPSERT 캘린더 이벤트
    const _title = `🔪 ${data.procedureName}`;
    const _location = data.operatingRoom ?? null;
    const _metadata = JSON.stringify({ surgeryId: data.surgeryId, procedureCode: data.procedureCode, anesthetistId: data.anesthetistId, source: "his" });
    await prisma.$executeRaw`INSERT INTO calendar_events (id, cafe_id, title, start_at, end_at, all_day, location, event_type, external_id, metadata, created_by, created_at, updated_at)
       VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${_title}, ${startTime}, ${endTime}, false, ${_location}, 'surgery', ${externalId}, ${_metadata}::jsonb, ${data.surgeonId}, now(), now())
       ON CONFLICT (cafe_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         title=${_title}, start_at=${startTime}, end_at=${endTime}, location=${_location}, metadata=${_metadata}::jsonb, updated_at=now()`;

    return NextResponse.json({ ok: true, synced: true, externalId });
  } catch (err) { return handleError(err); }
}
