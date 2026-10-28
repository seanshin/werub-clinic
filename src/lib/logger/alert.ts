// Created: 2026-05-06
// 텔레그램 알림 — fire-and-forget, 60초 dedup
// 기존 lib/services/server-alert.ts에서 이전

const ALERT_COOLDOWN = 60_000;
const recentAlerts = new Map<string, number>();

/**
 * 에러를 텔레그램 관리자 채팅으로 전송.
 * 동일 에러 1분 내 중복 방지. fire-and-forget.
 */
export function sendAlert(context: string, errMsg: string): void {
  const chatId = process.env.LOG_MONITOR_TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const key = `${context}:${errMsg.slice(0, 50)}`;
  const now = Date.now();
  const lastSent = recentAlerts.get(key) ?? 0;
  if (now - lastSent < ALERT_COOLDOWN) return;
  recentAlerts.set(key, now);

  // 오래된 항목 정리
  if (recentAlerts.size > 100) {
    for (const [k, t] of recentAlerts) {
      if (now - t > ALERT_COOLDOWN * 5) recentAlerts.delete(k);
    }
  }

  const text = [
    "🚨 *서버 에러 알림*",
    "",
    `📍 \`${context}\``,
    `❌ ${errMsg.slice(0, 200)}`,
    "",
    `🕐 ${new Date().toLocaleString("ko")}`,
    `🌐 ${process.env.NEXT_PUBLIC_APP_URL || "example.org"}`,
  ].join("\n");

  // dynamic import — 텔레그램 서비스가 없을 때도 안전
  import("@/lib/services/telegram.service").then(({ sendTelegramMessage }) => {
    sendTelegramMessage(chatId, text).catch(() => {});
  }).catch(() => {});
}
