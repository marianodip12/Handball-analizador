"use client";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Trash2, Check, X, Minus, ListVideo, ChevronDown, BarChart2 } from "lucide-react";
import { getEventConfig, getEventCategory, EVENT_TREE } from "@/types";
import type { SportEvent, EventResult, Player } from "@/types";

interface EventListProps {
  events: SportEvent[];
  players: Player[];
  onSeek: (time: number) => void;
  onDelete: (id: string) => void;
  onUpdateResult: (id: string, result: EventResult) => void;
  onClearAll: () => void;
}

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ds = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${ds}`;
}

function ResultBadge({ result, onClick }: { result: EventResult; onClick: () => void }) {
  const base = "flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded cursor-pointer hover:opacity-75 transition-opacity";
  if (result === "correcto")   return <span className={`${base} bg-green-500/15 border border-green-500/30 text-green-400`}   onClick={onClick}><Check className="w-3 h-3"/>OK</span>;
  if (result === "incorrecto") return <span className={`${base} bg-rose-500/15 border border-rose-500/30 text-rose-400`}     onClick={onClick}><X className="w-3 h-3"/>ERR</span>;
  return <span className={`${base} bg-[#161b22] border border-[#30363d] text-[#484f58]`} onClick={onClick}><Minus className="w-3 h-3"/>—</span>;
}

function SubtypeBadge({ subtype }: { subtype: string | null }) {
  if (!subtype) return null;
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-cyan-500/10 border-cyan-500/20 text-cyan-300">
      {subtype}
    </span>
  );
}

function DetailBadge({ detail, qualifier }: { detail: string | null; qualifier: string | null | undefined }) {
  if (!detail && !qualifier) return null;
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-violet-500/10 border-violet-500/20 text-violet-300">
      {detail}{qualifier ? ` · ${qualifier}` : ""}
    </span>
  );
}

type Filter = { tipo: string; subtype: string; result: string; player: string };

export default function EventList({ events, players, onSeek, onDelete, onUpdateResult, onClearAll }: EventListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(events.length);
  const [filter, setFilter] = useState<Filter>({ tipo: "", subtype: "", result: "", player: "" });
  const [sortBy, setSortBy] = useState<"time" | "player">("time");
  const [showMetrics, setShowMetrics] = useState(false);

  useEffect(() => {
    if (events.length > prevLen.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    prevLen.current = events.length;
  }, [events.length]);

  const filtered = useMemo(() => {
    let list = [...events];
    if (filter.tipo)    list = list.filter(e => e.tipo === filter.tipo);
    if (filter.subtype) list = list.filter(e => e.subtype === filter.subtype);
    if (filter.result)  list = list.filter(e => (e.result ?? e.resultado ?? null) === filter.result);
    if (filter.player)  list = list.filter(e => e.player_id === filter.player);
    if (sortBy === "player") list.sort((a,b) => (a.player_name??"")<(b.player_name??"") ? -1 : 1);
    return list;
  }, [events, filter, sortBy]);

  // Metrics
  const metrics = useMemo(() => {
    const byPlayer: Record<string, { name: string; total: number; ok: number; err: number }> = {};
    events.forEach(e => {
      const key = e.player_id ?? "__none__";
      const name = e.player_name ?? "Sin jugador";
      if (!byPlayer[key]) byPlayer[key] = { name, total: 0, ok: 0, err: 0 };
      byPlayer[key].total++;
      const r = e.result ?? e.resultado ?? null;
      if (r === "correcto")   byPlayer[key].ok++;
      if (r === "incorrecto") byPlayer[key].err++;
    });
    return Object.values(byPlayer).sort((a,b) => b.total - a.total);
  }, [events]);

  const uniqueTipos = Array.from(new Set(events.map(e => e.tipo)));

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-[#161b22] border border-[#30363d] flex items-center justify-center">
          <ListVideo className="w-5 h-5 text-[#484f58]" />
        </div>
        <div>
          <p className="text-[#8b949e] font-display font-semibold tracking-wide text-sm">SIN EVENTOS</p>
          <p className="text-[#484f58] text-xs font-mono mt-1">Marcá acciones mientras reproducís el video</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-bold text-white tracking-widest text-sm">
            {filtered.length}/{events.length} EVENTOS
          </span>
          <span className="text-xs font-mono px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded text-green-400">
            ✓ {events.filter(e => (e.result??e.resultado) === "correcto").length}
          </span>
          <span className="text-xs font-mono px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded text-rose-400">
            ✗ {events.filter(e => (e.result??e.resultado) === "incorrecto").length}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowMetrics(m => !m)}
            className={`flex items-center gap-1 text-xs font-mono px-2.5 py-1.5 rounded-lg border transition-colors ${showMetrics ? "bg-violet-500/15 border-violet-500/30 text-violet-400" : "bg-[#161b22] border-[#30363d] text-[#484f58] hover:text-white"}`}>
            <BarChart2 className="w-3.5 h-3.5" /> MÉTRICAS
          </button>
          <button onClick={() => { if(confirm("¿Borrar todos?")) onClearAll(); }}
            className="flex items-center gap-1 text-xs text-[#484f58] hover:text-rose-400 font-mono transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> LIMPIAR
          </button>
        </div>
      </div>

      {/* Metrics panel */}
      {showMetrics && metrics.length > 0 && (
        <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-3 flex flex-col gap-2">
          <p className="text-[10px] font-mono text-[#484f58] uppercase tracking-widest">Efectividad por jugador</p>
          {metrics.map(m => {
            const pct = m.total > 0 ? Math.round((m.ok / m.total) * 100) : 0;
            return (
              <div key={m.name} className="flex items-center gap-2">
                <span className="text-white font-mono text-xs w-28 truncate">{m.name}</span>
                <div className="flex-1 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-mono text-[#8b949e] w-20 text-right">
                  {pct}% · {m.ok}✓ {m.err}✗ / {m.total}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1.5 flex-wrap">
        <select value={filter.tipo} onChange={e => setFilter(f=>({...f, tipo: e.target.value}))}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-[#484f58] transition-colors">
          <option value="">Todos los tipos</option>
          {uniqueTipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {filter.tipo && (() => {
          const node = EVENT_TREE.find(n => n.label === filter.tipo);
          const subtypes: string[] = node?.children?.map(c => c.label) ?? [];
          if (subtypes.length === 0) return null;
          return (
            <select value={filter.subtype} onChange={e => setFilter(f=>({...f, subtype: e.target.value}))}
              className="bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-[#484f58] transition-colors">
              <option value="">Todos los subtipos</option>
              {subtypes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          );
        })()}

        <select value={filter.result} onChange={e => setFilter(f=>({...f, result: e.target.value}))}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-[#484f58] transition-colors">
          <option value="">OK / ERR</option>
          <option value="correcto">✓ Correcto</option>
          <option value="incorrecto">✗ Incorrecto</option>
        </select>

        {players.length > 0 && (
          <select value={filter.player} onChange={e => setFilter(f=>({...f, player: e.target.value}))}
            className="bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-[#484f58] transition-colors">
            <option value="">Todos los jugadores</option>
            {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <select value={sortBy} onChange={e => setSortBy(e.target.value as "time"|"player")}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-[#484f58] transition-colors">
          <option value="time">Orden: Tiempo</option>
          <option value="player">Orden: Jugador</option>
        </select>

        {(filter.tipo || filter.subtype || filter.result || filter.player) && (
          <button onClick={() => setFilter({ tipo:"", subtype:"", result:"", player:"" })}
            className="text-xs font-mono text-[#484f58] hover:text-white px-2 py-1 rounded-lg bg-[#161b22] border border-[#30363d] transition-colors">
            ✕ limpiar filtros
          </button>
        )}
      </div>

      {/* Event rows */}
      <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto pr-1 custom-scroll">
        {filtered.map((event, idx) => {
          const cfg = getEventConfig(event.tipo);
          const result = event.result ?? event.resultado ?? null;
          const cycleResult = () => {
            const next: EventResult = result === null ? "correcto" : result === "correcto" ? "incorrecto" : null;
            onUpdateResult(event.id, next);
          };
          return (
            <div key={event.id}
              className="group flex items-center gap-2 px-3 py-2 rounded-xl bg-[#161b22] border border-[#21262d] hover:border-[#30363d] transition-all animate-slide-in">
              <span className="text-[#30363d] font-mono text-xs w-4 shrink-0 text-right">{idx+1}</span>

              {/* Seek */}
              <button onClick={() => onSeek(Math.max(0, event.clip_start ?? event.time - 5))}
                className="font-mono text-sm tabular-nums text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 w-16"
                title="Ir a este momento">
                {fmt(event.time)}
              </button>

              {/* Emoji */}
              <span style={{fontSize:"1rem"}} className="shrink-0">{cfg.emoji}</span>

              {/* Tipo */}
              <span className={`font-display font-semibold ${cfg.color} truncate flex-1 min-w-0`}
                style={{fontSize:"0.62rem", letterSpacing:"0.05em"}}>
                {event.tipo.toUpperCase()}
              </span>

              {/* Subtype */}
              <SubtypeBadge subtype={event.subtype ?? null} />
              <DetailBadge detail={event.detail ?? null} qualifier={event.qualifier ?? null} />

              {/* Player */}
              {event.player_name && (
                <span className="text-xs font-mono text-cyan-400 truncate max-w-[60px] shrink-0">
                  {event.player_name}
                </span>
              )}

              {/* Result */}
              <div className="shrink-0">
                <ResultBadge result={result} onClick={cycleResult} />
              </div>

              {/* Delete */}
              <button onClick={() => onDelete(event.id)}
                className="opacity-0 group-hover:opacity-100 text-[#30363d] hover:text-rose-400 transition-all shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-[#484f58] font-mono text-xs py-6">Sin eventos con estos filtros</p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
