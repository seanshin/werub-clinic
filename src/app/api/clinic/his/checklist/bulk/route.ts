// Created: 2026-05-07
// POST /api/clinic/his/checklist/bulk — 전체 직원 일괄 Push
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "checklist");
    const body = await request.json();
    const { date, staff } = body;
    if (!staff || !Array.isArray(staff)) throw new BadRequestError("staff 배열이 필요합니다");
    const d = date ?? new Date().toISOString().slice(0, 10);

    let processed = 0;
    for (const s of staff) {
      if (!s.userId || !s.items || !Array.isArray(s.items)) continue;
      for (const item of s.items) {
        const _title = item.title;
        const _category = item.category ?? "clinical";
        const _hisRole = item.hisRole ?? "ALL";
        const _priority = item.priority ?? "optional";
        const _status = item.status ?? "info";
        const _summary = item.summary ?? null;
        const _count = item.count ?? 0;
        const _link = item.link ?? null;
        const _details = JSON.stringify(item.details ?? []);
        await prisma.$executeRaw`INSERT INTO his_checklist_data (id, cafe_id, user_id, date, key, title, category, his_role, priority, status, summary, count, link, details, updated_at)
           VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${s.userId}, ${d}, ${item.key}, ${_title}, ${_category}, ${_hisRole}, ${_priority}, ${_status}, ${_summary}, ${_count}, ${_link}, ${_details}, now())
           ON CONFLICT (cafe_id, user_id, date, key) DO UPDATE SET
             title=${_title}, category=${_category}, his_role=${_hisRole}, priority=${_priority}, status=${_status}, summary=${_summary}, count=${_count}, link=${_link}, details=${_details}, updated_at=now()`;
      }
      processed++;
    }

    return NextResponse.json({ ok: true, processed, date: d });
  } catch (err) { return handleError(err); }
}
