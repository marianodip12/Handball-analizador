"use client";
import React, { useState, useRef } from "react";
import { Type, Pen, Square, ArrowRight, Trash2, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import type { Annotation } from "@/types";

interface AnnotationEditorProps {
  annotations: Annotation[];
  currentTime: number;
  onAdd: (ann: Annotation) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Annotation>) => void;
}

export default function AnnotationEditor({
  annotations,
  currentTime,
  onAdd,
  onRemove,
  onUpdate,
}: AnnotationEditorProps) {
  const [open, setOpen] = useState(true);

  const visibleNow = annotations.filter(a =>
    a.duration === 0 ? currentTime >= a.timeIn : currentTime >= a.timeIn && currentTime < a.timeIn + a.duration
  );

  return (
    <div className="rounded-2xl bg-[#0d1117] border border-[#21262d] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#161b22] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Pen className="w-4 h-4 text-violet-400" />
          <span className="font-display font-semibold tracking-widest text-xs text-[#484f58] uppercase">
            Anotaciones
          </span>
          <span className="text-xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">
            {annotations.length}
          </span>
          {visibleNow.length > 0 && (
            <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
              {visibleNow.length} visibles
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-[#484f58]" /> : <ChevronDown className="w-4 h-4 text-[#484f58]" />}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          {annotations.length === 0 ? (
            <p className="text-[#484f58] font-mono text-xs text-center py-4">
              Sin anotaciones. Usá el editor de video para agregar.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {annotations.map(ann => {
                const isVisible = ann.duration === 0
                  ? currentTime >= ann.timeIn
                  : currentTime >= ann.timeIn && currentTime < ann.timeIn + ann.duration;
                const toolIcon =
                  ann.tool === "arrow" ? <ArrowRight className="w-3 h-3" /> :
                  ann.tool === "line"  ? <Square className="w-3 h-3" /> :
                  ann.tool === "text"  ? <Type className="w-3 h-3" /> :
                                         <Pen className="w-3 h-3" />;

                return (
                  <div key={ann.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-mono transition-all
                      ${isVisible ? "border-violet-500/40 bg-violet-500/10" : "border-[#21262d] bg-[#161b22]"}`}
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: ann.color }} />
                    <span className="text-[#8b949e]">{toolIcon}</span>
                    {ann.text && <span className="text-white truncate max-w-[100px]">&quot;{ann.text}&quot;</span>}
                    <span className="text-[#484f58] tabular-nums">
                      {Math.floor(ann.timeIn / 60).toString().padStart(2,"0")}:{Math.floor(ann.timeIn % 60).toString().padStart(2,"0")}
                    </span>
                    <span className="text-[#484f58]">{ann.duration === 0 ? "∞" : `${ann.duration}s`}</span>
                    {isVisible ? <Eye className="w-3 h-3 text-emerald-400 ml-auto" /> : <EyeOff className="w-3 h-3 text-[#484f58] ml-auto" />}
                    <button
                      onClick={() => onRemove(ann.id)}
                      className="text-[#484f58] hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
