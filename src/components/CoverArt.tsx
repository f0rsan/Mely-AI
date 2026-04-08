/**
 * CoverArt — gradient placeholder cover art for a character.
 * Renders a layered dark gradient using the character's accent color.
 * Supports a training overlay (LoRA in progress) and a style label badge.
 * When a real image is eventually available it can be swapped in as background.
 *
 * Usage:
 *   <CoverArt accent="hsl(320, 70%, 65%)" size="full" style="二次元" />
 *   <CoverArt accent="hsl(190, 70%, 65%)" size="md" isTraining />
 *   <CoverArt accent="hsl(30, 70%, 65%)" size="sm" />
 */

import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CoverArtSize = "full" | "md" | "sm";

interface CoverArtProps {
  /** Color string, e.g. "hsl(320, 70%, 65%)" — drives gradient palette */
  accent: string;
  /** sm = 80px height, md = 120px, full = 3/4 aspect ratio */
  size?: CoverArtSize;
  /** Show LoRA training overlay with pulsing ring + progress bar */
  isTraining?: boolean;
  /** Character style label badge, e.g. "二次元" */
  style?: string;
}

// ---------------------------------------------------------------------------
// Noise texture (SVG fractal noise, mixed as overlay for film-grain depth)
// ---------------------------------------------------------------------------
const NOISE_URL =
  `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

// ---------------------------------------------------------------------------
// PulseRing — small pulsing dot for training status
// ---------------------------------------------------------------------------
function PulseRing({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* Solid core */}
      <div
        style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }}
      />
      {/* Expanding ring — "pulseRing" keyframe defined in styles.css */}
      <div
        style={{
          position: "absolute",
          inset: -3,
          borderRadius: "50%",
          border: `1.5px solid ${color}`,
          opacity: 0.4,
          animation: "pulseRing 2s ease-in-out infinite",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CoverArt
// ---------------------------------------------------------------------------
export function CoverArt({ accent, size = "full", isTraining = false, style }: CoverArtProps) {
  // Extract hue from "hsl(N, ...)" — fallback 280 if parsing fails
  const hueMatch = accent.match(/hsl\((\d+)/);
  const hue = hueMatch ? parseInt(hueMatch[1], 10) : 280;
  const hue2 = (hue + 40) % 360;

  // Size-specific container styles
  const sizeStyles: CSSProperties =
    size === "full"
      ? { aspectRatio: "3/4", borderRadius: "12px 12px 0 0" }
      : size === "md"
      ? { height: 120, borderRadius: 10 }
      : { height: 80, borderRadius: 8 };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        overflow: "hidden",
        flexShrink: 0,
        background: `linear-gradient(160deg, hsl(${hue},25%,10%), hsl(${hue},35%,5%))`,
        ...sizeStyles,
      }}
    >
      {/* Dual radial overlays for depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            `radial-gradient(ellipse 80% 60% at 30% 80%, hsla(${hue},50%,25%,0.5), transparent 60%)`,
            `radial-gradient(ellipse 60% 80% at 80% 20%, hsla(${hue2},45%,20%,0.4), transparent 55%)`,
          ].join(", "),
        }}
      />

      {/* Noise texture — film-grain atmosphere */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.3,
          backgroundImage: NOISE_URL,
          backgroundSize: "128px",
          mixBlendMode: "overlay",
        }}
      />

      {/* Bottom accent glow */}
      <div
        style={{
          position: "absolute",
          bottom: -10,
          left: "50%",
          transform: "translateX(-50%)",
          width: "120%",
          height: 50,
          background: `radial-gradient(ellipse, ${accent}22, transparent 70%)`,
        }}
      />

      {/* Optional style label badge */}
      {style && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "2px 8px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            fontSize: 9,
            fontWeight: 500,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          {style}
        </div>
      )}

      {/* Training overlay — shown when LoRA is actively training */}
      {isTraining && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(2px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <PulseRing color={accent} />
          <span style={{ fontSize: 10, fontWeight: 600, color: accent }}>LoRA 训练中</span>
          {/* "trainPulse" keyframe defined in styles.css */}
          <div
            style={{
              width: "55%",
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "62%",
                height: "100%",
                borderRadius: 2,
                background: accent,
                animation: "trainPulse 3s ease-in-out infinite",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
