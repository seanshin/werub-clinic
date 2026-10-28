// Created: 2026-05-07
// Updated: 2026-07-20 — 추천 로직을 approver-resolver.ts(in-process 공용)로 이관(H2).
//   기안자→직속 상급자→차상위(최대 2인). 휴직·퇴직·비활성 제외. 보고라인 없으면 직위 휴리스틱 폴백.
// GET /api/clinic/his/organization/approvers — 결재선 자동 추천
import { NextRequest, NextResponse } from "next/server";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";
import { resolveRecommendedApprovers } from "@/lib/his/approver-resolver";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const rawType = url.searchParams.get("type") ?? url.searchParams.get("docType") ?? "general";
    if (!userId) throw new BadRequestError("userId가 필요합니다");

    const rec = await resolveRecommendedApprovers(ctx.cafeId, userId, rawType);
    if (!rec) throw new BadRequestError("직원을 찾을 수 없습니다");
    return NextResponse.json(rec);
  } catch (err) { return handleError(err); }
}
