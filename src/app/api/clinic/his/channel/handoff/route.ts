// Created: 2026-05-07
// POST /api/clinic/his/channel/handoff — 인수인계 노트 전송
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "channel");
    const body = await request.json();
    const { from, to, shift, department, patients, generalNotes } = body;
    if (!from || !to || !shift) throw new BadRequestError("from, to, shift가 필요합니다");

    // 인수인계 채널 찾기 (없으면 일반 공지 채널)
    const channelName = department ? `${department}-인수인계` : "인수인계";
    let chRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM board_channels WHERE cafe_id = ${ctx.cafeId} AND name = ${channelName} LIMIT 1`;
    if (chRows.length === 0) {
      // 일반 채널 검색
      chRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM board_channels WHERE cafe_id = ${ctx.cafeId} ORDER BY created_at LIMIT 1`;
    }
    if (chRows.length === 0) throw new BadRequestError("메시지를 전송할 채널이 없습니다");

    const shiftLabel: Record<string, string> = {
      night_to_day: "야간→주간", day_to_evening: "주간→저녁", evening_to_night: "저녁→야간",
    };

    // 인수인계 메시지 포맷
    let content = `📋 **인수인계** (${shiftLabel[shift] ?? shift})\n`;
    if (department) content += `부서: ${department}\n`;
    content += `\n`;

    if (patients && patients.length > 0) {
      content += `### 환자별 인수인계\n`;
      for (const p of patients) {
        const pri = p.priority === "high" ? "🔴" : p.priority === "normal" ? "🟡" : "⚪";
        content += `\n${pri} **${p.name}** (${p.room}호)\n`;
        content += `${p.summary}\n`;
        if (p.tasks?.length > 0) {
          content += p.tasks.map((t: string) => `- [ ] ${t}`).join("\n") + "\n";
        }
      }
    }

    if (generalNotes) {
      content += `\n### 전체 특이사항\n${generalNotes}\n`;
    }

    const msgId = `msg-handoff-${Date.now()}`;
    await prisma.$executeRaw`INSERT INTO board_messages (id, channel_id, author_id, content, created_at)
       VALUES (${msgId}, ${chRows[0].id}, ${from}, ${content}, now())`;

    // 인수 받는 직원에게 알림
    for (const uid of to) {
      const _handoffTitle = `📋 인수인계 도착 (${shiftLabel[shift] ?? shift})`;
      const _handoffMsg = `${department ?? ""} 인수인계 노트가 전달되었습니다.`;
      await prisma.$executeRaw`INSERT INTO notifications (id, user_id, type, title, message, created_at)
         VALUES (gen_random_uuid()::text, ${uid}, 'HIS_HANDOFF', ${_handoffTitle}, ${_handoffMsg}, now())`;
    }

    return NextResponse.json({ ok: true, messageId: msgId, channelName });
  } catch (err) { return handleError(err); }
}
