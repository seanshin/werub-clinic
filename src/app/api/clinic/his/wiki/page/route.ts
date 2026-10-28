// Created: 2026-05-07
// POST /api/clinic/his/wiki/page — HIS에서 Wiki 페이지 생성
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const pageSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  format: z.enum(["html", "json"]).optional().default("html"),
  parentPath: z.string().optional(),
  author: z.string(),
  tags: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "wiki");
    await rateLimit(request, "write");
    const body = await request.json();
    const data = pageSchema.parse(body);

    // wiki_instances 조회
    const instances = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM wiki_instances WHERE cafe_id = ${ctx.cafeId} AND instance_type = 'cafe' LIMIT 1`;
    if (instances.length === 0) {
      return NextResponse.json({ error: "Wiki가 활성화되지 않았습니다" }, { status: 400 });
    }
    const wikiId = instances[0].id;

    const pageId = `wiki-his-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const slug = data.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "-").replace(/-+/g, "-").slice(0, 50);
    const path = data.parentPath ? `${data.parentPath}/${slug}` : `/${slug}`;

    const _jsonContent = data.format === "json" ? data.content : null;
    const _htmlContent = data.format === "html" ? data.content : null;
    await prisma.$executeRaw`INSERT INTO wiki_pages (id, wiki_id, title, slug, content, content_text, materialized_path, created_by, updated_by, version, created_at, updated_at)
       VALUES (${pageId}, ${wikiId}, ${data.title}, ${slug}, ${_jsonContent}, ${_htmlContent}, ${path}, ${data.author}, ${data.author}, 1, now(), now())`;

    return NextResponse.json({ ok: true, pageId, path });
  } catch (err) { return handleError(err); }
}
