"use client";
import React from "react";
import { Plus, Minus } from "lucide-react";
import type { Score } from "@/types";

interface ScoreboardProps {
  equipoLocal: string;
  equipoVisitante: string;
  score: Score;
  onScore: (score: Score) => void;
}

export default function Scoreboard({ equipoLocal, equipoVisitante, score, onScore }: ScoreboardProps) {
  const change = (team: "local" | "visitante", delta: number) => {
    const next = { ...score, [team]: Math.max(0, score[team] + delta) };
    onScore(next);
  };

  return (
    <div className="flex items-center justify-center gap-4 p-4 bg-[#0d1117] rounded-2xl border border-[#21262d]">
      {/* Local */}
      <div className="flex flex-col items-center gap-2 flex-1">
        <span className="font-display font-bold text-white tracking-widest text-xs uppercase truncate max-w-[120px] text-center">
          {equipoLocal || "Local"}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => change("local", -1)}
            className="w-8 h-8 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-rose-500/50 hover:text-rose-400 text-[#8b949e] flex items-center justify-center transition-all active:scale-90"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-display font-black text-5xl text-white tabular-nums w-14 text-center">
            {score.local}
          </span>
          <button
            onClick={() => change("local", 1)}
            className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/40 hover:bg-emerald-500/20 text-emerald-400 flex items-center justify-center transition-all active:scale-90"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Separator */}
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[#30363d] font-black text-3xl">:</span>
        <span className="text-[10px] font-mono text-[#30363d] tracking-widest">VS</span>
      </div>

      {/* Visitante */}
      <div className="flex flex-col items-center gap-2 flex-1">
        <span className="font-display font-bold text-white tracking-widest text-xs uppercase truncate max-w-[120px] text-center">
          {equipoVisitante || "Visitante"}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => change("visitante", -1)}
            className="w-8 h-8 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-rose-500/50 hover:text-rose-400 text-[#8b949e] flex items-center justify-center transition-all active:scale-90"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-display font-black text-5xl text-white tabular-nums w-14 text-center">
            {score.visitante}
          </span>
          <button
            onClick={() => change("visitante", 1)}
            className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/40 hover:bg-emerald-500/20 text-emerald-400 flex items-center justify-center transition-all active:scale-90"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
