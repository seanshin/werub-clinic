// Created: 2026-05-07
// Updated: 2026-07-16 — raw SQL 스키마 불일치(500) 수정: Prisma 재작성 + currentStep + 영문 status 매핑 (C-3 재개)
// GET /api/clinic/his/wsign/status/[docId] — 전자결재 상태 조회
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { mapDocStatusEn } from "@/lib/his/wsign-callback";
import { handleError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ docId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "wsign");
    const { docId } = await params;

    const doc = await prisma.wsignDocument.findFirst({
      where: { id: docId, cafeId: ctx.cafeId },
      select: {
        id: true, docNumber: true, title: true, status: true, currentStep: true,
        drafterId: true, createdAt: true, updatedAt: true,
      },
    });
    if (!doc) throw new NotFoundError("문서를 찾을 수 없습니다");

    const steps = await prisma.wsignApprovalStep.findMany({
      where: { documentId: docId },
      orderBy: { stepIndex: "asc" },
      select: { stepIndex: true, memberId: true, role: true, status: true, processedAt: true, comment: true, approvedBy: true },
    });

    const userIds = [...new Set([doc.drafterId, ...steps.map((s) => s.memberId)])];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } }, select: { id: true, username: true },
    });
    const nameOf = (id: string) => users.find((u) => u.id === id)?.username ?? null;

    const statusEn = mapDocStatusEn(doc.status);
    // 결재선 상태: 대기(현재 차례)=pending / 대기(이후)=waiting / 반려=rejected / 그 외(승인·전결·동의·확인·검토완료)=approved
    const stepStatusEn = (s: { status: string; stepIndex: number }): string => {
      if (s.status === "반려") return "rejected";
      if (s.status === "대기") {
        return statusEn === "pending" && s.stepIndex === (doc.currentStep ?? 0) ? "pending" : "waiting";
      }
      return "approved";
    };

    const completedAt = statusEn === "approved" || statusEn === "rejected"
      ? steps.reduce<Date | null>((max, s) => (s.processedAt && (!max || s.processedAt > max) ? s.processedAt : max), null) ?? doc.updatedAt
      : null;

    return NextResponse.json({
      docId: doc.id,
      docNumber: doc.docNumber,
      title: doc.title,
      status: statusEn,
      rawStatus: doc.status,
      // 1-based, approvalLine의 step과 동일 기준. 진행 중이 아니면 null.
      currentStep: statusEn === "pending" ? (doc.currentStep ?? 0) + 1 : null,
      drafter: { userId: doc.drafterId, username: nameOf(doc.drafterId) },
      approvalLine: steps.map((s) => ({
        step: s.stepIndex + 1,
        userId: s.memberId,
        username: nameOf(s.memberId),
        role: s.role,
        status: stepStatusEn(s),
        rawStatus: s.status,
        approvedAt: s.processedAt,
        approvedBy: s.approvedBy, // 대결 처리자(위임 시 실제 처리 유저)
        comment: s.comment || null,
      })),
      createdAt: doc.createdAt,
      completedAt,
    });
  } catch (err) { return handleError(err); }
}
