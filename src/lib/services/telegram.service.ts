// Created: 2026-02-09
// Updated: 2026-03-05 — getSecretValue() 연동
import crypto from "crypto";
import { getSecretValue } from "@/lib/services/secrets.service";

export async function isTelegramConfigured(): Promise<boolean> {
  const token = await getSecretValue("TELEGRAM_BOT_TOKEN");
  return !!token;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const botToken = await getSecretValue("TELEGRAM_BOT_TOKEN");
  if (!botToken) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// 혼동 방지 문자 제외 (O, 0, I, 1, L)
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARS[crypto.randomInt(CHARS.length)];
  }
  return code;
}
