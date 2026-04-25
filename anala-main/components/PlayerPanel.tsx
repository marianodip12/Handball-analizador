"use client";
import React, { useState } from "react";
import { Users, Plus, Trash2, X } from "lucide-react";
import type { Player } from "@/types";

interface PlayerPanelProps {
  players: Player[];
  onAdd: (name: string, number?: string) => void;
  onRemove: (id: string) => void;
}

export default function PlayerPanel({ players, onAdd, onRemove }: PlayerPanelProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim(), number.trim() || undefined);
    setName(""); setNumber("");
  };

  return (
    <div className="rounded-2xl bg-[#0d1117] border border-[#21262d] overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#161b22] transition-colors">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="font-display font-semibold tracking-widest text-xs text-[#484f58] uppercase">
            Jugadores
          </span>
          <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
            {players.length}
          </span>
        </div>
        <span className="text-[#484f58] text-xs font-mono">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {/* Add form */}
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="text" placeholder="#" value={number} onChange={e => setNumber(e.target.value)}
              className="w-12 bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-2 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-cyan-500/50 transition-colors text-center"
            />
            <input
              type="text" placeholder="Nombre del jugador" value={name} onChange={e => setName(e.target.value)}
              className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            <button type="submit"
              className="p-2 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 rounded-lg text-cyan-400 transition-all">
              <Plus className="w-4 h-4" />
            </button>
          </form>

          {/* Player list */}
          {players.length === 0 ? (
            <p className="text-[#484f58] font-mono text-xs text-center py-2">Sin jugadores. Agregá uno arriba.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto custom-scroll">
              {players.map(p => (
                <div key={p.id} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#161b22] border border-[#21262d]">
                  {p.number && <span className="text-[#484f58] font-mono text-xs">#{p.number}</span>}
                  <span className="text-white font-mono text-sm flex-1">{p.name}</span>
                  <button onClick={() => onRemove(p.id)}
                    className="opacity-0 group-hover:opacity-100 text-[#484f58] hover:text-rose-400 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
