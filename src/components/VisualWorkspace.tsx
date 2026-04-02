import { useState } from "react";
import { VisualDatasetPanel } from "./VisualDatasetPanel";
import { VisualDNAPanel } from "./VisualDNAPanel";
import { VisualTrainingPanel } from "./VisualTrainingPanel";

type VisualSubTab = "datasets" | "dna" | "training";

const SUB_TAB_LABELS: Record<VisualSubTab, string> = {
  datasets: "图片数据集",
  dna:      "角色外貌",
  training: "视觉训练",
};

type Props = {
  characterId: string;
};

export function VisualWorkspace({ characterId }: Props) {
  const [subTab, setSubTab] = useState<VisualSubTab>("datasets");

  return (
    <div className="flex flex-col gap-4 min-h-0 h-full">
      {/* Sub-tab bar */}
      <div className="flex gap-0 border-b border-zinc-800">
        {(Object.keys(SUB_TAB_LABELS) as VisualSubTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              subTab === tab
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {SUB_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {subTab === "datasets" && (
          <VisualDatasetPanel characterId={characterId} />
        )}
        {subTab === "dna" && (
          <VisualDNAPanel characterId={characterId} />
        )}
        {subTab === "training" && (
          <VisualTrainingPanel characterId={characterId} />
        )}
      </div>
    </div>
  );
}
