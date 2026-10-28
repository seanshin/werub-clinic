// Created: 2026-05-07
// Updated: 2026-06-10 — raw SQL 스키마 불일치(500) 수정: Prisma create로 재작성 + viewUrl + history his_meta
// Updated: 2026-07-16 — C-3 재개: 멱등키(Idempotency-Key/externalRef) + 템플릿 3종(근태정정/초과근무/휴가취소) + 응답 status 영문화
// Updated: 2026-07-17 — viewUrl 정본 호스트 고정: clinic.example.org 프록시 경유 호출 시 request origin이 내부 주소가 되어 깨지는 버그.
//   연동 대상 = 병원 워크스페이스(clinic) 전자결재. 병원웹은 자체 wsign 화면 없이 메인앱 /cafes/{slug}/wsign을 사용(대시보드 링크와 동일).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { resolveRecommendedApprovers } from "@/lib/his/approver-resolver";
import { mapDocStatusEn } from "@/lib/his/wsign-callback";
import { emitWsignEvent } from "@/lib/wsign";
import { createNotification } from "@/lib/services/notification.service";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const wsignSchema = z.object({
  templateId: z.string().optional(),
  category: z.string().optional(), // A안: 명시 카테고리(HR|CLINICAL_RECORD|PRE_AUTH) — 분류 1순위, templateId 접두어(B안)는 폴백
  title: z.string().min(1).max(200),
  drafter: z.string(),
  approvers: z.array(z.string()).optional().nullable(),
  autoApproverType: z.enum(["general", "purchase", "leave", "medical"]).optional(),
  content: z.record(z.string(), z.unknown()),
  callbackUrl: z.string().url().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  externalRef: z.string().min(1).max(200).optional(), // 멱등키 (Idempotency-Key 헤더와 동일 취급)
});

// templateId / autoApproverType → W.Sign 병원 docType(한글). 하이픈/언더스코어·대소문자 동등.
// ⚠️ 격리(I3): 이 라우트는 clinic/his 전용 → 병원 카테고리(DOC_TYPES_CLINIC)로 매핑. 공용 상신과 무관.
// 매핑 정본: clinic-wsign-category-system.plan.md §3.3 (HIS 3종 HR/CLINICAL_RECORD/PRE_AUTH → 병원 7종)
const DOCTYPE_MAP: Record<string, string> = {
  // HR 계열 (구 templateId 하위호환 포함)
  hr: "인사·근태", leave: "인사·근태", attendance_correction: "인사·근태", overtime: "인사·근태", leave_cancel: "인사·근태",
  // 진료·의무기록 (구 medical 재사용)
  clinical_record: "진료·의무기록", medical: "진료·의무기록", opinion: "진료·의무기록", summary: "진료·의무기록",
  // 보험·심사
  pre_auth: "보험·심사", insurance: "보험·심사", procedure: "보험·심사",
  // 구매·재무
  purchase: "구매·재무",
  general: "기타",
};
// 접두어 매칭: 하위 양식(CLINICAL_RECORD_summary 등)을 카테고리로 흡수
// HIS templateId 14종은 `{docType}:{subtype}` 콜론 규격(relay-his-wsign-templateid-regspec 2026-07-20)
// — norm()이 콜론도 _로 접어 접두어 매칭에 태운다. category(A안) 미동봉 상신도 분류되도록 4종 docType 등재.
const CLINIC_PREFIX_MAP: [string, string][] = [
  ["hr", "인사·근태"],
  ["clinical_record", "진료·의무기록"],
  ["clinical_certificate", "진료·의무기록"],      // 진단서·소견서·입퇴원확인서
  ["consent_doctor_sign", "진료·의무기록"],       // 동의서 9종
  ["clinical_note_cosign", "진료·의무기록"],      // 간호기록 공동서명
  ["medical_record_copy_approval", "진료·의무기록"], // 의무기록 사본
  ["pre_auth", "보험·심사"],
];
function resolveDocType(templateId?: string, autoType?: string, category?: string): string {
  const norm = (v?: string) => (v ?? "").toLowerCase().replace(/[-:]/g, "_");
  // A안 1순위: 명시 category 필드(HR/CLINICAL_RECORD/PRE_AUTH …) → B안(templateId 접두어) → autoType 폴백
  for (const key of [norm(category), norm(templateId), norm(autoType)]) {
    if (!key) continue;
    if (DOCTYPE_MAP[key]) return DOCTYPE_MAP[key];               // 정확 일치 우선
    const pref = CLINIC_PREFIX_MAP.find(([p]) => key === p || key.startsWith(p + "_"));
    if (pref) return pref[1];                                    // 접두어 매칭
  }
  return "기타";
}

// viewUrl 정본 호스트 — request origin 사용 금지(clinic.example.org 프록시 경유 시 내부 주소로 깨짐)
const MAIN_HOST = process.env.NEXT_PUBLIC_APP_URL || "https://example.org";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "wsign");
    await rateLimit(request, "write");
    const body = await request.json();
    const data = wsignSchema.parse(body);

    // 멱등키: Idempotency-Key 헤더 우선, body.externalRef 겸용 — 동일 키 재상신 시 기존 문서 반환(중복 생성 방지)
    const idemKey = request.headers.get("idempotency-key")?.trim() || data.externalRef || null;
    if (idemKey) {
      const existing = await prisma.wsignDocument.findFirst({
        where: { cafeId: ctx.cafeId, sourceService: "his", externalRef: idemKey },
        select: { id: true, docNumber: true, status: true, currentStep: true },
      });
      if (existing) {
        const steps = await prisma.wsignApprovalStep.findMany({
          where: { documentId: existing.id }, orderBy: { stepIndex: "asc" },
          select: { stepIndex: true, memberId: true, status: true },
        });
        const slugRow0 = await prisma.cafe.findUnique({ where: { id: ctx.cafeId }, select: { slug: true } }).catch(() => null);
        return NextResponse.json({
          ok: true,
          idempotent: true,
          docId: existing.id,
          docNumber: existing.docNumber,
          status: mapDocStatusEn(existing.status),
          viewUrl: `${MAIN_HOST}/cafes/${slugRow0?.slug ?? ""}/wsign?doc=${existing.id}`,
          approvalLine: steps.map((s) => ({
            step: s.stepIndex + 1, userId: s.memberId,
            // 진행 중 단계는 문서 currentStep 기준(stepIndex===0 아님) — status 엔드포인트와 일관(M6)
            status: s.status === "대기" ? (s.stepIndex === existing.currentStep ? "pending" : "waiting") : s.status === "반려" ? "rejected" : "approved",
          })),
        });
      }
    }

    // 기안자 멤버 확인 — 활성(ACTIVE) 멤버만 상신 가능(퇴사/차단자 상신 차단, L5)
    const members = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${ctx.cafeId} AND user_id = ${data.drafter} AND status = 'ACTIVE'`;
    if (members.length === 0) {
      return NextResponse.json({ error: "기안자가 병원 소속이 아니거나 비활성 상태입니다" }, { status: 400 });
    }

    // 결재자 자동 추천 (approvers가 없고 autoApproverType이 있을 때) — in-process(H2, 프록시 origin 깨짐 회피)
    let approvers = data.approvers ?? [];
    if (approvers.length === 0 && data.autoApproverType) {
      const rec = await resolveRecommendedApprovers(ctx.cafeId, data.drafter, data.autoApproverType);
      approvers = (rec?.recommendedLine ?? []).map((l) => l.userId);
    }

    // 결재선 필수 — 결재자 0이면 "검토중"인데 처리 불가한 좀비 문서가 됨(전결/승인/반려 전부 "대기 단계 없음").
    // approvers 미지정 + autoApproverType 추천도 0건(기안자 보고라인 미등록 등)이면 상신 거부.
    // 기안자 자신은 첫 결재자가 될 수 없음(자기결재 방지) → 필터링 후에도 남아야 함.
    approvers = [...new Set(approvers.filter((id) => id && id !== data.drafter))]; // 중복 결재자 제거(L4)
    if (approvers.length === 0) {
      return NextResponse.json({
        error: "결재선을 결정할 수 없습니다. approvers를 지정하거나, 기안자의 조직도 보고라인(managerEmployeeNumber)을 등록한 뒤 autoApproverType으로 상신하세요.",
        code: "NO_APPROVER",
      }, { status: 400 });
    }

    // 보안: 결재자는 모두 이 병원의 활성 멤버여야 함(비멤버·퇴사자에게 결재권 부여 차단)
    const activeApprovers = await prisma.cafeMember.findMany({
      where: { cafeId: ctx.cafeId, userId: { in: approvers }, status: "ACTIVE" }, select: { userId: true },
    });
    const activeSet = new Set(activeApprovers.map((m) => m.userId));
    const invalidApprovers = approvers.filter((id) => !activeSet.has(id));
    if (invalidApprovers.length > 0) {
      return NextResponse.json({ error: "결재자 중 병원 활성 멤버가 아닌 사용자가 있습니다", code: "INVALID_APPROVER", invalid: invalidApprovers }, { status: 400 });
    }

    const docType = resolveDocType(data.templateId, data.autoApproverType, data.category);
    const status = "검토중";
    const docId = `wsign-his-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowStr = new Date().toISOString();
    const amount = typeof (data.content as { amount?: unknown }).amount === "number"
      ? (data.content as { amount: number }).amount : null;

    // history: 기안 이력 + HIS 연동 메타(콜백 발송 시 참조)
    const history = [
      { action: "기안", by: data.drafter, at: nowStr },
      { type: "his_meta", source: "his", templateId: data.templateId ?? null, callbackUrl: data.callbackUrl ?? null },
    ];

    const created = await prisma.$transaction(async (tx) => {
      // 문서번호 시퀀스
      const prefix = docType.slice(0, 2).toUpperCase();
      const year = new Date().getFullYear();
      await tx.$executeRaw`INSERT INTO wsign_doc_sequences (cafe_id, last_seq) VALUES (${ctx.cafeId}, 0) ON CONFLICT (cafe_id) DO NOTHING`;
      const [seq] = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE wsign_doc_sequences SET last_seq = last_seq + 1 WHERE cafe_id = ${ctx.cafeId} RETURNING last_seq`;
      const docNumber = `${prefix}-${year}-${String(seq.last_seq).padStart(4, "0")}`;

      // docType과 동명인 문서함 카테고리로 자동 배치(있으면). 병원 프리셋 폴더와 정렬.
      const cat = await tx.wsignDocCategory.findFirst({
        where: { cafeId: ctx.cafeId, name: docType },
        select: { id: true },
      });

      const doc = await tx.wsignDocument.create({
        data: {
          id: docId,
          cafeId: ctx.cafeId,
          docNumber,
          title: data.title,
          docType,
          categoryId: cat?.id ?? null, // 동명 카테고리 자동 배치
          drafterId: data.drafter,
          amount,
          status,
          approvalMode: "sequential",
          currentStep: 0,
          content: JSON.stringify(data.content),
          attachments: data.attachments ?? [],
          history,
          sourceService: "his", // 연동 출처 태깅 (결재함/연동 문서함 분리)
          externalRef: idemKey, // 멱등키 (재상신 dedup 조회 키)
        },
      });

      if (approvers.length > 0) {
        await tx.wsignApprovalStep.createMany({
          data: approvers.map((memberId, i) => ({
            documentId: doc.id,
            stepIndex: i,
            memberId,
            role: i === approvers.length - 1 ? "최종승인" : "결재",
            status: "대기",
          })),
        });
      }
      return { doc, docNumber };
    }).catch(async (err) => {
      // 동시 중복 상신 레이스: (cafe_id, external_ref) 부분 유니크 인덱스 충돌 시 기존 문서로 수렴
      if (idemKey && (err as { code?: string }).code === "P2002") {
        const dup = await prisma.wsignDocument.findFirst({
          where: { cafeId: ctx.cafeId, sourceService: "his", externalRef: idemKey },
          select: { id: true, docNumber: true },
        });
        if (dup) return { doc: { id: dup.id }, docNumber: dup.docNumber, idempotent: true } as const;
      }
      throw err;
    });

    if ((created as { idempotent?: boolean }).idempotent) {
      // 레이스로 기존 문서 수렴 — 실제 상태/결재선을 조회해 반환(M6, 하드코딩 pending·빈 배열 금지)
      const [dupDoc, dupSteps, slugRow1] = await Promise.all([
        prisma.wsignDocument.findUnique({ where: { id: created.doc.id }, select: { status: true, currentStep: true } }),
        prisma.wsignApprovalStep.findMany({ where: { documentId: created.doc.id }, orderBy: { stepIndex: "asc" }, select: { stepIndex: true, memberId: true, status: true } }),
        prisma.cafe.findUnique({ where: { id: ctx.cafeId }, select: { slug: true } }).catch(() => null),
      ]);
      return NextResponse.json({
        ok: true, idempotent: true, docId: created.doc.id, docNumber: created.docNumber,
        status: mapDocStatusEn(dupDoc?.status ?? "검토중"),
        viewUrl: `${MAIN_HOST}/cafes/${slugRow1?.slug ?? ""}/wsign?doc=${created.doc.id}`,
        approvalLine: dupSteps.map((s) => ({
          step: s.stepIndex + 1, userId: s.memberId,
          status: s.status === "대기" ? (s.stepIndex === (dupDoc?.currentStep ?? 0) ? "pending" : "waiting") : s.status === "반려" ? "rejected" : "approved",
        })),
      });
    }

    const approvalLine = approvers.map((userId, i) => ({
      step: i + 1, userId, status: i === 0 ? "pending" : "waiting",
    }));

    // 첫 결재자 알림 (fire-and-forget)
    if (approvers.length > 0) {
      const cafeRow = await prisma.cafe.findUnique({ where: { id: ctx.cafeId }, select: { slug: true } }).catch(() => null);
      createNotification({
        userId: approvers[0],
        type: "WSIGN_APPROVAL_REQUEST",
        title: `[W.Sign] 결재 요청: ${data.title}`,
        message: "HIS 연동 문서 결재를 요청했습니다",
        linkUrl: cafeRow?.slug ? `/cafes/${cafeRow.slug}/wsign` : "/wsign",
        actorId: data.drafter,
      }).catch(() => {});
    }

    emitWsignEvent(ctx.cafeId, "doc:submitted", { docId, title: data.title, drafterId: data.drafter });

    // W.Channel 연동: 연동 링크가 있으면 상신 카드 게시(브리지가 링크·멤버십 판단, maskAmount 적용).
    // "submit"은 HIS_CALLBACK_EVENT에 없어 HIS로 되돌아가는 콜백은 발생하지 않음(카드만).
    // await로 게시 보장(응답 후 fire-and-forget는 Next에서 완료 미보장). 실패해도 상신은 성공 처리.
    try {
      const { dispatchApprovalEvent } = await import("@/lib/wsign-bridge");
      await dispatchApprovalEvent(
        { id: docId, cafeId: ctx.cafeId, docNumber: created.docNumber, title: data.title, docType, drafterId: data.drafter, amount, status, approvalMode: "sequential", currentStep: 0, sourceService: "his" },
        "submit", data.drafter,
      );
    } catch (e) {
      const { logger } = await import("@/lib/logger");
      logger.warn("HIS_WSIGN_REQUEST", "채널 카드 브리지 실패", { docId, error: (e as Error).message });
    }

    // [M-1] 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_WSIGN_REQUEST", { cafeId: ctx.cafeId, docId, title: data.title, drafter: data.drafter });
    } catch {}

    const slugRow = await prisma.cafe.findUnique({ where: { id: ctx.cafeId }, select: { slug: true } }).catch(() => null);
    const viewUrl = `${MAIN_HOST}/cafes/${slugRow?.slug ?? ""}/wsign?doc=${docId}`;

    return NextResponse.json({
      ok: true,
      docId,
      docNumber: created.docNumber,
      status: mapDocStatusEn(status), // "pending" — HIS 계약 영문 상태(스펙 §5.1)
      viewUrl,
      approvalLine,
    });
  } catch (err) { return handleError(err); }
}
