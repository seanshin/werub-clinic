// Created: 2026-04-28
// 텔레그램 개인 알림 전송 서비스
// notification.service.ts에서 호출 — 알림 생성 시 텔레그램 DM 자동 전송

import { prisma } from "@/lib/prisma";
import { pool } from "@/lib/pg-pool";
import { sendTelegramMessage, isTelegramConfigured } from "@/lib/services/telegram.service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://example.org";

// NotificationType → telegram_preferences 컬럼 매핑
const TYPE_TO_PREF: Record<string, string> = {
  COMMENT: "notify_comment",
  POST_LIKE: "notify_like",
  MENTION: "notify_mention",
  OPEN_CHANNEL_MENTION: "notify_channel",
  BOARD_MENTION: "notify_channel",
  WSIGN_REQUEST: "notify_approval",
  WSIGN_APPROVED: "notify_approval",
  WSIGN_REJECTED: "notify_approval",
  CALENDAR_REMINDER: "notify_calendar",
  WIKI_EDIT: "notify_wiki",
  DM: "notify_dm",
  CAFE_INVITE: "notify_invite",
  LOGIN_ALERT: "notify_login",
  SCOUT_SETTLE: "notify_scout",
  // 기타 타입은 기본 전송
};

// 알림 타입별 이모지
const TYPE_EMOJI: Record<string, string> = {
  COMMENT: "💬",
  POST_LIKE: "👍",
  MENTION: "📢",
  OPEN_CHANNEL_MENTION: "📢",
  BOARD_MENTION: "📢",
  WSIGN_REQUEST: "📋",
  WSIGN_APPROVED: "✅",
  WSIGN_REJECTED: "❌",
  CALENDAR_REMINDER: "🔔",
  WIKI_EDIT: "📝",
  DM: "✉️",
  CAFE_INVITE: "🏠",
  LOGIN_ALERT: "🔐",
  SCOUT_SETTLE: "💰",
};

// MarkdownV2 특수문자 이스케이프
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * 알림을 텔레그램 DM으로 전송
 * - 텔레그램 연결 + 검증된 사용자만
 * - 사용자별 알림 설정 확인
 * - 방해 금지 시간 체크
 */
export async function sendTelegramNotification(
  userId: string,
  type: string,
  title: string,
  message?: string,
  linkUrl?: string,
): Promise<void> {
  try {
    // 텔레그램 봇 설정 확인
    if (!await isTelegramConfigured()) return;

    // 텔레그램 연결 확인
    const conn = await prisma.telegramConnection.findUnique({
      where: { userId },
      select: { chatId: true, isVerified: true },
    });
    if (!conn?.isVerified || !conn.chatId) return;

    // 알림 설정 확인
    const prefColumn = TYPE_TO_PREF[type];
    if (prefColumn) {
      try {
        const { rows } = await pool.query<Record<string, boolean>>(
          `SELECT ${prefColumn} FROM telegram_preferences WHERE user_id = $1`,
          [userId],
        );
        // 설정 행이 있고, 해당 알림이 false면 전송 안 함
        if (rows[0] && rows[0][prefColumn] === false) return;
      } catch {
        // telegram_preferences 테이블 미존재 시 기본 전송
      }
    }

    // 방해 금지 시간 체크
    try {
      const { rows: quietRows } = await pool.query<{ quiet_start: string | null; quiet_end: string | null }>(
        `SELECT quiet_start::text, quiet_end::text FROM telegram_preferences WHERE user_id = $1`,
        [userId],
      );
      if (quietRows[0]?.quiet_start && quietRows[0]?.quiet_end) {
        const now = new Date();
        const h = now.getHours(), m = now.getMinutes();
        const currentMin = h * 60 + m;
        const [sh, sm] = quietRows[0].quiet_start.split(":").map(Number);
        const [eh, em] = quietRows[0].quiet_end.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;

        if (startMin > endMin) {
          // 자정 넘김 (예: 22:00~08:00)
          if (currentMin >= startMin || currentMin < endMin) return;
        } else {
          if (currentMin >= startMin && currentMin < endMin) return;
        }
      }
    } catch { /* 방해 금지 설정 없으면 무시 */ }

    // 메시지 포맷팅
    const emoji = TYPE_EMOJI[type] || "🔔";
    let text = `${emoji} *${escapeMarkdown(title)}*`;
    if (message) {
      const preview = message.length > 150 ? message.slice(0, 150) + "..." : message;
      text += `\n${escapeMarkdown(preview)}`;
    }
    if (linkUrl) {
      const fullUrl = linkUrl.startsWith("http") ? linkUrl : `${APP_URL}${linkUrl}`;
      text += `\n\n[바로 가기](${fullUrl})`;
    }

    // 전송 (MarkdownV2)
    await sendTelegramMarkdown(conn.chatId, text);
  } catch (e) {
    console.error("[telegram-notify] 전송 실패:", e);
  }
}

/** MarkdownV2 형식으로 텔레그램 메시지 전송 */
async function sendTelegramMarkdown(chatId: string, text: string): Promise<boolean> {
  const { getSecretValue } = await import("@/lib/services/secrets.service");
  const botToken = await getSecretValue("TELEGRAM_BOT_TOKEN");
  if (!botToken) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // MarkdownV2 실패 시 plain text 폴백
      const plain = text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      await sendTelegramMessage(chatId, plain);
    }
    return true;
  } catch {
    return false;
  }
}

/** 테스트 메시지 전송 */
export async function sendTestTelegramMessage(userId: string): Promise<boolean> {
  const conn = await prisma.telegramConnection.findUnique({
    where: { userId },
    select: { chatId: true, isVerified: true },
  });
  if (!conn?.isVerified || !conn.chatId) return false;

  return sendTelegramMessage(
    conn.chatId,
    "🔔 WeRU.B 알림 테스트\n텔레그램 알림이 정상적으로 연결되었습니다!\nexample.org",
  );
}
