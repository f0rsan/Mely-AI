import { useState, useEffect, useRef } from "react";

// ─── Character Mock Data ─────────────────────────────────────
const CHARACTER = {
  id: "c1",
  name: "星野ミカ",
  nameEn: "Hoshino Mika",
  created_at: "2025-11-22T14:30:00Z",
  style: "二次元",
  accent: "#FF6B9D",
  coverHue: 320,
  fingerprint: "a7f3c9...e1b2d4",
  dna: {
    hair: { label: "樱粉色", color: "#FFD6E0", prompt: "pink hair, light pink long hair" },
    eyes: { label: "紫罗兰", color: "#7B68EE", prompt: "violet eyes, bright purple eyes" },
    skin: { label: "白皙", prompt: "fair skin, pale skin" },
    bodyType: { label: "纤细", prompt: "slim body, petite figure" },
    style: { label: "二次元", prompt: "anime style, 2d illustration" },
    personality: "元气满满的少女，喜欢音乐和猫咪，偶尔害羞",
    fullPrompt: "hoshino_mika, pink hair, long hair, violet eyes, fair skin, slim body, anime style, 1girl",
  },
  visual: {
    loraPath: "models/lora/hoshino_mika_v3.safetensors",
    triggerWord: "hoshino_mika",
    baseModel: "FLUX-dev",
    trainingMode: "标准",
    rank: 16,
    steps: 1800,
    fileSize: "82MB",
    trainDate: "2025-11-22",
    consistency: 91,
    weight: 0.85,
    datasetSize: 22,
  },
  voice: {
    bound: true,
    engine: "F5-TTS",
    refAudioDuration: "8.2s",
    similarity: 78,
    sampleText: "大家好呀！我是星野ミカ，今天也要元气满满地直播哦～",
    waveform: [0.2,0.4,0.8,0.6,0.3,0.9,0.7,0.5,0.4,0.6,0.8,1,0.7,0.5,0.3,0.6,0.8,0.9,0.6,0.4,0.3,0.5,0.7,0.9,0.8,0.6,0.4,0.2,0.5,0.7,0.8,0.6],
  },
  costumes: [
    { id: "cos-0", name: "基础造型", parentId: null, prompt: "", genCount: 72, children: ["cos-1", "cos-2", "cos-3"] },
    { id: "cos-1", name: "夏日泳装版", parentId: "cos-0", prompt: "white bikini, beach, straw hat, seashell necklace", genCount: 23, children: [] },
    { id: "cos-2", name: "万圣节版", parentId: "cos-0", prompt: "black witch dress, orange belt, pumpkin hat, bat wings accessory", genCount: 18, children: ["cos-4"] },
    { id: "cos-3", name: "圣诞特别版", parentId: "cos-0", prompt: "red santa dress, white fur trim, candy cane, christmas lights", genCount: 31, children: [] },
    { id: "cos-4", name: "暗夜女巫版", parentId: "cos-2", prompt: "dark purple witch robe, glowing runes, floating candles, mystic aura", genCount: 8, children: [] },
  ],
  generations: [
    { id: "g1", costumeId: "cos-0", type: "image", tags: ["封面图"], time: "2 小时前", seed: 483291, steps: 28, sampler: "DPM++ 2M Karras", loraWeight: 0.85, hue: 280 },
    { id: "g2", costumeId: "cos-0", type: "image", tags: ["封面图"], time: "2 小时前", seed: 192847, steps: 28, sampler: "DPM++ 2M Karras", loraWeight: 0.85, hue: 200 },
    { id: "g3", costumeId: "cos-3", type: "image", tags: ["周边", "贴纸"], time: "昨天", seed: 738291, steps: 30, sampler: "Euler a", loraWeight: 0.9, hue: 350 },
    { id: "g4", costumeId: "cos-0", type: "image", tags: ["表情包"], time: "昨天", seed: 294817, steps: 25, sampler: "DPM++ 2M Karras", loraWeight: 0.8, hue: 40 },
    { id: "g5", costumeId: "cos-1", type: "image", tags: ["封面图"], time: "3 天前", seed: 571293, steps: 28, sampler: "DPM++ 2M Karras", loraWeight: 0.85, hue: 190 },
    { id: "g6", costumeId: "cos-2", type: "image", tags: ["预告图"], time: "4 天前", seed: 819374, steps: 30, sampler: "Euler a", loraWeight: 0.9, hue: 270 },
    { id: "g7", costumeId: "cos-0", type: "audio", tags: ["配音"], time: "5 天前", seed: null, steps: null, sampler: null, loraWeight: null, hue: 0 },
    { id: "g8", costumeId: "cos-4", type: "image", tags: ["概念图"], time: "1 周前", seed: 462918, steps: 28, sampler: "DPM++ 2M Karras", loraWeight: 0.85, hue: 260 },
    { id: "g9", costumeId: "cos-0", type: "image", tags: ["表情包"], time: "1 周前", seed: 129384, steps: 25, sampler: "DPM++ 2M Karras", loraWeight: 0.8, hue: 50 },
  ],
};

// ─── SVG Icons ───────────────────────────────────────────────
const I = {
  Back: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  DNA: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.5 1.5v12M10.5 1.5v12M4.5 4.5h6M4.5 7.5h6M4.5 10.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Eye: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><ellipse cx="7.5" cy="7.5" rx="6" ry="3.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>,
  Voice: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3.5 5.5v4M5.75 3.5v8M8 5v5M10.25 3.5v8M12.5 5.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Tree: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="3" r="2" stroke="currentColor" strokeWidth="1.1"/><circle cx="4" cy="11" r="2" stroke="currentColor" strokeWidth="1.1"/><circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.1"/><path d="M6.3 4.8L4.8 9.2M8.7 4.8l1.5 4.4" stroke="currentColor" strokeWidth="1.1"/></svg>,
  Gallery: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/></svg>,
  Shield: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L3 3.5v3.5c0 2.8 1.7 4.5 4 5.5 2.3-1 4-2.7 4-5.5V3.5L7 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/><path d="M5.5 7l1.2 1.2L9 6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Copy: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M9 1.5H3A1.5 1.5 0 001.5 3v6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  Play: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2.5l8 4.5-8 4.5V2.5z" fill="currentColor"/></svg>,
  Plus: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  Sparkle: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1l1.3 3.7L11.5 6l-3.7 1.3L6.5 11l-1.3-3.7L1.5 6l3.7-1.3L6.5 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Repeat: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 5A5 5 0 0110.8 3.5M11.5 8a5 5 0 01-9.3 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/><path d="M10.5 1.5v2.5h-2.5M2.5 11.5V9H5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Export: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v7M4 5.5L7 1.5l3 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M1.5 10v1.5a1 1 0 001 1h9a1 1 0 001-1V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Waveform: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1.5 7.5h1l1-3 1.5 6 1.5-5 1 4 1-3 1.5 5 1-4 .5 1h1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Clock: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 3.5V6l2 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Tag: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6.9V2.5a1 1 0 011-1h4.4a1 1 0 01.7.3l3.1 3.1a1 1 0 010 1.4l-4.4 4.4a1 1 0 01-1.4 0L1.8 7.6a1 1 0 01-.3-.7z" stroke="currentColor" strokeWidth="1"/><circle cx="4.5" cy="4.5" r="0.8" fill="currentColor"/></svg>,
  Img: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1"/><circle cx="4" cy="4.5" r="1" stroke="currentColor" strokeWidth="0.8"/><path d="M1 9l2.5-2.5L5 8l2.5-3L11 9" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Audio: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5v3M4.5 3v6M6.5 4v4M8.5 3v6M10.5 4.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
};

// ─── Shared Styles ───────────────────────────────────────────
const S = {
  pill: (active, accent) => ({
    padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "1px solid", fontFamily: "inherit", transition: "all 0.2s",
    ...(active ? { background: `${accent}18`, borderColor: `${accent}40`, color: accent } : { background: "transparent", borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }),
  }),
  sectionTitle: { fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 },
  glass: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12 },
  label: { fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, marginBottom: 3 },
  value: { fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 600 },
  mono: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11 },
};

// ─── Consistency Arc ─────────────────────────────────────────
function ConsistencyArc({ value, size = 80, accent }) {
  const r = (size - 10) / 2;
  const c = Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={accent} strokeWidth="5" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1.2s ease-out", filter: `drop-shadow(0 0 6px ${accent}44)` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{value}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: -2 }}>一致性</span>
      </div>
    </div>
  );
}

// ─── DNA Color Swatch ────────────────────────────────────────
function ColorSwatch({ color, label, prompt }) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, ...S.glass, position: "relative", cursor: "default" }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: color, border: "2px solid rgba(255,255,255,0.1)", flexShrink: 0, boxShadow: `0 0 12px ${color}33` }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{label}</div>
        <div style={{ ...S.mono, fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{prompt}</div>
      </div>
    </div>
  );
}

// ─── DNA Tag ─────────────────────────────────────────────────
function DNATag({ label, value, accent }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 10, ...S.glass }}>
      <div style={S.label}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{value}</div>
    </div>
  );
}

// ─── Costume Version Tree ────────────────────────────────────
function CostumeTree({ costumes, accent, selectedId, onSelect }) {
  const root = costumes.find(c => c.parentId === null);
  if (!root) return null;

  function renderNode(node, depth = 0) {
    const children = costumes.filter(c => c.parentId === node.id);
    const isSelected = selectedId === node.id;
    const isRoot = depth === 0;
    return (
      <div key={node.id}>
        <div style={{ display: "flex", alignItems: "stretch", marginLeft: depth > 0 ? 24 : 0 }}>
          {depth > 0 && (
            <div style={{ width: 24, position: "relative", flexShrink: 0 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: "50%", width: 12, borderLeft: `1.5px solid rgba(255,255,255,0.08)`, borderBottom: `1.5px solid rgba(255,255,255,0.08)`, borderBottomLeftRadius: 6 }} />
            </div>
          )}
          <div
            onClick={() => onSelect(node.id)}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
              border: `1px solid ${isSelected ? `${accent}40` : "rgba(255,255,255,0.05)"}`,
              background: isSelected ? `${accent}0C` : "rgba(255,255,255,0.015)",
              marginBottom: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isRoot && <div style={{ width: 6, height: 6, borderRadius: 3, background: accent }} />}
                <span style={{ fontSize: 12, fontWeight: isRoot ? 600 : 500, color: isSelected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.65)" }}>{node.name}</span>
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{node.genCount} 张</span>
            </div>
            {node.prompt && (
              <div style={{ ...S.mono, fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 5, lineHeight: 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                +{node.prompt}
              </div>
            )}
          </div>
        </div>
        {children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      {renderNode(root)}
      {/* New branch button */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
          border: "1px dashed rgba(255,255,255,0.08)", marginTop: 4, justifyContent: "center",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.3)", display: "flex" }}><I.Plus /></span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>新建造型分支</span>
      </div>
    </div>
  );
}

// ─── Waveform Visualizer ─────────────────────────────────────
function Waveform({ data, accent, playing }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 36, padding: "0 4px" }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            width: 3, borderRadius: 2, flexShrink: 0,
            height: `${v * 100}%`,
            background: playing && i < data.length * 0.4 ? accent : `rgba(255,255,255,${0.08 + v * 0.15})`,
            transition: "background 0.15s, height 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

// ─── Generation Thumbnail ────────────────────────────────────
function GenThumb({ gen, accent, onClick }) {
  const [hover, setHover] = useState(false);
  const isAudio = gen.type === "audio";
  const costume = CHARACTER.costumes.find(c => c.id === gen.costumeId);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        borderRadius: 10, overflow: "hidden", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.19,1,0.22,1)",
        transform: hover ? "translateY(-2px) scale(1.01)" : "none",
        boxShadow: hover ? `0 8px 30px -8px ${accent}20` : "none",
        border: `1px solid ${hover ? `${accent}30` : "rgba(255,255,255,0.05)"}`,
      }}
    >
      {/* Thumb area */}
      <div style={{
        aspectRatio: isAudio ? "3/1" : "1/1", position: "relative", overflow: "hidden",
        background: isAudio
          ? "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)"
          : `linear-gradient(135deg, hsl(${gen.hue},30%,12%) 0%, hsl(${gen.hue},25%,6%) 100%)`,
      }}>
        {!isAudio && (
          <>
            <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 80% 60% at 40% 70%, hsla(${gen.hue},45%,20%,0.5) 0%, transparent 60%)` }} />
            <div style={{ position: "absolute", inset: 0, opacity: 0.25, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")`, backgroundSize: "100px", mixBlendMode: "overlay" }} />
          </>
        )}
        {isAudio && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "0 16px" }}>
            <Waveform data={CHARACTER.voice.waveform.slice(0, 16)} accent={accent} />
          </div>
        )}
        {/* Type badge */}
        <div style={{ position: "absolute", top: 6, right: 6, padding: "2px 7px", borderRadius: 12, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "rgba(255,255,255,0.6)" }}>
          {isAudio ? <I.Audio /> : <I.Img />}
          {isAudio ? "音频" : "图像"}
        </div>
        {/* Hover overlay */}
        {hover && !isAudio && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(1px)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <button style={{ padding: "5px 12px", borderRadius: 16, border: `1px solid ${accent}60`, background: `${accent}20`, color: accent, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
              <I.Repeat /> 重现
            </button>
          </div>
        )}
      </div>
      {/* Info */}
      <div style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
          {gen.tags.map(t => (
            <span key={t} style={{ padding: "1px 7px", borderRadius: 10, fontSize: 9, fontWeight: 500, color: `${accent}cc`, background: `${accent}12`, border: `1px solid ${accent}20` }}>{t}</span>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", display: "flex", alignItems: "center", gap: 3 }}><I.Clock />{gen.time}</span>
          {costume && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{costume.name}</span>}
        </div>
        {gen.seed && (
          <div style={{ ...S.mono, fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>
            seed:{gen.seed} · s:{gen.steps} · w:{gen.loraWeight}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar Tabs ────────────────────────────────────────────
const TABS = [
  { id: "dna", icon: <I.DNA />, label: "角色 DNA" },
  { id: "visual", icon: <I.Eye />, label: "视觉资产" },
  { id: "costumes", icon: <I.Tree />, label: "造型版本" },
  { id: "gallery", icon: <I.Gallery />, label: "生成历史" },
  { id: "voice", icon: <I.Voice />, label: "声音绑定" },
  { id: "security", icon: <I.Shield />, label: "安全存证" },
];

// ─── Main Detail Page ────────────────────────────────────────
export default function CharacterDetail() {
  const [activeTab, setActiveTab] = useState("dna");
  const [selectedCostume, setSelectedCostume] = useState("cos-0");
  const [galleryFilter, setGalleryFilter] = useState("全部");
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [selectedGen, setSelectedGen] = useState(null);
  const c = CHARACTER;
  const a = c.accent;

  const galleryTags = ["全部", "封面图", "表情包", "周边", "预告图", "概念图", "配音"];
  const filteredGens = c.generations.filter(g => galleryFilter === "全部" || g.tags.includes(galleryFilter));

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", color: "#fff", fontFamily: "'DM Sans', 'Noto Sans SC', -apple-system, sans-serif", position: "relative", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes slideIn { from { opacity:0; transform:translateX(-12px) } to { opacity:1; transform:translateX(0) } }
        @keyframes pulseGlow { 0%,100% { box-shadow:0 0 8px ${a}22 } 50% { box-shadow:0 0 20px ${a}44 } }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:5px } ::-webkit-scrollbar-track { background:transparent } ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.06);border-radius:3px }
      `}</style>

      {/* ─── Background orbs ─── */}
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: `radial-gradient(circle, hsla(${c.coverHue},50%,25%,0.06) 0%, transparent 70%)`, left: "10%", top: "20%", transform: "translate(-50%,-50%)" }} />
        <div style={{ position: "absolute", width: 350, height: 350, borderRadius: "50%", background: `radial-gradient(circle, hsla(${(c.coverHue+60)%360},40%,20%,0.05) 0%, transparent 70%)`, right: "10%", bottom: "20%", transform: "translate(50%,50%)" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", height: "100vh" }}>

        {/* ──────── LEFT SIDEBAR ──────── */}
        <div style={{ width: 260, borderRight: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", flexShrink: 0, background: "rgba(0,0,0,0.15)" }}>
          {/* Back nav */}
          <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 500, transition: "color 0.2s" }}>
            <I.Back /> 角色库
          </div>

          {/* Character header card */}
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{ borderRadius: 14, overflow: "hidden", ...S.glass, animation: "fadeIn 0.5s ease-out" }}>
              {/* Cover */}
              <div style={{ height: 120, position: "relative", background: `linear-gradient(160deg, hsl(${c.coverHue},25%,12%) 0%, hsl(${c.coverHue},35%,6%) 100%)` }}>
                <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 80% 70% at 50% 80%, ${a}22 0%, transparent 60%)` }} />
                <div style={{ position: "absolute", inset: 0, opacity: 0.3, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`, backgroundSize: "128px", mixBlendMode: "overlay" }} />
                <div style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 12, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{c.style}</div>
              </div>
              {/* Info */}
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{c.nameEn}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                  <ConsistencyArc value={c.visual.consistency} size={56} accent={a} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      {[
                        { l: "生成", v: c.generations.length },
                        { l: "造型", v: c.costumes.length },
                        { l: "LoRA", v: c.visual.trainingMode },
                        { l: "声音", v: c.voice.bound ? "已绑定" : "未绑定" },
                      ].map(s => (
                        <div key={s.l}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{s.l}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Nav tabs */}
          <div style={{ flex: 1, padding: "0 12px", overflow: "auto" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", textAlign: "left", width: "100%",
                    animation: `slideIn 0.3s ${i * 0.05}s both ease-out`,
                    background: activeTab === tab.id ? `${a}12` : "transparent",
                    color: activeTab === tab.id ? a : "rgba(255,255,255,0.4)",
                  }}
                >
                  <span style={{ display: "flex" }}>{tab.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 500 }}>{tab.label}</span>
                  {activeTab === tab.id && <div style={{ marginLeft: "auto", width: 4, height: 4, borderRadius: 2, background: a }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom actions */}
          <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 6 }}>
            <button style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <I.Export /> 导出设定书
            </button>
          </div>
        </div>

        {/* ──────── MAIN CONTENT ──────── */}
        <div style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>

          {/* ─── DNA TAB ─── */}
          {activeTab === "dna" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={S.sectionTitle}>角色 DNA · 外貌参数</div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 1.6, maxWidth: 520 }}>
                DNA 参数是所有生成任务的「基础 Prompt 锚点」，确保角色在不同场景下词根一致。修改 DNA 会影响所有未来生成。
              </p>

              {/* Color attributes */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                <ColorSwatch color={c.dna.hair.color} label={`发色 · ${c.dna.hair.label}`} prompt={c.dna.hair.prompt} />
                <ColorSwatch color={c.dna.eyes.color} label={`瞳色 · ${c.dna.eyes.label}`} prompt={c.dna.eyes.prompt} />
              </div>

              {/* Other attributes */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 24 }}>
                <DNATag label="肤色" value={c.dna.skin.label} />
                <DNATag label="体型" value={c.dna.bodyType.label} />
                <DNATag label="风格" value={c.dna.style.label} />
              </div>

              {/* Personality */}
              <div style={{ ...S.glass, padding: 16, marginBottom: 24 }}>
                <div style={S.label}>角色性格备注</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.7, marginTop: 4 }}>{c.dna.personality}</div>
              </div>

              {/* Full prompt */}
              <div style={{ ...S.glass, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={S.label}>完整 DNA Prompt（自动注入）</div>
                  <button style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.35)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                    <I.Copy /> 复制
                  </button>
                </div>
                <div style={{ ...S.mono, fontSize: 11, color: a, lineHeight: 1.8, padding: 12, borderRadius: 8, background: `${a}08`, border: `1px solid ${a}15` }}>
                  {c.dna.fullPrompt}
                </div>
              </div>
            </div>
          )}

          {/* ─── VISUAL ASSETS TAB ─── */}
          {activeTab === "visual" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={S.sectionTitle}>视觉资产 · LoRA 模型</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                {/* LoRA info card */}
                <div style={{ ...S.glass, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: `${a}15`, display: "flex", alignItems: "center", justifyContent: "center", color: a }}><I.Sparkle /></div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>FLUX LoRA</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{c.visual.trainingMode}模式 · Rank {c.visual.rank}</div>
                    </div>
                  </div>
                  {[
                    { l: "触发词", v: c.visual.triggerWord, mono: true },
                    { l: "基础模型", v: c.visual.baseModel },
                    { l: "训练步数", v: `${c.visual.steps} steps` },
                    { l: "推荐权重", v: c.visual.weight },
                    { l: "训练数据集", v: `${c.visual.datasetSize} 张图片` },
                    { l: "文件大小", v: c.visual.fileSize },
                    { l: "训练日期", v: c.visual.trainDate },
                  ].map(r => (
                    <div key={r.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{r.l}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.75)", ...(r.mono && { ...S.mono, color: a }) }}>{r.v}</span>
                    </div>
                  ))}
                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${a}40`, background: `${a}12`, color: a, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>重新训练</button>
                    <button style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>调整参数</button>
                  </div>
                </div>

                {/* Consistency & file */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ ...S.glass, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
                    <ConsistencyArc value={c.visual.consistency} size={100} accent={a} />
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "center", lineHeight: 1.5, marginTop: 4 }}>
                      标准模式目标 ~88%<br/>当前超过目标 +3%
                    </div>
                  </div>
                  <div style={{ ...S.glass, padding: 16 }}>
                    <div style={S.label}>LoRA 文件路径</div>
                    <div style={{ ...S.mono, fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, wordBreak: "break-all", lineHeight: 1.6 }}>
                      {c.visual.loraPath}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                      <I.Shield />
                      <span style={{ fontSize: 10, color: "#5DCAA5", fontWeight: 500 }}>AES-256 加密存储</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── COSTUMES TAB ─── */}
          {activeTab === "costumes" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={S.sectionTitle}>造型版本树</div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 1.6, maxWidth: 520 }}>
                每个造型基于基础 LoRA 叠加服装描述 Prompt。面部特征由基础 LoRA 锁定，只有服装、配饰按描述变化。
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {/* Tree */}
                <div>
                  <CostumeTree costumes={c.costumes} accent={a} selectedId={selectedCostume} onSelect={setSelectedCostume} />
                </div>
                {/* Detail panel */}
                <div>
                  {(() => {
                    const cos = c.costumes.find(x => x.id === selectedCostume);
                    if (!cos) return null;
                    const isRoot = cos.parentId === null;
                    return (
                      <div style={{ ...S.glass, padding: 20, animation: "fadeIn 0.3s ease-out" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                          {isRoot && <div style={{ width: 8, height: 8, borderRadius: 4, background: a }} />}
                          <div style={{ fontSize: 16, fontWeight: 600 }}>{cos.name}</div>
                          {isRoot && <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 9, fontWeight: 500, background: `${a}15`, color: a }}>基础</span>}
                        </div>
                        {cos.prompt && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={S.label}>造型附加 Prompt</div>
                            <div style={{ ...S.mono, fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 4, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", lineHeight: 1.7 }}>
                              {cos.prompt}
                            </div>
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                          <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                            <div style={S.label}>生成图数</div>
                            <div style={S.value}>{cos.genCount}</div>
                          </div>
                          <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                            <div style={S.label}>子分支</div>
                            <div style={S.value}>{cos.children.length}</div>
                          </div>
                        </div>
                        {/* Preview grid placeholder */}
                        <div style={S.label}>预览图</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
                          {[0,1,2,3].map(i => (
                            <div key={i} style={{ aspectRatio: "1/1", borderRadius: 8, background: `linear-gradient(135deg, hsl(${c.coverHue + i*30},25%,12%), hsl(${c.coverHue + i*30},30%,6%))`, border: "1px solid rgba(255,255,255,0.04)" }}>
                              <div style={{ width: "100%", height: "100%", borderRadius: 8, opacity: 0.3, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")`, backgroundSize: "80px", mixBlendMode: "overlay" }} />
                            </div>
                          ))}
                        </div>
                        {/* Actions */}
                        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                          <button style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${a}40`, background: `${a}12`, color: a, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                            <I.Sparkle /> 使用此造型生成
                          </button>
                          {!isRoot && (
                            <button style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                              <I.Plus /> 新建子分支
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ─── GALLERY TAB ─── */}
          {activeTab === "gallery" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={S.sectionTitle}>生成历史 · {c.generations.length} 条记录</div>
              </div>
              {/* Filters */}
              <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
                {galleryTags.map(t => (
                  <button key={t} onClick={() => setGalleryFilter(t)} style={S.pill(galleryFilter === t, a)}>{t}</button>
                ))}
              </div>
              {/* Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {filteredGens.map((gen, i) => (
                  <div key={gen.id} style={{ animation: `fadeIn 0.35s ${i * 0.04}s both ease-out` }}>
                    <GenThumb gen={gen} accent={a} onClick={() => setSelectedGen(gen)} />
                  </div>
                ))}
              </div>
              {filteredGens.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>没有匹配的记录</div>
              )}
            </div>
          )}

          {/* ─── VOICE TAB ─── */}
          {activeTab === "voice" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={S.sectionTitle}>声音绑定 · {c.voice.engine}</div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 24, lineHeight: 1.6, maxWidth: 520 }}>
                零样本声纹克隆：上传 3–30 秒参考音频，无需训练。所有 TTS 生成将自动使用此声音。
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Voice profile */}
                <div style={{ ...S.glass, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: `${a}15`, display: "flex", alignItems: "center", justifyContent: "center", color: a, animation: voicePlaying ? "pulseGlow 2s ease-in-out infinite" : "none" }}>
                      <I.Voice />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>声纹已绑定</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{c.voice.engine} · 参考音频 {c.voice.refAudioDuration}</div>
                    </div>
                  </div>

                  {/* Waveform preview */}
                  <div style={{ ...S.glass, padding: 14, marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={() => setVoicePlaying(!voicePlaying)}
                        style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${a}40`, background: `${a}15`, color: a, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                      >
                        {voicePlaying ? <span style={{ width: 8, height: 8, borderRadius: 2, background: a }} /> : <I.Play />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <Waveform data={c.voice.waveform} accent={a} playing={voicePlaying} />
                      </div>
                    </div>
                    <div style={{ ...S.mono, fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 8, lineHeight: 1.6 }}>
                      "{c.voice.sampleText}"
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                      <div style={S.label}>音色相似度</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ fontSize: 22, fontWeight: 700, color: a }}>{c.voice.similarity}%</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>零样本</span>
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                      <div style={S.label}>TTS 引擎</div>
                      <div style={{ ...S.mono, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>{c.voice.engine}</div>
                    </div>
                  </div>
                </div>

                {/* TTS Test area */}
                <div style={{ ...S.glass, padding: 20, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>语音合成测试</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>输入文字，用角色声音朗读</div>

                  <textarea
                    placeholder="输入要朗读的文字…"
                    defaultValue="大家晚上好！欢迎来到我的直播间，今天我们来聊聊最近追的番～"
                    style={{
                      flex: 1, minHeight: 120, padding: 14, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.7, resize: "none", outline: "none",
                    }}
                  />

                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${a}, ${a}bb)`, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <I.Voice /> 生成语音
                    </button>
                    <button style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                      更换引擎
                    </button>
                  </div>

                  {/* Upgrade hint */}
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "rgba(123,104,238,0.06)", border: "1px solid rgba(123,104,238,0.15)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(123,104,238,0.9)", marginBottom: 3 }}>v1.5 升级路径</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                      精训专属声音模型（Unsloth TTS），音色相似度提升至 ~92%，约需 20-30 分钟训练
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── SECURITY TAB ─── */}
          {activeTab === "security" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={S.sectionTitle}>安全存证 · 创作保护</div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 24, lineHeight: 1.6, maxWidth: 520 }}>
                所有训练和生成记录自动存证，LoRA 文件加密存储并绑定设备指纹，为创作权益提供本地证据链。
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Fingerprint */}
                <div style={{ ...S.glass, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(93,202,165,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5DCAA5" }}><I.Shield /></div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>角色指纹</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>DNA + 训练数据哈希</div>
                    </div>
                  </div>
                  <div style={{ ...S.mono, fontSize: 12, color: "#5DCAA5", padding: 12, borderRadius: 8, background: "rgba(93,202,165,0.06)", border: "1px solid rgba(93,202,165,0.15)", wordBreak: "break-all" }}>
                    {c.fingerprint}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                    创建时间：{new Date(c.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
                  </div>
                </div>

                {/* Encryption status */}
                <div style={{ ...S.glass, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>加密状态</div>
                  {[
                    { label: "LoRA 模型文件", status: "AES-256 加密", ok: true },
                    { label: "声纹嵌入向量", status: "加密存储", ok: true },
                    { label: "训练数据集", status: "本地存储", ok: true },
                    { label: "生成参数快照", status: "哈希存档", ok: true },
                    { label: "设备绑定", status: "已绑定", ok: true },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{r.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: r.ok ? "#5DCAA5" : "rgba(255,255,255,0.3)" }}>{r.status}</span>
                    </div>
                  ))}
                  <button style={{ width: "100%", marginTop: 16, padding: "9px 0", borderRadius: 8, border: "1px solid rgba(93,202,165,0.3)", background: "rgba(93,202,165,0.06)", color: "#5DCAA5", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    导出创作证明文件
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
