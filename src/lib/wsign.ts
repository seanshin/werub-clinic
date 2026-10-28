// Created: 2026-03-10
// W.Sign 공통 헬퍼 — 인증, 역할 매핑, 멤버 조회

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { NotFoundError, ForbiddenError, BadRequestError } from "@/lib/errors";

export type WsignRole = "viewer" | "drafter" | "approver" | "dept_admin" | "sys_admin";

export const ROLE_LEVELS: Record<WsignRole, number> = {
  viewer: 0,
  drafter: 1,
  approver: 2,
  dept_admin: 3,
  sys_admin: 4,
};

export function hasWsignRole(userRole: string, minRole: WsignRole): boolean {
  return (ROLE_LEVELS[userRole as WsignRole] ?? 0) >= ROLE_LEVELS[minRole];
}

/** CafeMember role → W.Sign systemRole 자동 매핑 */
export function mapCafeRoleToWsign(cafeRole: string): WsignRole {
  const map: Record<string, WsignRole> = {
    OWNER: "sys_admin",
    MANAGER: "dept_admin",
    STAFF: "approver",
    MEMBER: "drafter",
    REGULAR: "drafter",
    ASSOCIATE: "drafter",
    NEWBIE: "viewer",
  };
  return map[cafeRole] ?? "viewer";
}

/** 카페 조회 (slug 기반) */
export async function getCafeBySlug(slug: string) {
  const cafe = await prisma.cafe.findUnique({ where: { slug } });
  if (!cafe) throw new NotFoundError("카페를 찾을 수 없습니다");
  return cafe;
}

/** W.Sign 멤버 조회 — 미등록 시 CafeMember role 기반 자동 생성, 카페 역할 변경 시 자동 동기화 */
export async function getOrCreateWsignMember(cafeId: string, userId: string) {
  const cafeMember = await prisma.cafeMember.findUnique({
    where: { cafeId_userId: { cafeId, userId } },
  });
  if (!cafeMember) throw new ForbiddenError("카페 멤버가 아닙니다");
  // 활성 멤버만 접근 — 퇴사/차단(BANNED) 멤버가 유효 세션으로 결재문서 열람·승인하는 것 차단(보안 F1)
  if (cafeMember.status !== "ACTIVE") throw new ForbiddenError("비활성 멤버는 전자결재를 이용할 수 없습니다");

  const expectedRole = mapCafeRoleToWsign(cafeMember.role);
  let wsignMember = await prisma.wsignMember.findUnique({
    where: { cafeId_userId: { cafeId, userId } },
  });

  if (!wsignMember) {
    wsignMember = await prisma.wsignMember.create({
      data: { cafeId, userId, wsignRole: expectedRole },
    });
  } else {
    // 퇴사(active=false) wsign 멤버 접근 차단 — cafe status 검사에 더한 이중 방어(F1 심화)
    if (!wsignMember.active) throw new ForbiddenError("비활성 결재 멤버는 전자결재를 이용할 수 없습니다");
    // 카페 역할이 승격된 경우 wsign 역할도 동기화 (현재 wsign 역할보다 높을 때만)
    const currentLevel = ROLE_LEVELS[wsignMember.wsignRole as WsignRole] ?? 0;
    const expectedLevel = ROLE_LEVELS[expectedRole] ?? 0;
    if (expectedLevel > currentLevel) {
      wsignMember = await prisma.wsignMember.update({
        where: { cafeId_userId: { cafeId, userId } },
        data: { wsignRole: expectedRole },
      });
    }
  }

  return wsignMember;
}

/** 공통 인증 + 카페 + W.Sign 멤버 조회 */
export async function requireWsignAuth(request: NextRequest, slug: string) {
  const auth = await requireAuth(request);
  const cafe = await getCafeBySlug(slug);
  const wsignMember = await getOrCreateWsignMember(cafe.id, auth.userId);
  return { auth, cafe, wsignMember };
}

/** 오늘 날짜 (YYYY-MM-DD) */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** HTML 태그 제거 — XSS 방어용 (script/이벤트핸들러) */
export function sanitizeContent(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript\s*:/gi, "");
}

/** 금액 파싱 — NaN/범위 검증 (v2.0) */
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const num = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (isNaN(num)) return null;
  if (num < 0 || num > 999_999_999) return null;
  return num;
}

/** 문서 ID 생성 — 시퀀스 기반 atomic increment (v2.0) */
export async function generateDocIdSafe(cafeId: string): Promise<string> {
  const year = new Date().getFullYear();
  const result = await prisma.$queryRaw<[{ last_seq: number }]>`
    INSERT INTO wsign_doc_sequences (cafe_id, last_seq)
    VALUES (${cafeId}, 1)
    ON CONFLICT (cafe_id)
    DO UPDATE SET last_seq = wsign_doc_sequences.last_seq + 1
    RETURNING last_seq
  `;
  const seq = result[0].last_seq;
  // 2026-07-17: id는 전역 PK인데 시퀀스는 카페별 → 신규 워크스페이스 첫 문서가 타 카페 기존 id와 충돌(P2002→409).
  // 기존 형식 유지, 전역 중복 시에만 무작위 접미로 회피.
  const base = `DOC-${year}-${String(seq).padStart(3, "0")}`;
  let candidate = base;
  for (let i = 0; i < 3; i++) {
    const dup = await prisma.wsignDocument.findUnique({ where: { id: candidate }, select: { id: true } });
    if (!dup) return candidate;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** 대리결재 활성 여부 확인 — 재귀 체인 (최대 3단계, 순환 참조 방지) */
export async function findSubstituteMatch(
  cafeId: string, userId: string, stepMemberId: string, depth = 0, visited?: Set<string>,
): Promise<boolean> {
  if (userId === stepMemberId) return true;
  if (depth > 3) return false;

  // C-15: 순환 참조 방지
  const seen = visited ?? new Set<string>();
  if (seen.has(stepMemberId)) return false;
  seen.add(stepMemberId);

  const todayStr = today();
  const sub = await prisma.wsignSubstitute.findUnique({
    where: { cafeId_memberId: { cafeId, memberId: stepMemberId } },
  });
  if (!sub) return false;
  const subStart = String(sub.startDate).slice(0, 10);
  const subEnd = String(sub.endDate).slice(0, 10);
  if (subStart > todayStr || subEnd < todayStr) return false;
  if (sub.substituteId === userId) return true;
  return findSubstituteMatch(cafeId, userId, sub.substituteId, depth + 1, seen);
}

/** 감사 로그 기록 헬퍼 (v2.0) */
export async function logAudit(
  txOrPrisma: { wsignAuditLog: { create: (args: any) => Promise<any> } },
  cafeId: string,
  documentId: string | null,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, any> = {},
) {
  await txOrPrisma.wsignAuditLog.create({
    data: { cafeId, documentId, actorId, action, targetType, targetId, detail },
  });
}

/** 문서 직렬화 (v2.0) */
export function serializeDoc(doc: any) {
  return {
    id: doc.id,
    docNumber: doc.docNumber ?? null,
    title: doc.title,
    type: doc.docType,
    drafter: doc.drafterId,
    amount: doc.amount,
    status: doc.status,
    createdAt: doc.createdAt?.toISOString(),
    approvalLineId: doc.approvalLineId,
    approvalMode: doc.approvalMode,
    currentStep: doc.currentStep,
    content: doc.content,
    rejectReason: doc.rejectReason,
    attachments: doc.attachments ?? [],
    comments: doc.comments ?? [],
    history: doc.history ?? [],
    approvalSteps: (doc.steps ?? [])
      .sort((a: any, b: any) => a.stepIndex - b.stepIndex)
      .map((s: any) => ({
        memberId: s.memberId,
        role: s.role,
        status: s.status,
        at: s.processedAt?.toISOString() ?? null,
        approvedBy: s.approvedBy ?? null,
        comment: s.comment,
        proxyFor: s.proxyFor ?? null,
      })),
    version: doc.version ?? 1,
    deadline: doc.deadline?.toISOString() ?? null,
    parentDocId: doc.parentDocId ?? null,
    heldBy: doc.heldBy ?? null,
    isPreApproved: doc.isPreApproved ?? false,
    isUrgent: doc.isUrgent ?? false,
    sourceService: doc.sourceService ?? "native", // 연동 서비스 출처 (native | his | …)
    externalRef: doc.externalRef ?? null,
    attestationStatus: doc.attestationStatus ?? "none", // 블록체인 문서 인증 상태
    archived: doc.archived ?? false, // 문서함 서버 아카이브
    categoryId: doc.categoryId ?? null, // 문서함 카테고리
    pinned: doc.pinned ?? false, // 문서함 상단 고정
  };
}

/** 결재라인 steps 배열 유효성 검증 (v3.6) */
export function validateApprovalSteps(steps: unknown): Array<{ memberId: string; role: string }> {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new BadRequestError("결재 단계를 1개 이상 추가하세요");
  }
  if (steps.length > 20) {
    throw new BadRequestError("결재 단계는 최대 20개까지 가능합니다");
  }
  return steps.map((s: any, i: number) => {
    if (!s || typeof s !== "object") throw new BadRequestError(`결재 단계 ${i + 1}번이 유효하지 않습니다`);
    if (typeof s.memberId !== "string" || !s.memberId.trim()) {
      throw new BadRequestError(`결재 단계 ${i + 1}번의 결재자를 선택하세요`);
    }
    if (typeof s.role !== "string" || !s.role.trim()) {
      throw new BadRequestError(`결재 단계 ${i + 1}번의 역할을 입력하세요`);
    }
    return { memberId: s.memberId.trim(), role: s.role.trim() };
  });
}

/** 조직도 트리 노드 유효성 검증 (v3.6) */
export function validateOrgTree(tree: unknown, depth = 0): void {
  if (depth > 10) throw new BadRequestError("조직도는 최대 10단계까지 허용됩니다");
  if (!tree || typeof tree !== "object") throw new BadRequestError("조직도 형식이 올바르지 않습니다");
  const node = tree as Record<string, unknown>;
  if (typeof node.id !== "string" || !node.id) throw new BadRequestError("조직도 노드에 id가 필요합니다");
  if (typeof node.name !== "string") throw new BadRequestError("조직도 노드에 name이 필요합니다");
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) throw new BadRequestError("children은 배열이어야 합니다");
    if (node.children.length > 100) throw new BadRequestError("자식 노드는 최대 100개까지 가능합니다");
    for (const child of node.children) {
      validateOrgTree(child, depth + 1);
    }
  }
}

/** SSE 이벤트 발행 헬퍼 (v2.0) */
export function emitWsignEvent(cafeId: string, event: string, data: any) {
  try {
    const g = global as typeof global & { _wsignListeners?: Map<string, Set<any>> };
    const listeners = g._wsignListeners?.get(`wsign:${cafeId}`);
    if (!listeners) return;
    listeners.forEach((listener) => {
      listener.send(event, data);
    });
  } catch {
    // SSE 미초기화 환경에서는 무시
  }
}
