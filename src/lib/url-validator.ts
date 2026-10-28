// Created: 2026-02-27
// SSRF 방지 — 외부 URL 검증 유틸

const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // 127.0.0.0/8
  /^10\./,                           // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12
  /^192\.168\./,                     // 192.168.0.0/16
  /^169\.254\./,                     // Link-local
  /^0\./,                            // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "[::1]",
  "[::0]",
  "[0:0:0:0:0:0:0:1]",
  "[0:0:0:0:0:0:0:0]",
  "metadata.google.internal",
];

/** IPv4/IPv6 리터럴이 사설·링크로컬·ULA 범위인지 (해석된 실 IP 검사용) */
export function isPrivateIpLiteral(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(s))) return true;
  // IPv6: 루프백(::1), ULA(fc00::/7 → fc/fd), 링크로컬(fe80::/10), IPv4-mapped(::ffff:a.b.c.d)
  if (s === "::1" || s === "::" ) return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(s)) return true;      // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(s)) return true;         // fe80::/10
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return PRIVATE_IP_PATTERNS.some((re) => re.test(mapped[1]));
  return false;
}

/** 숫자만의 host(예: 2130706433, 0x7f000001, 017700000001)를 점표기 IPv4로 정규화 — 아니면 null */
function decodeNumericHost(host: string): string | null {
  let n: number | null = null;
  if (/^\d+$/.test(host)) n = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) n = parseInt(host, 16);
  else if (/^0[0-7]+$/.test(host)) n = parseInt(host, 8);
  if (n === null || !Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function isPrivateIp(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;
  const numeric = decodeNumericHost(lower);
  if (numeric && PRIVATE_IP_PATTERNS.some((re) => re.test(numeric))) return true;
  if (isPrivateIpLiteral(lower)) return true;
  return PRIVATE_IP_PATTERNS.some((re) => re.test(lower));
}

/** DNS 해석 후 실 IP까지 검증 — 호스트명→내부IP·DNS 리바인딩 차단. https 강제. */
export async function assertSafeOutboundUrl(urlStr: string): Promise<URL> {
  const url = validateExternalUrl(urlStr);        // 리터럴/숫자/프로토콜/포트 1차 검증
  if (url.protocol !== "https:") throw new Error("https만 허용됩니다");
  try {
    const { lookup } = await import("dns/promises");
    const addrs = await lookup(url.hostname, { all: true });
    for (const a of addrs) if (isPrivateIpLiteral(a.address)) throw new Error("내부 네트워크로 해석되는 호스트입니다");
  } catch (e) {
    if (e instanceof Error && e.message.includes("내부")) throw e;
    // DNS 실패(NXDOMAIN 등)는 fetch 단계에서 자연 실패 — 리터럴 검증은 이미 통과
  }
  return url;
}

/**
 * 외부 URL 검증 — SSRF 방지
 * @throws BadRequestError if URL is internal/private
 */
export function validateExternalUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("유효하지 않은 URL입니다");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`허용되지 않는 프로토콜입니다: ${url.protocol}`);
  }

  if (isPrivateIp(url.hostname)) {
    throw new Error("내부 네트워크 주소는 접근할 수 없습니다");
  }

  // 포트 제한: 80, 443만 허용 (명시된 경우)
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error(`허용되지 않는 포트입니다: ${url.port}`);
  }

  return url;
}
