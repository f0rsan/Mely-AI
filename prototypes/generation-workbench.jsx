import { useState, useRef, useEffect } from "react";

// ─── Mock Data ───────────────────────────────────────────────
const ACTIVE_CHARACTER = {
  name: "星野ミカ",
  nameEn: "Hoshino Mika",
  accent: "#FF6B9D",
  coverHue: 320,
  consistency: 91,
  triggerWord: "hoshino_mika",
  dnaPrompt: "hoshino_mika, pink hair, long hair, violet eyes, fair skin, slim body, anime style, 1girl",
  loraWeight: 0.85,
  loraFile: "hoshino_mika_v3.safetensors",
  baseModel: "FLUX-dev",
};

const COSTUMES = [
  { id: "cos-0", name: "基础造型", prompt: "", isRoot: true },
  { id: "cos-1", name: "夏日泳装版", prompt: "white bikini, beach, straw hat, seashell necklace" },
  { id: "cos-2", name: "万圣节版", prompt: "black witch dress, orange belt, pumpkin hat, bat wings accessory" },
  { id: "cos-3", name: "圣诞特别版", prompt: "red santa dress, white fur trim, candy cane, christmas lights" },
];

const PRESETS = [
  { label: "直播封面", icon: "🎬", scene: "facing viewer, upper body, colorful background, stream thumbnail style, dynamic pose, vibrant lighting" },
  { label: "表情包", icon: "😆", scene: "chibi, simple background, exaggerated expression, sticker style, white outline" },
  { label: "周边立牌", icon: "🏷️", scene: "full body, standing pose, white background, clean lines, merchandise illustration style" },
  { label: "社媒头图", icon: "📱", scene: "portrait, soft lighting, bokeh background, social media banner composition, warm tones" },
  { label: "概念艺术", icon: "🎨", scene: "cinematic lighting, detailed background, concept art, dramatic atmosphere" },
  { label: "节日贺图", icon: "🎉", scene: "festive atmosphere, celebration, confetti, gift boxes, cheerful mood, holiday theme" },
];

const SAMPLERS = ["DPM++ 2M Karras", "Euler a", "DPM++ SDE Karras", "DDIM", "UniPC"];

const INITIAL_QUEUE = [
  { id: "q1", scene: "在咖啡馆看书，阳光从窗户射入", status: "completed", costume: "基础造型", hue: 30, progress: 100 },
  { id: "q2", scene: "在樱花树下弹吉他", status: "generating", costume: "基础造型", hue: 330, progress: 67 },
  { id: "q3", scene: "万圣节派对，拿着南瓜灯笼", status: "queued", costume: "万圣节版", hue: 25, progress: 0 },
  { id: "q4", scene: "圣诞树前拆礼物，惊喜的表情", status: "queued", costume: "圣诞特别版", hue: 350, progress: 0 },
  { id: "q5", scene: "月光下的天台，风吹起长发", status: "queued", costume: "基础造型", hue: 230, progress: 0 },
];

// ─── Icons ───────────────────────────────────────────────────
const I = {
  Send: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 2L7 9M14 2l-4.5 12-2-5.5L2 6.5 14 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  Expand: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4 5l2.5 2.5L9 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Collapse: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4 8l2.5-2.5L9 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Sparkle: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Batch: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><rect x="3.5" y="2" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><rect x="5.5" y="0" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="0" fill="none"/></svg>,
  Queue: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M2 7h10M2 11h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.1"/><path d="M11 10v1.2l.8.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Play: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor"/></svg>,
  Pause: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2.5" y="2" width="2.5" height="8" rx="0.5" fill="currentColor"/><rect x="7" y="2" width="2.5" height="8" rx="0.5" fill="currentColor"/></svg>,
  Check: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  X: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Dice: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.1"/><circle cx="4.5" cy="4.5" r="0.8" fill="currentColor"/><circle cx="6.5" cy="6.5" r="0.8" fill="currentColor"/><circle cx="8.5" cy="8.5" r="0.8" fill="currentColor"/></svg>,
  Sliders: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/><circle cx="5" cy="3.5" r="1.3" fill="currentColor" stroke="currentColor" strokeWidth="0.5"/><circle cx="9" cy="7" r="1.3" fill="currentColor" stroke="currentColor" strokeWidth="0.5"/><circle cx="4" cy="10.5" r="1.3" fill="currentColor" stroke="currentColor" strokeWidth="0.5"/></svg>,
  Tag: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6.9V2.5a1 1 0 011-1h4.4a1 1 0 01.7.3l3.1 3.1a1 1 0 010 1.4l-4.4 4.4a1 1 0 01-1.4 0L1.8 7.6a1 1 0 01-.3-.7z" stroke="currentColor" strokeWidth="1"/><circle cx="4.5" cy="4.5" r="0.7" fill="currentColor"/></svg>,
  Save: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M10.5 11.5h-8a1 1 0 01-1-1v-8a1 1 0 011-1h6l3 3v6a1 1 0 01-1 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/><path d="M4 11.5v-4h5v4" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/><path d="M4 1.5v2.5h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Repeat: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 5A5 5 0 0110.8 3.5M11.5 8a5 5 0 01-9.3 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/><path d="M10.5 1.5v2.5h-2.5M2.5 11.5V9H5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Clock: () => <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1"/><path d="M5.5 3v2.5l1.8 1.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Bolt: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6.5 1L3 7h3l-.5 4L9 5H6l.5-4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Eye: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><ellipse cx="6.5" cy="6.5" rx="5" ry="3" stroke="currentColor" strokeWidth="1.1"/><circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.1"/></svg>,
  Plus: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  Trash: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3.5h8M4.5 3.5V2.5a1 1 0 011-1h1a1 1 0 011 1v1M3 3.5l.5 6.5a1 1 0 001 .9h3a1 1 0 001-.9L9 3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ─── Prompt Assembly Preview ─────────────────────────────────
function PromptPreview({ dna, costumePrompt, scenePrompt, accent, expanded, onToggle }) {
  const segments = [
    { label: "LoRA 触发词", text: ACTIVE_CHARACTER.triggerWord, color: accent },
    { label: "DNA 外貌", text: dna.replace(ACTIVE_CHARACTER.triggerWord + ", ", ""), color: "#7B68EE" },
    ...(costumePrompt ? [{ label: "造型叠加", text: costumePrompt, color: "#FF8C42" }] : []),
    ...(scenePrompt ? [{ label: "场景描述", text: scenePrompt, color: "#5DCAA5" }] : []),
  ];
  const full = segments.map(s => s.text).join(", ");

  return (
    <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <I.Eye />
          <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>完整 Prompt 预览</span>
          {segments.map((s, i) => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: 4, background: s.color, opacity: 0.7 }} />
          ))}
        </div>
        <span style={{ color: "rgba(255,255,255,0.3)", display: "flex" }}>{expanded ? <I.Collapse /> : <I.Expand />}</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 12px 12px", animation: "fadeIn 0.2s ease-out" }}>
          {/* Segmented view */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {segments.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: s.color, minWidth: 56, paddingTop: 3, textAlign: "right", opacity: 0.8 }}>{s.label}</span>
                <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: `${s.color}cc`, lineHeight: 1.7, padding: "2px 8px", borderRadius: 4, background: `${s.color}08`, borderLeft: `2px solid ${s.color}30`, flex: 1 }}>{s.text}</span>
              </div>
            ))}
          </div>
          {/* Merged prompt */}
          <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 4, fontWeight: 500 }}>合并后发送到 ComfyUI</div>
            <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "rgba(255,255,255,0.5)", lineHeight: 1.7, wordBreak: "break-all" }}>{full}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Preset Chip ─────────────────────────────────────────────
function PresetChip({ preset, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", borderRadius: 20, border: `1px solid ${active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
      background: active ? "rgba(255,255,255,0.06)" : "transparent", cursor: "pointer", fontFamily: "inherit",
      display: "flex", alignItems: "center", gap: 5, transition: "all 0.2s", fontSize: 11, fontWeight: 500,
      color: active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)",
    }}>
      <span>{preset.icon}</span> {preset.label}
    </button>
  );
}

// ─── Generated Image Card ────────────────────────────────────
function ResultCard({ hue, index, accent, status }) {
  const [hover, setHover] = useState(false);
  const isGenerating = status === "generating";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        aspectRatio: "1/1", borderRadius: 12, overflow: "hidden", position: "relative",
        border: `1px solid ${hover ? `${accent}30` : "rgba(255,255,255,0.05)"}`,
        transition: "all 0.3s cubic-bezier(0.19,1,0.22,1)",
        transform: hover ? "scale(1.02)" : "none",
        animation: `resultIn 0.5s ${index * 0.1}s both ease-out`,
        cursor: "pointer",
      }}
    >
      {/* Background */}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, hsl(${hue},28%,12%) 0%, hsl(${hue},32%,5%) 100%)` }} />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 45% 65%, hsla(${hue},45%,22%,0.5) 0%, transparent 60%)` }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.3, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.45'/%3E%3C/svg%3E")`, backgroundSize: "128px", mixBlendMode: "overlay" }} />

      {isGenerating && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)", zIndex: 2 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${accent}40`, borderTopColor: accent, animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 8 }}>生成中…</span>
        </div>
      )}

      {/* Hover overlay */}
      {hover && !isGenerating && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(1px)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, zIndex: 2, animation: "fadeIn 0.15s ease-out" }}>
          {[
            { icon: <I.Save />, tip: "入库" },
            { icon: <I.Tag />, tip: "标签" },
            { icon: <I.Repeat />, tip: "重现" },
          ].map((b, i) => (
            <button key={i} title={b.tip} style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${accent}50`, background: `${accent}20`,
              color: accent, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>{b.icon}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Queue Item ──────────────────────────────────────────────
function QueueItem({ item, accent, onRemove }) {
  const [hover, setHover] = useState(false);
  const statusColors = { completed: "#5DCAA5", generating: accent, queued: "rgba(255,255,255,0.25)" };
  const statusLabels = { completed: "已完成", generating: "生成中", queued: "排队中" };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8,
        background: hover ? "rgba(255,255,255,0.025)" : "transparent",
        border: `1px solid ${item.status === "generating" ? `${accent}20` : "rgba(255,255,255,0.03)"}`,
        transition: "all 0.2s",
      }}
    >
      {/* Status dot */}
      <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: statusColors[item.status], margin: 1 }} />
        {item.status === "generating" && (
          <div style={{ position: "absolute", inset: -2, borderRadius: "50%", border: `1.5px solid ${accent}`, opacity: 0.3, animation: "pulseRing 2s ease-in-out infinite" }} />
        )}
      </div>

      {/* Thumb */}
      <div style={{
        width: 32, height: 32, borderRadius: 6, flexShrink: 0, overflow: "hidden",
        background: `linear-gradient(135deg, hsl(${item.hue},25%,14%), hsl(${item.hue},30%,7%))`,
        border: "1px solid rgba(255,255,255,0.05)",
      }}>
        <div style={{ width: "100%", height: "100%", opacity: 0.3, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`, backgroundSize: "64px", mixBlendMode: "overlay" }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.scene}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>{item.costume}</div>
      </div>

      {/* Progress or status */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        {item.status === "generating" && (
          <div style={{ width: 48, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ width: `${item.progress}%`, height: "100%", borderRadius: 2, background: accent, transition: "width 0.3s" }} />
          </div>
        )}
        <span style={{ fontSize: 10, fontWeight: 500, color: statusColors[item.status] }}>{statusLabels[item.status]}</span>
        {hover && item.status === "queued" && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(item.id); }} style={{ width: 20, height: 20, borderRadius: 4, border: "none", background: "rgba(255,80,80,0.15)", color: "#FF5050", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            <I.X />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Param Slider ────────────────────────────────────────────
function ParamRow({ label, value, unit, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.75)", fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
        {unit && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{unit}</span>}
        {sub && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>{sub}</span>}
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
export default function GenerationWorkbench() {
  const [sceneInput, setSceneInput] = useState("在咖啡馆看书，阳光从窗户射入");
  const [selectedCostume, setSelectedCostume] = useState("cos-0");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [activePreset, setActivePreset] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchInput, setBatchInput] = useState("在樱花树下弹吉他\n月光下的天台，风吹起长发\n雨天在公交站等车，撑着透明雨伞");
  const [queue, setQueue] = useState(INITIAL_QUEUE);
  const [generatedResults, setGeneratedResults] = useState([
    { hue: 30, status: "completed" },
    { hue: 200, status: "completed" },
    { hue: 340, status: "generating" },
    { hue: 180, status: "generating" },
  ]);
  const [queueCollapsed, setQueueCollapsed] = useState(false);

  // Advanced params
  const [steps, setSteps] = useState(28);
  const [seed, setSeed] = useState(-1);
  const [sampler, setSampler] = useState("DPM++ 2M Karras");
  const [loraWeight, setLoraWeight] = useState(0.85);
  const [negPrompt, setNegPrompt] = useState("low quality, blurry, deformed, extra fingers, bad anatomy");

  const a = ACTIVE_CHARACTER.accent;
  const costume = COSTUMES.find(c => c.id === selectedCostume);
  const costumePrompt = costume?.prompt || "";

  const removeFromQueue = (id) => setQueue(q => q.filter(x => x.id !== id));
  const completedCount = queue.filter(q => q.status === "completed").length;
  const activeCount = queue.filter(q => q.status === "generating").length;

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", color: "#fff", fontFamily: "'DM Sans', 'Noto Sans SC', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes resultIn { from{opacity:0;transform:scale(0.9)} to{opacity:1;transform:scale(1)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes pulseRing { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:0;transform:scale(2)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing:border-box }
        textarea:focus, input:focus { outline:none }
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:3px}
      `}</style>

      {/* ─── Background ─── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: `radial-gradient(circle, hsla(${ACTIVE_CHARACTER.coverHue},45%,20%,0.05) 0%, transparent 70%)`, left: "20%", top: "30%", transform: "translate(-50%,-50%)" }} />
        <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, hsla(200,40%,18%,0.04) 0%, transparent 70%)", right: "10%", bottom: "20%", transform: "translate(50%,50%)" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100vh" }}>
        {/* ═══ TOP BAR ═══ */}
        <div style={{ padding: "14px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, animation: "fadeIn 0.3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${a}, ${a}88)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <I.Sparkle />
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>生成工作台</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 8 }}>Generation Workbench</span>
            </div>
          </div>
          {/* Active character badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 14px 5px 6px", borderRadius: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: `linear-gradient(135deg, hsl(${ACTIVE_CHARACTER.coverHue},30%,15%), hsl(${ACTIVE_CHARACTER.coverHue},35%,8%))`, border: `1.5px solid ${a}40` }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{ACTIVE_CHARACTER.name}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>一致性 {ACTIVE_CHARACTER.consistency}% · {ACTIVE_CHARACTER.baseModel}</div>
            </div>
          </div>
        </div>

        {/* ═══ MAIN BODY ═══ */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* ──── LEFT: INPUT PANEL ──── */}
          <div style={{ width: 380, borderRight: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", flexShrink: 0, background: "rgba(0,0,0,0.1)" }}>
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>

              {/* Mode toggle */}
              <div style={{ display: "flex", gap: 4, marginBottom: 16, padding: 3, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                {[
                  { mode: false, label: "单张生成", icon: <I.Sparkle /> },
                  { mode: true, label: "批量模式", icon: <I.Batch /> },
                ].map(m => (
                  <button key={String(m.mode)} onClick={() => setBatchMode(m.mode)} style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.2s",
                    background: batchMode === m.mode ? "rgba(255,255,255,0.06)" : "transparent",
                    color: batchMode === m.mode ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                    fontSize: 11, fontWeight: 500,
                  }}>{m.icon} {m.label}</button>
                ))}
              </div>

              {/* Costume selector */}
              <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>选择造型</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
                {COSTUMES.map(c => (
                  <button key={c.id} onClick={() => setSelectedCostume(c.id)} style={{
                    padding: "5px 12px", borderRadius: 16, border: `1px solid ${selectedCostume === c.id ? `${a}40` : "rgba(255,255,255,0.06)"}`,
                    background: selectedCostume === c.id ? `${a}10` : "transparent", cursor: "pointer", fontFamily: "inherit",
                    fontSize: 11, fontWeight: 500, color: selectedCostume === c.id ? a : "rgba(255,255,255,0.4)", transition: "all 0.2s",
                  }}>
                    {c.isRoot && "●  "}{c.name}
                  </button>
                ))}
              </div>

              {/* Scene presets */}
              <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>场景模板</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 18 }}>
                {PRESETS.map((p, i) => (
                  <PresetChip key={i} preset={p} active={activePreset === i} onClick={() => { setActivePreset(activePreset === i ? null : i); if (activePreset !== i) setSceneInput(p.scene); }} />
                ))}
              </div>

              {/* Scene input */}
              <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                {batchMode ? "批量场景（每行一个）" : "描述场景，不描述角色"}
              </div>

              {batchMode ? (
                <textarea
                  value={batchInput}
                  onChange={e => setBatchInput(e.target.value)}
                  placeholder={"在咖啡馆看书\n在樱花树下弹吉他\n月光下的天台"}
                  rows={6}
                  style={{
                    width: "100%", padding: 14, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.8)", fontSize: 12,
                    fontFamily: "inherit", lineHeight: 1.8, resize: "vertical",
                  }}
                />
              ) : (
                <textarea
                  value={sceneInput}
                  onChange={e => setSceneInput(e.target.value)}
                  placeholder="在咖啡馆看书，阳光从窗户射入"
                  rows={3}
                  style={{
                    width: "100%", padding: 14, borderRadius: 10, border: `1px solid rgba(255,255,255,0.06)`,
                    background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.8)", fontSize: 13,
                    fontFamily: "inherit", lineHeight: 1.7, resize: "vertical",
                  }}
                />
              )}

              {batchMode && (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 6 }}>
                  {batchInput.split("\n").filter(l => l.trim()).length} 个场景 · 预计 {batchInput.split("\n").filter(l => l.trim()).length * 12}–{batchInput.split("\n").filter(l => l.trim()).length * 18} 秒
                </div>
              )}

              {/* Prompt Preview */}
              <div style={{ marginTop: 14 }}>
                <PromptPreview
                  dna={ACTIVE_CHARACTER.dnaPrompt}
                  costumePrompt={costumePrompt}
                  scenePrompt={batchMode ? batchInput.split("\n")[0] : sceneInput}
                  accent={a}
                  expanded={promptExpanded}
                  onToggle={() => setPromptExpanded(!promptExpanded)}
                />
              </div>

              {/* Advanced params toggle */}
              <div style={{ marginTop: 16 }}>
                <div onClick={() => setShowAdvanced(!showAdvanced)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: showAdvanced ? 10 : 0 }}>
                  <span style={{ color: "rgba(255,255,255,0.3)", display: "flex" }}><I.Sliders /></span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>高级参数</span>
                  <span style={{ color: "rgba(255,255,255,0.2)", display: "flex", marginLeft: "auto" }}>{showAdvanced ? <I.Collapse /> : <I.Expand />}</span>
                </div>
                {showAdvanced && (
                  <div style={{ padding: 14, borderRadius: 10, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", animation: "fadeIn 0.2s ease-out" }}>
                    <ParamRow label="采样步数" value={steps} />
                    <ParamRow label="采样器" value={sampler} />
                    <ParamRow label="LoRA 权重" value={loraWeight} />
                    <ParamRow label="Seed" value={seed === -1 ? "随机" : seed} sub={seed === -1 ? "" : ""} />
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>反向提示词</div>
                      <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "rgba(255,255,255,0.3)", lineHeight: 1.6, padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.02)" }}>
                        {negPrompt}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Generate button */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <button style={{
                width: "100%", padding: "12px 0", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: `linear-gradient(135deg, ${a}, ${a}aa)`, color: "#fff", fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8, letterSpacing: "-0.01em",
                boxShadow: `0 4px 20px ${a}33`,
                transition: "all 0.2s",
              }}>
                {batchMode ? <I.Batch /> : <I.Send />}
                {batchMode ? `批量生成 ${batchInput.split("\n").filter(l => l.trim()).length} 张` : "生成图像"}
              </button>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                <I.Bolt /> GPU 就绪 · 预计 ~12 秒/张
              </div>
            </div>
          </div>

          {/* ──── RIGHT: PREVIEW & RESULTS ──── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* Results area */}
            <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  生成结果 · 本次会话
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.35)", fontSize: 10, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                    <I.Save /> 全部入库
                  </button>
                </div>
              </div>

              {/* Result grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                {generatedResults.map((r, i) => (
                  <ResultCard key={i} hue={r.hue} index={i} accent={a} status={r.status} />
                ))}
              </div>

              {generatedResults.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
                  <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)" }}>
                    <I.Sparkle />
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", textAlign: "center", lineHeight: 1.6 }}>
                    描述一个场景，点击生成<br/>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}>角色外貌由 LoRA + DNA 自动保证</span>
                  </div>
                </div>
              )}
            </div>

            {/* ──── BOTTOM: BATCH QUEUE ──── */}
            <div style={{
              borderTop: "1px solid rgba(255,255,255,0.04)", flexShrink: 0,
              maxHeight: queueCollapsed ? 44 : 260, transition: "max-height 0.3s ease",
              overflow: "hidden", background: "rgba(0,0,0,0.12)",
            }}>
              {/* Queue header */}
              <div
                onClick={() => setQueueCollapsed(!queueCollapsed)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "rgba(255,255,255,0.35)", display: "flex" }}><I.Queue /></span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>生成队列</span>
                  <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: `${a}15`, color: a }}>{queue.length}</span>
                  {activeCount > 0 && (
                    <span style={{ fontSize: 10, color: a, display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, background: a, animation: "pulseRing 2s ease-in-out infinite" }} />
                      {activeCount} 处理中
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: "#5DCAA5" }}>
                    {completedCount} 已完成
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.3)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                    清空已完成
                  </button>
                  <span style={{ color: "rgba(255,255,255,0.2)", display: "flex", transform: queueCollapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                    <I.Collapse />
                  </span>
                </div>
              </div>

              {/* Queue list */}
              <div style={{ padding: "0 16px 12px", overflow: "auto", maxHeight: 200 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {queue.map((item, i) => (
                    <div key={item.id} style={{ animation: `fadeIn 0.25s ${i * 0.03}s both ease-out` }}>
                      <QueueItem item={item} accent={a} onRemove={removeFromQueue} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
