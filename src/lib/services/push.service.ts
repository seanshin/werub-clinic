// Created: 2026-03-08
// Updated: 2026-04-10 — Chat/DM 푸시에 PUSH_ENABLED 마스터 토글 체크 추가
// FCM 푸시 알림 서비스 — firebase-admin 사용
// 설치: npm install firebase-admin
// 환경변수: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (Base64 인코딩 가능)
import { prisma } from "@/lib/prisma";
import { isPushEnabled } from "@/lib/services/notification-preference.service";

export interface PushPayload {
  title:          string;
  body:           string;
  type:           string;   // NotificationType string
  linkUrl?:       string;
  notificationId?: string;
}

// ── Firebase Admin 초기화 (싱글턴, lazy) ────────────────────────────────

let messagingInstance: unknown = null;

async function getMessaging() {
  if (messagingInstance) return messagingInstance;

  const projectId  = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  let privateKey   = process.env.FCM_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null; // FCM 미설정 — 푸시 스킵
  }

  // Base64 인코딩된 키 지원 (개행 문자 처리)
  if (!privateKey.includes("-----BEGIN")) {
    privateKey = Buffer.from(privateKey, "base64").toString("utf-8");
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  try {
     
    // @ts-ignore — firebase-admin 선택적 설치 (npm install firebase-admin)
    const admin = await import("firebase-admin").catch(() => null);
    if (!admin) {
      console.warn("[push] firebase-admin 패키지가 설치되지 않았습니다. `npm install firebase-admin`");
      return null;
    }

    const appName = "werub-push";
    const existing = admin.apps?.find((a: any) => a?.name === appName);
    const app = existing ?? admin.initializeApp(
      { credential: admin.credential.cert({ projectId, clientEmail, privateKey }) },
      appName,
    );
    messagingInstance = admin.messaging(app);
    return messagingInstance;
  } catch (e) {
    console.error("[push] Firebase 초기화 실패:", e);
    return null;
  }
}

// ── 단일 토큰에 푸시 발송 ────────────────────────────────────────────────

async function sendToToken(
  messaging: unknown,
  token: string,
  payload: PushPayload,
): Promise<"ok" | "invalid" | "error"> {
  try {
    const msg = messaging as {
      send(m: unknown): Promise<string>;
    };
    await msg.send({
      token,
      notification: { title: payload.title, body: payload.body },
      data: {
        type:           payload.type,
        linkUrl:        payload.linkUrl        ?? "",
        notificationId: payload.notificationId ?? "",
      },
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default", badge: 1 } } },
    });
    return "ok";
  } catch (err: unknown) {
    const code = (err as { errorInfo?: { code?: string } })?.errorInfo?.code ?? "";
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      return "invalid";
    }
    console.error("[push] FCM 발송 오류:", code, err);
    return "error";
  }
}

// ── 유저에게 푸시 발송 (활성 토큰 전체) ─────────────────────────────────

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const messaging = await getMessaging();
  if (!messaging) return; // FCM 미설정

  // 활성 디바이스 토큰 조회
  const tokens = await prisma.$queryRawUnsafe<{ id: string; token: string }[]>(
    `SELECT id, token FROM device_tokens WHERE user_id = $1 AND is_active = true`,
    userId,
  );
  if (tokens.length === 0) return;

  const invalidIds: string[] = [];

  const settled = await Promise.allSettled(
    tokens.map(async ({ id, token }) => {
      const result = await sendToToken(messaging, token, payload);
      if (result === "invalid") invalidIds.push(id);
      return result;
    }),
  );

  const errors = settled.filter((r) => r.status === "rejected").length;
  if (errors > 0) {
    console.error(`[push] ${errors}/${tokens.length} 토큰 발송 실패 (userId: ${userId})`);
  }

  // 유효하지 않은 토큰 비활성화
  if (invalidIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE device_tokens SET is_active = false, updated_at = NOW()
       WHERE id = ANY($1::text[])`,
      invalidIds,
    ).catch((e) => console.error("[push] 토큰 비활성화 실패:", e));
    // S3-1: 비활성화된 무효 토큰 수 기록 (운영 모니터링용)
    console.log(`[push] 무효 토큰 비활성화: ${invalidIds.length}개 (userId: ${userId})`);
  }
}

// ── 다수 유저에게 푸시 발송 ──────────────────────────────────────────────

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return;
  await Promise.allSettled(userIds.map((uid) => sendPushToUser(uid, payload)));
}

// ── Topic 기반 일괄 푸시 발송 ──────────────────────────────────────────────

export async function sendPushToTopic(topic: string, payload: PushPayload): Promise<void> {
  const messaging = await getMessaging();
  if (!messaging) return;

  try {
    const msg = messaging as { send(m: unknown): Promise<string> };
    await msg.send({
      topic,
      notification: { title: payload.title, body: payload.body },
      data: {
        type:           payload.type,
        linkUrl:        payload.linkUrl        ?? "",
        notificationId: payload.notificationId ?? "",
      },
      android: { priority: "high" as const },
      apns: { payload: { aps: { sound: "default" } } },
    });
  } catch (err) {
    console.error("[push] Topic 발송 오류:", topic, err);
  }
}

// ── 채팅방 메시지 FCM 푸시 (앱 전용) ─────────────────────────────────────
// fire-and-forget: Socket.IO emit 직후 호출
// 발신자를 제외한 활성 멤버 전원에게 발송

export async function sendChatPush(
  roomId: string,
  senderId: string,
  senderUsername: string,
  preview: string,
  roomName: string,
): Promise<void> {
  const messaging = await getMessaging();
  if (!messaging) return;

  const rows = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT crm.user_id FROM chat_room_members crm
    WHERE crm.room_id = ${roomId}
      AND crm.user_id != ${senderId}
      AND crm.left_at IS NULL
      AND crm.is_muted = false
  `;
  if (rows.length === 0) return;

  // PUSH_ENABLED 마스터 토글 체크 — 옵트아웃 유저 제외
  const eligible = (await Promise.all(
    rows.map(async (r) => ({ uid: r.user_id, ok: await isPushEnabled(r.user_id) })),
  )).filter((r) => r.ok).map((r) => r.uid);
  if (eligible.length === 0) return;

  await sendPushToUsers(
    eligible,
    {
      title: senderUsername,
      body: `[${roomName}] ${preview.slice(0, 100)}`,
      type: "CHAT_MESSAGE",
      linkUrl: `/chat/${roomId}`,
    },
  );
}

// ── DM 메시지 FCM 푸시 (앱 전용) ─────────────────────────────────────────
// fire-and-forget: notifyUser(targetId) 직후 호출
// 수신자(partner) 1명에게 발송

export async function sendDmPush(
  conversationId: string,
  senderId: string,
  senderUsername: string,
  preview: string,
): Promise<void> {
  const messaging = await getMessaging();
  if (!messaging) return;

  const rows = await prisma.$queryRaw<{ partner_id: string }[]>`
    SELECT CASE WHEN user1_id = ${senderId} THEN user2_id ELSE user1_id END AS partner_id
    FROM conversations WHERE id = ${conversationId}
  `;
  if (!rows[0]) return;

  // PUSH_ENABLED 마스터 토글 체크
  if (!await isPushEnabled(rows[0].partner_id)) return;

  await sendPushToUser(rows[0].partner_id, {
    title: senderUsername,
    body: preview.slice(0, 100),
    type: "NEW_DM",
    linkUrl: `/messages/${conversationId}`,
  });
}
