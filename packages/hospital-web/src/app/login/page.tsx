// Created: 2026-04-29
// Updated: 2026-05-14 — 병원 코드 + identifier + 소셜로그인 + 2FA 통합
// Updated: 2026-08-19 — auth-ui 표준 LoginForm 채택(로그인 화면 명칭·문구 단일화 P3). 헤더 "W.Clinic — 병원 플랫폼" 병기,
//   병원 코드는 renderBeforeForm 슬롯, 합류는 onLoggedIn(await), 소셜은 from=clinic + redirect(코드 동봉)로 원래 화면 복귀
//   (이전엔 from=hospital 이라 콜백 SERVICE_URLS에 없어 메인 홈으로 떨어졌고 code 도 버려졌다).
// clinic.example.org/login — 병원 로그인 (병원 코드 필수, 이메일 또는 아이디)
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm, sanitizeRedirect, getMainAppOrigin, AUTH_COPY, type SocialProvider } from "@werub/auth-ui";
import { KeyRound, Check, Loader2 } from "lucide-react";
import { hfetch } from "@/lib/api";
import { setPreferredClinic } from "@/lib/clinic-context";
import { ec } from "@/lib/error-codes";

const SC = "HW-LOGIN";
const CODE_LABEL = "병원 코드";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = sanitizeRedirect(searchParams?.get("redirect"), "/dashboard");
  const codeParam = searchParams?.get("code");
  const socialReturn = searchParams?.get("social") === "1";

  const [hospitalCode, setHospitalCode] = useState((codeParam ?? "").toUpperCase());
  const [codeVerified, setCodeVerified] = useState<{ name: string; slug?: string } | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState("");

  const verifyCode = useCallback(async (code?: string): Promise<{ name: string; slug?: string } | null> => {
    const c = (code ?? hospitalCode).trim();
    if (!c) return null;
    setCodeLoading(true);
    setCodeError("");
    setCodeVerified(null);
    try {
      const res = await hfetch(`/api/clinic/verify/${encodeURIComponent(c)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "유효하지 않은 병원 코드");
      const v = { name: data.cafe.name as string, slug: data.cafe.slug as string | undefined };
      setCodeVerified(v);
      if (v.slug) setPreferredClinic(v.slug); // 이 병원으로 진입(CLI-70)
      return v;
    } catch (err) {
      setCodeError(`${ec(SC, 3)} ${err instanceof Error ? err.message : "코드 확인 실패"}`);
      return null;
    } finally {
      setCodeLoading(false);
    }
  }, [hospitalCode]);

  const joinHospital = useCallback(async () => {
    // 병원 코드로 합류 (이미 멤버면 무시됨). 실패는 대시보드의 "소속 없음" 화면이 안내한다.
    await hfetch("/api/clinic/join", { method: "POST", body: JSON.stringify({ code: hospitalCode.trim() }) }).catch(() => {});
  }, [hospitalCode]);

  // URL에 코드가 있으면 자동 검증. 소셜 로그인 복귀(?social=1)면 이미 로그인 상태이므로 합류 후 대시보드로.
  useEffect(() => {
    if (!codeParam) return;
    (async () => {
      const v = await verifyCode(codeParam);
      if (socialReturn && v) {
        const me = await hfetch("/api/auth/me").catch(() => null);
        if (me?.ok) { await joinHospital(); router.replace(redirectUrl); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSocialLogin = (provider: SocialProvider) => {
    // 소셜은 메인앱 도메인에서 시작(OAuth state 쿠키). 콜백이 인식하는 from=clinic + 복귀 URL에 코드 동봉
    const back = `${window.location.origin}/login?code=${encodeURIComponent(hospitalCode.trim())}&social=1${redirectUrl !== "/dashboard" ? `&redirect=${encodeURIComponent(redirectUrl)}` : ""}`;
    window.location.href = `${getMainAppOrigin()}/api/auth/${provider}?from=clinic&redirect=${encodeURIComponent(back)}`;
  };

  return (
    <LoginForm
      service="clinic"
      socialLogin={["google", "naver", "kakao"]}
      twoFactor
      submitDisabled={!codeVerified}
      onLoggedIn={joinHospital}
      onSuccess={() => router.push(redirectUrl)}
      onSocialLogin={handleSocialLogin}
      links={{ signup: "/register" }}
      renderBeforeForm={() => (
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            <KeyRound size={12} className="inline mr-1 text-emerald-500" />
            {CODE_LABEL}
          </label>
          <div className="flex gap-2">
            <input
              value={hospitalCode}
              onChange={(e) => { setHospitalCode(e.target.value.toUpperCase()); setCodeVerified(null); setCodeError(""); }}
              placeholder="WRB-XXXX-XXXX"
              className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-mono font-bold tracking-wider text-center outline-none"
            />
            <button type="button" onClick={() => verifyCode()} disabled={!hospitalCode.trim() || codeLoading}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 shrink-0 transition-colors">
              {codeLoading ? <Loader2 size={14} className="animate-spin" /> : AUTH_COPY.button.confirm}
            </button>
          </div>
          {codeError && <p className="text-xs text-red-500 mt-1">{codeError}</p>}
          {codeVerified && (
            <div className="flex items-center gap-2 mt-2 p-2.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{codeVerified.name}</span>
            </div>
          )}
          {!codeVerified && !codeError && (
            <p className="text-xs mt-1" style={{ color: "var(--auth-muted)" }}>{CODE_LABEL}를 먼저 확인하세요</p>
          )}
        </div>
      )}
    />
  );
}
