// Created: 2026-05-06
// Updated: 2026-05-06 — 병원 등록과 회원가입 분리. 여기는 병원 등록만 (계정 불필요)
// clinic.example.org/register — 병원 등록 신청 (관리자 승인 후 → 로그인/가입 가능)
"use client";

import { useState } from "react";
import Link from "next/link";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { Stethoscope, ArrowRight, ArrowLeft, Loader2, Check } from "lucide-react";
import { hfetch } from "@/lib/api";
import { ec } from "@/lib/error-codes";

const SC = "HW-REG";

type Step = 1 | 2 | 3 | 4;

const SPECIALTIES = [
  "내과", "외과", "정형외과", "피부과", "이비인후과", "안과", "치과",
  "산부인과", "소아청소년과", "비뇨기과", "신경외과", "신경과",
  "정신건강의학과", "재활의학과", "마취통증의학과",
  "가정의학과", "응급의학과", "영상의학과", "진단검사의학과",
  "한의원", "한방병원", "종합병원", "상급종합병원", "기타",
];

const HOSPITAL_SIZES = ["5인 미만", "5~15인", "16~50인", "51~100인", "100~300인", "300인 이상"];

export default function HospitalRegisterPage() {
  const [step, setStep] = useState<Step>(1);

  // 병원 정보
  const [hospitalName, setHospitalName] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [representative, setRepresentative] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [hospitalType, setHospitalType] = useState<"clinic" | "hospital">("clinic");

  // 담당자 연락처
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // 기능 설정
  const [hisEnabled, setHisEnabled] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({
    board: true, calendar: true, sharespace: true, attendance: true,
    wsign: false, organization: false, leave: false,
    okr: false, knowledgeAi: false, joinApproval: false,
  });

  // 상태
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ cafeName?: string; already?: boolean } | null>(null);

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleNextToFeatures = () => {
    if (!hospitalName.trim()) { setError("병원명을 입력하세요"); return; }
    if (!contactName.trim()) { setError("담당자 이름을 입력하세요"); return; }
    if (!contactEmail.trim() || !isValidEmail(contactEmail)) { setError("담당자 이메일을 올바르게 입력하세요"); return; }
    setError(""); setStep(3);
  };

  const handleSubmit = async () => {
    setLoading(true); setError("");
    try {
      const res = await hfetch("/api/clinic/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: hospitalName,
          businessNumber,
          representativeName: representative,
          industry: specialty,
          employeeCount,
          cafeType: hospitalType,
          features,
          // 담당자 정보
          contactName,
          contactEmail,
          contactPhone,
          hisEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "병원 등록 실패");
      setResult({
        cafeName: data.cafe?.name ?? hospitalName,
        already: data.already ?? false,
      });
      setStep(4);
    } catch (err) {
      setError(`${ec(SC, 1)} ${err instanceof Error ? err.message : "병원 등록 실패"}`);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader />

      <main className="max-w-2xl mx-auto px-4 py-10">

        {/* ── 진행 단계 표시 ── */}
        {step < 4 && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {[
              { n: 1, label: "병원 정보" },
              { n: 2, label: "담당자 · 상세" },
              { n: 3, label: "기능 선택" },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  step >= s.n ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-400"
                }`}>
                  {step > s.n ? <Check size={14} /> : s.n}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${step >= s.n ? "text-gray-900" : "text-gray-400"}`}>{s.label}</span>
                {i < 2 && <div className={`w-8 h-0.5 ${step > s.n ? "bg-emerald-400" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        )}

        {/* ── Step 1: 병원 기본 정보 ── */}
        {step === 1 && (
          <div>
            <div className="text-center mb-6">
              <Stethoscope size={32} className="mx-auto text-emerald-500 mb-3" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">병원 등록 신청</h1>
              <p className="text-sm text-gray-500">병원 정보를 입력하면 관리자 검토 후 승인됩니다</p>
            </div>

            {error && <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">병원 유형 *</label>
                <div className="flex gap-2">
                  <button onClick={() => setHospitalType("clinic")}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${hospitalType === "clinic" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-500"}`}>
                    🩻 의원 / 병원
                  </button>
                  <button onClick={() => setHospitalType("hospital")}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${hospitalType === "hospital" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-500"}`}>
                    🏥 종합병원
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">병원명 *</label>
                <input value={hospitalName} onChange={e => setHospitalName(e.target.value)} placeholder="OO병원 / OO의원"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">진료과</label>
                <select value={specialty} onChange={e => setSpecialty(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm">
                  <option value="">선택</option>
                  {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">직원 수</label>
                <select value={employeeCount} onChange={e => setEmployeeCount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm">
                  <option value="">선택</option>
                  {HOSPITAL_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button onClick={() => { if (!hospitalName.trim()) { setError("병원명을 입력하세요"); return; } setError(""); setStep(2); }}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-700">
                다음 <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>

            <div className="text-center mt-6">
              <p className="text-sm text-gray-400">
                이미 병원 코드가 있으신가요? <Link href="/login" className="text-emerald-600 font-medium hover:underline">로그인 →</Link>
              </p>
            </div>
          </div>
        )}

        {/* ── Step 2: 담당자 + 상세 정보 ── */}
        {step === 2 && (
          <div>
            <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6">
              <ArrowLeft size={14} /> 돌아가기
            </button>

            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">담당자 · 상세 정보</h2>
              <p className="text-sm text-gray-500 mt-1">승인 결과를 받을 담당자 정보를 입력하세요</p>
            </div>

            {error && <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">담당자 정보</p>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">담당자 이름 *</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="홍길동"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">담당자 이메일 *</label>
                <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="admin@hospital.example"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
                {contactEmail && !isValidEmail(contactEmail) && (
                  <p className="text-xs text-red-500 mt-1">올바른 이메일 형식을 입력하세요</p>
                )}
                <p className="text-xs text-gray-400 mt-1">승인 결과 및 병원 코드가 이 이메일로 발송됩니다</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">연락처</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="010-0000-0000"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
              </div>

              <hr className="border-gray-100" />
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">병원 상세 (선택)</p>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">사업자등록번호</label>
                <input value={businessNumber} onChange={e => setBusinessNumber(e.target.value)} placeholder="000-00-00000"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">대표원장</label>
                <input value={representative} onChange={e => setRepresentative(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm" />
              </div>

              <button onClick={handleNextToFeatures}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
                다음: 기능 선택 <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: 기능 설정 + HIS ── */}
        {step === 3 && (
          <div className="max-w-5xl mx-auto -mx-4 sm:mx-auto">
            <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6 px-4 sm:px-0">
              <ArrowLeft size={14} /> 돌아가기
            </button>

            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">사용할 기능 선택</h2>
              <p className="text-sm text-gray-500 mt-1">승인 후 관리자 설정에서 언제든 변경할 수 있습니다</p>
            </div>

            {error && <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 px-4 sm:px-0">
              {/* 좌측: 기능 체크리스트 */}
              <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-1">그룹웨어 기능</p>
                {[
                  { key: "board", label: "의료진 채널", desc: "실시간 소통 · 인수인계", default: true },
                  { key: "calendar", label: "캘린더 · 근무표", desc: "당직 · 교대 · 수술 일정", default: true },
                  { key: "sharespace", label: "진료 매뉴얼 Wiki", desc: "프로토콜 · 가이드라인", default: true },
                  { key: "attendance", label: "근태 관리", desc: "출퇴근 · 교대 기록", default: true },
                  { key: "wsign", label: "전자결재 (W.Sign)", desc: "의료 문서 결재", default: false },
                  { key: "organization", label: "조직도", desc: "부서 · 직급 · 보고라인", default: false },
                  { key: "leave", label: "연차 관리", desc: "잔여 · 신청 · 승인", default: false },
                  { key: "okr", label: "OKR", desc: "목표 관리", default: false },
                  { key: "knowledgeAi", label: "AI Knowledge", desc: "사내 지식 검색", default: false },
                  { key: "joinApproval", label: "코드 가입 승인제", desc: "병원 코드로 가입한 직원을 관리자가 승인해야 활성화 (기본: 즉시 활성)", default: false },
                ].map(f => (
                  <label key={f.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={features[f.key] ?? f.default}
                      onChange={e => setFeatures(prev => ({ ...prev, [f.key]: e.target.checked }))}
                      className="rounded border-gray-300 text-emerald-600" />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">{f.label}</span>
                      <span className="text-xs text-gray-400 ml-2">{f.desc}</span>
                    </div>
                  </label>
                ))}
              </div>

              {/* 우측: HIS 연동 */}
              <div className="space-y-4">
                <div className={`rounded-2xl border p-6 transition-colors ${hisEnabled ? "bg-blue-50 border-blue-300" : "bg-white border-gray-200"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">🏥</span>
                    <h3 className="text-base font-bold text-gray-900">HIS 연동</h3>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">선택</span>
                  </div>

                  <p className="text-sm text-gray-700 leading-relaxed mb-3">
                    <strong>HIS(Hospital Information System)</strong>는 병원 업무 전반을 관리하는
                    통합 정보 시스템입니다.
                  </p>

                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2">
                    <p className="text-xs font-bold text-gray-600">HIS 연동 시 추가되는 기능</p>
                    <ul className="space-y-1.5 text-xs text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span><strong>진료 접수/예약</strong> — 환자 접수, 예약 관리, 대기 현황</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span><strong>환자 차트</strong> — 진료 기록, 처방 이력, 검사 결과 조회</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span><strong>처방/투약 관리</strong> — 약 처방, DUR 점검, 투약 기록</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span><strong>보험 청구</strong> — 건강보험 EDI 연동, 청구 자동화</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span><strong>의료 물품 관리</strong> — 재고 추적, 자동 발주, 유효기간 알림</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span><strong>통계/BI</strong> — 환자 수, 진료과별 현황, 매출 분석</span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-amber-50 rounded-lg px-3 py-2 mb-4">
                    <p className="text-[11px] text-amber-700">
                      ⚠️ HIS 연동은 별도 구축이 필요하며, 승인 후 담당자가 개별 상담을 진행합니다.
                      기존 EMR/OCS 시스템이 있는 경우 연동 여부를 확인합니다.
                    </p>
                  </div>

                  <label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${hisEnabled ? "bg-blue-100 border border-blue-300" : "bg-gray-100 border border-gray-200"}`}>
                    <input type="checkbox" checked={hisEnabled} onChange={e => setHisEnabled(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 w-5 h-5" />
                    <div>
                      <span className="text-sm font-bold text-gray-900">HIS 연동을 희망합니다</span>
                      <p className="text-xs text-gray-500 mt-0.5">승인 후 HIS 구축 상담이 별도로 진행됩니다</p>
                    </div>
                  </label>
                </div>

                {/* 등록 요약 */}
                <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4">
                  <p className="text-xs font-bold text-emerald-700 mb-2">등록 요약</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                    <span>병원명: <strong>{hospitalName}</strong></span>
                    <span>유형: <strong>{hospitalType === "hospital" ? "종합병원" : "의원/병원"}</strong></span>
                    {specialty && <span>진료과: {specialty}</span>}
                    {employeeCount && <span>규모: {employeeCount}</span>}
                    <span>담당자: {contactName}</span>
                    <span>이메일: {contactEmail}</span>
                    {hisEnabled && <span className="text-blue-600 font-bold col-span-2">🏥 HIS 연동 희망</span>}
                  </div>
                </div>
              </div>
            </div>

            <button onClick={handleSubmit} disabled={loading}
              className="w-full mt-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-700 max-w-2xl mx-auto block">
              {loading ? <Loader2 size={16} className="inline animate-spin" /> : "병원 등록 신청"}
              {!loading && <ArrowRight size={14} className="inline ml-1" />}
            </button>
          </div>
        )}

        {/* ── Step 4: 접수 완료 ── */}
        {step === 4 && (
          <div className="max-w-lg mx-auto text-center">
            <div className="text-5xl mb-4">⏳</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {result?.already ? `이미 등록된 병원입니다` : "병원 등록이 접수되었습니다"}
            </h2>

            {!result?.already && (
              <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 mt-6 text-left">
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse mt-2 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-800 mb-2">다음 단계</p>
                    <ol className="text-xs text-amber-700 leading-relaxed space-y-1.5 list-decimal list-inside">
                      <li>시스템 관리자가 병원 정보를 검토합니다 (1영업일 이내)</li>
                      <li>승인되면 <strong>{contactEmail}</strong>으로 병원 코드가 발송됩니다</li>
                      <li>병원 코드를 받은 후, 이 사이트에서 <strong>로그인 → 병원 코드 입력</strong>으로 시작합니다</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-200 p-5 mt-4 text-left">
              <p className="text-xs font-bold text-gray-500 mb-2">등록 정보</p>
              <div className="space-y-1 text-sm text-gray-600">
                <p>🏥 {result?.cafeName ?? hospitalName}</p>
                <p>👤 {contactName} ({contactEmail})</p>
                {specialty && <p>🩺 {specialty}</p>}
              </div>
            </div>

            <div className="flex gap-3 justify-center mt-8">
              <Link href="/" className="px-6 py-3 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700">
                홈으로 돌아가기
              </Link>
              <Link href="/login" className="px-6 py-3 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50">
                로그인
              </Link>
            </div>
          </div>
        )}
      </main>

      <HospitalFooter />
    </div>
  );
}
