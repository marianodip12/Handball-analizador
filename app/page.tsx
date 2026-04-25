"use client";
import React, { useState } from "react";
import { Activity, Plus, Trash2, Play, Calendar, Users, Cloud } from "lucide-react";
import { usePartidos } from "@/hooks/usePartidos";

function formatDate(str: string) {
  if (!str) return "";
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

export default function HomePage() {
  const { partidos, crearPartido, borrarPartido, useCloud } = usePartidos();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombre: "", equipoLocal: "", equipoVisitante: "", fecha: new Date().toISOString().slice(0, 10) });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    const p = crearPartido(form.nombre, form.equipoLocal, form.equipoVisitante, form.fecha);
    window.location.href = `/partido/${p.id}`;
  };

  return (
    <div className="min-h-screen bg-[#080b0f]">
      {/* Header */}
      <header className="border-b border-[#21262d] bg-[#0d1117]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 flex items-center justify-center">
            <Activity className="w-4 h-4 text-[#00ff88]" />
          </div>
          <span className="font-display font-bold text-white tracking-widest text-lg">SPORTTAG</span>
          <span className="text-[#484f58] font-mono text-xs hidden sm:block">Futsal Analysis</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
        {/* Hero */}
        <div className="text-center py-6">
          <p className="text-5xl mb-3">⚽</p>
          <h1 className="font-display font-black text-white text-3xl tracking-widest uppercase mb-2">Tus Partidos</h1>
          <p className="text-[#8b949e] font-mono text-sm">Analizá video, marcá eventos y revisá el juego de tu equipo</p>
        </div>

        {/* New match button */}
        {!showForm ? (
          <button onClick={() => setShowForm(true)}
            className="flex items-center justify-center gap-3 w-full p-4 rounded-2xl border-2 border-dashed border-[#30363d] hover:border-[#00ff88]/50 hover:bg-[#00ff88]/5 text-[#484f58] hover:text-[#00ff88] transition-all group">
            <Plus className="w-5 h-5" />
            <span className="font-display font-semibold tracking-widest uppercase">Nuevo Partido</span>
          </button>
        ) : (
          <form onSubmit={handleCreate} className="flex flex-col gap-4 p-5 rounded-2xl bg-[#0d1117] border border-[#00ff88]/30">
            <h2 className="font-display font-bold text-white tracking-widest text-sm uppercase flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#00ff88]" /> Nuevo Partido
            </h2>
            <input
              type="text" placeholder="Nombre del partido (ej: vs Halcones - Liga)" required
              value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-2.5 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-[#00ff88]/50 transition-colors"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text" placeholder="Equipo local"
                value={form.equipoLocal} onChange={e => setForm(f => ({ ...f, equipoLocal: e.target.value }))}
                className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-2.5 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-[#00ff88]/50 transition-colors"
              />
              <input
                type="text" placeholder="Equipo visitante"
                value={form.equipoVisitante} onChange={e => setForm(f => ({ ...f, equipoVisitante: e.target.value }))}
                className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-2.5 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-[#00ff88]/50 transition-colors"
              />
            </div>
            <input
              type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
              className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#00ff88]/50 transition-colors w-full"
            />
            <div className="flex gap-3">
              <button type="submit"
                className="flex-1 py-2.5 bg-[#00ff88]/10 border border-[#00ff88]/40 hover:bg-[#00ff88]/20 rounded-lg text-[#00ff88] font-display font-bold tracking-widest uppercase text-sm transition-all">
                CREAR Y ANALIZAR
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2.5 bg-[#161b22] border border-[#30363d] hover:bg-[#21262d] rounded-lg text-[#8b949e] font-mono text-sm transition-all">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Partidos list */}
        {partidos.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <p className="text-[#484f58] font-mono text-xs tracking-widest">HISTORIAL — {partidos.length} partidos</p>
              <div className={`flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border ${useCloud ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-[#484f58] border-[#21262d]"}`}>
                <Cloud className="w-3 h-3" />
                {useCloud ? "Supabase" : "Local"}
              </div>
            </div>
            {partidos.map(p => (
              <div key={p.id}
                className="group flex items-center gap-4 p-4 rounded-2xl bg-[#0d1117] border border-[#21262d] hover:border-[#30363d] transition-all">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-white tracking-wide truncate">{p.nombre}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {(p.equipoLocal || p.equipoVisitante) && (
                      <span className="flex items-center gap-1 text-xs text-[#8b949e] font-mono">
                        <Users className="w-3 h-3" />
                        {p.equipoLocal || "Local"} vs {p.equipoVisitante || "Visitante"}
                      </span>
                    )}
                    {p.fecha && (
                      <span className="flex items-center gap-1 text-xs text-[#484f58] font-mono">
                        <Calendar className="w-3 h-3" />
                        {formatDate(p.fecha)}
                      </span>
                    )}
                    <span className="text-xs text-[#484f58] font-mono">
                      {p.events.length} eventos
                    </span>
                  </div>
                </div>

                {/* Score */}
                <div className="font-display font-black text-white text-xl tabular-nums shrink-0">
                  {p.score.local} : {p.score.visitante}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <a href={`/partido/${p.id}`}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[#00ff88]/10 border border-[#00ff88]/30 hover:bg-[#00ff88]/20 rounded-lg text-[#00ff88] text-xs font-mono transition-all">
                    <Play className="w-3 h-3" /> ABRIR
                  </a>
                  <button onClick={() => { if (confirm(`¿Borrar "${p.nombre}"?`)) borrarPartido(p.id); }}
                    className="opacity-0 group-hover:opacity-100 p-2 text-[#484f58] hover:text-rose-400 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {partidos.length === 0 && !showForm && (
          <div className="text-center py-8 text-[#30363d] font-mono text-xs">
            No hay partidos guardados todavía
          </div>
        )}
      </main>
    </div>
  );
}
