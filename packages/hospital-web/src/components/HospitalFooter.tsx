// Created: 2026-05-06
export function HospitalFooter() {
  return (
    <footer className="border-t border-gray-200 py-6 px-4 mt-10">
      <div className="max-w-5xl mx-auto text-center text-[11px] text-gray-400 space-y-0.5">
        <p>(주)위루비 | 대표: 박세진, 박진숙 | 사업자등록번호: 539-86-02382</p>
        <p>경기도 고양시 일산동구 중앙로1079 639호 | 전화: 070-7799-2772</p>
        <p className="pt-1">
          <a href="https://example.org/terms" target="_blank" rel="noopener noreferrer" className="hover:underline">이용약관</a>
          <span className="mx-1">·</span>
          <a href="https://example.org/privacy" target="_blank" rel="noopener noreferrer" className="hover:underline">개인정보처리방침</a>
        </p>
      </div>
    </footer>
  );
}
