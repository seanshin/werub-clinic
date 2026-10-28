// Created: 2026-05-06
// clinic.example.org/dashboard — 병원 허브 대시보드
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import {
  FileText, MessageSquare, Calendar, BookOpen, Building2,
  Clock, Palmtree, Stethoscope, ChevronRight, Loader2, MapPin,
  ClipboardList, Scissors, Pill, Siren, Wifi, WifiOff,
} from "lucide-react";
import FloorWidget from "@/components/floor/FloorWidget";
import DoctorDashboard from "@/components/dashboard/DoctorDashboard";
import NurseDashboard from "@/components/dashboard/NurseDashboard";
import AdminDashboard from "@/components/dashboard/AdminDashboard";
import { clinicContextUrl } from "@/lib/clinic-context";

interface ClinicContext {
  found: boolean;
  primary?: { id: string; slug: string; name: string; type: string; status: string; logo: string | null; role: string };
}

const SERVICES = [
  { icon: MessageSquare, label: "채널", color: "text-green-500", path: "board" },
  { icon: Calendar, label: "캘린더", color: "text-orange-500", path: "calendar" },
  { icon: BookOpen, label: "Wiki", color: "text-cyan-500", path: "wiki" },
  { icon: FileText, label: "전자결재", color: "text-blue-500", path: "wsign" },
  { icon: Building2, label: "조직도", color: "text-emerald-500", path: "organization" },
  { icon: Clock, label: "근태", color: "text-amber-500", path: "attendance" },
  { icon: Palmtree, label: "연차", color: "text-red-500", path: "attendance?tab=leave" },
];

const WORKGROUP_LINKS = [
  { icon: Calendar, label: "근무 캘린더", color: "text-blue-500", href: "/work-calendar" },
  { icon: ClipboardList, label: "인수인계", color: "text-indigo-500", href: "/handoff" },
  { icon: Calendar, label: "당직표", color: "text-violet-500", href: "/duty" },
  { icon: Scissors, label: "수술 보드", color: "text-rose-500", href: "/surgery-board" },
  { icon: Pill, label: "투약 관리", color: "text-pink-500", href: "/medication" },
  { icon: Siren, label: "긴급 알림", color: "text-red-500", href: "/alerts" },
  { icon: MapPin, label: "병원 동선", color: "text-emerald-500", href: "/floor" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<ClinicContext | null>(null);
  const [user, setUser] = useState<{ id?: string; username: string } | null>(null);
  const [hisRole, setHisRole] = useState<string>("staff");
  const [loading, setLoading] = useState(true);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [todayEvents, setTodayEvents] = useState(0);
  const [notices, setNotices] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  // W.Channel 워크스페이스 연동 — null=조회중, ""=미연동(disabled), url=연동됨
  const [channelUrl, setChannelUrl] = useState<string | null>(null);

  // 근무 상태
  const [workStatus, setWorkStatus] = useState<string>("none");
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  // HIS 연결 상태
  const [hisStatus, setHisStatus] = useState<"checking" | "connected" | "disconnected" | "not_configured">("checking");
  const [hisLatency, setHisLatency] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      hfetch("/api/auth/me").then(r => r.ok ? r.json() : null),
      hfetch(clinicContextUrl()).then(r => r.json()),
    ]).then(([authData, ctxData]) => {
      if (!authData?.user) { router.replace("/login"); return; }
      setUser(authData.user);
      setCtx(ctxData);

      if (ctxData.found) {
        const slug = ctxData.primary.slug;
        hfetch(`/api/cafes/${slug}/wsign/pending-count`).then(r => r.ok ? r.json() : {}).then((d: Record<string, number>) => setPendingApprovals(d.count ?? 0)).catch(() => {});
        hfetch(`/api/cafes/${slug}/calendar?summary=true`).then(r => r.ok ? r.json() : {}).then((d: Record<string, number>) => setTodayEvents(d.todayCount ?? d.count ?? 0)).catch(() => {});
        hfetch(`/api/cafes/${slug}/notifications/count`).then(r => r.ok ? r.json() : {}).then((d: Record<string, number>) => setUnreadNotifs(d.unread ?? 0)).catch(() => {});
        hfetch(`/api/cafes/${slug}/board/unread-count`).then(r => r.ok ? r.json() : {}).then((d: Record<string, number>) => {
          setUnreadMessages(d.total ?? 0);
        }).catch(() => {});
        hfetch(`/api/cafes/${slug}/posts?limit=5&isNotice=true`).then(r => r.ok ? r.json() : {}).then((d: Record<string, unknown>) => {
          const posts = (d.posts ?? d.pinnedPosts ?? []) as { id: string; title: string; createdAt: string }[];
          setNotices(posts.slice(0, 5));
        }).catch(() => {});
        // W.Channel 워크스페이스 연동 상태 — 채널 타일 링크(연동=워크스페이스 URL, 미연동=disabled)
        hfetch(`/api/cafes/${slug}/channel-workspace`).then((r: Response) => r.ok ? r.json() : null).then((d: { provisioned?: boolean; workspace?: { url?: string } } | null) => {
          setChannelUrl(d?.provisioned && d?.workspace?.url ? d.workspace.url : "");
        }).catch(() => setChannelUrl(""));
        // HIS 연결 상태 확인
        hfetch("/api/clinic/his/health").then(r => r.ok ? r.json() : null).then(d => {
          if (d?.ok) { setHisStatus("connected"); setHisLatency(d.latency ?? null); }
          else if (d?.status === "not_configured") setHisStatus("not_configured");
          else setHisStatus("disconnected");
        }).catch(() => setHisStatus("disconnected"));
        // HIS 역할 조회
        hfetch(`/api/cafes/${slug}/admin/his-roles`).then(r => r.ok ? r.json() : null).then((d) => {
          const mappings = (d?.mappings ?? []) as { user_id: string; his_role: string }[];
          const myMapping = mappings.find(m => m.user_id === authData.user.id);
          if (myMapping) setHisRole(myMapping.his_role.toLowerCase());
        }).catch(() => {});
        // 근태 상태
        hfetch(`/api/cafes/${slug}/hr-law/attendance`).then(r => r.ok ? r.json() : null).then((d) => {
          const records = (d?.records ?? []) as { status: string; check_in_at: string | null }[];
          const my = records[0];
          if (my) {
            const statusMap: Record<string, string> = { checked_in: "office", checked_out: "off", remote: "remote", on_vacation: "leave" };
            setWorkStatus(statusMap[my.status] ?? "none");
            if (my.check_in_at) setCheckInTime(new Date(my.check_in_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
          }
        }).catch(() => {});
      }
    }).catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /></div>;
  }

  if (!ctx?.found) {
    return (
      <div className="min-h-screen bg-gray-50">
        <HospitalHeader showNav />
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <div className="text-center max-w-md">
            <div className="text-5xl mb-4">🏥</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">소속된 병원이 없습니다</h1>
            <p className="text-sm text-gray-500 mb-6">병원 코드로 가입하거나, 새로 병원을 등록하세요.</p>
            <div className="flex gap-3 justify-center">
              <Link href="/register" className="px-6 py-2.5 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700">병원 등록하기</Link>
              <button onClick={() => { const c = prompt("병원 코드 (WRB-XXXX-XXXX)"); if (c) router.push(`/login?code=${c}`); }}
                className="px-6 py-2.5 text-sm font-bold border-2 border-gray-200 text-gray-700 rounded-xl hover:border-emerald-300">병원 코드 입력</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 가입 승인 대기(코드 가입 승인제, 2026-08-19) — 병원은 활성이지만 내 멤버십이 PENDING
  if ((ctx.primary as { memberStatus?: string } | undefined)?.memberStatus === "PENDING") {
    return (
      <div className="min-h-screen bg-gray-50">
        <HospitalHeader hospitalName={ctx.primary?.name} showNav />
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <div className="text-center max-w-md">
            <div className="text-5xl mb-4">🪪</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">가입 승인 대기 중입니다</h1>
            <div className="rounded-2xl border p-4 mb-6 bg-amber-50 border-amber-200 text-amber-800">
              <p className="text-sm leading-relaxed">{ctx.primary?.name} 관리자가 가입 신청을 검토하고 있습니다. 승인되면 알림으로 안내드리며, 이 화면을 새로고침하면 바로 이용할 수 있습니다.</p>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> 관리자 승인 대기
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 승인 대기 / 거절 / 정지 상태 화면
  const cafeStatus = ctx.primary?.status;
  if (cafeStatus && cafeStatus !== "active") {
    const statusInfo: Record<string, { icon: string; title: string; desc: string; color: string }> = {
      pending_approval: {
        icon: "⏳",
        title: "승인 대기 중입니다",
        desc: "시스템 관리자가 병원 등록을 검토하고 있습니다. 승인 완료 시 알림으로 안내드리겠습니다.",
        color: "bg-amber-50 border-amber-200 text-amber-800",
      },
      rejected: {
        icon: "❌",
        title: "등록이 거절되었습니다",
        desc: "병원 등록이 거절되었습니다. 자세한 사항은 알림을 확인하시거나 고객센터로 문의해 주세요.",
        color: "bg-red-50 border-red-200 text-red-800",
      },
      suspended: {
        icon: "⚠️",
        title: "서비스가 일시 정지되었습니다",
        desc: "관리자에 의해 서비스가 일시 정지되었습니다. 자세한 사항은 알림을 확인해 주세요.",
        color: "bg-red-50 border-red-200 text-red-800",
      },
    };
    const info = statusInfo[cafeStatus] ?? statusInfo.pending_approval;

    return (
      <div className="min-h-screen bg-gray-50">
        <HospitalHeader hospitalName={ctx.primary?.name} showNav />
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <div className="text-center max-w-md">
            <div className="text-5xl mb-4">{info.icon}</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{info.title}</h1>
            <div className={`rounded-2xl border p-4 mb-6 ${info.color}`}>
              <p className="text-sm leading-relaxed">{info.desc}</p>
            </div>
            {cafeStatus === "pending_approval" && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  검토 중 — 보통 1영업일 이내 처리됩니다
                </div>
                <p className="text-xs text-gray-400">병원명: {ctx.primary?.name}</p>
              </div>
            )}
            <div className="mt-6 flex gap-3 justify-center">
              <Link href="/notifications" className="px-5 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50">알림 확인</Link>
              <Link href="/profile" className="px-5 py-2 text-sm font-medium text-gray-400 hover:text-gray-600">프로필</Link>
            </div>
          </div>
        </div>
        <HospitalFooter />
      </div>
    );
  }

  const slug = ctx.primary!.slug;
  const hospitalName = ctx.primary!.name;
  const MAIN = "https://example.org";
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후에요" : "수고하셨어요";

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader hospitalName={hospitalName} showNav unreadCount={unreadNotifs} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* 인사 + 근무 상태 */}
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{greeting}, {user?.username}님</h1>
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { key: "office", label: "출근", icon: "🏥", zone: "working", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
                { key: "remote", label: "재택", icon: "🏠", zone: "remote", color: "bg-blue-100 text-blue-700 border-blue-300" },
                { key: "leave", label: "휴가", icon: "🏖", zone: "vacation", color: "bg-amber-100 text-amber-700 border-amber-300" },
                { key: "off", label: "퇴근", icon: "🌙", zone: "off_duty", color: "bg-gray-100 text-gray-600 border-gray-300" },
              ] as const).map(s => (
                <button key={s.key} onClick={async () => {
                  const isActive = workStatus === s.key;
                  hfetch(`/api/cafes/${slug}/hr-law/attendance`, {
                    method: "POST",
                    body: JSON.stringify({ statusZone: s.zone, action: isActive ? "leave" : "enter" }),
                  }).catch(() => {});
                  const timeStr = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
                  if (isActive) { setWorkStatus("none"); } else {
                    setWorkStatus(s.key);
                    if (s.key === "office") setCheckInTime(timeStr);
                  }
                }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
                    workStatus === s.key ? `${s.color} ring-2 ring-offset-1 ring-current` : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                  }`}>
                  {s.icon} {s.label}
                  {workStatus === s.key && s.key === "office" && checkInTime && <span className="ml-1 text-[10px]">{checkInTime}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-gray-400">
              {now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
            </p>
            {hisStatus !== "checking" && (
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                hisStatus === "connected" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" :
                hisStatus === "not_configured" ? "bg-gray-50 text-gray-400 border border-gray-200" :
                "bg-red-50 text-red-500 border border-red-200"
              }`}>
                {hisStatus === "connected" ? <Wifi size={10} /> : <WifiOff size={10} />}
                {hisStatus === "connected" ? `HIS 연결됨${hisLatency ? ` (${hisLatency}ms)` : ""}` :
                 hisStatus === "not_configured" ? "HIS 미설정" : "HIS 연결 끊김"}
              </div>
            )}
          </div>
        </div>

        {/* 공지사항 */}
        {notices.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-700">📢 공지사항</p>
              <a href={`${MAIN}/cafes/${slug}`} className="text-xs text-emerald-600 hover:underline">전체보기 →</a>
            </div>
            <div className="space-y-1">
              {notices.map(n => (
                <a key={n.id} href={`${MAIN}/cafes/${slug}/posts/${n.id}`} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-sm text-gray-700 truncate flex-1">{n.title}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{new Date(n.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <a href={`${MAIN}/cafes/${slug}/wsign`} className="bg-white rounded-2xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2"><FileText size={18} className="text-blue-500" />{pendingApprovals > 0 && <span className="w-2 h-2 rounded-full bg-red-500" />}</div>
            <p className="text-2xl font-black text-gray-900">{pendingApprovals}</p>
            <p className="text-xs text-gray-400">결재 대기</p>
          </a>
          <a href={`${MAIN}/cafes/${slug}/calendar`} className="bg-white rounded-2xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <Calendar size={18} className="text-orange-500 mb-2" />
            <p className="text-2xl font-black text-gray-900">{todayEvents}</p>
            <p className="text-xs text-gray-400">오늘 일정</p>
          </a>
          <a href={`${MAIN}/cafes/${slug}/board`} className="bg-white rounded-2xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2"><MessageSquare size={18} className="text-green-500" />{unreadMessages > 0 && <span className="w-2 h-2 rounded-full bg-green-500" />}</div>
            <p className="text-2xl font-black text-gray-900">{unreadMessages}</p>
            <p className="text-xs text-gray-400">읽지 않은 메시지</p>
          </a>
          <a href="/notifications" className="bg-white rounded-2xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <div className="text-red-500 mb-2 text-lg">🔔</div>
            <p className="text-2xl font-black text-gray-900">{unreadNotifs}</p>
            <p className="text-xs text-gray-400">알림</p>
          </a>
        </div>

        {/* 서비스 바로가기 */}
        <div>
          <h2 className="text-sm font-bold text-gray-500 mb-3">서비스</h2>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
            {SERVICES.map(s => {
              const Icon = s.icon;
              // 채널 = 연동된 W.Channel 워크스페이스로 링크. 미연동이면 disabled.
              if (s.label === "채널") {
                if (!channelUrl) {
                  return (
                    <div key={s.label} title={channelUrl === null ? "확인 중…" : "W.Channel 미연동 — 병원 워크그룹 관리 > W.Channel 연동에서 워크스페이스를 생성하세요"}
                      className="bg-gray-50 rounded-2xl border border-gray-200 p-4 flex flex-col items-center gap-2 opacity-45 cursor-not-allowed select-none">
                      <Icon size={22} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-400">{s.label}</span>
                    </div>
                  );
                }
                return (
                  <a key={s.label} href={channelUrl} target="_blank" rel="noopener noreferrer"
                    className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col items-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition-all">
                    <Icon size={22} className={s.color} />
                    <span className="text-xs font-medium text-gray-700">{s.label}</span>
                  </a>
                );
              }
              const href = `${MAIN}/cafes/${slug}/${s.path}`;
              return (
                <a key={s.label} href={href} className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col items-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <Icon size={22} className={s.color} />
                  <span className="text-xs font-medium text-gray-700">{s.label}</span>
                </a>
              );
            })}
          </div>
        </div>

        {/* 워크그룹 */}
        <div>
          <h2 className="text-sm font-bold text-gray-500 mb-3">병원 워크그룹</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {WORKGROUP_LINKS.map(w => {
              const Icon = w.icon;
              return (
                <a key={w.label} href={w.href} className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col items-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <Icon size={22} className={w.color} />
                  <span className="text-xs font-medium text-gray-700">{w.label}</span>
                </a>
              );
            })}
          </div>
        </div>

        {/* 역할별 대시보드 — 관리자(OWNER/MANAGER)는 모든 역할 표시 */}
        {user?.id && (() => {
          const clinicRole = ctx.primary?.role ?? "";
          const isAdmin = ["OWNER", "MANAGER"].includes(clinicRole) || hisRole === "admin";
          const sections = [
            { key: "doctor", label: "의사", show: isAdmin || hisRole === "doctor", component: <DoctorDashboard userId={user.id!} /> },
            { key: "nurse", label: "간호사", show: isAdmin || hisRole === "nurse", component: <NurseDashboard userId={user.id!} /> },
            { key: "staff", label: "원무/행정", show: isAdmin || hisRole === "staff", component: <AdminDashboard userId={user.id!} /> },
          ].filter(s => s.show);
          return (
            <div className="space-y-4">
              {sections.map(s => (
                <div key={s.key}>
                  {isAdmin && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        s.key === "doctor" ? "bg-emerald-100 text-emerald-700" :
                        s.key === "nurse" ? "bg-indigo-100 text-indigo-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>{s.label}</span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>
                  )}
                  {s.component}
                </div>
              ))}
            </div>
          );
        })()}

        {/* 병원 동선 위젯 */}
        <FloorWidget />

        {/* 빠른 링크 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a href={`${MAIN}/cafes/${slug}`} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3"><Stethoscope size={18} className="text-emerald-500" /><div><p className="text-sm font-medium text-gray-900">{hospitalName} 홈</p><p className="text-xs text-gray-400">게시판 · 공지사항</p></div></div>
            <ChevronRight size={16} className="text-gray-300" />
          </a>
          <a href={`${MAIN}/cafes/${slug}/admin`} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3"><Building2 size={18} className="text-amber-500" /><div><p className="text-sm font-medium text-gray-900">관리</p><p className="text-xs text-gray-400">멤버 · 설정 · 병원 코드</p></div></div>
            <ChevronRight size={16} className="text-gray-300" />
          </a>
          <a href="/settings" className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3"><MapPin size={18} className="text-violet-500" /><div><p className="text-sm font-medium text-gray-900">동선 설정</p><p className="text-xs text-gray-400">위젯 · 폴링 · 혼잡도 · 알림</p></div></div>
            <ChevronRight size={16} className="text-gray-300" />
          </a>
        </div>
      </main>

      <HospitalFooter />
    </div>
  );
}
