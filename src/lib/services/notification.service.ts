// Created: 2026-02-23
// Updated: 2026-03-18 — FCM 푸시 opt-out 체크 추가
// 알림 서비스 — 생성, 목록 조회, 읽음 처리

import { prisma } from "@/lib/prisma";
import { NotificationType } from "@/generated/prisma";
import { notifyUser } from "@/lib/socket-store";
import { isTypeEnabled, isPushEnabled, isPushTypeEnabled } from "@/lib/services/notification-preference.service";
import { sendPushToUser } from "@/lib/services/push.service";
import { isInDnd, isPresenceDnd } from "@/lib/services/notify-prefs.service";

interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  linkUrl?: string;
  actorId?: string;
}

/** 알림 생성 (자기 자신에게는 생성하지 않음, 비활성 타입 스킵) */
export async function createNotification(data: CreateNotificationData) {
  if (data.actorId && data.actorId === data.userId) return null;

  // 유저가 해당 알림 타입을 비활성화했으면 스킵
  const enabled = await isTypeEnabled(data.userId, data.type);
  if (!enabled) return null;

  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      linkUrl: data.linkUrl,
      actorId: data.actorId,
    },
  });

  // SSE로 실시간 푸시 — 연결된 클라이언트에게 즉시 전달
  notifyUser(data.userId, "notification", {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    linkUrl: notification.linkUrl ?? null,
  });

  // FCM 푸시 알림 — 마스터 토글 + 유형별 푸시 + DND(시간대) + 상태기반 DND(바쁨/휴가) 체크 (fire-and-forget)
  // DND 중에는 푸시만 억제(인앱/SSE 알림은 그대로 — 복귀 시 확인 가능)
  Promise.all([isPushEnabled(data.userId), isPushTypeEnabled(data.userId, data.type), isInDnd(data.userId), isPresenceDnd(data.userId)]).then(([masterOn, typeOn, dnd, presenceDnd]) => {
    if (!masterOn || !typeOn || dnd || presenceDnd) return;
    sendPushToUser(data.userId, {
      title:          data.title,
      body:           data.message ?? data.title,
      type:           data.type,
      linkUrl:        data.linkUrl,
      notificationId: notification.id,
    }).catch((e) => console.error("[notification] FCM 푸시 실패:", e));
  });

  // 텔레그램 DM 알림 (fire-and-forget)
  import("@/lib/services/telegram-notify.service")
    .then(({ sendTelegramNotification }) =>
      sendTelegramNotification(data.userId, data.type, data.title, data.message, data.linkUrl),
    )
    .catch((e) => console.error("[notification] Telegram 알림 실패:", e));

  return notification;
}

/** @all 멘션 등 대량 알림 — 벌크 INSERT + 개별 SSE/푸시 (W.Channel 성능 보강) */
export async function createBulkNotifications(
  userIds: string[],
  data: Omit<CreateNotificationData, "userId">,
) {
  if (userIds.length === 0) return;

  // 1. 벌크 INSERT (1 쿼리)
  await prisma.notification.createMany({
    data: userIds.map((uid) => ({
      userId: uid,
      type: data.type,
      title: data.title,
      message: data.message,
      linkUrl: data.linkUrl,
      actorId: data.actorId,
    })),
  });

  // 2. SSE + 푸시는 비동기 fire-and-forget (개별 설정 체크)
  for (const uid of userIds) {
    notifyUser(uid, "notification", { type: data.type, title: data.title, linkUrl: data.linkUrl ?? null });
  }
}

/** 알림 목록 조회 (페이지네이션 + 읽지 않은 필터) */
export async function getNotifications(
  userId: string,
  options: { page?: number; limit?: number; unreadOnly?: boolean } = {},
) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

   
  const where: any = { userId };
  if (options.unreadOnly) {
    where.isRead = false;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        actor: { select: { id: true, username: true, profileImage: true } },
      },
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/** 읽지 않은 알림 수 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

/** 단건 읽음 처리 */
export async function markAsRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

/** 전체 읽음 처리 */
export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}
