// Created: 2026-02-08

/** Convert a string to a URL-safe slug (영문/숫자만, 한글은 랜덤 코드로 대체). */
export function toSlug(text: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")  // 영문/숫자/공백/하이픈만 유지
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  // 영문이 없으면 (한글만 입력 등) 랜덤 코드 생성
  if (!ascii || ascii.length < 2) {
    return `cafe-${Math.random().toString(36).slice(2, 8)}`;
  }
  return ascii;
}

/** Generate a unique slug by appending a random suffix on conflict. */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = toSlug(base);

  // Fallback when slug is empty (e.g. special characters only)
  if (!slug) {
    slug = `cafe-${Math.random().toString(36).slice(2, 6)}`;
  }

  if (!(await exists(slug))) return slug;

  for (let i = 0; i < 10; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${slug}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
