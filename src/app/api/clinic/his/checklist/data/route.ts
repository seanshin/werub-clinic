// Created: 2026-05-07
// POST /api/clinic/his/checklist/data — HIS 체크리스트 데이터 Push
// GET  /api/clinic/his/checklist/data — 체크리스트 데이터 Pull
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";

// POST — HIS → Clinic Push
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "checklist");
    const body = await request.json();
    const { userId, date, items } = body;
    if (!userId || !items || !Array.isArray(items)) throw new BadRequestError("userId와 items가 필요합니다");
    const d = date ?? new Date().toISOString().slice(0, 10);

    let received = 0;
    for (const item of items) {
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
         VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${userId}, ${d}, ${item.key}, ${_title}, ${_category}, ${_hisRole}, ${_priority}, ${_status}, ${_summary}, ${_count}, ${_link}, ${_details}, now())
         ON CONFLICT (cafe_id, user_id, date, key) DO UPDATE SET
           title=${_title}, category=${_category}, his_role=${_hisRole}, priority=${_priority}, status=${_status}, summary=${_summary}, count=${_count}, link=${_link}, details=${_details}, updated_at=now()`;
      received++;
    }

    return NextResponse.json({ ok: true, received, date: d, userId });
  } catch (err) { return handleError(err); }
}

// GET — Clinic Pull
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "checklist");
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    if (!userId) throw new BadRequestError("userId가 필요합니다");

    const rows = await prisma.$queryRaw<Array<{
      key: string; title: string; category: string; his_role: string;
      priority: string; status: string; summary: string | null;
      count: number; link: string | null; details: unknown;
      checked: boolean; checked_at: Date | null;
    }>>`SELECT key, title, category, his_role, priority, status, summary, count, link, details, checked, checked_at
       FROM his_checklist_data WHERE cafe_id = ${ctx.cafeId} AND user_id = ${userId} AND date = ${date}
       ORDER BY priority DESC, category, key`;

    return NextResponse.json({
      userId, date,
      items: rows.map(r => ({
        key: r.key, title: r.title, category: r.category, hisRole: r.his_role,
        priority: r.priority, status: r.status, summary: r.summary,
        count: r.count, link: r.link, details: r.details,
        checked: r.checked, checkedAt: r.checked_at,
      })),
    });
  } catch (err) { return handleError(err); }
}
