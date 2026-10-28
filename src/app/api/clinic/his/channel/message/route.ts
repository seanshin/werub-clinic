// Created: 2026-05-07
// POST /api/clinic/his/channel/message — 채널에 메시지 전송
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "channel");
    const body = await request.json();
    const { channelId, channelName, content, sender, threadId } = body;
    if (!content) throw new BadRequestError("content가 필요합니다");
    if (!channelId && !channelName) throw new BadRequestError("channelId 또는 channelName이 필요합니다");

    // 채널 조회
    let chId = channelId;
    if (!chId && channelName) {
      const ch = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM board_channels WHERE cafe_id = ${ctx.cafeId} AND name = ${channelName} LIMIT 1`;
      if (ch.length === 0) throw new BadRequestError(`채널 '${channelName}'을 찾을 수 없습니다`);
      chId = ch[0].id;
    }

    // 발신자 (system → werubi_bot, userId → 해당 유저)
    let senderId = sender;
    if (!senderId || senderId === "system") {
      const bot = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE username = 'werubi_bot' LIMIT 1`;
      senderId = bot[0]?.id;
    }
    if (!senderId) throw new BadRequestError("발신자를 찾을 수 없습니다");

    const msgId = `msg-his-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await prisma.$executeRaw`INSERT INTO board_messages (id, channel_id, author_id, content, parent_id, created_at)
       VALUES (${msgId}, ${chId}, ${senderId}, ${content}, ${threadId ?? null}, now())`;

    return NextResponse.json({ ok: true, messageId: msgId, channelId: chId });
  } catch (err) { return handleError(err); }
}
