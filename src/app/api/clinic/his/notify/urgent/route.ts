// Created: 2026-05-07
// Updated: 2026-05-07 — [H-2] prisma 전환, [H-3] Zod
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const urgentSchema = z.object({
  channel: z.string().max(100).optional(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  assignees: z.array(z.string()).optional(),
  priority: z.literal("urgent").optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "notify");
    await rateLimit(request, "write");
    const body = await request.json();
    const data = urgentSchema.parse(body);

    let channelMessageId: string | null = null;
    if (data.channel) {
      const channels = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM board_channels WHERE cafe_id = ${ctx.cafeId} AND name = ${data.channel} LIMIT 1`;
      if (channels.length > 0) {
        const msgId = `msg-his-${Date.now()}`;
        const botRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE username = 'werubi_bot' LIMIT 1`;
        const senderId = botRows[0]?.id;
        if (senderId) {
          const _content = `🚨 **${data.title}**\n\n${data.message}`;
          await prisma.$executeRaw`INSERT INTO board_messages (id, channel_id, author_id, content, created_at)
             VALUES (${msgId}, ${channels[0].id}, ${senderId}, ${_content}, now())`;
          channelMessageId = msgId;
        }
      }
    }

    // M5: assignees 지정 시 대상자만, 없으면 활성 전체 브로드캐스트. 단일 INSERT(N+1 제거).
    const targetIds = (data.assignees && data.assignees.length > 0)
      ? [...new Set(data.assignees)]
      : (await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${ctx.cafeId} AND status = 'ACTIVE'`).map(m => m.user_id);
    const _urgentTitle = `🚨 ${data.title}`;
    let sent = 0;
    if (targetIds.length > 0) {
      await prisma.$executeRaw`INSERT INTO notifications (id, user_id, type, title, message, created_at)
         SELECT gen_random_uuid()::text, uid, 'HIS_URGENT', ${_urgentTitle}, ${data.message}, now()
         FROM unnest(${targetIds}::text[]) AS uid`;
      sent = targetIds.length;
    }

    return NextResponse.json({ ok: true, notificationsSent: sent, channelMessageId });
  } catch (err) { return handleError(err); }
}
