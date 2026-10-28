// Created: 2026-05-07
// GET /api/clinic/his/wiki/search — Wiki 문서 검색
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "wiki");
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);
    if (!q) throw new BadRequestError("검색어 q 파라미터가 필요합니다");

    // wiki_instances에서 카페용 위키 ID 조회
    const instances = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM wiki_instances WHERE cafe_id = ${ctx.cafeId} AND instance_type = 'cafe' LIMIT 1`;
    if (instances.length === 0) {
      return NextResponse.json({ results: [], total: 0 });
    }
    const wikiId = instances[0].id;

    const rows = await prisma.$queryRaw<Array<{
      id: string; title: string; path: string; updated_at: Date;
      updated_by_username: string | null; content_snippet: string | null;
    }>>`SELECT wp.id, wp.title, wp.materialized_path as path, wp.updated_at,
              u.username as updated_by_username,
              LEFT(wp.content_text, 200) as content_snippet
       FROM wiki_pages wp
       LEFT JOIN users u ON u.id = wp.updated_by
       WHERE wp.wiki_id = ${wikiId} AND wp.deleted_at IS NULL
         AND (wp.title ILIKE '%' || ${q} || '%' OR wp.content_text ILIKE '%' || ${q} || '%')
       ORDER BY wp.updated_at DESC
       LIMIT ${limit}`;

    return NextResponse.json({
      results: rows.map(r => ({
        id: r.id,
        title: r.title,
        path: r.path,
        excerpt: r.content_snippet,
        updatedAt: r.updated_at,
        author: r.updated_by_username,
      })),
      total: rows.length,
    });
  } catch (err) { return handleError(err); }
}
