// Created: 2026-05-06
// Updated: 2026-05-19 — 역할/부서/근무 정보 + 병원 정보 표시
// clinic.example.org/profile — 프로필
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { Loader2, LogOut, ArrowLeft, Stethoscope, Building2, Clock, Shield, Mail, User } from "lucide-react";
import { clinicContextUrl, clearPreferredClinic } from "@/lib/clinic-context";

const ROLE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  doctor: { label: "의사", color: "text-emerald-700", bg: "bg-emerald-50" },
  nurse: { label: "간호사", color: "text-indigo-700", bg: "bg-indigo-50" },
  pharmacist: { label: "약사", color: "text-pink-700", bg: "bg-pink-50" },
  labtech: { label: "검사실", color: "text-purple-700", bg: "bg-purple-50" },
  staff: { label: "행정/원무", color: "text-amber-700", bg: "bg-amber-50" },
  admin: { label: "관리자", color: "text-red-700", bg: "bg-red-50" },
};

const CLINIC_ROLE_LABELS: Record<string, string> = {
  OWNER: "소유자", MANAGER: "매니저", REGULAR: "일반 멤버",
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id?: string; username: string; email: string; profileImage?: string; role?: string } | null>(null);
  const [hospitalName, setHospitalName] = useState("");
  const [clinicRole, setClinicRole] = useState("");
  const [hisRole, setHisRole] = useState("");
  const [department, setDepartment] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      hfetch("/api/auth/me").then(r => r.ok ? r.json() : null),
      hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null),
    ]).then(([authData, ctx]) => {
      if (!authData?.user) { router.replace("/login"); return; }
      setUser(authData.user);

      if (ctx?.primary) {
        setHospitalName(ctx.primary.name);
        setClinicRole(ctx.primary.role ?? "");

        // HIS 역할 조회
        const slug = ctx.primary.slug;
        hfetch(`/api/cafes/${slug}/admin/his-roles`).then(r => r.ok ? r.json() : null).then(d => {
          const mappings = (d?.mappings ?? []) as { user_id: string; his_role: string; department?: string }[];
          const my = mappings.find(m => m.user_id === authData.user.id);
          if (my) {
            setHisRole(my.his_role.toLowerCase());
            if (my.department) setDepartment(my.department);
          }
        }).catch(() => {});

        // 가입일
        hfetch(`/api/cafes/${slug}/members`).then(r => r.ok ? r.json() : null).then(d => {
          const members = (d?.members ?? []) as { userId: string; joinedAt?: string }[];
          const me = members.find(m => m.userId === authData.user.id);
          if (me?.joinedAt) setMemberSince(me.joinedAt);
        }).catch(() => {});
      }
    }).catch(() => router.replace("/login")).finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await hfetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearPreferredClinic();
    router.replace("/login");
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /></div>;

  const roleCfg = ROLE_LABELS[hisRole] ?? ROLE_LABELS.staff;

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-lg mx-auto px-4 py-8">
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
          <ArrowLeft size={14} /> 대시보드
        </button>

        {/* 프로필 카드 */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          {/* 상단 그라디언트 */}
          <div className="h-20 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="px-6 pb-6 -mt-10">
            {/* 아바타 */}
            <div className="w-20 h-20 rounded-2xl bg-white border-4 border-white shadow-lg flex items-center justify-center overflow-hidden mb-4">
              {user?.profileImage ? (
                <Image src={user.profileImage} alt="" width={80} height={80} className="w-full h-full object-cover" unoptimized />
              ) : (
                <User size={32} className="text-gray-300" />
              )}
            </div>

            {/* 이름 + 역할 */}
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-black text-gray-900">{user?.username}</h1>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${roleCfg.bg} ${roleCfg.color}`}>
                {roleCfg.label}
              </span>
            </div>
            <p className="text-sm text-gray-400">{user?.email}</p>
          </div>
        </div>

        {/* 상세 정보 */}
        <div className="mt-4 bg-white rounded-2xl border shadow-sm divide-y">
          {/* 병원 */}
          <div className="flex items-center gap-3 px-5 py-3.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Stethoscope size={14} className="text-emerald-500" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400">소속 병원</p>
              <p className="text-sm font-medium text-gray-900">{hospitalName || "—"}</p>
            </div>
          </div>

          {/* 부서 */}
          {department && (
            <div className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Building2 size={14} className="text-blue-500" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-gray-400">부서</p>
                <p className="text-sm font-medium text-gray-900">{department}</p>
              </div>
            </div>
          )}

          {/* 권한 */}
          <div className="flex items-center gap-3 px-5 py-3.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Shield size={14} className="text-amber-500" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400">Clinic 권한</p>
              <p className="text-sm font-medium text-gray-900">{CLINIC_ROLE_LABELS[clinicRole] ?? (clinicRole || "—")}</p>
            </div>
          </div>

          {/* 이메일 */}
          <div className="flex items-center gap-3 px-5 py-3.5">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
              <Mail size={14} className="text-gray-400" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400">이메일</p>
              <p className="text-sm font-medium text-gray-900">{user?.email}</p>
            </div>
          </div>

          {/* 가입일 */}
          {memberSince && (
            <div className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                <Clock size={14} className="text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-gray-400">가입일</p>
                <p className="text-sm font-medium text-gray-900">
                  {new Date(memberSince).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="mt-4 space-y-2">
          <a href="https://example.org/account" target="_blank" rel="noopener noreferrer"
            className="w-full bg-white rounded-xl border px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors">
            계정 설정 (WeRU.B 계정)
          </a>
          <button onClick={handleLogout}
            className="w-full bg-white rounded-xl border border-red-200 px-4 py-3 text-sm text-red-500 hover:bg-red-50 flex items-center justify-center gap-2 transition-colors">
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      </main>
      <HospitalFooter />
    </div>
  );
}
