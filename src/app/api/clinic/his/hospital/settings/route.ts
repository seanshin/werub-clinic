// Created: 2026-05-07
// GET/PUT /api/clinic/his/hospital/settings — HIS 연동 설정
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const rows = await prisma.$queryRaw<{ settings: Record<string, unknown> }[]>`SELECT settings FROM cafes WHERE id = ${ctx.cafeId}`;
    const s = (rows[0]?.settings ?? {}) as Record<string, unknown>;
    const his = (s.hisSettings ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      sso: { enabled: true, tokenTtlSeconds: 30, ...(his.sso as object ?? {}) },
      checklist: { enabled: true, autoShowOnCheckin: true, requiredBeforeWork: false, ...(his.checklist as object ?? {}) },
      notifications: { channelEnabled: true, pushEnabled: true, urgentChannelName: "emergency", ...(his.notifications as object ?? {}) },
      calendar: { syncEnabled: true, syncIntervalMinutes: 15, ...(his.calendar as object ?? {}) },
      wsign: { autoApproverLookup: true, callbackUrl: null, ...(his.wsign as object ?? {}) },
      organization: { syncEnabled: true, lastSyncAt: (his.organization as Record<string, unknown>)?.lastSyncAt ?? null, ...(his.organization as object ?? {}) },
    });
  } catch (err) { return handleError(err); }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const body = await request.json();

    await prisma.$executeRaw`UPDATE cafes SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('hisSettings', ${JSON.stringify(body)}::jsonb), updated_at = now() WHERE id = ${ctx.cafeId}`;

    return NextResponse.json({ ok: true, message: "설정이 저장되었습니다" });
  } catch (err) { return handleError(err); }
}
