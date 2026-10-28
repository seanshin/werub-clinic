// Created: 2026-06-09
// W.Channel↔그룹웨어 전자결재 연동 브리지
// wsign 라우트(route-hook)에서 호출 → 연동된 채널에 결재 카드 메시지 게시 + SSE 발행.
// 단방향(소스 그룹웨어 → 채널). 실패는 본 결재 트랜잭션을 막지 않음(fire-and-forget).
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/board-sse";
import { getLinksForSource } from "@/lib/wsign-links";
import { logger } from "@/lib/logger";

const MAIN_HOST = process.env.NEXT_PUBLIC_APP_URL || "https://example.org";

export type WsignBridgeAction = "submit" | "approve" | "reject" | "hold" | "resume" | "complete" | "cancel" | "recall";

const ACTION_VERB: Record<WsignBridgeAction, string> = {
  submit: "결재 요청", approve: "승인됨", reject: "반려됨", hold: "보류됨", resume: "보류 해제", complete: "승인 완료",
  cancel: "취소됨", recall: "회수됨",
};
const STATUS_COLOR: Record<string, string> = {
  "검토중": "#3B82F6", "승인완료": "#10B981", "반려": "#EF4444", "보류": "#F59E0B", "취소": "#6B7280", "임시저장": "#9CA3AF",
};

// 카드 인라인 승인/반려 대상에서 제외할 결재선 역할 — 이들의 액션은 상세에서 "확인"뿐
const READONLY_STEP_ROLES = ["열람", "수신", "참조"];

interface WsignDocLite {
  id: string;
  cafeId: string;
  docNumber: string | null;
  title: string;
  docType?: string;
  drafterId: string;
  amount?: number | null;
  status: string;
  approvalMode?: string | null;
  currentStep?: number | null;
  sourceService?: string | null;
}

interface CardAction { id: string; label: string; style?: "primary" | "danger" | "default" }

interface BridgeLink {
  defaultChannelId: string | null;
  notifyMode: string;
  maskAmount: boolean;
}

// 민감 docType — 카드 제목(개인 PII 포함)을 분류 라벨로 마스킹. 결재 대상자는 멘션+상세(권한검사)로 전체 확인. (보안 D2)
const SENSITIVE_DOCTYPES = new Set(["인사·근태", "진료·의무기록", "보험·심사", "감염·안전·질관리", "인사", "의료"]);
/** 공개 채널 노출용 카드 표시 제목 — 민감 분류면 개인 제목 대신 "[번호] {분류} 결재 문서" */
function cardTitle(doc: WsignDocLite): string {
  const no = doc.docNumber ?? "문서";
  if (doc.docType && SENSITIVE_DOCTYPES.has(doc.docType)) return `[${no}] ${doc.docType} 결재 문서`;
  return `[${no}] ${doc.title}`;
}

function buildCard(doc: WsignDocLite, action: WsignBridgeAction, link: BridgeLink, sourceSlug: string, drafterName: string, hasPendingApprover: boolean) {
  const fields: { title: string; value: string; short?: boolean }[] = [];
  fields.push({ title: "기안자", value: drafterName, short: true });
  if (doc.amount != null) {
    fields.push({ title: "금액", value: link.maskAmount ? "***" : `${doc.amount.toLocaleString()}원`, short: true });
  }
  fields.push({ title: "상태", value: doc.status, short: true });

  const viewAction: CardAction = { id: `wsign:view:${doc.cafeId}:${doc.id}`, label: "상세", style: "default" };
  const actions: CardAction[] = doc.status === "검토중" && hasPendingApprover
    ? [
        { id: `wsign:approve:${doc.cafeId}:${doc.id}`, label: "승인", style: "primary" },
        { id: `wsign:reject:${doc.cafeId}:${doc.id}`, label: "반려", style: "danger" },
        viewAction,
      ]
    : [viewAction];

  return {
    color: STATUS_COLOR[doc.status] ?? "#6B7280",
    title: cardTitle(doc),
    title_link: `${MAIN_HOST}/cafes/${sourceSlug}/wsign/${doc.id}`,
    text: `📋 전자결재 ${ACTION_VERB[action]}`,
    fields,
    actions,
  };
}

/** wsign 처리 직후 호출 — 연동된 채널에 결재 카드 게시 */
// HIS 연동 문서의 결과(승인/반려/회수·취소)를 HIS callbackUrl로 통지.
// 단방향·fire-and-forget. callbackUrl은 기안 시 history(his_meta)에 저장됨.
// 페이로드/서명/재시도 규약 = src/lib/his/wsign-callback.ts (스펙 §7.4 공통 형식 + eventId 멱등키)
const HIS_CALLBACK_EVENT: Partial<Record<WsignBridgeAction, string>> = {
  complete: "wsign.approved", reject: "wsign.rejected", cancel: "wsign.withdrawn", recall: "wsign.withdrawn",
};
async function dispatchHisResultCallback(doc: WsignDocLite, action: WsignBridgeAction, actorId: string): Promise<void> {
  try {
    const event = HIS_CALLBACK_EVENT[action];
    if (!event) return;
    const row = await prisma.wsignDocument.findUnique({
      where: { id: doc.id }, select: { history: true, docNumber: true, title: true, drafterId: true },
    });
    const history = Array.isArray(row?.history) ? (row!.history as Array<Record<string, unknown>>) : [];
    const meta = history.find((h) => h && h.type === "his_meta");
    const callbackUrl = typeof meta?.callbackUrl === "string" ? meta.callbackUrl : null;
    if (!callbackUrl) return;
    // SSRF 최소 가드: https + 내부/사설 호스트 차단
    if (!/^https:\/\//i.test(callbackUrl) || /(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|::1|metadata\.)/i.test(callbackUrl)) {
      logger.warn("HIS_API_ERROR", "HIS wsign 콜백 차단(비-https/내부호스트)", { docId: doc.id, callbackUrl });
      return;
    }

    const { getHisCallbackSecret, getHospitalCode, deliverHisCallback } = await import("@/lib/his/wsign-callback");
    const [secret, hospitalCode, users] = await Promise.all([
      getHisCallbackSecret(doc.cafeId),
      getHospitalCode(doc.cafeId),
      prisma.user.findMany({
        where: { id: { in: [...new Set([row?.drafterId ?? doc.drafterId, actorId])] } },
        select: { id: true, username: true },
      }).catch(() => [] as { id: string; username: string }[]),
    ]);
    const nameOf = (id: string) => ({ userId: id, username: users.find((u) => u.id === id)?.username ?? null });
    const statusEn = event === "wsign.approved" ? "approved" : event === "wsign.rejected" ? "rejected" : "withdrawn";
    const actorKey = event === "wsign.approved" ? "approvedBy" : event === "wsign.rejected" ? "rejectedBy" : "withdrawnBy";
    const now = new Date().toISOString();

    // eventId: 동일 발생 건의 재시도는 같은 값(HIS 멱등 dedup 키), 별개 발생 건은 상이
    const eventId = `evt-${doc.id}-${statusEn}-${Date.now().toString(36)}`;
    void deliverHisCallback(callbackUrl, {
      event,
      eventId,
      timestamp: now,
      hospitalCode,
      data: {
        docId: doc.id,
        docNumber: row?.docNumber ?? doc.docNumber ?? null,
        title: row?.title ?? doc.title,
        drafter: nameOf(row?.drafterId ?? doc.drafterId),
        [actorKey]: nameOf(actorId),
        status: statusEn,
        completedAt: now,
      },
    }, secret);
  } catch (e) {
    logger.warn("HIS_API_ERROR", "HIS wsign 콜백 발송 실패", { docId: doc.id, error: (e as Error).message });
  }
}

export async function dispatchApprovalEvent(doc: WsignDocLite, action: WsignBridgeAction, actorId: string): Promise<void> {
  // HIS 연동 문서는 W.Channel 링크 유무와 무관하게 결과 콜백 발송
  // 탐지: source_service 컬럼 우선 + id 프리픽스 폴백(백필 누락·구문서 안전망)
  if (doc.sourceService === "his" || doc.id.startsWith("wsign-his-")) void dispatchHisResultCallback(doc, action, actorId);
  try {
    const links = await getLinksForSource(doc.cafeId);
    if (links.length === 0) return;

    const [sourceCafe, drafter] = await Promise.all([
      prisma.cafe.findUnique({ where: { id: doc.cafeId }, select: { slug: true } }),
      prisma.user.findUnique({ where: { id: doc.drafterId }, select: { id: true, username: true, profileImage: true } }),
    ]);
    const slug = sourceCafe?.slug ?? doc.cafeId;
    const drafterName = drafter?.username ?? "기안자";
    const verb = ACTION_VERB[action];
    const docNo = doc.docNumber ?? "문서";
    // 민감 분류는 본문 텍스트도 마스킹(제목 PII 미노출, D2)
    const displayTitle = doc.docType && SENSITIVE_DOCTYPES.has(doc.docType) ? `${doc.docType} 결재 문서` : doc.title;
    const content = `📋 [${docNo}] ${displayTitle} — ${verb}`;

    // 현재 결재 가능자(userId) — WsignApprovalStep.memberId == userId
    // 열람/수신/참조 역할은 카드 승인/반려 대상에서 제외(상세에서 "확인"만 가능)
    let eligibleUserIds: string[] = [];
    if (doc.status === "검토중") {
      const steps = await prisma.wsignApprovalStep.findMany({
        where: { documentId: doc.id },
        select: { memberId: true, stepIndex: true, status: true, role: true },
      });
      const actionable = (doc.approvalMode === "parallel"
        ? steps.filter((s) => s.status === "대기")
        : steps.filter((s) => s.status === "대기" && s.stepIndex === (doc.currentStep ?? 0))
      ).filter((s) => !READONLY_STEP_ROLES.includes(s.role));
      eligibleUserIds = [...new Set(actionable.map((s) => s.memberId))];
    }

    for (const link of links) {
      if (link.notifyMode === "off") continue;
      if (!link.defaultChannelId) continue; // Phase 2: 기본 채널 필요 (DM fallback은 후속 단계)
      try {
        const card = buildCard(doc, action, link, slug, drafterName, eligibleUserIds.length > 0);
        const metadata = {
          attachments: [card],
          wsign: { sourceCafeId: doc.cafeId, sourceSlug: slug, docId: doc.id, action, status: doc.status, eligibleUserIds },
        };
        const msg = await prisma.boardMessage.create({
          data: { channelId: link.defaultChannelId, authorId: doc.drafterId, content, metadata: metadata as unknown as Prisma.InputJsonValue },
          select: { id: true, createdAt: true },
        });

        // notifyMode=mention: 채널 멤버인 결재 대상자에게 멘션 알림(BoardMention)
        if (link.notifyMode === "mention" && eligibleUserIds.length > 0) {
          const channelApprovers = await prisma.cafeMember.findMany({
            where: { cafeId: link.channelCafeId, userId: { in: eligibleUserIds } },
            select: { userId: true },
          });
          if (channelApprovers.length > 0) {
            await prisma.boardMention.createMany({
              data: channelApprovers.map((c) => ({ messageId: msg.id, mentionedId: c.userId })),
            });
          }
        }

        publishBoardEvent(link.defaultChannelId, "board:message:new", {
          id: msg.id,
          content,
          parentId: null,
          createdAt: msg.createdAt,
          author: drafter ?? { id: doc.drafterId, username: drafterName, profileImage: null },
          reactions: [],
          files: [],
          _count: { replies: 0 },
          metadata,
        });
        // 기존 카드 버튼 실시간 갱신 — 같은 docId 카드들이 현재 결재자/상태에 맞춰 재계산
        publishBoardEvent(link.defaultChannelId, "wsign:card:update", {
          docId: doc.id, status: doc.status, eligibleUserIds,
        });
      } catch (e) {
        logger.error("wsign-bridge:post", e);
      }
    }
  } catch (e) {
    logger.error("wsign-bridge", e);
  }
}
