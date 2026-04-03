import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   MELY AI — Character Workbench · Unified Polished Prototype
   All 4 modules with enhanced micro-interactions
   ═══════════════════════════════════════════════════════════════ */

const A = "#FF6B9D"; // accent

// ─── Icons ───────────────────────────────────────────────────
const Ic = {
  Sparkle: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Plus: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  Search: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Voice: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5.5v3M5.5 3.5v7M8 5v4M10.5 4v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Image: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1"/><circle cx="4.5" cy="5" r="1" stroke="currentColor" strokeWidth="0.9"/><path d="M1 9.5l3-3 2 2 2.5-3L12 9.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Costume: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.5L4 4v3l2.5 2.5L9 7V4L6.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Clock: () => <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1"/><path d="M5.5 3v2.5l1.8 1.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Right: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Back: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Bolt: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6.5 1L3 7h3l-.5 4L9 5H6l.5-4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Shield: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L2 3v3c0 2.5 1.7 4.2 4 5 2.3-.8 4-2.5 4-5V3L6 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Send: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 2L6 8M12 2L8.5 12l-2-4.5L2 5.5 12 2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Wand: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 2.5l1.5 1.5-9.5 9.5-1.5-1.5L12 2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><circle cx="7" cy="4" r="0.7" fill="currentColor"/><circle cx="12" cy="7" r="0.5" fill="currentColor"/></svg>,
  Upload: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 11A3.5 3.5 0 014.5 4.3a4.5 4.5 0 018.5 1.5A3 3 0 0112 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M8 7v5M6 9l2-2 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Grid: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/></svg>,
  Play: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor"/></svg>,
  Check: () => <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5L9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Home: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2.5 7.5l5-5 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 6.5V12h2.5V9.5h2V12H11V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  DNA: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.5 1.5v12M10.5 1.5v12M4.5 4.5h6M4.5 7.5h6M4.5 10.5h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  Train: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5L3.5 8h3.5l-.5 5L11 6H7l.5-4.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Generate: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2" y="2" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1"/><path d="M5 5l2.5 2.5L10 5M5 8l2.5 2.5L10 8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ─── Helpers ─────────────────────────────────────────────────
const noise = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
          padding: "4px 10px", borderRadius: 6, background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.1)",
          fontSize: 10, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap", zIndex: 50,
          animation: "tooltipIn 0.15s ease-out", pointerEvents: "none",
        }}>{text}</div>
      )}
    </div>
  );
}

function PulseRing({ color, size = 10 }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
      <div style={{ position: "absolute", inset: -3, borderRadius: "50%", border: `1.5px solid ${color}`, opacity: 0.4, animation: "pulseRing 2s ease-in-out infinite" }} />
    </div>
  );
}

function ConsistencyRing({ value, size = 34, accent }) {
  const r = (size - 5) / 2, c = Math.PI * r, off = c * (1 - value / 100);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2.5" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={accent} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1.2s ease-out" }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.85)" fontSize="8" fontWeight="700" style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>{value}</text>
    </svg>
  );
}

// ─── Character Data ──────────────────────────────────────────
const CHARS = [
  { id: "c1", name: "星野ミカ", nameEn: "Hoshino Mika", style: "二次元", costumes: 4, gens: 127, hasVoice: true, loraStatus: "trained", consistency: 91, lastActive: "2 小时前", tags: ["Vtuber", "直播封面"], hue: 320, accent: "#FF6B9D" },
  { id: "c2", name: "黑渊", nameEn: "Kokuen", style: "暗黑写实", costumes: 2, gens: 64, hasVoice: false, loraStatus: "trained", consistency: 88, lastActive: "昨天", tags: ["IP连载"], hue: 0, accent: "#E94560" },
  { id: "c3", name: "小橘猫 Maru", nameEn: "Maru", style: "Q版", costumes: 6, gens: 203, hasVoice: true, loraStatus: "trained", consistency: 94, lastActive: "30 分钟前", tags: ["表情包", "Vtuber"], hue: 30, accent: "#FF8C42" },
  { id: "c4", name: "赛博薇拉", nameEn: "Cyber Vera", style: "赛博朋克", costumes: 3, gens: 89, hasVoice: true, loraStatus: "training", consistency: null, lastActive: "训练中…", tags: ["游戏角色"], hue: 190, accent: "#00F5FF" },
  { id: "c5", name: "白鹭", nameEn: "Shirasagi", style: "水墨国风", costumes: 1, gens: 31, hasVoice: false, loraStatus: "trained", consistency: 82, lastActive: "3 天前", tags: ["IP连载"], hue: 200, accent: "#8AAEC4" },
];

// ─── Cover Art ───────────────────────────────────────────────
function CoverArt({ hue, accent, style: s, isTraining, size = "full" }) {
  const h = size === "sm" ? 80 : size === "md" ? 120 : "100%";
  return (
    <div style={{ position: "relative", width: "100%", height: typeof h === "number" ? h : undefined, aspectRatio: size === "full" ? "3/4" : undefined, borderRadius: size === "full" ? "12px 12px 0 0" : 10, overflow: "hidden", background: `linear-gradient(160deg, hsl(${hue},25%,10%), hsl(${hue},35%,5%))` }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 80% 60% at 30% 80%, hsla(${hue},50%,25%,0.5), transparent 60%), radial-gradient(ellipse 60% 80% at 80% 20%, hsla(${(hue+40)%360},45%,20%,0.4), transparent 55%)` }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.3, backgroundImage: noise, backgroundSize: "128px", mixBlendMode: "overlay" }} />
      <div style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)", width: "120%", height: 50, background: `radial-gradient(ellipse, ${accent}22, transparent 70%)` }} />
      {s && <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 12, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>{s}</div>}
      {isTraining && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <PulseRing color={accent} />
          <span style={{ fontSize: 10, fontWeight: 600, color: accent }}>LoRA 训练中</span>
          <div style={{ width: "55%", height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ width: "62%", height: "100%", borderRadius: 2, background: accent, animation: "trainPulse 3s ease-in-out infinite" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Character Card (Enhanced) ───────────────────────────────
function CharCard({ char, idx, onClick }) {
  const [h, setH] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <div
      onMouseEnter={() => setH(true)} onMouseLeave={() => { setH(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)}
      onClick={onClick}
      style={{
        borderRadius: 14, overflow: "hidden", cursor: "pointer",
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${h ? `${char.accent}40` : "rgba(255,255,255,0.06)"}`,
        transition: "all 0.4s cubic-bezier(0.19,1,0.22,1)",
        transform: pressed ? "scale(0.97)" : h ? "translateY(-6px) scale(1.01)" : "none",
        boxShadow: h ? `0 20px 50px -12px ${char.accent}20, 0 0 0 1px ${char.accent}12` : "0 2px 12px rgba(0,0,0,0.2)",
        animation: `cardIn 0.6s ${idx * 0.07}s both cubic-bezier(0.16,1,0.3,1)`,
      }}
    >
      <CoverArt hue={char.hue} accent={char.accent} style={char.style} isTraining={char.loraStatus === "training"} />
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.93)", letterSpacing: "-0.01em" }}>{char.name}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{char.nameEn}</div>
          </div>
          {char.consistency && <ConsistencyRing value={char.consistency} accent={char.accent} />}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {[
            { icon: <Ic.Image />, val: char.gens, lbl: "生成" },
            { icon: <Ic.Costume />, val: char.costumes, lbl: "造型" },
            ...(char.hasVoice ? [{ icon: <Ic.Voice />, val: "✓", lbl: "声音", color: char.accent }] : []),
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ color: s.color || "rgba(255,255,255,0.25)", display: "flex" }}>{s.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)" }}>{s.val}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{s.lbl}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          {char.tags.map(t => <span key={t} style={{ padding: "2px 7px", borderRadius: 12, fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>{t}</span>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", display: "flex", alignItems: "center", gap: 3 }}><Ic.Clock />{char.lastActive}</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: char.accent, opacity: h ? 1 : 0, transform: h ? "translateX(0)" : "translateX(-6px)", transition: "all 0.35s ease", display: "flex", alignItems: "center", gap: 2 }}>打开 <Ic.Right /></span>
        </div>
      </div>
    </div>
  );
}

// ─── Create Option (extracted for hooks) ─────────────────────
function CreateOption({ icon, title, desc, color, delay }) {
  const [oh, setOh] = useState(false);
  return (
    <div onMouseEnter={() => setOh(true)} onMouseLeave={() => setOh(false)}
      onClick={e => e.stopPropagation()}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", borderRadius: 10, marginBottom: 6,
        border: `1px solid ${oh ? `${color}40` : "rgba(255,255,255,0.05)"}`,
        background: oh ? `${color}08` : "rgba(255,255,255,0.015)",
        transition: "all 0.2s", animation: `slideRight 0.3s ${delay}s both ease-out`,
        transform: oh ? "translateX(3px)" : "none",
      }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}12`, display: "flex", alignItems: "center", justifyContent: "center", color: color, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{title}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );
}

// ─── Create Card (Enhanced) ──────────────────────────────────
function CreateCard({ onClick }) {
  const [h, setH] = useState(false);
  const [expanded, setExpanded] = useState(false);
  
  const handleMouseEnter = () => setH(true);
  const handleMouseLeave = () => { setH(false); setExpanded(false); };
  const handleClick = () => { 
    if (!expanded) { setExpanded(true); } 
    else if (onClick) { onClick(); } 
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{
        borderRadius: 14, border: `1.5px dashed ${h ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)"}`,
        cursor: "pointer", transition: "all 0.4s cubic-bezier(0.19,1,0.22,1)",
        transform: h ? "translateY(-4px)" : "none", background: h ? "rgba(255,255,255,0.015)" : "transparent",
        display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
        minHeight: expanded ? "auto" : 380, overflow: "hidden",
        animation: `cardIn 0.6s ${CHARS.length * 0.07}s both cubic-bezier(0.16,1,0.3,1)`,
      }}
    >
      {!expanded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 30, animation: "fadeIn 0.3s ease-out" }}>
          <div style={{
            width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.03)",
            border: `1px solid ${h ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: h ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)",
            transition: "all 0.35s", transform: h ? "scale(1.08) rotate(90deg)" : "none",
          }}>{Ic.Plus(18)}</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.55)" }}>创建新角色</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 3, lineHeight: 1.5 }}>上传参考图或文字描述</div>
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, width: "100%", animation: "fadeIn 0.25s ease-out" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 10, textAlign: "center" }}>选择创建方式</div>
          {[
            { icon: <Ic.Upload />, title: "上传参考图创建", desc: "上传 10–30 张参考图训练 LoRA", color: "#7B68EE" },
            { icon: <Ic.Wand />, title: "文字描述创角", desc: "AI 生成候选图，选满意的训练", color: "#FF8C42" },
          ].map((o, i) => (
            <CreateOption key={i} icon={o.icon} title={o.title} desc={o.desc} color={o.color} delay={i * 0.08} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", animation: "fadeIn 0.5s ease-out" }}>
      <div style={{ width: 80, height: 80, borderRadius: 24, background: "rgba(255,255,255,0.02)", border: "1.5px dashed rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.12)", marginBottom: 16 }}>
        {Ic.Sparkle(28)}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>还没有角色</div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", lineHeight: 1.6, textAlign: "center", maxWidth: 280 }}>创建你的第一个角色，上传参考图训练 LoRA，让 AI 永远记住你的角色。</div>
    </div>
  );
}

// ─── Nav Sidebar ─────────────────────────────────────────────
function NavSidebar({ page, onNav, charName }) {
  const items = [
    { id: "home", icon: <Ic.Home />, label: "角色库" },
    ...(charName ? [
      { id: "detail", icon: <Ic.DNA />, label: charName },
      { id: "generate", icon: <Ic.Generate />, label: "生成工作台" },
      { id: "train", icon: <Ic.Train />, label: "LoRA 训练" },
    ] : []),
  ];
  return (
    <div style={{ width: 56, borderRight: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 2, flexShrink: 0, background: "rgba(0,0,0,0.2)" }}>
      {/* Logo */}
      <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, #7B68EE, ${A})`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, cursor: "pointer" }} onClick={() => onNav("home")}>
        {Ic.Sparkle(14)}
      </div>
      {items.map((it, i) => {
        const active = page === it.id;
        return (
          <Tooltip key={it.id} text={it.label}>
            <button onClick={() => onNav(it.id)} style={{
              width: 38, height: 38, borderRadius: 10, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s", background: active ? `${A}15` : "transparent",
              color: active ? A : "rgba(255,255,255,0.3)",
            }}>{it.icon}</button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ─── Page Transition Wrapper ─────────────────────────────────
function PageTransition({ children, key: k }) {
  return <div key={k} style={{ animation: "pageIn 0.4s cubic-bezier(0.16,1,0.3,1)" }}>{children}</div>;
}

// ═══ PAGE: HOME ══════════════════════════════════════════════
function HomePage({ onSelectChar }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部");
  const filters = ["全部", "Vtuber", "IP连载", "游戏角色", "训练中"];
  const filtered = CHARS.filter(c => {
    if (filter === "训练中") return c.loraStatus === "training";
    if (filter !== "全部") return c.tags.includes(filter);
    return true;
  }).filter(c => !search || c.name.includes(search) || c.nameEn.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ padding: "28px 28px 40px", overflow: "auto", height: "100%" }}>
      {/* Hero */}
      <div style={{ marginBottom: 28, animation: "fadeIn 0.4s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", margin: 0, lineHeight: 1.15 }}>
              <span style={{ color: "rgba(255,255,255,0.92)" }}>你的角色，</span><br/>
              <span style={{ background: `linear-gradient(90deg, #7B68EE, ${A}, #FF8C42)`, backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 6s linear infinite" }}>永远是同一个人。</span>
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 8, maxWidth: 380 }}>绑定 LoRA、声音指纹与外貌参数，一切创作自动保持跨场景一致性。</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 16, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", fontSize: 10 }}>
            <Ic.Bolt /><span style={{ color: "rgba(255,255,255,0.45)" }}>RTX 3070</span>
            <span style={{ color: "#5DCAA5", fontWeight: 600 }}>5.2 GB 可用</span>
            <Ic.Shield /><span style={{ color: "rgba(255,255,255,0.3)" }}>本地加密</span>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, animation: "fadeIn 0.4s 0.1s both ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", width: 200 }}>
            <span style={{ color: "rgba(255,255,255,0.25)", display: "flex" }}><Ic.Search /></span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索角色…" style={{ background: "none", border: "none", outline: "none", color: "rgba(255,255,255,0.8)", fontSize: 11, width: "100%", fontFamily: "inherit" }} />
          </div>
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "5px 12px", borderRadius: 16, fontSize: 10, fontWeight: 500, cursor: "pointer", border: "1px solid",
              fontFamily: "inherit", transition: "all 0.2s",
              ...(filter === f ? { background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)" } : { background: "transparent", borderColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }),
            }}>
              {f === "训练中" && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, background: "#FF8C42", marginRight: 4, verticalAlign: "middle" }} />}{f}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 || filter === "全部" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {filtered.map((c, i) => <CharCard key={c.id} char={c} idx={i} onClick={() => onSelectChar(c)} />)}
          <CreateCard />
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

// ═══ PAGE: DETAIL ════════════════════════════════════════════
function DetailPage({ char }) {
  const [tab, setTab] = useState("dna");
  const a = char.accent;
  const tabs = [
    { id: "dna", icon: <Ic.DNA />, label: "角色 DNA" },
    { id: "visual", icon: <Ic.Image />, label: "视觉资产" },
    { id: "costumes", icon: <Ic.Costume />, label: "造型版本" },
    { id: "gallery", icon: <Ic.Grid />, label: "生成历史" },
    { id: "voice", icon: <Ic.Voice />, label: "声音绑定" },
  ];

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Side panel */}
      <div style={{ width: 230, borderRight: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", flexShrink: 0, background: "rgba(0,0,0,0.12)" }}>
        <div style={{ padding: 14 }}>
          <div style={{ borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", animation: "fadeIn 0.4s ease-out" }}>
            <CoverArt hue={char.hue} accent={a} size="md" />
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{char.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{char.nameEn}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                {char.consistency && <ConsistencyRing value={char.consistency} size={40} accent={a} />}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, flex: 1 }}>
                  {[{ l: "生成", v: char.gens }, { l: "造型", v: char.costumes }].map(s => (
                    <div key={s.l}><span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>{s.l}</span><div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)" }}>{s.v}</div></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "0 10px", overflow: "auto" }}>
          {tabs.map((t, i) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8,
              border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              transition: "all 0.2s", marginBottom: 2,
              animation: `slideRight 0.3s ${i * 0.04}s both ease-out`,
              background: tab === t.id ? `${a}12` : "transparent",
              color: tab === t.id ? a : "rgba(255,255,255,0.35)",
            }}>
              {t.icon}
              <span style={{ fontSize: 11, fontWeight: tab === t.id ? 600 : 500 }}>{t.label}</span>
              {tab === t.id && <div style={{ marginLeft: "auto", width: 4, height: 4, borderRadius: 2, background: a }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div key={tab} style={{ animation: "pageIn 0.35s ease-out" }}>
          {tab === "dna" && <DNAPanel accent={a} hue={char.hue} />}
          {tab === "visual" && <VisualPanel accent={a} char={char} />}
          {tab === "costumes" && <CostumesPanel accent={a} />}
          {tab === "gallery" && <GalleryPanel accent={a} />}
          {tab === "voice" && <VoicePanel accent={a} />}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{children}</div>;
}

function DNAPanel({ accent, hue }) {
  const [editHover, setEditHover] = useState(null);
  const attrs = [
    { label: "发色", value: "樱粉色", color: "#FFD6E0", prompt: "pink hair, long hair" },
    { label: "瞳色", value: "紫罗兰", color: "#7B68EE", prompt: "violet eyes" },
  ];
  return (
    <div>
      <SectionLabel>角色 DNA · 外貌参数</SectionLabel>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 18, lineHeight: 1.6, maxWidth: 500 }}>DNA 参数是所有生成任务的「基础 Prompt 锚点」。修改会影响所有未来生成。</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {attrs.map((a, i) => (
          <div key={i} onMouseEnter={() => setEditHover(i)} onMouseLeave={() => setEditHover(null)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: `1px solid ${editHover === i ? `${accent}30` : "rgba(255,255,255,0.05)"}`, transition: "border-color 0.2s", cursor: "pointer" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: a.color, border: "2px solid rgba(255,255,255,0.08)", boxShadow: `0 0 12px ${a.color}33`, transition: "transform 0.3s", transform: editHover === i ? "scale(1.1)" : "none" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{a.label} · {a.value}</div>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "rgba(255,255,255,0.25)", marginTop: 1 }}>{a.prompt}</div>
            </div>
            {editHover === i && <span style={{ fontSize: 9, color: accent, fontWeight: 500, animation: "fadeIn 0.15s ease-out" }}>编辑</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
        {[{ l: "肤色", v: "白皙" }, { l: "体型", v: "纤细" }, { l: "风格", v: "二次元" }].map((d, i) => (
          <div key={i} style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{d.l}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>{d.v}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: 14, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 6, fontWeight: 500 }}>完整 DNA Prompt</div>
        <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: accent, lineHeight: 1.8, padding: 10, borderRadius: 8, background: `${accent}06`, border: `1px solid ${accent}12` }}>
          hoshino_mika, pink hair, long hair, violet eyes, fair skin, slim body, anime style, 1girl
        </div>
      </div>
    </div>
  );
}

function VisualPanel({ accent, char }) {
  return (
    <div>
      <SectionLabel>视觉资产 · LoRA 模型</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>FLUX LoRA · 标准模式</div>
          {[{ l: "触发词", v: "hoshino_mika", mono: true }, { l: "Rank", v: "16" }, { l: "训练步数", v: "1800" }, { l: "权重", v: "0.85" }, { l: "文件大小", v: "82MB" }].map(r => (
            <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{r.l}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: r.mono ? accent : "rgba(255,255,255,0.7)", fontFamily: r.mono ? "'JetBrains Mono',monospace" : "inherit" }}>{r.v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <ConsistencyRing value={char.consistency || 0} size={80} accent={accent} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 8 }}>标准模式目标 ~88%</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 12, fontSize: 10, color: "#5DCAA5" }}><Ic.Shield /> AES-256 加密</div>
        </div>
      </div>
    </div>
  );
}

function CostumesPanel({ accent }) {
  const [sel, setSel] = useState("cos-0");
  const costumes = [
    { id: "cos-0", name: "基础造型", parent: null, prompt: "", gens: 72 },
    { id: "cos-1", name: "夏日泳装版", parent: "cos-0", prompt: "white bikini, beach, straw hat", gens: 23 },
    { id: "cos-2", name: "万圣节版", parent: "cos-0", prompt: "black witch dress, pumpkin hat", gens: 18 },
    { id: "cos-3", name: "圣诞特别版", parent: "cos-0", prompt: "red santa dress, candy cane", gens: 31 },
  ];
  return (
    <div>
      <SectionLabel>造型版本树</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          {costumes.map((c, i) => {
            const isRoot = !c.parent;
            const active = sel === c.id;
            return (
              <div key={c.id} onClick={() => setSel(c.id)} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, marginBottom: 4, marginLeft: isRoot ? 0 : 24,
                cursor: "pointer", transition: "all 0.25s",
                border: `1px solid ${active ? `${accent}40` : "rgba(255,255,255,0.04)"}`,
                background: active ? `${accent}0A` : "rgba(255,255,255,0.01)",
                animation: `slideRight 0.3s ${i * 0.06}s both ease-out`,
                transform: active ? "translateX(4px)" : "none",
              }}>
                {isRoot && <div style={{ width: 6, height: 6, borderRadius: 3, background: accent }} />}
                {!isRoot && <div style={{ width: 12, height: 1, background: "rgba(255,255,255,0.08)", marginLeft: -4 }} />}
                <span style={{ fontSize: 12, fontWeight: isRoot ? 600 : 500, color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)", flex: 1 }}>{c.name}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{c.gens} 张</span>
              </div>
            );
          })}
          <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px dashed rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4, cursor: "pointer", color: "rgba(255,255,255,0.25)", fontSize: 11, transition: "all 0.2s" }}>
            {Ic.Plus(12)} 新建造型分支
          </div>
        </div>
        <div style={{ padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", animation: "fadeIn 0.3s ease-out" }}>
          {(() => {
            const c = costumes.find(x => x.id === sel);
            return c ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{c.name}</div>
                {c.prompt && <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "rgba(255,255,255,0.5)", padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", marginBottom: 12, lineHeight: 1.6 }}>{c.prompt}</div>}
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{c.gens} 张生成记录</div>
                <button style={{ marginTop: 14, padding: "8px 18px", borderRadius: 8, border: `1px solid ${accent}40`, background: `${accent}10`, color: accent, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                  {Ic.Sparkle(12)} 使用此造型生成
                </button>
              </>
            ) : null;
          })()}
        </div>
      </div>
    </div>
  );
}

function GalleryThumb({ g, i, accent }) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        borderRadius: 10, overflow: "hidden", cursor: "pointer",
        border: `1px solid ${h ? `${accent}25` : "rgba(255,255,255,0.04)"}`,
        transition: "all 0.3s cubic-bezier(0.19,1,0.22,1)",
        transform: h ? "translateY(-2px) scale(1.02)" : "none",
        animation: `cardIn 0.4s ${i * 0.04}s both ease-out`,
      }}>
      <div style={{ aspectRatio: "1/1", position: "relative", background: `linear-gradient(135deg, hsl(${g.hue},28%,12%), hsl(${g.hue},32%,5%))` }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 45% 65%, hsla(${g.hue},45%,22%,0.5), transparent 60%)` }} />
        <div style={{ position: "absolute", inset: 0, opacity: 0.25, backgroundImage: noise, backgroundSize: "100px", mixBlendMode: "overlay" }} />
        {h && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.15s ease-out" }}>
            <button style={{ padding: "4px 12px", borderRadius: 12, border: `1px solid ${accent}50`, background: `${accent}20`, color: accent, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 10 }}>↻</span> 重现
            </button>
          </div>
        )}
      </div>
      <div style={{ padding: "7px 9px" }}>
        <div style={{ display: "flex", gap: 3 }}>
          {g.tags.map(t => <span key={t} style={{ padding: "1px 6px", borderRadius: 8, fontSize: 8, fontWeight: 500, color: `${accent}cc`, background: `${accent}10`, border: `1px solid ${accent}18` }}>{t}</span>)}
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 4, display: "flex", alignItems: "center", gap: 3 }}><Ic.Clock />{g.time}</div>
      </div>
    </div>
  );
}

function GalleryPanel({ accent }) {
  const [filter, setFilter] = useState("全部");
  const tags = ["全部", "封面图", "表情包", "周边", "预告图"];
  const gens = [
    { id: 1, tags: ["封面图"], time: "2 小时前", hue: 280 },
    { id: 2, tags: ["封面图"], time: "2 小时前", hue: 200 },
    { id: 3, tags: ["周边"], time: "昨天", hue: 350 },
    { id: 4, tags: ["表情包"], time: "昨天", hue: 40 },
    { id: 5, tags: ["封面图"], time: "3 天前", hue: 190 },
    { id: 6, tags: ["预告图"], time: "4 天前", hue: 270 },
    { id: 7, tags: ["表情包"], time: "1 周前", hue: 50 },
    { id: 8, tags: ["封面图"], time: "1 周前", hue: 310 },
  ];
  const filtered = gens.filter(g => filter === "全部" || g.tags.includes(filter));
  return (
    <div>
      <SectionLabel>生成历史 · {gens.length} 条记录</SectionLabel>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {tags.map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            padding: "4px 12px", borderRadius: 16, fontSize: 10, fontWeight: 500, cursor: "pointer", border: "1px solid",
            fontFamily: "inherit", transition: "all 0.2s",
            ...(filter === t ? { background: `${accent}15`, borderColor: `${accent}35`, color: accent } : { background: "transparent", borderColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }),
          }}>{t}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {filtered.map((g, i) => (
          <GalleryThumb key={g.id} g={g} i={i} accent={accent} />
        ))}
      </div>
    </div>
  );
}

function VoicePanel({ accent }) {
  const [playing, setPlaying] = useState(false);
  const wave = [0.2,0.4,0.8,0.6,0.3,0.9,0.7,0.5,0.4,0.6,0.8,1,0.7,0.5,0.3,0.6,0.8,0.9,0.6,0.4,0.3,0.5,0.7,0.9,0.8,0.6,0.4,0.2];
  return (
    <div>
      <SectionLabel>声音绑定 · F5-TTS</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `${accent}12`, display: "flex", alignItems: "center", justifyContent: "center", color: accent, animation: playing ? "glowPulse 2s ease-in-out infinite" : "none" }}><Ic.Voice /></div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>声纹已绑定</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>参考音频 8.2 秒</div>
            </div>
          </div>
          {/* Waveform */}
          <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setPlaying(!playing)} style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${accent}40`, background: `${accent}12`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "transform 0.2s", transform: playing ? "scale(0.95)" : "none" }}>
              {playing ? <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} /> : <Ic.Play />}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, height: 28 }}>
              {wave.map((v, i) => (
                <div key={i} style={{
                  width: 3, borderRadius: 1.5, flex: "0 0 auto",
                  height: `${v * 100}%`,
                  background: playing && i < wave.length * 0.4 ? accent : `rgba(255,255,255,${0.06 + v * 0.12})`,
                  transition: `background 0.15s, height 0.4s ${i * 0.01}s ease`,
                }} />
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>音色相似度</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono',monospace" }}>78%</div>
            </div>
            <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>TTS 引擎</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginTop: 3 }}>F5-TTS</div>
            </div>
          </div>
        </div>
        <div style={{ padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>语音合成测试</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>输入文字用角色声音朗读</div>
          <textarea defaultValue="大家晚上好！欢迎来到我的直播间～" style={{ flex: 1, minHeight: 80, padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "inherit", lineHeight: 1.7, resize: "none", outline: "none" }} />
          <button style={{ marginTop: 10, padding: "10px 0", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Ic.Voice /> 生成语音
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Gen Result Card (extracted for hooks) ──────────────────
function GenResultCard({ hue, i, accent, generating }) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        aspectRatio: "1/1", borderRadius: 12, overflow: "hidden", position: "relative",
        border: `1px solid ${h ? `${accent}25` : "rgba(255,255,255,0.04)"}`,
        transition: "all 0.3s cubic-bezier(0.19,1,0.22,1)",
        transform: h ? "scale(1.03)" : "none",
        animation: `cardIn 0.5s ${i * 0.1}s both ease-out`, cursor: "pointer",
      }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, hsl(${hue},28%,12%), hsl(${hue},32%,5%))` }} />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 45% 65%, hsla(${hue},45%,22%,0.5), transparent 60%)` }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.25, backgroundImage: noise, backgroundSize: "100px", mixBlendMode: "overlay" }} />
      {generating && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${accent}40`, borderTopColor: accent, animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>生成中…</span>
        </div>
      )}
      {h && !generating && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, animation: "fadeIn 0.15s ease-out" }}>
          {["入库", "标签", "重现"].map((l, j) => (
            <button key={j} style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${accent}50`, background: `${accent}20`, color: accent, fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ PAGE: GENERATE ══════════════════════════════════════════
function GeneratePage({ char }) {
  const [scene, setScene] = useState("");
  const [typing, setTyping] = useState(false);
  const a = char.accent;

  // Simulate typing indicator
  useEffect(() => {
    if (scene) { setTyping(true); const t = setTimeout(() => setTyping(false), 800); return () => clearTimeout(t); }
    else setTyping(false);
  }, [scene]);

  const presets = [
    { icon: "🎬", label: "直播封面" }, { icon: "😆", label: "表情包" },
    { icon: "🏷️", label: "周边立牌" }, { icon: "📱", label: "社媒头图" },
  ];

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Left input */}
      <div style={{ width: 360, borderRight: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.1)" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          <SectionLabel>场景模板</SectionLabel>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
            {presets.map((p, i) => (
              <button key={i} onClick={() => setScene(p.label === "直播封面" ? "facing viewer, dynamic pose, vibrant lighting" : "")} style={{
                padding: "5px 11px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", background: "transparent",
                cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)",
                display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
              }}>{p.icon} {p.label}</button>
            ))}
          </div>
          <SectionLabel>描述场景，不描述角色</SectionLabel>
          <div style={{ position: "relative" }}>
            <textarea value={scene} onChange={e => setScene(e.target.value)} placeholder="在咖啡馆看书，阳光从窗户射入…" rows={4} style={{
              width: "100%", padding: 14, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.8)", fontSize: 13,
              fontFamily: "inherit", lineHeight: 1.7, resize: "vertical", outline: "none",
            }} />
            {typing && (
              <div style={{ position: "absolute", bottom: 10, right: 12, display: "flex", gap: 3, animation: "fadeIn 0.15s ease-out" }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: 2, background: a, opacity: 0.5, animation: `typingDot 1s ${i * 0.15}s infinite` }} />)}
              </div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>角色外貌由 LoRA + DNA 自动注入，无需重复描述</div>
        </div>
        <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button style={{
            width: "100%", padding: "12px 0", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
            background: `linear-gradient(135deg, ${a}, ${a}aa)`, color: "#fff", fontSize: 13, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: `0 4px 20px ${a}33`, transition: "transform 0.15s",
          }}><Ic.Send /> 生成图像</button>
          <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Ic.Bolt /> GPU 就绪 · ~12 秒/张</div>
        </div>
      </div>

      {/* Right results */}
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <SectionLabel>生成结果</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {[280, 200, 340, 180].map((hue, i) => (
            <GenResultCard key={i} hue={hue} i={i} accent={a} generating={i >= 2} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══ PAGE: TRAIN ═════════════════════════════════════════════
function TrainPage({ char }) {
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(true);
  const a = char.accent;

  useEffect(() => {
    if (running && progress < 100) {
      const t = setTimeout(() => setProgress(p => Math.min(p + 0.4, 100)), 120);
      return () => clearTimeout(t);
    }
  }, [running, progress]);

  const samplingAt = [20, 40, 60, 80, 100];
  const lossPts = [1,0.85,0.71,0.59,0.5,0.43,0.39,0.35,0.33,0.31,0.30,0.29,0.285,0.28,0.277];
  const visCount = Math.floor(progress / 100 * lossPts.length);
  const vis = lossPts.slice(0, Math.max(visCount, 1));
  const max = Math.max(...lossPts);

  return (
    <div style={{ overflow: "auto", height: "100%", padding: 24 }}>
      {/* Progress header */}
      <div style={{ padding: 22, borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", marginBottom: 20, animation: "fadeIn 0.4s ease-out" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              {progress < 100 ? (
                <><div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${a}40`, borderTopColor: a, animation: "spin 1s linear infinite" }} /> 训练中…</>
              ) : (
                <><div style={{ width: 20, height: 20, borderRadius: "50%", background: "#5DCAA5", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Ic.Check /></div><span style={{ color: "#5DCAA5" }}>训练完成！</span></>
              )}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>标准模式 · FLUX-dev · Rank 16 · Step {Math.round(progress / 100 * 1800)} / 1800</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: a, fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(progress)}%</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{progress < 100 ? `~${Math.round((100-progress)*0.28)} 分钟` : "耗时 28 分钟"}</div>
          </div>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${a}, ${a}88)`, transition: "width 0.3s", boxShadow: `0 0 12px ${a}44` }} />
        </div>
        {progress < 100 && (
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button onClick={() => setRunning(!running)} style={{ padding: "5px 14px", borderRadius: 8, border: `1px solid ${a}30`, background: `${a}08`, color: a, fontSize: 10, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>{running ? "⏸ 暂停" : "▶ 继续"}</button>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Loss chart */}
        <div>
          <SectionLabel>Loss 曲线</SectionLabel>
          <div style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ position: "relative", height: 100 }}>
              {[0, 0.25, 0.5, 0.75, 1].map(v => <div key={v} style={{ position: "absolute", left: 0, right: 0, bottom: `${v*100}%`, height: 1, background: "rgba(255,255,255,0.025)" }} />)}
              <svg width="100%" height="100" viewBox={`0 0 ${lossPts.length} ${max}`} preserveAspectRatio="none" style={{ display: "block" }}>
                <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={a} stopOpacity="0.5"/><stop offset="100%" stopColor={a} stopOpacity="0.02"/></linearGradient></defs>
                <path d={`M0,${max} ${vis.map((v,i)=>`L${i},${max-v}`).join(" ")} L${vis.length-1},${max} Z`} fill="url(#lg)"/>
                <path d={vis.map((v,i)=>`${i===0?"M":"L"}${i},${max-v}`).join(" ")} fill="none" stroke={a} strokeWidth="0.06" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${a}66)` }}/>
              </svg>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono',monospace" }}>
              <span>Loss: {vis.length > 0 ? vis[vis.length-1].toFixed(3) : "—"}</span>
              <span>GPU 72°C · VRAM 7.2 GB</span>
            </div>
          </div>
        </div>

        {/* Sampling previews */}
        <div>
          <SectionLabel>采样预览 · 角色逐渐成型</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
            {samplingAt.map((pct, i) => {
              const visible = progress >= pct;
              const isLatest = visible && (i === samplingAt.length - 1 || progress < samplingAt[i + 1]);
              return (
                <div key={i} style={{
                  aspectRatio: "1/1", borderRadius: 10, overflow: "hidden", position: "relative",
                  border: visible ? (isLatest ? `1.5px solid ${a}50` : "1px solid rgba(255,255,255,0.05)") : "1px dashed rgba(255,255,255,0.06)",
                  boxShadow: isLatest ? `0 0 16px ${a}20` : "none",
                  animation: visible && isLatest ? "previewPop 0.5s ease-out" : "none",
                }}>
                  {visible ? (
                    <>
                      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, hsl(${320+i*12},${20+pct*0.3}%,${8+pct*0.05}%), hsl(${320+i*12},28%,5%))` }} />
                      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 45% 65%, hsla(${320+i*12},${30+pct*0.3}%,${15+pct*0.1}%,${0.2+pct*0.004}), transparent 60%)` }} />
                      <div style={{ position: "absolute", inset: 0, opacity: Math.max(0, 0.35 - pct * 0.003), backgroundImage: noise, backgroundSize: "100px", mixBlendMode: "overlay" }} />
                      <div style={{ position: "absolute", bottom: 4, left: 4, padding: "1px 6px", borderRadius: 8, background: "rgba(0,0,0,0.6)", fontSize: 8, fontWeight: 600, color: isLatest ? a : "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono',monospace" }}>{pct}%</div>
                      {isLatest && <div style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, background: a, animation: "pulse 2s ease-in-out infinite" }} />}
                    </>
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "rgba(255,255,255,0.12)", fontFamily: "'JetBrains Mono',monospace" }}>{pct}%</div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 6, textAlign: "center" }}>每 20% 进度自动采样，观察角色特征逐步锁定</div>
        </div>
      </div>
    </div>
  );
}

// ═══ MAIN APP ════════════════════════════════════════════════
export default function MelyApp() {
  const [page, setPage] = useState("home");
  const [selectedChar, setSelectedChar] = useState(null);

  const handleSelectChar = (char) => { setSelectedChar(char); setPage("detail"); };
  const handleNav = (p) => { if (p === "home") { setSelectedChar(null); } setPage(p); };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0A0A0F", color: "#fff", fontFamily: "'DM Sans', 'Noto Sans SC', -apple-system, sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes cardIn { from{opacity:0;transform:translateY(20px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pageIn { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideRight { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
        @keyframes pulseRing { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0;transform:scale(1.8)} }
        @keyframes trainPulse { 0%{width:58%} 50%{width:66%} 100%{width:58%} }
        @keyframes previewPop { from{opacity:0;transform:scale(0.85)} to{opacity:1;transform:scale(1)} }
        @keyframes tooltipIn { from{opacity:0;transform:translateX(-50%) translateY(4px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes typingDot { 0%,60%,100%{opacity:0.3;transform:translateY(0)} 30%{opacity:1;transform:translateY(-3px)} }
        @keyframes glowPulse { 0%,100%{box-shadow:0 0 8px ${A}22} 50%{box-shadow:0 0 20px ${A}44} }
        * { box-sizing:border-box; margin:0; padding:0 }
        textarea:focus, input:focus { outline:none }
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:3px}
      `}</style>

      {/* Background orbs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, hsla(280,50%,25%,0.06), transparent 70%)", left: "15%", top: "20%", transform: "translate(-50%,-50%)" }} />
        <div style={{ position: "absolute", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, hsla(200,45%,20%,0.04), transparent 70%)", right: "10%", bottom: "25%", transform: "translate(50%,50%)" }} />
      </div>

      <div style={{ display: "flex", width: "100%", position: "relative", zIndex: 1 }}>
        <NavSidebar page={page} onNav={handleNav} charName={selectedChar ? selectedChar.name : null} />
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div key={page} style={{ height: "100%", animation: "pageIn 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
            {page === "home" && <HomePage onSelectChar={handleSelectChar} />}
            {page === "detail" && selectedChar && <DetailPage char={selectedChar} />}
            {page === "generate" && selectedChar && <GeneratePage char={selectedChar} />}
            {page === "train" && selectedChar && <TrainPage char={selectedChar} />}
          </div>
        </div>
      </div>
    </div>
  );
}
