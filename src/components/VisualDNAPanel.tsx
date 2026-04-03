import { useCallback, useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

type FieldOption = {
  value: string;
  prompt: string;
};

type DnaField = {
  label: string;
  recommended: string;
  recommendedPrompt: string;
  options: FieldOption[];
};

type DnaSuggestions = {
  characterId: string;
  source: string;
  fields: Record<string, DnaField>;
  autoPromptPreview: string;
  wd14: {
    available: boolean;
    modelId: string | null;
    reason: string | null;
    tags: string[];
  };
};

const FIELD_ORDER = ["hairColor", "eyeColor", "skinTone", "bodyType", "style"] as const;
type FieldKey = (typeof FIELD_ORDER)[number];

async function fetchSuggestions(characterId: string): Promise<DnaSuggestions> {
  const resp = await fetch(`${API_BASE}/api/characters/${characterId}/dna/suggestions`);
  if (!resp.ok) throw new Error("加载外貌建议失败");
  return (await resp.json()) as DnaSuggestions;
}

async function saveDna(
  characterId: string,
  values: Record<FieldKey, string>,
): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/characters/${characterId}/dna`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hairColor: values.hairColor,
      eyeColor: values.eyeColor,
      skinTone: values.skinTone,
      bodyType: values.bodyType,
      style: values.style,
    }),
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "保存失败");
}

type Props = {
  characterId: string;
};

export function VisualDNAPanel({ characterId }: Props) {
  const [suggestions, setSuggestions] = useState<DnaSuggestions | null>(null);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    hairColor: "",
    eyeColor: "",
    skinTone: "",
    bodyType: "",
    style: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSuggestions(characterId);
      setSuggestions(data);
      // Initialize values from recommendations
      const init = {} as Record<FieldKey, string>;
      for (const key of FIELD_ORDER) {
        init[key] = data.fields[key]?.recommended ?? "";
      }
      setValues(init);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveDna(characterId, values);
      setSaved(true);
      // Reload to get updated autoPrompt from server
      await load();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // Compute auto_prompt preview locally from current values + options
  const computePromptPreview = (): string => {
    if (!suggestions) return "";
    const tokens: string[] = [];
    for (const key of FIELD_ORDER) {
      const val = values[key];
      const opts = suggestions.fields[key]?.options ?? [];
      const match = opts.find((o) => o.value === val);
      if (match?.prompt) tokens.push(match.prompt);
      else if (val) tokens.push(val);
    }
    return tokens.join(", ");
  };

  if (loading) {
    return <p className="text-zinc-500 text-sm">加载外貌配置中…</p>;
  }

  if (!suggestions) {
    return (
      <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
        {error ?? "加载失败，请刷新重试"}
      </div>
    );
  }

  const promptPreview = computePromptPreview();

  return (
    <div className="space-y-5">
      {/* WD14 status */}
      {suggestions.wd14.reason && (
        <div className="flex items-center gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2 text-xs text-zinc-500">
          <span className="shrink-0">ⓘ</span>
          <span>{suggestions.wd14.reason}</span>
        </div>
      )}

      {/* DNA dropdowns */}
      <div className="grid grid-cols-1 gap-3">
        {FIELD_ORDER.map((key) => {
          const field = suggestions.fields[key];
          if (!field) return null;
          return (
            <div key={key} className="space-y-1">
              <label className="text-xs text-zinc-400">{field.label}</label>
              <select
                value={values[key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5
                           text-sm text-zinc-200 focus:outline-none focus:border-indigo-500
                           transition-colors"
              >
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {/* Auto-prompt preview */}
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-400 uppercase tracking-wide">自动 Prompt 预览</p>
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2.5">
          <p className="text-xs text-zinc-300 font-mono leading-relaxed break-all">
            {promptPreview || <span className="text-zinc-600">（请选择外貌参数）</span>}
          </p>
        </div>
        <p className="text-xs text-zinc-600">此 Prompt 将自动用于视觉训练和图像生成</p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                   disabled:opacity-40 disabled:cursor-not-allowed
                   text-sm font-medium text-white transition-colors"
      >
        {saving ? "保存中…" : saved ? "✓ 已保存" : "保存外貌设定"}
      </button>
    </div>
  );
}
