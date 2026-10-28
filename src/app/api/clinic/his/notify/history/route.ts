// Created: 2026-05-07
// GET /api/clinic/his/notify/history — 발송 알림 이력
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "notify");
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Number(url.searchParams.get("offset")) || 0;
    const category = url.searchParams.get("category");

    const catFilter = category ? `AND n.type = '${category}'` : `AND n.type IN ('HIS_ALERT','HIS_URGENT')`;

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; title: string; message: string; type: string;
      user_id: string; is_read: boolean; created_at: Date;
    }>>(
      `SELECT n.id, n.title, n.message, n.type, n.user_id, n.is_read, n.created_at
       FROM notifications n
       JOIN cafe_members cm ON cm.user_id = n.user_id AND cm.cafe_id = $1
       WHERE 1=1 ${catFilter}
       ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
      ctx.cafeId, limit, offset,
    );

    return NextResponse.json({
      notifications: rows.map(r => ({
        id: r.id, title: r.title, message: r.message, category: r.type,
        userId: r.user_id, read: r.is_read, createdAt: r.created_at,
      })),
      total: rows.length,
    });
  } catch (err) { return handleError(err); }
}
