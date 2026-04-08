/**
 * ConsistencyRing — SVG circular progress ring showing a character's
 * consistency score (how well the LoRA preserves the character across generations).
 *
 * Usage:
 *   import { ConsistencyRing } from "@/components/ConsistencyRing";
 *
 *   <ConsistencyRing value={91} accent="hsl(320, 70%, 65%)" />
 *   <ConsistencyRing value={88} accent="#E94560" size={40} />
 *   <ConsistencyRing value={0} accent="hsl(190, 70%, 65%)" size={80} />
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConsistencyRingProps {
  /** Score from 0–100 */
  value: number;
  /** Outer diameter in px, default 34 */
  size?: number;
  /** Stroke color for the foreground arc */
  accent: string;
}

// ---------------------------------------------------------------------------
// ConsistencyRing
// ---------------------------------------------------------------------------
export function ConsistencyRing({ value, size = 34, accent }: ConsistencyRingProps) {
  // Ring geometry: strokeWidth is 2.5, radius shrinks accordingly
  const strokeWidth = 2.5;
  const r = (size - strokeWidth * 2) / 2;
  const circumference = Math.PI * 2 * r;
  const offset = circumference * (1 - Math.min(Math.max(value, 0), 100) / 100);

  const cx = size / 2;
  const cy = size / 2;

  return (
    // Rotated -90deg so the arc starts at 12 o'clock
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)", flexShrink: 0 }}
      aria-label={`Consistency score: ${value}`}
      role="img"
    >
      {/* Background track */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={strokeWidth}
      />

      {/* Foreground arc — animated on mount via CSS transition */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
      />

      {/*
        Center label — counter-rotated so it reads upright.
        SVG text rotation around an arbitrary point requires a transform on the element,
        not on the parent, because SVG coordinate transforms are additive.
      */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill="rgba(255,255,255,0.85)"
        fontSize={8}
        fontWeight={700}
        style={{ transform: "rotate(90deg)", transformOrigin: "center" }}
      >
        {value}
      </text>
    </svg>
  );
}
