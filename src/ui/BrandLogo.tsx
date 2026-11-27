/**
 * 平台 LOGO（紧凑横版）：脉冲核心图标 + Dimlu-ai 字标 + 中文副标。
 * currentColor 跟随文字颜色；紧凑 viewBox 让 Logo 在 52px 顶栏内清晰可读。
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Dimlu-ai 律动引擎"
    >
      <g transform="translate(5.6 5.6) scale(0.8)">
        <rect x="1.5" y="1.5" width="53" height="53" rx="14" />
        <path d="M10 28 H18 L24 18 L32 38 L39 23 L45 28 H53" />
        <circle cx="53" cy="28" r="2.2" fill="currentColor" stroke="none" />
      </g>
      <text
        x="68"
        y="31"
        fontFamily="Inter, 'Segoe UI', Arial, sans-serif"
        fontSize={26}
        fontWeight={700}
        letterSpacing={0.2}
        fill="currentColor"
        stroke="none"
      >
        Dimlu-ai
      </text>
      <text
        x="69"
        y="48"
        fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
        fontSize={10}
        fontWeight={400}
        letterSpacing={3}
        fill="currentColor"
        stroke="none"
        opacity={0.55}
      >
        律动引擎
      </text>
    </svg>
  );
}
