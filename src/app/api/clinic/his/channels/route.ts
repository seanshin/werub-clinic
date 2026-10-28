// Created: 2026-05-07
// GET /api/clinic/his/channels — 병원 채널 목록
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "channel");

    const rows = await prisma.$queryRaw<Array<{
      id: string; name: string; type: string; member_count: bigint; last_message_at: Date | null;
    }>>`SELECT bc.id, bc.name, bc.type,
              (SELECT COUNT(*) FROM board_channel_members WHERE channel_id = bc.id) as member_count,
              (SELECT MAX(created_at) FROM board_messages WHERE channel_id = bc.id) as last_message_at
       FROM board_channels bc WHERE bc.cafe_id = ${ctx.cafeId} AND bc.is_archived = false
       ORDER BY bc.name`;

    return NextResponse.json({
      channels: rows.map(r => ({
        id: r.id, name: r.name, type: r.type,
        memberCount: Number(r.member_count),
        lastMessageAt: r.last_message_at,
      })),
      total: rows.length,
    });
  } catch (err) { return handleError(err); }
}
