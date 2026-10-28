// Created: 2026-05-06
// POST /api/clinic/join — 병원 코드로 가입
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError, BadRequestError, NotFoundError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createNotification } from "@/lib/services/notification.service";

export async function POST(request: NextRequest) {
  try {
    await rateLimit(request, "write");
    const { userId } = await requireAuth(request);
    const { code } = await request.json();

    if (!code || typeof code !== "string") throw new BadRequestError("병원 코드를 입력하세요");

    const codeUpper = code.toUpperCase();
    const codeLower = code.toLowerCase();
    const cafes = await prisma.$queryRaw<Array<{
      id: string; name: string; slug: string; enterprise_code_active: boolean;
      settings: Record<string, unknown> | null;
    }>>`SELECT id, name, slug, enterprise_code_active, settings FROM cafes
       WHERE (enterprise_code = ${codeUpper} OR enterprise_custom_slug = ${codeLower})
         AND cafe_type IN ('hospital', 'clinic')
       LIMIT 1`;

    const cafe = cafes[0];
    if (!cafe) throw new NotFoundError("유효하지 않은 병원 코드입니다");
    if (!cafe.enterprise_code_active) throw new BadRequestError("비활성화된 병원 코드입니다");

    // 이미 멤버인지 확인
    const existingRows = await prisma.$queryRaw<{ role: string }[]>`SELECT role FROM cafe_members WHERE cafe_id = ${cafe.id} AND user_id = ${userId}`;
    if (existingRows.length > 0) {
      return NextResponse.json({
        ok: true, already: true,
        cafe: { name: cafe.name, slug: cafe.slug },
        message: "이미 소속되어 있습니다",
      });
    }

    // [M-4] 멤버 추가 — 담당자 이메일 일치 + 이메일 인증 완료 시 MANAGER 승격
    const contactEmail = (cafe.settings as Record<string, unknown>)?.contactEmail as string | undefined;
    const userEmailRows = await prisma.$queryRaw<{ email: string; email_verified: boolean }[]>`SELECT email, email_verified FROM users WHERE id = ${userId}`;
    const userEmail = userEmailRows[0]?.email;
    const emailVerified = userEmailRows[0]?.email_verified ?? false;
    const role = (contactEmail && userEmail && emailVerified && contactEmail.toLowerCase() === userEmail.toLowerCase()) ? "MANAGER" : "REGULAR";

    // 2026-08-19: 병원 설정 groupwareFeatures.joinApproval 이 켜져 있으면 PENDING 으로 넣고 관리자 승인(카페 멤버 관리) 후 ACTIVE.
    // 기본(꺼짐)은 종전대로 즉시 ACTIVE. 담당자 이메일 일치(MANAGER)는 승인제여도 즉시 활성.
    const gf = ((cafe.settings as Record<string, unknown>)?.groupwareFeatures ?? {}) as Record<string, unknown>;
    const joinApproval = gf.joinApproval === true && role !== "MANAGER";
    const memberStatus = joinApproval ? "PENDING" : "ACTIVE";
    await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, status, joined_at)
       VALUES (gen_random_uuid()::text, ${cafe.id}, ${userId}, ${role}, ${memberStatus}::"CafeMemberStatus", now())`;

    // 관리자에게 알림
    try {
      const admins = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${cafe.id} AND role = 'OWNER'`;
      const userRows = await prisma.$queryRaw<{ username: string }[]>`SELECT username FROM users WHERE id = ${userId}`;
      const user = userRows[0];
      for (const admin of admins) {
        const notifMsg = joinApproval
          ? `${user?.username ?? "새 사용자"}님이 병원 코드로 가입 신청했습니다 — 멤버 관리에서 승인해 주세요`
          : `${user?.username ?? "새 사용자"}님이 병원 코드로 가입했습니다`;
        const notifLink = `/cafes/${cafe.slug}/admin/members`;
        // 2026-08-20: 기존 raw INSERT 는 `link` 컬럼(없음) + 'CAFE_NEW_MEMBER' enum(없음)으로 **항상 실패**했다.
        //   try/catch 라 조용히 삼켜져 관리자에게 가입/승인 요청 알림이 한 건도 가지 않았다(승인제의 유일한 통지 경로).
        await createNotification({
          userId: admin.user_id,
          type: "EXTERNAL_NOTICE",
          title: joinApproval ? "가입 승인 요청" : "새 직원 가입",
          message: notifMsg,
          linkUrl: notifLink,
        });
      }
    } catch { /* 알림 실패 무시 */ }

    return NextResponse.json({
      ok: true, already: false, pending: joinApproval,
      cafe: { name: cafe.name, slug: cafe.slug },
      message: joinApproval ? `${cafe.name}에 가입 신청되었습니다 — 관리자 승인 후 이용할 수 있습니다` : `${cafe.name}에 가입되었습니다`,
    });
  } catch (err) {
    return handleError(err);
  }
}
