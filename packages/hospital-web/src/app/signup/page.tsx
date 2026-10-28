// Created: 2026-05-06
// clinic.example.org/signup — 병원 전용 회원가입 (병원 코드 + 계정 생성 동시)
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { ec } from "@/lib/error-codes";
import { Check, Loader2, KeyRound, Stethoscope, ArrowRight } from "lucide-react";

const SC = "HW-SIGNUP";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeParam = searchParams?.get("code");

  // 병원 코드
  const [hospitalCode, setHospitalCode] = useState(codeParam ?? "");
  const [codeVerified, setCodeVerified] = useState<{ name: string; slug: string } | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState("");

  // 회원가입
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);

  // 상태
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Turnstile
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileIdRef = useRef<string | null>(null);

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const renderTurnstile = useCallback(() => {
    const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey || !turnstileRef.current) return;
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void } };
    if (!w.turnstile) return;
    if (turnstileIdRef.current) { try { w.turnstile.remove(turnstileIdRef.current); } catch {} }
    turnstileIdRef.current = w.turnstile.render(turnstileRef.current, {
      sitekey, theme: "light", callback: (token: string) => { setTurnstileToken(token); },
    });
  }, []);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return;
    const tryRender = () => {
      if ((window as unknown as { turnstile?: unknown }).turnstile) { renderTurnstile(); return true; }
      return false;
    };
    if (tryRender()) return;
    const check = setInterval(() => { if (tryRender()) clearInterval(check); }, 300);
    return () => clearInterval(check);
  }, [renderTurnstile]);

  // URL에 코드가 있으면 자동 검증
  useEffect(() => {
    if (codeParam) verifyCode(codeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyCode = async (code?: string) => {
    const c = (code ?? hospitalCode).trim();
    if (!c) return;
    setCodeLoading(true); setCodeError(""); setCodeVerified(null);
    try {
      const res = await hfetch(`/api/clinic/verify/${encodeURIComponent(c)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "유효하지 않은 병원 코드");
      setCodeVerified({ name: data.cafe.name, slug: data.cafe.slug });
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "코드 확인 실패");
    } finally { setCodeLoading(false); }
  };

  const handleSignup = async () => {
    if (!codeVerified) { setError("병원 코드를 먼저 확인하세요"); return; }
    if (!isValidEmail(email)) { setError("올바른 이메일 주소를 입력하세요"); return; }
    if (!username.trim()) { setError("사용자명을 입력하세요"); return; }
    if (password.length < 8) { setError("비밀번호는 8자 이상이어야 합니다"); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다"); return; }
    if (!agreeTerms) { setError("이용약관에 동의해 주세요"); return; }

    setLoading(true); setError("");
    try {
      // 1. 회원가입
      const regRes = await hfetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, username, password, turnstileToken }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) throw new Error(regData.error ?? "회원가입 실패");

      // 2. 병원 코드로 합류
      const joinRes = await hfetch("/api/clinic/join", {
        method: "POST",
        body: JSON.stringify({ code: hospitalCode.trim() }),
      });
      const joinData = await joinRes.json();
      if (!joinRes.ok) throw new Error(joinData.error ?? "병원 합류 실패");

      setDone(true);
    } catch (err) {
      setError(`${ec(SC, 1)} ${err instanceof Error ? err.message : "가입 실패"}`);
    } finally { setLoading(false); }
  };

  // 완료 화면
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50">
        <HospitalHeader />
        <main className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">가입이 완료되었습니다!</h1>
          <p className="text-sm text-gray-500 mb-2"><strong>{codeVerified?.name}</strong>에 합류했습니다.</p>
          <Link href="/dashboard" className="inline-flex items-center gap-1 mt-6 px-6 py-3 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700">
            대시보드로 이동 <ArrowRight size={14} />
          </Link>
        </main>
        <HospitalFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader />
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-6">
          <Stethoscope size={28} className="mx-auto text-emerald-500 mb-2" />
          <h1 className="text-2xl font-black text-gray-900">병원 회원가입</h1>
          <p className="text-sm text-gray-500 mt-1">병원 코드와 함께 계정을 생성합니다</p>
        </div>

        {error && <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          {/* 병원 코드 */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              <KeyRound size={12} className="inline mr-1 text-emerald-500" />병원 코드 *
            </label>
            <div className="flex gap-2">
              <input value={hospitalCode} onChange={e => { setHospitalCode(e.target.value.toUpperCase()); setCodeVerified(null); setCodeError(""); }}
                placeholder="WRB-XXXX-XXXX"
                className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm font-mono font-bold tracking-wider text-center" />
              <button onClick={() => verifyCode()} disabled={!hospitalCode.trim() || codeLoading}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 shrink-0">
                {codeLoading ? <Loader2 size={14} className="animate-spin" /> : "확인"}
              </button>
            </div>
            {codeError && <p className="text-xs text-red-500 mt-1">{codeError}</p>}
            {codeVerified && (
              <div className="flex items-center gap-2 mt-2 p-2.5 bg-emerald-50 rounded-xl border border-emerald-200">
                <Check size={14} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-bold text-emerald-700">{codeVerified.name}</span>
              </div>
            )}
          </div>

          <hr className="border-gray-100" />

          {/* 계정 정보 */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">이메일 *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@hospital.example"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
            {email && !isValidEmail(email) && <p className="text-xs text-red-500 mt-1">올바른 이메일 형식을 입력하세요</p>}
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">사용자명 *</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="2~20자, 영문/숫자/밑줄"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">비밀번호 *</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="8자 이상"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">비밀번호 확인</label>
            <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSignup()}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} className="mt-0.5 rounded" />
            <span className="text-xs text-gray-500">
              <a href="https://example.org/terms" target="_blank" className="text-emerald-600 underline">이용약관</a> 및{" "}
              <a href="https://example.org/privacy" target="_blank" className="text-emerald-600 underline">개인정보처리방침</a>에 동의합니다
            </span>
          </label>

          {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="flex justify-center" />}

          <button onClick={handleSignup}
            disabled={loading || !codeVerified || !email || !isValidEmail(email) || !username || !password || !passwordConfirm || !agreeTerms}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-700 transition-colors">
            {loading ? <Loader2 size={16} className="inline animate-spin" /> : "가입 후 병원 합류"}
          </button>
        </div>

        <div className="text-center mt-6 space-y-2">
          <p className="text-sm text-gray-400">
            이미 계정이 있으신가요? <Link href="/login" className="text-emerald-600 font-medium hover:underline">로그인 →</Link>
          </p>
          <p className="text-sm text-gray-400">
            병원을 등록하시겠어요? <Link href="/register" className="text-emerald-600 font-medium hover:underline">병원 등록 신청 →</Link>
          </p>
        </div>
      </main>
      <HospitalFooter />
    </div>
  );
}

export default function SignupPage() {
  return <Suspense><SignupForm /></Suspense>;
}
