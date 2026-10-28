// Created: 2026-05-06
// Updated: 2026-05-06 — Hospital RUN HIS 소개 + 디자인 개선
// Updated: 2026-08-19 — FEATURES 9종·전체 기능 상세 10그룹을 실제 구현 기준으로 확대(코드 인벤토리)
// clinic.example.org/ — 병원용 랜딩 페이지
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { Check, ArrowRight, Stethoscope, Shield, Zap, Heart, Activity } from "lucide-react";

const FEATURES = [
  { icon: "🏥", title: "역할별 대시보드", desc: "의사·간호사·원무 역할에 맞는 화면. 관리자는 셋을 한 화면에.", items: ["의사: 오늘 진료·수술·담당 입원환자·당직", "간호사: 병상 점유율·중증도·투약 예정", "원무: 대기/수납/보험 승인 현황", "근무 상태 토글 4종 · 요약 카드 4종"], color: "border-emerald-100 hover:border-emerald-300" },
  { icon: "🗺️", title: "병동 동선 모니터링", desc: "층별 2D 평면도 위에 인원·대기·병목을 실시간으로.", items: ["히트맵 · 혼잡도 4단계 · 병목 펄스", "존간 흐름선(OD) · 예상 동선", "리플레이 타임랩스(최근 2시간, ×30~120)", "맵 에디터 · 레이아웃 서버 저장"], color: "border-teal-100 hover:border-teal-300" },
  { icon: "📅", title: "당직 · 근무 캘린더", desc: "주간·야간·응급 3교대 당직표와 월/주/일 근무 캘린더.", items: ["월별 당직표 · 오늘 당직 배너", "교대 요청(희망일·사유) → HIS 연동", "일정 8종 범례 · 부서별 참석자 일괄", "HIS 당직 + 수술 + 공지 병합 뷰"], color: "border-orange-100 hover:border-orange-300" },
  { icon: "🔁", title: "인수인계", desc: "환자별 카드로 교대 시 놓치는 것 없이. 저장·이력·복원.", items: ["환자 상태 4종 · 활력징후 · 주의 태그", "투약 배지(IV/PO/IM/SC) · 대기 처방", "특이사항 우선순위 3종 · 병동 메모", "최근 3일 타임라인 · 같은 교대 이어쓰기"], color: "border-rose-100 hover:border-rose-300" },
  { icon: "💊", title: "투약 관리", desc: "다음 투약을 하이라이트하고 원클릭으로 완료 처리.", items: ["필터 4종(전체·대기·미투약·완료)", "지연 건 강조 · 15초 자동 갱신", "투여 경로 5종 한글 라벨", "미투약 발생 시 브라우저 알림"], color: "border-blue-100 hover:border-blue-300" },
  { icon: "🩻", title: "수술판", desc: "오늘 수술을 5단계 타임라인으로. 진행중 수술은 상단 고정.", items: ["예정→준비→진행→완료→회복실", "오전/오후 섹션 · 30초 갱신", "다음 단계 원클릭 전환", "HIS 수술 일정 → 캘린더 동기화"], color: "border-indigo-100 hover:border-indigo-300" },
  { icon: "🚨", title: "긴급 알림", desc: "CODE BLUE부터 정원 초과까지, 5초 폴링 + 브라우저 알림.", items: ["유형 7종 · 심각도 3단계", "확인 → 대응중 → 해결 액션", "HIS 인바운드 알림(개인·부서·전체)", "아웃바운드 웹훅 13종 이벤트(HMAC)"], color: "border-red-100 hover:border-red-300" },
  { icon: "📋", title: "전자결재 (W.Sign)", desc: "HIS에서 바로 상신하고, 결재선은 조직도로 자동 추천.", items: ["결재선 자동 추천(보고라인·직위)", "문서번호 자동 채번 · 문서유형 5종", "멱등 상신 · 결과 콜백(HMAC·재시도)", "블록체인 문서 인증 · W.Channel 카드"], color: "border-violet-100 hover:border-violet-300" },
  { icon: "🔗", title: "HIS 연동", desc: "API 키 하나로 조직도·캘린더·근태·연차·채널까지.", items: ["API 키(스코프 9종·IP 화이트리스트)", "조직도 동기화 v2(사번·보고라인)", "근태·연차 인바운드 · 헬스체크", "W.Channel 워크스페이스 자동 프로비저닝"], color: "border-cyan-100 hover:border-cyan-300" },
];

/** 전체 기능 상세 — 실제 구현 기준(2026-08-19). [준비중] 표기는 아직 연결되지 않은 것 */
const DETAIL_GROUPS = [
  { icon: "🏥", area: "임상 · 간호 운영", items: ["역할별 대시보드 3종(의사·간호사·원무), 관리자 통합 뷰", "오늘 진료 목록: 초진/재진/경과, 상태 4종", "병동 병상 점유율 · 병실별 중증도 · 근무중 의료진", "원무: 대기/진행/완료/평균대기 · 수납/미수납 · 보험 승인/대기/반려", "근무 상태 토글(출근·재택·휴가·퇴근), 서비스 타일 7종", "데이터 출처 배지: HIS 실시간 / 데모 데이터"] },
  { icon: "🗺️", area: "병동 · 동선 모니터링", items: ["층 탭 · 전체 개요 그리드 · 2D 캔버스(줌 0.5~2.5)", "구역 유형 9종 · 현재 인원 · 평균 대기 · SLA 초과 적색", "히트맵 · 혼잡도 4단계 · 병목 구역 펄스", "존간 흐름선(두께=이동 건수, 파티클=정체) · 예상 동선(전이확률 20%+)", "이슈 배지 6종: 장비고장·격리·긴급·인력부족·차단·혼잡", "리플레이(최근 2시간, ×30/60/120) · SSE 실시간 + 15초 폴링 백업", "맵 에디터(드래그·리사이즈) · 레이아웃 서버 저장(기기 간 동기화)"] },
  { icon: "📅", area: "근무 · 당직 · 캘린더", items: ["당직표: 주간·야간·응급 3교대 + 간호 컬럼, 오늘 강조", "교대 요청: 근무형태 3종·희망일·사유 → 로컬 저장 + HIS 전송", "근무 캘린더: 월/주/일, 이벤트 8종 범례, 종일/시간 지정", "부서별 참석자 일괄 선택 · HIS 당직+수술+공지 병합", "HIS 근태 인바운드(외부 단말 출퇴근) · 연차 신청/잔여 API"] },
  { icon: "🔁", area: "인수인계", items: ["환자 카드: 호실·베드·상태 4종(안정/호전/악화/위중)·진단명", "활력징후(BP·HR·체온) · 주의 태그(낙상 등) 펄스", "투약 배지(경로별 색) · 대기 처방 타임라인", "특이사항 우선순위 3종 · 병동 전체 메모 · 교대 2종", "위중·악화 카드 자동 펼침 · 최근 3일 타임라인 · 이어쓰기", "환자명 마스킹(홍*동) · HIS→채널 인수인계 노트 전송"] },
  { icon: "💊", area: "투약", items: ["환자·호실 그룹 카드, 미투약 그룹 최상단", "필터 4종 + 건수 배지 · 다음 투약 하이라이트", "원클릭 투약 완료(낙관적 갱신·애니메이션) · 지연 강조", "15초 자동 갱신 · 완료 상태 영속 · 브라우저 알림"] },
  { icon: "🩻", area: "수술판", items: ["오늘 수술 보드 30초 갱신, 상세/간략 토글", "상태 5종 · 5단계 타임라인 · 다음 단계 원클릭", "진행중 수술 상단 고정 + 즉시 완료 · 오전/오후 분리", "요약 4카드 + 진행률 · 집도의·마취과·수술실 표시"] },
  { icon: "🚨", area: "알림", items: ["긴급 알림 7종(CODE BLUE·긴급수혈·긴급검사·낙상·대기초과·정원초과·의료진부재)", "심각도 3단계 · 확인/대응중/해결 · critical은 브라우저 알림", "알림함: 유형 아이콘 7종 · 날짜 그룹 · 안읽음 필터", "HIS 인바운드 알림(카테고리 12종·우선순위 4종) · 아웃바운드 웹훅 13종(HMAC-SHA256, 실패 5회 자동 비활성)"] },
  { icon: "📋", area: "결재 · 문서", items: ["HIS 상신 API: 멱등키 · 문서번호 자동(예: 인사-2026-0001)", "결재선 자동 추천(보고라인 2인, 휴직·퇴직 제외, 유형별 규칙)", "병원 문서유형 5종 매핑 · 자기결재/비활성 차단", "상태 조회 · 결과 콜백(HMAC·3회 재시도·이벤트 멱등)", "상신 시 W.Channel 카드(금액 마스킹) · Wiki 진료 매뉴얼 API"] },
  { icon: "🔗", area: "HIS 연동", items: ["API 키: 스코프 9종 · 활성 5개 · IP 화이트리스트 · 만료 · sha256 저장", "인증 이중화(Bearer + X-Hospital-Code) · 키 단위 레이트리밋", "조직도 동기화 v2 · 직원 API · 캘린더 upsert", "W.Channel 워크스페이스 온디맨드 프로비저닝(멱등)", "헬스체크(connected/timeout/unreachable) · 미연동 시 로컬 영속 6종"] },
  { icon: "🔒", area: "보안 · 권한", items: ["병원 코드(WRB-XXXX-XXXX) 검증 후 로그인·가입 · 등록 승인제", "권한 이원화: Clinic 3종 + HIS 역할 6종", "환자명 마스킹 전 화면 공통 · SSO 단회 토큰(5분/60초)", "진입 게이트(세션 없으면 로그인) · 보안 헤더 · SSRF 방어 · Turnstile"] },
];


const PLANS = [
  { name: "Starter", price: "무료", period: "", highlight: false, features: ["5인까지", "기본 기능", "3GB 저장 공간", "이메일 지원"] },
  { name: "Clinic", price: "39,000", period: "원/월 (30인)", highlight: true, features: ["30인까지", "AI Knowledge 포함", "30GB 저장 공간", "근무표 관리", "HIS 연동 가능", "우선 지원"] },
  { name: "Hospital", price: "별도 협의", period: "", highlight: false, features: ["인원 무제한", "HIS 풀 패키지", "전용 서버 · SLA", "SSO · SAML", "온프레미스 가능", "전담 매니저"] },
];

const SPECIALTIES = [
  "내과", "외과", "정형외과", "피부과", "이비인후과", "안과", "치과",
  "산부인과", "소아청소년과", "신경외과", "재활의학과", "가정의학과",
  "한의원", "종합병원",
];

export default function HospitalLanding() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  useEffect(() => {
    hfetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.user) router.replace("/dashboard"); else setLoggedIn(false); })
      .catch(() => setLoggedIn(false));
  }, [router]);

  if (loggedIn === null) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="flex items-center gap-2 text-gray-400">
        <div className="w-5 h-5 border-2 border-emerald-300 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">로딩 중...</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <HospitalHeader />

      {/* ── 히어로 ── */}
      <section className="relative pt-24 pb-24 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-teal-50/30 to-white" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-200/20 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-teal-200/15 rounded-full blur-3xl" />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100/80 text-emerald-700 text-xs font-semibold mb-8 backdrop-blur-sm border border-emerald-200/50">
            <Stethoscope size={14} /> 병원 전용 올인원 플랫폼
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-gray-900 leading-[1.1] mb-6">
            병원 운영의 모든 것,<br />
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">하나로</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-500 max-w-xl mx-auto mb-4 leading-relaxed">
            진료 관리 · 의료진 채널 · 근무표 · Wiki · 전자결재<br />
            AI 의료 Knowledge — 설치 없이 즉시 시작
          </p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-gray-400 mb-10">
            <span className="flex items-center gap-1"><Check size={14} className="text-emerald-500" /> 카드 없이 시작</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-emerald-500" /> 5인 이하 무료</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-emerald-500" /> 5분 설정</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register" className="px-8 py-4 text-base font-bold bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all shadow-2xl shadow-emerald-600/25 hover:shadow-emerald-600/40 hover:-translate-y-0.5">
              병원 등록 신청 <ArrowRight size={16} className="inline ml-1" />
            </Link>
            <button onClick={() => setContactOpen(true)} className="px-8 py-4 text-base font-semibold border-2 border-gray-200 text-gray-700 rounded-2xl hover:border-emerald-300 hover:bg-emerald-50/50 transition-all">
              데모 요청
            </button>
          </div>
        </div>
      </section>

      {/* ── 대상 병원 ── */}
      <section className="py-12 px-4 border-t border-gray-100">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-3">ALL MEDICAL FACILITIES</p>
          <h2 className="text-xl font-bold text-gray-900 mb-6">동네 의원부터 종합병원까지</h2>
          <div className="flex flex-wrap justify-center gap-2">
            {SPECIALTIES.map(s => (
              <span key={s} className="px-4 py-2 text-xs font-medium rounded-full border border-gray-200 text-gray-500 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50/50 transition-all cursor-default">{s}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 핵심 기능 6칸 ── */}
      <section className="py-20 px-4 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest text-center mb-3">FEATURES</p>
          <h2 className="text-2xl sm:text-3xl font-black text-center text-gray-900 mb-3">병원에 필요한 모든 기능</h2>
          <p className="text-center text-gray-500 mb-12 max-w-md mx-auto text-sm">별도 설치 없이, 가입 즉시 사용 가능합니다</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className={`bg-white rounded-2xl border-2 p-6 hover:shadow-lg hover:-translate-y-1 transition-all ${f.color}`}>
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="text-sm font-bold text-gray-900 mb-1.5">{f.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed mb-3">{f.desc}</p>
                <ul className="space-y-1">
                  {f.items.map(item => (
                    <li key={item} className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Check size={10} className="text-emerald-400 shrink-0" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <p className="text-xs font-semibold text-gray-400 mb-3">그리고 더 많은 기능</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-3xl mx-auto">
              {["W.Channel 의료진 채널", "진료 매뉴얼 Wiki", "근태 · 연차(HIS 인바운드)", "조직도 동기화", "증명서 발급(메인앱)", "W.Office 모바일 결재", "선호 병원 기억(다중 소속)", "AI 의료 Knowledge [준비중]"].map(f => (
                <span key={f} className="px-3 py-1.5 text-xs rounded-full border border-gray-200 text-gray-500">{f}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 전체 기능 상세 (실제 구현 기준) ── */}
      <section className="py-16 px-4 bg-white border-t border-gray-100">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest text-center mb-3">ALL FEATURES</p>
          <h2 className="text-2xl sm:text-3xl font-black text-center text-gray-900 mb-3">전체 기능 상세</h2>
          <p className="text-center text-gray-500 mb-10 max-w-lg mx-auto text-sm">지금 clinic.example.org에서 실제로 동작하는 기능만 적었습니다. HIS 미연동 병원은 데모 데이터로 화면을 먼저 확인할 수 있습니다.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DETAIL_GROUPS.map(g => (
              <div key={g.area} className="rounded-2xl border border-gray-200 p-5 bg-gray-50/60">
                <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2"><span className="text-lg">{g.icon}</span>{g.area}</h3>
                <ul className="space-y-1.5">
                  {g.items.map(item => (
                    <li key={item} className="text-xs text-gray-600 flex items-start gap-1.5 leading-relaxed">
                      <Check size={11} className="text-emerald-500 shrink-0 mt-0.5" /> <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 의료 특화 ── */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest text-center mb-3">MEDICAL-FIRST</p>
          <h2 className="text-2xl font-black text-center text-gray-900 mb-3">병원을 위해 설계되었습니다</h2>
          <p className="text-center text-gray-500 mb-10 text-sm">병원 유형에 맞는 최적의 구성을 자동으로 제공합니다</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-6 border border-emerald-200/50 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><span className="text-xl">🏥</span></div>
                <h3 className="text-base font-bold text-gray-900">종합병원 모드</h3>
              </div>
              <ul className="space-y-2 text-xs text-gray-600">
                <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500 shrink-0" /> 진료과별 채널 자동 구성</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500 shrink-0" /> 당직/교대 근무표</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500 shrink-0" /> 부서별 결재 라인</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500 shrink-0" /> 인수인계 노트</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500 shrink-0" /> HIS 풀 패키지 연동</li>
              </ul>
            </div>
            <div className="bg-gradient-to-br from-sky-50 to-blue-50 rounded-2xl p-6 border border-sky-200/50 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><span className="text-xl">🩻</span></div>
                <h3 className="text-base font-bold text-gray-900">의원/병원 모드</h3>
              </div>
              <ul className="space-y-2 text-xs text-gray-600">
                <li className="flex items-center gap-2"><Check size={12} className="text-blue-500 shrink-0" /> 간편 예약 · 접수 관리</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-blue-500 shrink-0" /> 직원 근무표</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-blue-500 shrink-0" /> 공지사항 · 메모</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-blue-500 shrink-0" /> 의료 물품 관리</li>
                <li className="flex items-center gap-2"><Check size={12} className="text-blue-500 shrink-0" /> 선택적 HIS 모듈 연동</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Hospital RUN — HIS 소개 ── */}
      <section className="py-20 px-4 bg-gradient-to-b from-slate-900 to-slate-800 text-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Activity size={20} className="text-blue-400" />
            <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">HOSPITAL INFORMATION SYSTEM</p>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-center mb-3">
            Hospital RUN <span className="text-blue-400">HIS</span>
          </h2>
          <p className="text-center text-slate-400 mb-12 max-w-2xl mx-auto text-sm leading-relaxed">
            한국 의료 환경에 최적화된 차세대 병원 정보 시스템.<br />
            외래 진료부터 입원, 수술, 응급, 약국, 검사, 영상, 수납, 보험 청구까지 — 병원 운영 전체를 하나로.
          </p>

          {/* 진료 워크플로우 */}
          <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-700 p-5 mb-10 max-w-3xl mx-auto">
            <p className="text-xs font-bold text-blue-400 mb-4 text-center tracking-widest uppercase">Clinical Workflow</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs font-medium">
              {["예약", "접수", "진료(SOAP)", "진단(KCD)", "처방(DUR)", "OCS 전달", "약국 · 검사 · 영상", "수납", "보험 청구"].map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300">{s}</span>
                  {i < 8 && <span className="text-blue-500/40">→</span>}
                </span>
              ))}
            </div>
          </div>

          {/* 기능 4영역 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {[
              { icon: "🩺", title: "임상", subtitle: "Clinical", items: ["외래 진료 (SOAP 노트)", "처방전달 (OCS)", "DUR 약물 상호작용", "입원 · 수술 · 응급실", "약국 · 검사 · PACS"], accent: "blue" },
              { icon: "📋", title: "관리", subtitle: "Administration", items: ["원무 · 접수 · 증명서", "수납 (FFS + DRG)", "건강보험 청구 (HIRA)", "병상 · 인사(HR)", "자재/재고 · 장비"], accent: "emerald" },
              { icon: "🛡️", title: "안전/질관리", subtitle: "JCI Compliance", items: ["환자안전 사고 보고", "낙상 위험 평가", "감염관리 · 격리", "QI 대시보드", "동의서 · 직원 교육"], accent: "amber" },
              { icon: "⚙️", title: "기술 플랫폼", subtitle: "Platform", items: ["FHIR R4 표준 API", "JSON Form Engine", "플러그인 아키텍처", "EMR 인증제 대응", "진료정보교류 (HIE)"], accent: "violet" },
            ].map(area => (
              <div key={area.title} className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-5 hover:border-slate-600 transition-colors">
                <div className="text-2xl mb-2">{area.icon}</div>
                <h3 className="text-sm font-bold text-white">{area.title}</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">{area.subtitle}</p>
                <ul className="space-y-1.5 text-xs text-slate-400">
                  {area.items.map(item => (
                    <li key={item} className="flex items-start gap-1.5">
                      <Check size={10} className={`mt-0.5 shrink-0 ${
                        area.accent === "blue" ? "text-blue-400" :
                        area.accent === "emerald" ? "text-emerald-400" :
                        area.accent === "amber" ? "text-amber-400" : "text-violet-400"
                      }`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* 한국 의료 표준 + 시스템 규모 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Heart size={14} className="text-red-400" /> 한국 의료 표준 완전 지원
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { code: "KCD-8", desc: "한국표준질병분류" },
                  { code: "ICD-10", desc: "국제질병분류 10판" },
                  { code: "ICD-11", desc: "국제질병분류 11판" },
                  { code: "EDI", desc: "건강보험 수가코드" },
                  { code: "DUR", desc: "약물 안전사용 점검" },
                  { code: "HIRA", desc: "보험 청구 포맷" },
                  { code: "KTAS", desc: "응급환자 분류체계" },
                  { code: "EMR 인증", desc: "보건복지부 2주기" },
                  { code: "JCI", desc: "국제병원인증 대응" },
                ].map(s => (
                  <div key={s.code} className="text-center">
                    <span className="inline-block font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded text-[10px] border border-blue-500/20 mb-1">{s.code}</span>
                    <p className="text-[10px] text-slate-500">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Activity size={14} className="text-emerald-400" /> 시스템 규모
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { n: "42", label: "백엔드 모듈" },
                  { n: "188", label: "API 엔드포인트" },
                  { n: "51", label: "데이터 모델" },
                  { n: "37", label: "화면 페이지" },
                  { n: "5", label: "보안 역할" },
                  { n: "32K+", label: "코드 라인" },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className="text-2xl font-black text-blue-400">{s.n}</p>
                    <p className="text-[10px] text-slate-500">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 기술 태그 */}
          <div className="flex flex-wrap justify-center gap-2 max-w-4xl mx-auto">
            {["FHIR R4", "openEHR", "AES-256 암호화", "RBAC 5역할", "감사 로그", "DICOM/PACS", "오프라인 지원", "플러그인 확장", "Clean Architecture", "MIT 라이선스"].map(t => (
              <span key={t} className="px-3 py-1.5 text-[11px] rounded-full border border-slate-600 text-slate-400 hover:border-blue-500/50 hover:text-blue-400 transition-colors">{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 요금제 ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest text-center mb-3">PRICING</p>
          <h2 className="text-2xl sm:text-3xl font-black text-center text-gray-900 mb-3">합리적인 요금제</h2>
          <p className="text-center text-gray-500 mb-12 text-sm max-w-md mx-auto">소규모 의원은 무료로 시작하세요</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {PLANS.map(p => (
              <div key={p.name} className={`rounded-2xl border-2 p-6 transition-all hover:shadow-lg ${p.highlight
                ? "border-emerald-400 bg-white shadow-xl ring-2 ring-emerald-200/50 scale-[1.02]"
                : "border-gray-200 bg-white hover:-translate-y-0.5"}`}>
                {p.highlight && <div className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2.5 py-0.5 rounded-full w-fit mb-2">추천</div>}
                <h3 className="text-lg font-bold text-gray-900">{p.name}</h3>
                <div className="mt-2 mb-5">
                  <span className="text-3xl font-black text-gray-900">{p.price}</span>
                  {p.period && <span className="text-xs text-gray-400 ml-1">{p.period}</span>}
                </div>
                <ul className="space-y-2.5 mb-6">
                  {p.features.map(f => (
                    <li key={f} className="text-sm text-gray-600 flex items-start gap-2">
                      <Check size={14} className="text-emerald-500 shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                {p.name === "Hospital" ? (
                  <button onClick={() => setContactOpen(true)} className="w-full py-3 rounded-xl text-sm font-bold border-2 border-gray-200 text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all">문의하기</button>
                ) : (
                  <Link href="/register" className={`block w-full py-3 rounded-xl text-sm font-bold text-center transition-all ${p.highlight
                    ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>시작하기</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 보안 ── */}
      <section className="py-14 px-4 border-t border-gray-100">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-6">SECURITY & COMPLIANCE</p>
          <div className="flex justify-center gap-6 sm:gap-10 flex-wrap">
            {[
              { icon: <Shield size={18} />, label: "독립 Auth Server" },
              { icon: <Zap size={18} />, label: "2FA · TOTP · SMS" },
              { icon: <Shield size={18} />, label: "Cloudflare 보호" },
              { icon: <Shield size={18} />, label: "AES-256 암호화" },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 text-sm text-gray-500">
                <span className="text-emerald-400">{s.icon}</span> {s.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 다른 서비스 안내 ── */}
      <section className="py-10 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
            <a href="https://example.org/landing" className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-gray-200 hover:border-rose-300 hover:bg-rose-50/30 transition-all">
              <span className="text-xl">☕</span>
              <div><p className="text-sm font-bold text-gray-900">Community</p><p className="text-xs text-gray-400">카페 커뮤니티</p></div>
              <ArrowRight size={14} className="text-gray-300 ml-2" />
            </a>
            <a href="https://work.example.org" className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 transition-all">
              <span className="text-xl">🏢</span>
              <div><p className="text-sm font-bold text-gray-900">W.Work</p><p className="text-xs text-gray-400">기업 그룹웨어</p></div>
              <ArrowRight size={14} className="text-gray-300 ml-2" />
            </a>
            <a href="https://channel.example.org" className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all">
              <span className="text-xl">#️⃣</span>
              <div><p className="text-sm font-bold text-gray-900">W.Channel</p><p className="text-xs text-gray-400">채널 기반 팀 협업</p></div>
              <ArrowRight size={14} className="text-gray-300 ml-2" />
            </a>
            <a href="https://vibe.example.org" className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-gray-200 hover:border-pink-300 hover:bg-pink-50/30 transition-all">
              <span className="text-xl">🎵</span>
              <div><p className="text-sm font-bold text-gray-900">Vibe</p><p className="text-xs text-gray-400">이슈 탐색 소셜</p></div>
              <ArrowRight size={14} className="text-gray-300 ml-2" />
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-4 bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 text-center relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">지금 바로 시작하세요</h2>
          <p className="text-emerald-200/70 mb-10 text-sm max-w-md mx-auto">설치 없이, 카드 없이 — 5분 만에 병원 전체가 사용할 수 있습니다</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register" className="px-10 py-4 text-lg font-bold bg-white text-emerald-900 rounded-2xl hover:bg-emerald-50 transition-all shadow-2xl hover:-translate-y-0.5">
              병원 등록 신청
            </Link>
            <button onClick={() => setContactOpen(true)} className="px-10 py-4 text-lg font-semibold border-2 border-white/30 text-white rounded-2xl hover:border-white/60 hover:bg-white/5 transition-all">
              상담 문의
            </button>
          </div>
        </div>
      </section>

      <HospitalFooter />

      {/* ── 문의 모달 ── */}
      {contactOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setContactOpen(false)}>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900">도입 문의</h3>
              <button onClick={() => setContactOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="space-y-3">
              <input className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" placeholder="병원명" />
              <input type="email" className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" placeholder="담당자 이메일" />
              <input className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" placeholder="연락처" />
              <select className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm">
                <option>병원 규모 선택</option>
                <option>5인 미만 (의원)</option><option>5~15인</option><option>16~50인</option><option>51~100인</option><option>100인 이상 (종합병원)</option>
              </select>
              <textarea rows={3} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none" placeholder="문의 내용" />
              <button className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">문의 보내기</button>
              <p className="text-[11px] text-gray-400 text-center">영업일 기준 1일 이내 답변드립니다</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
