export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/panel/dashboard" className="flex items-center gap-2 select-none">
      <svg width={compact ? 30 : 40} height={compact ? 30 : 40} viewBox="0 0 64 64" fill="none">
        <path d="M10 16c0-5 5-8.5 11-8.5h22c6 0 11 3.5 11 8.5v11c0 5-5 8.5-11 8.5h-4l-9 8.5v-8.5h-9c-6 0-11-3.5-11-8.5V16z" fill="#0FB5A0" />
        <path d="M17 17c0-3 3.5-5.5 8-5.5h14c4.5 0 8 2.5 8 5.5v8c0 3-3.5 5.5-8 5.5h-2.5L30 36v-5.5h-5c-4.5 0-8-2.5-8-5.5v-8z" fill="white" opacity=".92" />
        <text x="32" y="27.5" fontFamily="Outfit,Arial" fontWeight="800" fontSize="13" fill="#0FB5A0" textAnchor="middle">S</text>
        <circle cx="22" cy="33" r="1.4" fill="#0FB5A0" />
        <circle cx="27" cy="33" r="1.4" fill="#0FB5A0" opacity=".6" />
        <circle cx="32" cy="33" r="1.4" fill="#0FB5A0" opacity=".35" />
      </svg>
      <span className="font-extrabold tracking-wide text-[#0FB5A0]" style={{ fontSize: compact ? 18 : 22 }}>
        WOLTSMS
      </span>
    </a>
  );
}
