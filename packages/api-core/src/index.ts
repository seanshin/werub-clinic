// Created: 2026-05-12
// @werub/api-core — 통합 API 래퍼
// CSRF 자동 갱신, 401 refresh (중복 방지), WebView 브리지, FormData 구분, cache

export interface ApiCoreConfig {
  /** 서비스 식별자 — 세션 관리용 */
  service: "werub" | "enterprise" | "office" | "clinic" | "channel" | "blog" | "vibe";
  /** 401 발생 + refresh 실패 시 호출 (로그인 리다이렉트 등) */
  onUnauthorized?: () => void;
  /** API base URL (기본: "" — Next.js rewrites 사용) */
  baseUrl?: string;
  /** WebView 브리지 — Bearer 토큰 자동 주입 (모바일 앱 전용) */
  bridgeTokenProvider?: () => string | null;
}

const CSRF_COOKIE = "werub_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 통합 API 클라이언트 생성
 *
 * ```ts
 * const cfetch = createApiClient({ service: "channel", onUnauthorized: () => location.href = "/login" });
 * const res = await cfetch("/api/cafes?my=true");
 * ```
 */
export function createApiClient(config: ApiCoreConfig) {
  let csrfToken: string | null = null;
  let refreshPromise: Promise<boolean> | null = null;

  // ── CSRF ────────────────────────────────────────────────
  let csrfFetchPromise: Promise<string> | null = null;

  function getCsrf(): string {
    if (csrfToken) return csrfToken;
    if (typeof document === "undefined") return "";
    // httpOnly 쿠키는 JS에서 읽을 수 없으므로 캐시된 값만 반환
    return "";
  }

  /** CSRF 토큰 확보 — 캐시 없으면 /api/auth/csrf에서 가져옴 */
  async function ensureCsrf(): Promise<string> {
    if (csrfToken) return csrfToken;
    if (csrfFetchPromise) return csrfFetchPromise;
    csrfFetchPromise = (async () => {
      try {
        const res = await fetch(`${config.baseUrl || ""}/api/auth/csrf`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          csrfToken = data.csrfToken ?? res.headers.get(CSRF_HEADER) ?? "";
        }
      } catch { /* ignore */ }
      csrfFetchPromise = null;
      return csrfToken ?? "";
    })();
    return csrfFetchPromise;
  }

  function updateCsrfFromResponse(res: Response): void {
    const token = res.headers.get(CSRF_HEADER);
    if (token) csrfToken = token;
  }

  // ── Refresh ─────────────────────────────────────────────
  async function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const headers: Record<string, string> = {};
        const csrf = getCsrf();
        if (csrf) headers[CSRF_HEADER] = csrf;

        const res = await fetch(`${config.baseUrl || ""}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
        });
        if (res.ok) {
          // 2026-08-19: refresh 응답의 X-CSRF-Token을 그대로 보존한다. 이전엔 바로 null로 지웠는데 werub_csrf는
          // httpOnly라 "쿠키에서 재읽기"가 불가능 → 401 재시도 mutation이 빈 CSRF로 나가 403이 났다.
          updateCsrfFromResponse(res);
          if (!csrfToken) await ensureCsrf();
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  // ── Headers ─────────────────────────────────────────────
  function buildHeaders(opts?: RequestInit): Headers {
    const headers = new Headers(opts?.headers);
    const method = (opts?.method || "GET").toUpperCase();

    // Content-Type — FormData는 브라우저가 자동 설정하므로 건드리지 않음
    if (opts?.body && typeof opts.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    // WebView 브리지: Bearer 토큰 우선
    const bridgeToken = config.bridgeTokenProvider?.();
    if (bridgeToken) {
      headers.set("Authorization", `Bearer ${bridgeToken}`);
    } else if (MUTATING.has(method)) {
      // 일반 웹: CSRF 토큰 첨부 (mutation만)
      headers.set(CSRF_HEADER, getCsrf());
    }

    return headers;
  }

  // ── Main Fetch ──────────────────────────────────────────
  return async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
    const fullUrl = `${config.baseUrl || ""}${url}`;
    const method = (opts.method || "GET").toUpperCase();

    // mutation 요청 시 CSRF 토큰 확보 (비동기)
    if (MUTATING.has(method) && !csrfToken) {
      await ensureCsrf();
    }

    const headers = buildHeaders(opts);

    const res = await fetch(fullUrl, {
      ...opts,
      headers,
      credentials: "include",
      cache: "no-store",
    });

    // CSRF 갱신 (모든 응답)
    updateCsrfFromResponse(res);

    // 403 CSRF → 토큰 재발급 → 재시도
    if (res.status === 403 && !url.includes("/api/auth/csrf")) {
      const body = await res.clone().text();
      if (body.includes("CSRF") || body.includes("csrf")) {
        csrfToken = null;
        await ensureCsrf();
        const retryHeaders = buildHeaders(opts);
        const retryRes = await fetch(fullUrl, { ...opts, headers: retryHeaders, credentials: "include", cache: "no-store" });
        updateCsrfFromResponse(retryRes);
        return retryRes;
      }
    }

    // 401 → 자동 refresh → 재시도
    if (res.status === 401 && !url.includes("/api/auth/")) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        // 핵심: 헤더를 새로 빌드 (새 CSRF 토큰 포함) — mutation이면 토큰 확보를 보장
        if (MUTATING.has(method) && !csrfToken) await ensureCsrf();
        const newHeaders = buildHeaders(opts);
        const retryRes = await fetch(fullUrl, {
          ...opts,
          headers: newHeaders,
          credentials: "include",
          cache: "no-store",
        });
        updateCsrfFromResponse(retryRes);
        return retryRes;
      }
      // refresh 실패 → 로그인 리다이렉트
      config.onUnauthorized?.();
    }

    return res;
  };
}
