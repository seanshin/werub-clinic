// Created: 2026-05-06
// Updated: 2026-06-06 — 보안 헤더 추가 (메인앱과 일관, 의료 데이터 보호)
// Hospital Web — 포트 3600, 메인 앱 API 프록시
const isProd = process.env.NODE_ENV === "production";

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  poweredByHeader: false, // X-Powered-By 노출 제거

  async rewrites() {
    const mainAppUrl = process.env.MAIN_APP_URL || "http://localhost:3000";
    return [
      { source: "/api/:path*", destination: `${mainAppUrl}/api/:path*` },
      { source: "/uploads/:path*", destination: `${mainAppUrl}/uploads/:path*` },
    ];
  },

  // 전체 페이지 보안 헤더 (메인앱과 일관). CSP는 nonce 미들웨어 필요 → 별도 검토
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
            : []),
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      { hostname: "cdn.werub.com" },
      { hostname: "example.org" },
      { hostname: "localhost" },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
