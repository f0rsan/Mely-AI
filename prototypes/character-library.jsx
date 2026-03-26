import { useState, useEffect, useRef, useCallback } from "react";

// ─── Mock Data ───────────────────────────────────────────────
const CHARACTERS = [
  {
    id: "c1",
    name: "星野ミカ",
    nameEn: "Hoshino Mika",
    style: "二次元",
    dna: { hair: "#FFD6E0", eyes: "#7B68EE", skin: "白皙", bodyType: "纤细" },
    costumes: 4,
    generations: 127,
    hasVoice: true,
    loraStatus: "trained",
    consistency: 91,
    lastActive: "2 小时前",
    tags: ["Vtuber", "直播封面", "周边"],
    coverHue: 320,
    accent: "#FF6B9D",
  },
  {
    id: "c2",
    name: "黑渊",
    nameEn: "Kokuen",
    style: "暗黑写实",
    dna: { hair: "#1A1A2E", eyes: "#E94560", skin: "苍白", bodyType: "修长" },
    costumes: 2,
    generations: 64,
    hasVoice: false,
    loraStatus: "trained",
    consistency: 88,
    lastActive: "昨天",
    tags: ["IP连载", "漫画"],
    coverHue: 0,
    accent: "#E94560",
  },
  {
    id: "c3",
    name: "小橘猫 Maru",
    nameEn: "Maru",
    style: "Q版",
    dna: { hair: "#FF8C42", eyes: "#2ECC71", skin: "健康", bodyType: "圆润" },
    costumes: 6,
    generations: 203,
    hasVoice: true,
    loraStatus: "trained",
    consistency: 94,
    lastActive: "30 分钟前",
    tags: ["表情包", "贴纸", "Vtuber"],
    coverHue: 30,
    accent: "#FF8C42",
  },
  {
    id: "c4",
    name: "赛博薇拉",
    nameEn: "Cyber Vera",
    style: "赛博朋克",
    dna: { hair: "#00F5FF", eyes: "#FF00FF", skin: "冷白", bodyType: "标准" },
    costumes: 3,
    generations: 89,
    hasVoice: true,
    loraStatus: "training",
    consistency: null,
    lastActive: "训练中…",
    tags: ["游戏角色", "概念设计"],
    coverHue: 190,
    accent: "#00F5FF",
  },
  {
    id: "c5",
    name: "白鹭",
    nameEn: "Shirasagi",
    style: "水墨国风",
    dna: { hair: "#F5F5F5", eyes: "#4A4A4A", skin: "白皙", bodyType: "修长" },
    costumes: 1,
    generations: 31,
    hasVoice: false,
    loraStatus: "trained",
    consistency: 82,
    lastActive: "3 天前",
    tags: ["IP连载"],
    coverHue: 200,
    accent: "#8AAEC4",
  },
];

// ─── SVG Icons ───────────────────────────────────────────────
const Icons = {
  Plus: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  Search: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Voice: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 5.5v3M5.5 3.5v7M8 5v4M10.5 4v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  Image: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="5.5" r="1.2" stroke="currentColor" strokeWidth="1" />
      <path d="M1.5 10l3-3 2 2 2.5-3 3.5 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Costume: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1.5L4 4.5v3l3 3 3-3v-3L7 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 6h3M7 4.5V8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
  Sparkle: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  Grid: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  List: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 4h13M1.5 8h13M1.5 12h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  Shield: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1L2 3v3c0 2.5 1.7 4.2 4 5 2.3-.8 4-2.5 4-5V3L6 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  Clock: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6 3.5V6l2 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Bolt: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6.5 1L3 7h3l-.5 4L9 5H6l.5-4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  ),
  Wand: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M13.5 2.5l2 2-11 11-2-2 11-11z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M3 14.5L2 16l1.5-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="4" r="0.8" fill="currentColor" />
      <circle cx="14" cy="8" r="0.6" fill="currentColor" />
      <circle cx="11" cy="3" r="0.5" fill="currentColor" />
    </svg>
  ),
  UploadCloud: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M5 12.5A3.5 3.5 0 015.5 5.6 5 5 0 0114.3 7a3 3 0 01.7 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9 9v5M7 11l2-2 2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronRight: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─── Animated Background ─────────────────────────────────────
function FloatingOrbs() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${300 + i * 120}px`,
            height: `${300 + i * 120}px`,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${
              ["hsla(280,60%,30%,0.08)", "hsla(200,60%,25%,0.06)", "hsla(340,50%,30%,0.07)"][i]
            } 0%, transparent 70%)`,
            left: `${[10, 55, 30][i]}%`,
            top: `${[15, 50, 70][i]}%`,
            transform: "translate(-50%, -50%)",
            animation: `floatOrb${i} ${18 + i * 5}s ease-in-out infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes floatOrb0 { 0%,100%{transform:translate(-50%,-50%) translate(0,0)} 33%{transform:translate(-50%,-50%) translate(40px,-30px)} 66%{transform:translate(-50%,-50%) translate(-20px,25px)} }
        @keyframes floatOrb1 { 0%,100%{transform:translate(-50%,-50%) translate(0,0)} 33%{transform:translate(-50%,-50%) translate(-35px,20px)} 66%{transform:translate(-50%,-50%) translate(25px,-15px)} }
        @keyframes floatOrb2 { 0%,100%{transform:translate(-50%,-50%) translate(0,0)} 33%{transform:translate(-50%,-50%) translate(20px,30px)} 66%{transform:translate(-50%,-50%) translate(-30px,-20px)} }
      `}</style>
    </div>
  );
}

// ─── Training Pulse Ring ─────────────────────────────────────
function TrainingPulse({ color }) {
  return (
    <div style={{ position: "relative", width: 10, height: 10 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          animation: "pulse 2s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -4,
          borderRadius: "50%",
          border: `1.5px solid ${color}`,
          opacity: 0.4,
          animation: "pulseRing 2s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.8)} }
        @keyframes pulseRing { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0;transform:scale(1.8)} }
      `}</style>
    </div>
  );
}

// ─── Consistency Ring ────────────────────────────────────────
function ConsistencyRing({ value, size = 36, accent }) {
  const circumference = Math.PI * (size - 6);
  const offset = circumference * (1 - value / 100);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={(size - 6) / 2}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="3"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={(size - 6) / 2}
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1s ease-out" }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="rgba(255,255,255,0.9)"
        fontSize="9"
        fontWeight="600"
        style={{ transform: "rotate(90deg)", transformOrigin: "center" }}
      >
        {value}
      </text>
    </svg>
  );
}

// ─── Character Cover Art (Generative) ────────────────────────
function CharacterCover({ hue, accent, name, style: charStyle, isTraining }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "3/4",
        borderRadius: "12px 12px 0 0",
        overflow: "hidden",
        background: `linear-gradient(160deg, hsl(${hue},25%,10%) 0%, hsl(${hue},35%,6%) 100%)`,
      }}
    >
      {/* Mesh gradient layers */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 80% 60% at 30% 80%, hsla(${hue},50%,25%,0.5) 0%, transparent 60%),
            radial-gradient(ellipse 60% 80% at 80% 20%, hsla(${(hue + 40) % 360},45%,20%,0.4) 0%, transparent 55%)
          `,
        }}
      />
      {/* Noise texture overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.35,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: "128px",
          mixBlendMode: "overlay",
        }}
      />
      {/* Character silhouette placeholder */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "70%",
          height: "85%",
          background: `linear-gradient(to top, hsla(${hue},30%,8%,0) 0%, hsla(${hue},30%,15%,0.3) 50%, hsla(${hue},30%,8%,0) 100%)`,
          borderRadius: "50% 50% 0 0",
        }}
      />
      {/* Accent glow at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: -20,
          left: "50%",
          transform: "translateX(-50%)",
          width: "120%",
          height: "80px",
          background: `radial-gradient(ellipse, ${accent}22 0%, transparent 70%)`,
        }}
      />
      {/* Style badge */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          padding: "3px 10px",
          borderRadius: "20px",
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          fontSize: "10px",
          fontWeight: 500,
          color: "rgba(255,255,255,0.7)",
          letterSpacing: "0.03em",
        }}
      >
        {charStyle}
      </div>
      {/* Training overlay */}
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
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TrainingPulse color={accent} />
            <span style={{ fontSize: 12, fontWeight: 600, color: accent }}>LoRA 训练中</span>
          </div>
          {/* fake progress */}
          <div style={{ width: "60%", height: 3, borderRadius: 2, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
            <div
              style={{
                width: "62%",
                height: "100%",
                borderRadius: 2,
                background: `linear-gradient(90deg, ${accent}, ${accent}88)`,
                animation: "trainProgress 3s ease-in-out infinite",
              }}
            />
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>62% · 约 12 分钟</span>
          <style>{`
            @keyframes trainProgress { 0%{width:58%} 50%{width:66%} 100%{width:58%} }
          `}</style>
        </div>
      )}
    </div>
  );
}

// ─── Character Card ──────────────────────────────────────────
function CharacterCard({ char, index, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: 14,
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${hovered ? `${char.accent}44` : "rgba(255,255,255,0.06)"}`,
        cursor: "pointer",
        transition: "all 0.35s cubic-bezier(0.19, 1, 0.22, 1)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hovered
          ? `0 20px 60px -12px ${char.accent}18, 0 0 0 1px ${char.accent}15`
          : "0 2px 12px rgba(0,0,0,0.15)",
        animation: `cardIn 0.6s ${index * 0.08}s both cubic-bezier(0.19, 1, 0.22, 1)`,
        overflow: "hidden",
      }}
    >
      <CharacterCover
        hue={char.coverHue}
        accent={char.accent}
        name={char.name}
        style={char.style}
        isTraining={char.loraStatus === "training"}
      />

      {/* Card body */}
      <div style={{ padding: "12px 14px 14px" }}>
        {/* Name row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "rgba(255,255,255,0.93)",
                letterSpacing: "-0.01em",
                lineHeight: 1.3,
              }}
            >
              {char.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.35)",
                fontFamily: "'DM Sans', sans-serif",
                marginTop: 1,
              }}
            >
              {char.nameEn}
            </div>
          </div>
          {char.consistency && <ConsistencyRing value={char.consistency} accent={char.accent} />}
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <StatChip icon={<Icons.Image />} value={char.generations} label="生成" />
          <StatChip icon={<Icons.Costume />} value={char.costumes} label="造型" />
          {char.hasVoice && <StatChip icon={<Icons.Voice />} value="已绑定" label="声音" accent={char.accent} />}
        </div>

        {/* Tags */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
          {char.tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: "2px 8px",
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 500,
                color: "rgba(255,255,255,0.45)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
            <Icons.Clock />
            {char.lastActive}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10,
              fontWeight: 500,
              color: char.accent,
              opacity: hovered ? 1 : 0,
              transform: hovered ? "translateX(0)" : "translateX(-4px)",
              transition: "all 0.3s ease",
            }}
          >
            打开工作台 <Icons.ChevronRight />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatChip({ icon, value, label, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: accent || "rgba(255,255,255,0.3)", display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{value}</span>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{label}</span>
    </div>
  );
}

// ─── Create Card ─────────────────────────────────────────────
function CreateCard() {
  const [hovered, setHovered] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const options = [
    { icon: <Icons.UploadCloud />, title: "上传参考图创建", desc: "上传 10-30 张参考图，训练专属 LoRA", color: "#7B68EE" },
    { icon: <Icons.Wand />, title: "文字描述创角", desc: "用自然语言描述，AI 生成角色候选图", color: "#FF8C42" },
  ];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowOptions(false); }}
      onClick={() => setShowOptions(!showOptions)}
      style={{
        position: "relative",
        borderRadius: 14,
        border: `1.5px dashed ${hovered ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)"}`,
        cursor: "pointer",
        transition: "all 0.35s cubic-bezier(0.19, 1, 0.22, 1)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        background: hovered ? "rgba(255,255,255,0.02)" : "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: showOptions ? "auto" : 380,
        overflow: "hidden",
        animation: `cardIn 0.6s ${CHARACTERS.length * 0.08}s both cubic-bezier(0.19, 1, 0.22, 1)`,
      }}
    >
      {!showOptions ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 30 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.4)",
              transition: "all 0.3s",
              ...(hovered && {
                background: "rgba(255,255,255,0.06)",
                borderColor: "rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.7)",
                transform: "scale(1.05)",
              }),
            }}
          >
            <Icons.Plus />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>创建新角色</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4, lineHeight: 1.5 }}>
              上传参考图或用文字描述
              <br />
              开始训练你的角色 LoRA
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, width: "100%" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: 12, textAlign: "center" }}>
            选择创建方式
          </div>
          {options.map((opt, i) => (
            <CreateOption key={i} {...opt} delay={i * 0.08} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateOption({ icon, title, desc, color, delay }) {
  const [h, setH] = useState(false);
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${h ? `${color}44` : "rgba(255,255,255,0.06)"}`,
        background: h ? `${color}08` : "rgba(255,255,255,0.02)",
        marginBottom: 8,
        transition: "all 0.25s ease",
        animation: `optionIn 0.35s ${delay}s both ease-out`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${color}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

// ─── Sidebar Quick Stats ─────────────────────────────────────
function QuickStats() {
  const stats = [
    { label: "角色总数", value: "5", sub: "1 训练中" },
    { label: "总生成数", value: "514", sub: "本月 +89" },
    { label: "造型版本", value: "16", sub: "跨 5 个角色" },
    { label: "磁盘占用", value: "4.7", unit: "GB", sub: "LoRA 3.2GB · 图库 1.5GB" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        animation: "fadeSlideUp 0.5s 0.3s both ease-out",
      }}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {s.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>
            {s.value}
            {s.unit && <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.4)", marginLeft: 2 }}>{s.unit}</span>}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
export default function CharacterLibrary() {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [activeFilter, setActiveFilter] = useState("全部");

  const filters = ["全部", "Vtuber", "IP连载", "游戏角色", "训练中"];

  const filteredChars = CHARACTERS.filter((c) => {
    if (activeFilter === "训练中") return c.loraStatus === "training";
    if (activeFilter !== "全部") return c.tags.includes(activeFilter);
    return true;
  }).filter((c) => {
    if (!searchQuery) return true;
    return c.name.includes(searchQuery) || c.nameEn.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0A0A0F",
        color: "#fff",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <FloatingOrbs />

      {/* Global keyframes */}
      <style>{`
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes optionIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes headerIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        {/* ─── Header ─── */}
        <header
          style={{
            padding: "28px 0 0",
            animation: "headerIn 0.5s ease-out",
          }}
        >
          {/* Top bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, #7B68EE 0%, #E94560 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icons.Sparkle />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    background: "linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.6))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Mely AI
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", fontWeight: 500 }}>
                  CHARACTER WORKBENCH
                </div>
              </div>
            </div>

            {/* GPU status pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderRadius: 20,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: 11,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Icons.Bolt />
                <span style={{ color: "rgba(255,255,255,0.5)" }}>RTX 3070</span>
              </div>
              <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
              <span style={{ color: "#5DCAA5", fontWeight: 500 }}>5.2 GB 可用</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Icons.Shield />
                <span style={{ color: "rgba(255,255,255,0.35)" }}>本地加密</span>
              </div>
            </div>
          </div>

          {/* Hero text */}
          <div style={{ margin: "32px 0 28px" }}>
            <h1
              style={{
                fontSize: 34,
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
                margin: 0,
                fontFamily: "'Noto Sans SC', 'DM Sans', sans-serif",
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.92)" }}>你的角色，</span>
              <br />
              <span
                style={{
                  background: "linear-gradient(90deg, #7B68EE, #E94560, #FF8C42)",
                  backgroundSize: "200% auto",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  animation: "shimmer 6s linear infinite",
                }}
              >
                永远是同一个人。
              </span>
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.4)",
                marginTop: 10,
                lineHeight: 1.6,
                maxWidth: 420,
              }}
            >
              绑定 LoRA、声音指纹与外貌参数，一切创作自动保持跨场景一致性。
            </p>
          </div>
        </header>

        {/* ─── Toolbar ─── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            animation: "fadeSlideUp 0.5s 0.15s both ease-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Search */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                width: 220,
                transition: "border-color 0.2s",
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.3)", display: "flex" }}>
                <Icons.Search />
              </span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索角色名称…"
                style={{
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "rgba(255,255,255,0.8)",
                  fontSize: 12,
                  width: "100%",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* Filter chips */}
            <div style={{ display: "flex", gap: 4 }}>
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    border: "1px solid",
                    transition: "all 0.2s ease",
                    fontFamily: "inherit",
                    ...(activeFilter === f
                      ? {
                          background: "rgba(255,255,255,0.08)",
                          borderColor: "rgba(255,255,255,0.15)",
                          color: "rgba(255,255,255,0.85)",
                        }
                      : {
                          background: "transparent",
                          borderColor: "rgba(255,255,255,0.06)",
                          color: "rgba(255,255,255,0.4)",
                        }),
                  }}
                >
                  {f === "训练中" && (
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#FF8C42", marginRight: 5, verticalAlign: "middle" }} />
                  )}
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* View mode toggle */}
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: 3,
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {[
              { mode: "grid", icon: <Icons.Grid /> },
              { mode: "list", icon: <Icons.List /> },
            ].map(({ mode, icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  width: 30,
                  height: 28,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                  background: viewMode === mode ? "rgba(255,255,255,0.08)" : "transparent",
                  color: viewMode === mode ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
                }}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Main Content ─── */}
        <div style={{ display: "flex", gap: 24 }}>
          {/* Card Grid */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: viewMode === "grid" ? "repeat(3, 1fr)" : "1fr",
                gap: 16,
              }}
            >
              {filteredChars.map((char, i) => (
                <CharacterCard key={char.id} char={char} index={i} onClick={() => {}} />
              ))}
              <CreateCard />
            </div>

            {filteredChars.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 0",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: 13,
                }}
              >
                未找到匹配的角色
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <div style={{ position: "sticky", top: 24 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 12,
                  animation: "fadeSlideUp 0.5s 0.25s both ease-out",
                }}
              >
                工作台概览
              </div>
              <QuickStats />

              {/* Recent activity */}
              <div
                style={{
                  marginTop: 20,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 10,
                  animation: "fadeSlideUp 0.5s 0.4s both ease-out",
                }}
              >
                最近活动
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, animation: "fadeSlideUp 0.5s 0.45s both ease-out" }}>
                {[
                  { char: "小橘猫 Maru", action: "生成了 3 张封面图", time: "30 分钟前", color: "#FF8C42" },
                  { char: "星野ミカ", action: "绑定了声音指纹", time: "2 小时前", color: "#FF6B9D" },
                  { char: "赛博薇拉", action: "LoRA 训练进行中 62%", time: "进行中", color: "#00F5FF" },
                  { char: "黑渊", action: "新建造型「暗夜骑士版」", time: "昨天", color: "#E94560" },
                ].map((item, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.04)",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        background: item.color,
                        marginTop: 5,
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>{item.char}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{item.action}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 3 }}>{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer
          style={{
            borderTop: "1px solid rgba(255,255,255,0.04)",
            marginTop: 48,
            padding: "16px 0 24px",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "rgba(255,255,255,0.2)",
          }}
        >
          <span>Mely AI · 角色工作台 v0.1 · 数据完全本地存储</span>
          <span>所有 LoRA 模型使用 AES-256 加密保护</span>
        </footer>
      </div>
    </div>
  );
}
