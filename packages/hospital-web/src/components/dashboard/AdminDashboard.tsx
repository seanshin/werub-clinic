// Created: 2026-05-18
// 원무/행정 대시보드 — 접수 현황 + 수납 통계
"use client";

import { useState, useEffect } from "react";
import { fetchReceptionStatus, fetchBillingSummary, type ReceptionStatus, type BillingSummary, type DataSource } from "@/lib/workgroup";
import { Users, CreditCard, AlertTriangle, TrendingUp, Loader2 } from "lucide-react";
import DataSourceBadge from "@/components/DataSourceBadge";

interface Props { userId: string }

export default function AdminDashboard({ userId }: Props) {
  const [reception, setReception] = useState<ReceptionStatus | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>("mock");

  useEffect(() => {
    Promise.all([
      fetchReceptionStatus(),
      fetchBillingSummary(),
    ]).then(([r, b]) => {
      setReception(r.data);
      setBilling(b.data);
      setSource(r._source === "his" ? "his" : "mock");
      setLoading(false);
    });

    const interval = setInterval(() => {
      fetchReceptionStatus().then(r => setReception(r.data));
    }, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-emerald-500" size={20} /></div>;

  return (
    <div className="space-y-4">
      <DataSourceBadge source={source} />
      {/* 접수 현황 */}
      {reception && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-blue-500" />
            <h3 className="text-sm font-bold text-gray-900">접수 현황</h3>
          </div>

          {/* 핵심 숫자 */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-amber-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-xl font-black text-amber-600">{reception.waiting}</div>
              <div className="text-[10px] text-amber-500">대기</div>
            </div>
            <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-xl font-black text-blue-600">{reception.inProgress}</div>
              <div className="text-[10px] text-blue-500">진행</div>
            </div>
            <div className="bg-green-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-xl font-black text-green-600">{reception.completed}</div>
              <div className="text-[10px] text-green-500">완료</div>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-xl font-black text-gray-700">{reception.avgWaitMinutes}<span className="text-xs font-normal">분</span></div>
              <div className="text-[10px] text-gray-400">평균대기</div>
            </div>
          </div>

          {/* 부서별 */}
          <div className="space-y-1">
            {reception.departments.map(d => (
              <div key={d.name} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
                <span className="text-xs text-gray-700">{d.name}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-amber-600 font-medium">{d.waiting}명 대기</span>
                  <span className="text-gray-400">평균 {d.avgWaitMinutes}분</span>
                </div>
              </div>
            ))}
          </div>

          {/* 경고 */}
          {reception.alerts.map((a, i) => (
            <div key={i} className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
              <AlertTriangle size={10} /> {a.department}: {a.message}
            </div>
          ))}
        </div>
      )}

      {/* 수납 통계 */}
      {billing && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard size={16} className="text-emerald-500" />
            <h3 className="text-sm font-bold text-gray-900">오늘 수납</h3>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-emerald-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-lg font-black text-emerald-600">{billing.totalReceipts}</div>
              <div className="text-[10px] text-emerald-500">수납 완료</div>
            </div>
            <div className="bg-red-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-lg font-black text-red-600">{billing.unpaid}</div>
              <div className="text-[10px] text-red-500">미수납</div>
            </div>
            <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-center">
              <div className="text-lg font-black text-blue-600">{(billing.totalAmount / 10000).toFixed(0)}<span className="text-xs font-normal">만원</span></div>
              <div className="text-[10px] text-blue-500">총 금액</div>
            </div>
          </div>

          {/* 보험 */}
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={12} className="text-gray-400" />
              <span className="text-[10px] font-medium text-gray-500">보험 청구</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-600">승인 <strong className="text-green-600">{billing.insurance.approved}</strong></span>
              <span className="text-gray-600">대기 <strong className="text-amber-600">{billing.insurance.pending}</strong></span>
              <span className="text-gray-600">반려 <strong className="text-red-600">{billing.insurance.rejected}</strong></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
