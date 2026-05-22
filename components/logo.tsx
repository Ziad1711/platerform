// ─── Color tokens ───────────────────────────────────────────────
const INK = "#1f2a23";
const GREEN = "#1fa971";
const INK_DARK = "#f3efe6";

// ─── Types ──────────────────────────────────────────────────────
interface MarkProps {
  size?: number;
  ink?: string;
  accent?: string;
}

interface WordmarkProps {
  size?: number;
  ink?: string;
  accent?: string;
}

interface LogoProps {
  size?: number;
  variant?: "mark" | "wordmark" | "lockup";
  dark?: boolean;
}

// ─── JisraMark — SVG bracket-J ──────────────────────────────────
export const JisraMark = ({
  size = 96,
  ink = "currentColor",
  accent = GREEN,
}: MarkProps) => (
  <svg width={size} height={size} viewBox="0 0 96 96" fill="none">
    <path
      d="M62 18 L80 18 L80 64 Q80 80 64 80 L40 80 Q24 80 24 64"
      stroke={ink}
      strokeWidth="8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <rect x="14" y="34" width="14" height="14" fill={accent} />
  </svg>
);

// ─── JisraWordmark — "jisra." with green period ────────────────
export const JisraWordmark = ({
  size = 64,
  ink = INK,
  accent = GREEN,
}: WordmarkProps) => (
  <span
    style={{
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontWeight: 600,
      letterSpacing: "-0.04em",
      fontSize: size,
      lineHeight: 1,
      color: ink,
      whiteSpace: "nowrap",
    }}
  >
    jisra
    <span style={{ color: accent }}>.</span>
  </span>
);

// ─── JisraLogo — lockup (mark + wordmark) ──────────────────────
export const JisraLogo = ({
  size = 96,
  variant = "lockup",
  dark = false,
}: LogoProps) => {
  const ink = dark ? INK_DARK : INK;
  const accent = GREEN;

  if (variant === "mark") {
    return <JisraMark size={size} ink={ink} accent={accent} />;
  }

  if (variant === "wordmark") {
    const fontSize = Math.round(size * 0.67);
    return <JisraWordmark size={fontSize} ink={ink} accent={accent} />;
  }

  // lockup
  const markSize = size;
  const fontSize = Math.round(size * 0.67);
  const gap = 22;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
      }}
    >
      <JisraMark size={markSize} ink={ink} accent={accent} />
      <JisraWordmark size={fontSize} ink={ink} accent={accent} />
    </div>
  );
};

// ─── Default export (backward compat) ──────────────────────────
const Logo = JisraLogo;
export default Logo;
