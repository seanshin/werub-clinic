// Created: 2026-05-07
// DELETE /api/clinic/his/webhooks/[webhookId] — Webhook 삭제
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";

type Params = { params: Promise<{ webhookId: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "notify");
    const { webhookId } = await params;

    await prisma.$executeRaw`DELETE FROM his_webhooks WHERE id = ${webhookId} AND cafe_id = ${ctx.cafeId}`;

    return NextResponse.json({ ok: true, message: "Webhook이 삭제되었습니다" });
  } catch (err) { return handleError(err); }
}
