import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────
const ACCENT = "#FF6B9D";
const MODES = [
  { id: "light", name: "轻量", steps: "800–1000", rank: 8, images: "10–15", time: "~15 分钟", size: "~40MB", consistency: 75, vram: "5.8 GB", recommended: false },
  { id: "standard", name: "标准", steps: "1500–2000", rank: 16, images: "15–25", time: "~30 分钟", size: "~80MB", consistency: 88, vram: "7.2 GB", recommended: true },
  { id: "fine", name: "精细", steps: "2500–3000", rank: 32, images: "25–40", time: "~55 分钟", size: "~150MB", consistency: 94, vram: "11.5 GB", recommended: false },
];

const MOCK_DATASET = [
  { id: 1, name: "ref_front_01.png", res: "1024×1024", angle: "正面", face: "清晰", ok: true },
  { id: 2, name: "ref_front_02.png", res: "1024×1024", angle: "正面", face: "清晰", ok: true },
  { id: 3, name: "ref_34side_01.png", res: "768×1024", angle: "3/4 侧", face: "清晰", ok: true },
  { id: 4, name: "ref_34side_02.png", res: "1024×768", angle: "3/4 侧", face: "清晰", ok: true },
  { id: 5, name: "ref_side_01.png", res: "1024×1024", angle: "侧面", face: "清晰", ok: true },
  { id: 6, name: "ref_back_01.png", res: "512×512", angle: "背面", face: "—", ok: false, issue: "分辨率过低" },
  { id: 7, name: "ref_closeup_01.png", res: "1024×1024", angle: "特写", face: "清晰", ok: true },
  { id: 8, name: "ref_full_01.png", res: "768×1152", angle: "全身", face: "模糊", ok: false, issue: "人脸模糊" },
  { id: 9, name: "ref_34side_03.png", res: "1024×1024", angle: "3/4 侧", face: "清晰", ok: true },
  { id: 10, name: "ref_front_03.png", res: "1024×1024", angle: "正面", face: "清晰", ok: true },
  { id: 11, name: "ref_action_01.png", res: "1024×768", angle: "正面", face: "清晰", ok: true },
  { id: 12, name: "ref_front_04.png", res: "1024×1024", angle: "正面", face: "清晰", ok: true },
  { id: 13, name: "ref_side_02.png", res: "768×1024", angle: "侧面", face: "清晰", ok: true },
  { id: 14, name: "ref_closeup_02.png", res: "1024×1024", angle: "特写", face: "清晰", ok: true },
  { id: 15, name: "ref_34side_04.png", res: "1024×1024", angle: "3/4 侧", face: "清晰", ok: true },
  { id: 16, name: "ref_full_02.png", res: "1024×1536", angle: "全身", face: "清晰", ok: true },
  { id: 17, name: "ref_front_05.png", res: "1024×1024", angle: "正面", face: "清晰", ok: true },
  { id: 18, name: "ref_side_03.png", res: "1024×1024", angle: "侧面", face: "清晰", ok: true },
  { id: 19, name: "ref_action_02.png", res: "768×1024", angle: "正面", face: "清晰", ok: true },
  { id: 20, name: "ref_34side_05.png", res: "1024×1024", angle: "3/4 侧", face: "清晰", ok: true },
  { id: 21, name: "ref_back_02.png", res: "1024×1024", angle: "背面", face: "—", ok: true },
  { id: 22, name: "ref_closeup_03.png", res: "1024×1024", angle: "特写", face: "清晰", ok: true },
];

const LOSS_DATA = [
  1.0,0.92,0.85,0.78,0.71,0.65,0.59,0.54,0.50,0.46,
  0.43,0.41,0.39,0.37,0.35,0.34,0.33,0.32,0.31,0.305,
  0.30,0.295,0.29,0.288,0.285,0.283,0.28,0.278,0.277,0.275,
];

// ─── Icons ───────────────────────────────────────────────────
const I = {
  Upload: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 18.5A5 5 0 017.8 8.7a7 7 0 0113.5 2.5A4.5 4.5 0 0120.5 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M12 12v8M9 15l3-3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Check: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  X: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Warn: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L1 10.5h10L6 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/><path d="M6 5v2.5M6 9v.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Bolt: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7.5 1.5L3.5 8h3.5l-.5 4.5L11 6H7l.5-4.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Sparkle: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Play: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2.5l9 5.5-9 5.5V2.5z" fill="currentColor"/></svg>,
  Pause: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2.5" width="3" height="9" rx="0.8" fill="currentColor"/><rect x="8" y="2.5" width="3" height="9" rx="0.8" fill="currentColor"/></svg>,
  Stop: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/></svg>,
  ThumbUp: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 6.5V12M6 6l1.5-4a1 1 0 011-.5h.5a1 1 0 011 1V5h2.5a1 1 0 011 1.1l-.8 5A1 1 0 0111.7 12H6a2 2 0 01-2-2V6.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  ThumbDown: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 7.5V2M6 8l1.5 4a1 1 0 001 .5h.5a1 1 0 001-1V9h2.5a1 1 0 001-1.1l-.8-5A1 1 0 0011.7 2H6a2 2 0 00-2 2v3.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Repeat: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5.5A5.5 5.5 0 0111.8 4M12 8.5A5.5 5.5 0 012.2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M11.5 2v2.5H9M2.5 12V9.5H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Info: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1"/><path d="M6 5.5V8.5M6 4v.01" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  ArrowRight: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ─── Shared ──────────────────────────────────────────────────
const glass = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12 };
const labelStyle = { fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 };
const mono = { fontFamily: "'JetBrains Mono', monospace" };

// ─── Quality Score Ring ──────────────────────────────────────
function ScoreRing({ value, size = 72, label }) {
  const r = (size - 8) / 2;
  const c = Math.PI * r;
  const offset = c * (1 - value / 100);
  const color = value >= 80 ? "#5DCAA5" : value >= 60 ? "#EF9F27" : "#E94560";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease-out", filter: `drop-shadow(0 0 6px ${color}44)` }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.9)", ...mono }}>{value}</span>
        </div>
      </div>
      {label && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{label}</span>}
    </div>
  );
}

// ─── Angle Distribution Bar ──────────────────────────────────
function AngleBar({ angles }) {
  const total = Object.values(angles).reduce((s, v) => s + v, 0);
  const colors = { "正面": "#7B68EE", "3/4 侧": "#5DCAA5", "侧面": "#FF8C42", "背面": "#E94560", "特写": "#00C9FF", "全身": "#EF9F27" };
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
        {Object.entries(angles).map(([k, v]) => (
          <div key={k} style={{ width: `${(v / total) * 100}%`, background: colors[k] || "#666", transition: "width 0.5s" }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(angles).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: colors[k] || "#666" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{k}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)", ...mono }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Loss Chart (Pure CSS) ───────────────────────────────────
function LossChart({ data, progress }) {
  const visibleCount = Math.floor((progress / 100) * data.length);
  const visible = data.slice(0, Math.max(visibleCount, 1));
  const max = Math.max(...data);
  const min = Math.min(...data);
  const w = 100 / data.length;

  return (
    <div style={{ ...glass, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>Loss 曲线</span>
        <span style={{ fontSize: 10, color: ACCENT, fontWeight: 600, ...mono }}>{visible.length > 0 ? visible[visible.length - 1].toFixed(3) : "—"}</span>
      </div>
      <div style={{ position: "relative", height: 80, overflow: "hidden" }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <div key={v} style={{ position: "absolute", left: 0, right: 0, bottom: `${v * 100}%`, height: 1, background: "rgba(255,255,255,0.03)" }} />
        ))}
        {/* Bars */}
        <svg width="100%" height="80" viewBox={`0 0 ${data.length} ${max}`} preserveAspectRatio="none" style={{ display: "block" }}>
          <defs>
            <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.6" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {/* Area fill */}
          <path
            d={`M0,${max} ${visible.map((v, i) => `L${i},${max - v}`).join(" ")} L${visible.length - 1},${max} Z`}
            fill="url(#lossGrad)"
          />
          {/* Line */}
          <path
            d={visible.map((v, i) => `${i === 0 ? "M" : "L"}${i},${max - v}`).join(" ")}
            fill="none" stroke={ACCENT} strokeWidth="0.08" vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 3px ${ACCENT}66)` }}
          />
        </svg>
        {/* Y axis labels */}
        <span style={{ position: "absolute", top: 0, left: 0, fontSize: 8, color: "rgba(255,255,255,0.2)", ...mono }}>{max.toFixed(1)}</span>
        <span style={{ position: "absolute", bottom: 0, left: 0, fontSize: 8, color: "rgba(255,255,255,0.2)", ...mono }}>{min.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Preview Image ───────────────────────────────────────────
function PreviewImage({ hue, step, total, index, isLatest }) {
  const pct = Math.round((step / total) * 100);
  return (
    <div style={{
      position: "relative", aspectRatio: "1/1", borderRadius: 10, overflow: "hidden",
      border: isLatest ? `1.5px solid ${ACCENT}50` : "1px solid rgba(255,255,255,0.05)",
      animation: isLatest ? "previewPop 0.5s ease-out" : "none",
      boxShadow: isLatest ? `0 0 20px ${ACCENT}22` : "none",
    }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, hsl(${hue},${20 + pct * 0.3}%,${8 + pct * 0.06}%), hsl(${hue},${25 + pct * 0.2}%,5%))` }} />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 45% 65%, hsla(${hue},${30 + pct * 0.3}%,${15 + pct * 0.1}%,${0.2 + pct * 0.005}) 0%, transparent 60%)` }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.3 - pct * 0.002, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`, backgroundSize: "128px", mixBlendMode: "overlay" }} />
      {/* Silhouette becomes more defined as training progresses */}
      <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: `${50 + pct * 0.3}%`, height: `${40 + pct * 0.5}%`, background: `linear-gradient(to top, hsla(${hue},30%,8%,0) 0%, hsla(${hue},${25 + pct * 0.2}%,${12 + pct * 0.08}%,${0.15 + pct * 0.004}) 50%, hsla(${hue},30%,8%,0) 100%)`, borderRadius: "50% 50% 0 0" }} />
      {/* Badge */}
      <div style={{ position: "absolute", bottom: 6, left: 6, padding: "2px 8px", borderRadius: 10, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", fontSize: 9, fontWeight: 600, color: isLatest ? ACCENT : "rgba(255,255,255,0.5)", ...mono }}>
        Step {step} · {pct}%
      </div>
      {isLatest && <div style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 4, background: ACCENT, animation: "pulse 2s ease-in-out infinite" }} />}
    </div>
  );
}

// ─── Verification Card ───────────────────────────────────────
function VerifyCard({ label, hue, rating, onRate }) {
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", ...glass }}>
      <div style={{ aspectRatio: "3/4", position: "relative", background: `linear-gradient(135deg, hsl(${hue},30%,14%), hsl(${hue},35%,6%))` }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 50% 60%, hsla(${hue},45%,22%,0.5) 0%, transparent 60%)` }} />
        <div style={{ position: "absolute", inset: 0, opacity: 0.2, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")`, backgroundSize: "128px", mixBlendMode: "overlay" }} />
        <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "65%", height: "90%", background: `linear-gradient(to top, transparent 0%, hsla(${hue},30%,18%,0.35) 50%, transparent 100%)`, borderRadius: "50% 50% 0 0" }} />
        <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 10, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{label}</div>
      </div>
      <div style={{ padding: "10px 12px", display: "flex", justifyContent: "center", gap: 8 }}>
        <button onClick={() => onRate("up")} style={{
          display: "flex", alignItems: "center", gap: 4, padding: "5px 14px", borderRadius: 16, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 500, transition: "all 0.2s",
          border: `1px solid ${rating === "up" ? "#5DCAA540" : "rgba(255,255,255,0.06)"}`,
          background: rating === "up" ? "#5DCAA512" : "transparent",
          color: rating === "up" ? "#5DCAA5" : "rgba(255,255,255,0.4)",
        }}><I.ThumbUp /> 满意</button>
        <button onClick={() => onRate("down")} style={{
          display: "flex", alignItems: "center", gap: 4, padding: "5px 14px", borderRadius: 16, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 500, transition: "all 0.2s",
          border: `1px solid ${rating === "down" ? "#E9456040" : "rgba(255,255,255,0.06)"}`,
          background: rating === "down" ? "#E9456012" : "transparent",
          color: rating === "down" ? "#E94560" : "rgba(255,255,255,0.4)",
        }}><I.ThumbDown /> 不满意</button>
      </div>
    </div>
  );
}

// ─── Step Indicator ──────────────────────────────────────────
function StepBar({ steps, current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 600, transition: "all 0.3s",
                background: done ? ACCENT : active ? `${ACCENT}20` : "rgba(255,255,255,0.03)",
                border: `1.5px solid ${done ? ACCENT : active ? ACCENT : "rgba(255,255,255,0.08)"}`,
                color: done ? "#fff" : active ? ACCENT : "rgba(255,255,255,0.3)",
              }}>
                {done ? <I.Check /> : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 500, color: active ? "rgba(255,255,255,0.85)" : done ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)", whiteSpace: "nowrap" }}>{s}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 40, height: 1.5, background: done ? `${ACCENT}50` : "rgba(255,255,255,0.06)", margin: "0 10px", borderRadius: 1, transition: "background 0.3s" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function LoRATrainingPanel() {
  const [phase, setPhase] = useState(0); // 0=upload, 1=config, 2=training, 3=verify
  const [dataset] = useState(MOCK_DATASET);
  const [selectedMode, setSelectedMode] = useState("standard");
  const [baseModel, setBaseModel] = useState("FLUX-dev");
  const [progress, setProgress] = useState(0);
  const [isTraining, setIsTraining] = useState(false);
  const [ratings, setRatings] = useState({});

  // Simulate training progress
  useEffect(() => {
    if (phase === 2 && isTraining && progress < 100) {
      const timer = setTimeout(() => setProgress(p => Math.min(p + 0.5, 100)), 150);
      return () => clearTimeout(timer);
    }
  }, [phase, isTraining, progress]);

  const okCount = dataset.filter(d => d.ok).length;
  const issueCount = dataset.length - okCount;
  const angles = {};
  dataset.forEach(d => { angles[d.angle] = (angles[d.angle] || 0) + 1; });
  const qualityScore = Math.round((okCount / dataset.length) * 85 + (Object.keys(angles).length / 6) * 15);
  const mode = MODES.find(m => m.id === selectedMode);
  const needsHighVRAM = selectedMode === "fine";

  const samplingSteps = [0.2, 0.4, 0.6, 0.8, 1.0].map(p => Math.round(p * parseInt(mode.steps)));
  const visibleSamples = samplingSteps.filter((_, i) => progress >= (i + 1) * 20);

  const handleRate = (id, r) => setRatings(prev => ({ ...prev, [id]: prev[id] === r ? null : r }));
  const dissatisfied = Object.values(ratings).filter(v => v === "down").length;

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", color: "#fff", fontFamily: "'DM Sans', 'Noto Sans SC', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes previewPop { from{opacity:0;transform:scale(0.85)} to{opacity:1;transform:scale(1)} }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-16px)} to{opacity:1;transform:translateX(0)} }
        * { box-sizing:border-box } textarea:focus,input:focus{outline:none}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:3px}
      `}</style>

      {/* Background */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: `radial-gradient(circle, hsla(320,40%,18%,0.05) 0%, transparent 70%)`, left: "15%", top: "30%", transform: "translate(-50%,-50%)" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "28px 32px" }}>
        {/* ─── Header ─── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, animation: "fadeIn 0.3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}88)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <I.Bolt />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>LoRA 训练面板</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>星野ミカ · AI-Toolkit 训练引擎</div>
            </div>
          </div>
          <StepBar steps={["数据集", "训练配置", "训练中", "验证"]} current={phase} />
        </div>

        {/* ═══ PHASE 0: DATASET ═══ */}
        {phase === 0 && (
          <div style={{ animation: "fadeIn 0.4s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
              {/* Left: image grid */}
              <div>
                <div style={labelStyle}>训练数据集 · {dataset.length} 张图片</div>
                {/* Drop zone (shown as header) */}
                <div style={{ ...glass, padding: 20, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, borderStyle: "dashed", cursor: "pointer", minHeight: 80 }}>
                  <span style={{ color: "rgba(255,255,255,0.25)" }}><I.Upload /></span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>拖拽图片到此处，或点击上传</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>支持 PNG / JPG / WebP，推荐 1024×1024 以上</div>
                  </div>
                </div>
                {/* Image grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 6 }}>
                  {dataset.map((img, i) => (
                    <div key={img.id} style={{
                      aspectRatio: "1/1", borderRadius: 8, overflow: "hidden", position: "relative",
                      border: `1px solid ${img.ok ? "rgba(255,255,255,0.05)" : "#E9456040"}`,
                      animation: `fadeIn 0.3s ${i * 0.02}s both ease-out`, cursor: "pointer",
                    }}>
                      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, hsl(${320 + i * 7},22%,12%), hsl(${320 + i * 7},28%,6%))` }} />
                      <div style={{ position: "absolute", inset: 0, opacity: 0.25, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`, backgroundSize: "64px", mixBlendMode: "overlay" }} />
                      {/* Status badge */}
                      <div style={{ position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: img.ok ? "rgba(93,202,165,0.2)" : "rgba(233,69,96,0.2)", color: img.ok ? "#5DCAA5" : "#E94560" }}>
                        {img.ok ? <I.Check /> : <I.Warn />}
                      </div>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 4px 3px", background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", textAlign: "center", ...mono }}>{img.res}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Quality report */}
              <div>
                <div style={labelStyle}>数据集质量评分</div>
                <div style={{ ...glass, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginBottom: 16 }}>
                  <ScoreRing value={qualityScore} size={88} label="综合评分" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
                    <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(93,202,165,0.06)", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#5DCAA5", ...mono }}>{okCount}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>合格图片</div>
                    </div>
                    <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(233,69,96,0.06)", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#E94560", ...mono }}>{issueCount}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>问题图片</div>
                    </div>
                  </div>
                </div>

                <div style={labelStyle}>角度分布</div>
                <div style={{ ...glass, padding: 16, marginBottom: 16 }}>
                  <AngleBar angles={angles} />
                </div>

                {/* Suggestions */}
                <div style={labelStyle}>改进建议</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {issueCount > 0 && (
                    <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(233,69,96,0.06)", border: "1px solid rgba(233,69,96,0.15)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "#E94560", marginTop: 1, flexShrink: 0 }}><I.Warn /></span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>有 {issueCount} 张图片存在问题（分辨率过低或人脸模糊），建议替换或移除</span>
                    </div>
                  )}
                  {!angles["背面"] || angles["背面"] < 2 ? (
                    <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(239,159,39,0.06)", border: "1px solid rgba(239,159,39,0.15)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "#EF9F27", marginTop: 1, flexShrink: 0 }}><I.Info /></span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>背面角度偏少，建议补充 2–3 张背面参考图以提升角度覆盖</span>
                    </div>
                  ) : null}
                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(93,202,165,0.06)", border: "1px solid rgba(93,202,165,0.15)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#5DCAA5", marginTop: 1, flexShrink: 0 }}><I.Check /></span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>正面和 3/4 侧图数量充足，适合标准模式训练</span>
                  </div>
                </div>

                {/* Next button */}
                <button onClick={() => setPhase(1)} style={{
                  width: "100%", marginTop: 20, padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}aa)`, color: "#fff", fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: `0 4px 20px ${ACCENT}33`,
                }}>
                  下一步：训练配置 <I.ArrowRight />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PHASE 1: CONFIG ═══ */}
        {phase === 1 && (
          <div style={{ animation: "fadeIn 0.4s ease-out" }}>
            <div style={labelStyle}>选择训练模式</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
              {MODES.map(m => {
                const active = selectedMode === m.id;
                const isHigh = m.id === "fine";
                return (
                  <div key={m.id} onClick={() => setSelectedMode(m.id)} style={{
                    ...glass, padding: 20, cursor: "pointer", transition: "all 0.25s",
                    borderColor: active ? `${ACCENT}50` : isHigh ? "rgba(239,159,39,0.15)" : "rgba(255,255,255,0.06)",
                    background: active ? `${ACCENT}08` : "rgba(255,255,255,0.02)",
                    position: "relative", overflow: "hidden",
                  }}>
                    {m.recommended && <div style={{ position: "absolute", top: 10, right: 10, padding: "2px 8px", borderRadius: 10, fontSize: 9, fontWeight: 600, background: `${ACCENT}18`, color: ACCENT }}>推荐</div>}
                    {isHigh && <div style={{ position: "absolute", top: 10, right: 10, padding: "2px 8px", borderRadius: 10, fontSize: 9, fontWeight: 600, background: "rgba(239,159,39,0.12)", color: "#EF9F27" }}>需 12GB</div>}
                    <div style={{ fontSize: 20, fontWeight: 700, color: active ? ACCENT : "rgba(255,255,255,0.7)", marginBottom: 4 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>Rank {m.rank} · {m.steps} steps</div>
                    {[
                      { l: "推荐图片", v: m.images },
                      { l: "预计耗时", v: m.time },
                      { l: "文件大小", v: m.size },
                      { l: "一致性评分", v: `~${m.consistency}%` },
                      { l: "VRAM 占用", v: m.vram },
                    ].map(r => (
                      <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{r.l}</span>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.65)", ...mono }}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Base model */}
            <div style={labelStyle}>基础模型</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {["FLUX-dev", "FLUX-schnell", "SDXL"].map(m => (
                <button key={m} onClick={() => setBaseModel(m)} style={{
                  padding: "8px 20px", borderRadius: 20, border: `1px solid ${baseModel === m ? `${ACCENT}40` : "rgba(255,255,255,0.06)"}`,
                  background: baseModel === m ? `${ACCENT}10` : "transparent", color: baseModel === m ? ACCENT : "rgba(255,255,255,0.4)",
                  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", ...mono,
                }}>{m}</button>
              ))}
            </div>

            {/* VRAM warning */}
            {needsHighVRAM && (
              <div style={{ padding: 14, borderRadius: 10, background: "rgba(239,159,39,0.06)", border: "1px solid rgba(239,159,39,0.2)", marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: "#EF9F27", marginTop: 1 }}><I.Warn /></span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#EF9F27" }}>精细模式需要 12GB VRAM</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, lineHeight: 1.6 }}>
                    你的 RTX 3070 拥有 8GB VRAM，精细模式可能导致 OOM 错误。建议使用标准模式（7.2GB），或确认已开启系统内存溢出策略。
                  </div>
                </div>
              </div>
            )}

            {/* Summary & start */}
            <div style={{ ...glass, padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>训练概要</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                  {dataset.length} 张数据集 · {mode.name}模式 · Rank {mode.rank} · {mode.steps} steps · {baseModel}
                </div>
              </div>
              <button onClick={() => { setPhase(2); setIsTraining(true); setProgress(0); }} style={{
                padding: "12px 32px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}aa)`, color: "#fff", fontSize: 14, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8, boxShadow: `0 4px 20px ${ACCENT}33`,
              }}>
                <I.Play /> 开始训练
              </button>
            </div>
          </div>
        )}

        {/* ═══ PHASE 2: TRAINING ═══ */}
        {phase === 2 && (
          <div style={{ animation: "fadeIn 0.4s ease-out" }}>
            {/* Progress header */}
            <div style={{ ...glass, padding: 24, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
                    {progress < 100 ? (
                      <>
                        <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${ACCENT}40`, borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
                        <span>训练中…</span>
                      </>
                    ) : (
                      <>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#5DCAA5", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><I.Check /></div>
                        <span style={{ color: "#5DCAA5" }}>训练完成！</span>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4, display: "flex", gap: 12 }}>
                    <span>{mode.name}模式 · {baseModel}</span>
                    <span>Rank {mode.rank}</span>
                    <span>Step {Math.round(progress / 100 * parseInt(mode.steps))} / {mode.steps.split("–")[0]}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 36, fontWeight: 700, color: ACCENT, ...mono }}>{Math.round(progress)}%</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                    {progress < 100 ? `预计剩余 ~${Math.round((100 - progress) * 0.3)} 分钟` : "耗时 28 分钟"}
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}88)`, transition: "width 0.3s", boxShadow: `0 0 12px ${ACCENT}44` }} />
              </div>
              {/* Controls */}
              {progress < 100 && (
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button onClick={() => setIsTraining(!isTraining)} style={{ padding: "6px 16px", borderRadius: 8, border: `1px solid ${ACCENT}30`, background: `${ACCENT}10`, color: ACCENT, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                    {isTraining ? <><I.Pause /> 暂停</> : <><I.Play /> 继续</>}
                  </button>
                  <button style={{ padding: "6px 16px", borderRadius: 8, border: "1px solid rgba(233,69,96,0.2)", background: "rgba(233,69,96,0.06)", color: "#E94560", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                    <I.Stop /> 终止
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Loss chart */}
              <div>
                <div style={labelStyle}>训练指标</div>
                <LossChart data={LOSS_DATA} progress={progress} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                  {[
                    { l: "当前 Loss", v: LOSS_DATA[Math.min(Math.floor(progress / 100 * LOSS_DATA.length), LOSS_DATA.length - 1)].toFixed(3) },
                    { l: "VRAM 占用", v: `${mode.vram}` },
                    { l: "GPU 温度", v: "72°C" },
                  ].map(s => (
                    <div key={s.l} style={{ ...glass, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>{s.l}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.8)", ...mono }}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sampling previews */}
              <div>
                <div style={labelStyle}>采样预览 · 角色逐渐成型</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  {samplingSteps.map((step, i) => {
                    const visible = progress >= (i + 1) * 20;
                    if (!visible) return (
                      <div key={i} style={{ aspectRatio: "1/1", borderRadius: 10, border: "1px dashed rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", ...mono }}>{(i + 1) * 20}%</span>
                      </div>
                    );
                    return <PreviewImage key={i} hue={320 + i * 12} step={step} total={parseInt(mode.steps)} index={i} isLatest={i === visibleSamples.length - 1} />;
                  })}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 8, textAlign: "center" }}>每 20% 进度自动生成一张采样预览，观察角色特征逐步锁定</div>
              </div>
            </div>

            {/* Complete button */}
            {progress >= 100 && (
              <div style={{ textAlign: "center", marginTop: 28, animation: "fadeIn 0.5s ease-out" }}>
                <button onClick={() => setPhase(3)} style={{
                  padding: "14px 40px", borderRadius: 14, border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: `linear-gradient(135deg, #5DCAA5, #5DCAA5aa)`, color: "#fff", fontSize: 14, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 4px 20px rgba(93,202,165,0.3)",
                }}>
                  <I.Sparkle /> 进入角色验证 <I.ArrowRight />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ PHASE 3: VERIFICATION ═══ */}
        {phase === 3 && (
          <div style={{ animation: "fadeIn 0.4s ease-out" }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>角色验证</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
                系统自动生成 4 张验证图，请确认角色外貌一致性。对每张图评分「满意 / 不满意」。
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { id: "v1", label: "正面", hue: 320 },
                { id: "v2", label: "3/4 侧面", hue: 340 },
                { id: "v3", label: "背面", hue: 300 },
                { id: "v4", label: "特写", hue: 310 },
              ].map((v, i) => (
                <div key={v.id} style={{ animation: `slideIn 0.4s ${i * 0.1}s both ease-out` }}>
                  <VerifyCard label={v.label} hue={v.hue} rating={ratings[v.id]} onRate={(r) => handleRate(v.id, r)} />
                </div>
              ))}
            </div>

            {/* Suggestions if unsatisfied */}
            {dissatisfied > 0 && (
              <div style={{ ...glass, padding: 20, marginBottom: 20, borderColor: "rgba(239,159,39,0.2)", animation: "fadeIn 0.3s ease-out" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#EF9F27", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <I.Info /> 改进建议
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 12 }}>
                  有 {dissatisfied} 张验证图未达预期。建议尝试以下方式改进：
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ padding: "8px 18px", borderRadius: 10, border: `1px solid ${ACCENT}30`, background: `${ACCENT}10`, color: ACCENT, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                    <I.Bolt /> 增加训练步数（+500）重训
                  </button>
                  <button style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
                    补充特定角度参考图
                  </button>
                  <button style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
                    切换精细模式重训
                  </button>
                </div>
              </div>
            )}

            {/* Complete action */}
            <div style={{ ...glass, padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>训练结果</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                  {mode.name}模式 · LoRA {mode.size} · 一致性预估 ~{mode.consistency}%
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${ACCENT}30`, background: `${ACCENT}10`, color: ACCENT, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                  <I.Repeat /> 一键重训
                </button>
                <button style={{
                  padding: "10px 28px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: `linear-gradient(135deg, #5DCAA5, #5DCAA5aa)`, color: "#fff", fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 6, boxShadow: "0 4px 20px rgba(93,202,165,0.3)",
                }}>
                  <I.Check /> 确认并激活角色
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
