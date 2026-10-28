// Created: 2026-05-07
// GET /api/clinic/his/wiki/page/[pageId] — Wiki 페이지 상세
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ pageId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireHisAuth(request, "wiki");
    const { pageId } = await params;
    const format = new URL(request.url).searchParams.get("format") ?? "html";

    const rows = await prisma.$queryRaw<Array<{
      id: string; title: string; content: string | null; content_text: string | null;
      materialized_path: string; updated_by: string | null; updated_by_username: string | null;
      updated_at: Date; version: number;
    }>>`SELECT wp.id, wp.title, wp.content, wp.content_text, wp.materialized_path,
              wp.updated_by, u.username as updated_by_username, wp.updated_at, wp.version
       FROM wiki_pages wp
       LEFT JOIN users u ON u.id = wp.updated_by
       JOIN wiki_instances wi ON wi.id = wp.wiki_id
       WHERE wp.id = ${pageId} AND wi.cafe_id = ${ctx.cafeId} AND wp.deleted_at IS NULL`;

    if (rows.length === 0) throw new NotFoundError("페이지를 찾을 수 없습니다");
    const p = rows[0];

    return NextResponse.json({
      id: p.id,
      title: p.title,
      content: format === "json" ? p.content : p.content_text,
      format,
      path: p.materialized_path,
      author: p.updated_by ? { userId: p.updated_by, username: p.updated_by_username } : null,
      updatedAt: p.updated_at,
      version: p.version,
    });
  } catch (err) { return handleError(err); }
}
