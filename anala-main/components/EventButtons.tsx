"use client";
import React, { useState, useCallback, useMemo } from "react";
import { Users, X, ChevronRight } from "lucide-react";
import { EVENT_CONFIGS, EVENT_TREE, getEventConfig } from "@/types";
import type { EventTipo, EventSubtype, EventDetail, EventQualifier, EventResult, Player, EventNode } from "@/types";

interface EventButtonsProps {
  players: Player[];
  onEvent: (
    tipo: EventTipo,
    subtype: EventSubtype,
    detail: EventDetail,
    qualifier: EventQualifier,
    result: EventResult,
    playerId: string | null,
    playerName: string | null,
  ) => void;
  disabled?: boolean;
}

interface Pending {
  tipo: EventTipo;
  subtype: EventSubtype;
  detail: EventDetail;
  qualifier: EventQualifier;
}

export default function EventButtons({ players, onEvent, disabled = false }: EventButtonsProps) {
  const [showModal, setShowModal] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [showPlayerStep, setShowPlayerStep] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [playerSearch, setPlayerSearch] = useState("");

  // Find the node tree for the currently-pending event
  const tipoNode = useMemo<EventNode | null>(() => {
    if (!pending) return null;
    return EVENT_TREE.find(n => n.label === pending.tipo) ?? null;
  }, [pending]);

  const subtypeNode = useMemo<EventNode | null>(() => {
    if (!pending || !tipoNode || !pending.subtype) return null;
    return tipoNode.children?.find(n => n.label === pending.subtype) ?? null;
  }, [pending, tipoNode]);

  const detailNode = useMemo<EventNode | null>(() => {
    if (!pending || !subtypeNode || !pending.detail) return null;
    return subtypeNode.children?.find(n => n.label === pending.detail) ?? null;
  }, [pending, subtypeNode]);

  const doFlash = (tipo: EventTipo) => {
    setFlash(tipo);
    setTimeout(() => setFlash(null), 500);
  };

  // Top-level click → open modal or fire if leaf
  const handleTipoClick = useCallback((tipo: EventTipo) => {
    const node = EVENT_TREE.find(n => n.label === tipo);
    if (!node?.children || node.children.length === 0) {
      // Leaf at level 1 (Gol, Gol rival) → ask player only
      setPending({ tipo, subtype: null, detail: null, qualifier: null });
      setShowPlayerStep(true);
      return;
    }
    setPending({ tipo, subtype: null, detail: null, qualifier: null });
    setShowModal(true);
  }, []);

  const handleSelectChild = useCallback((node: EventNode) => {
    if (!pending) return;

    const newPending: Pending = (() => {
      if (!pending.subtype)        return { ...pending, subtype: node.label };
      if (!pending.detail)         return { ...pending, detail: node.label };
      // qualifier
      return { ...pending, qualifier: node.label as EventQualifier };
    })();

    setPending(newPending);

    // Determine if we've reached a leaf
    const findReachedNode = (): EventNode | null => {
      let cur: EventNode | undefined = EVENT_TREE.find(n => n.label === newPending.tipo);
      if (!cur) return null;
      if (newPending.subtype)   cur = cur.children?.find(c => c.label === newPending.subtype);
      if (!cur) return null;
      if (newPending.detail)    cur = cur.children?.find(c => c.label === newPending.detail);
      if (!cur) return null;
      if (newPending.qualifier) cur = cur.children?.find(c => c.label === newPending.qualifier);
      return cur ?? null;
    };

    const reached = findReachedNode();
    if (!reached?.children || reached.children.length === 0) {
      // Leaf reached → close hierarchy modal, ask player
      setShowModal(false);
      setShowPlayerStep(true);
    }
  }, [pending]);

  const handleFire = useCallback((playerId: string | null, playerName: string | null) => {
    if (!pending) return;
    onEvent(pending.tipo, pending.subtype, pending.detail, pending.qualifier, null, playerId, playerName);
    doFlash(pending.tipo);
    setPending(null);
    setShowModal(false);
    setShowPlayerStep(false);
    setSelectedPlayer("");
    setPlayerSearch("");
  }, [pending, onEvent]);

  const handlePlayerConfirm = () => {
    if (!selectedPlayer) {
      handleFire(null, null);
    } else {
      const player = players.find(p => p.id === selectedPlayer);
      handleFire(selectedPlayer, player?.name ?? null);
    }
  };

  const cancel = () => {
    setPending(null);
    setShowModal(false);
    setShowPlayerStep(false);
    setSelectedPlayer("");
    setPlayerSearch("");
  };

  const goBack = () => {
    if (!pending) return;
    if (pending.qualifier) setPending({ ...pending, qualifier: null });
    else if (pending.detail) setPending({ ...pending, detail: null });
    else if (pending.subtype) setPending({ ...pending, subtype: null });
    else cancel();
  };

  const filteredPlayers = players.filter(p =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  // What children should we show next?
  const childrenToShow: EventNode[] = useMemo(() => {
    if (!pending) return [];
    if (!pending.subtype)   return tipoNode?.children ?? [];
    if (!pending.detail)    return subtypeNode?.children ?? [];
    if (!pending.qualifier) return detailNode?.children ?? [];
    return [];
  }, [pending, tipoNode, subtypeNode, detailNode]);

  // Color for the current tipo
  const tipoCfg = pending ? getEventConfig(pending.tipo) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Top-level event buttons ────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {EVENT_CONFIGS.map(cfg => {
          const isFlashing = flash === cfg.tipo;
          const isBinary = cfg.category === "binary";
          return (
            <button
              key={cfg.tipo}
              disabled={disabled}
              onClick={() => handleTipoClick(cfg.tipo)}
              className={`flex flex-col items-center gap-1.5 py-4 rounded-xl border font-display font-semibold transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:scale-95 ${cfg.bgColor} ${cfg.borderColor} ${isFlashing ? `ring-2 ${cfg.ringColor} scale-95` : ""} ${isBinary ? "shadow-lg" : ""}`}
            >
              <span style={{ fontSize: "1.8rem", lineHeight: 1 }}>{cfg.emoji}</span>
              <span className={`text-center leading-tight ${cfg.color}`} style={{ fontSize: "0.65rem", letterSpacing: "0.05em" }}>
                {cfg.shortLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Hierarchy modal ─────────────────────────────────────── */}
      {showModal && pending && tipoCfg && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={cancel}>
          <div
            className={`w-full max-w-2xl bg-[#0d1117] border ${tipoCfg.borderColor} rounded-2xl overflow-hidden shadow-2xl`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header with breadcrumb */}
            <div className="px-5 py-4 border-b border-[#21262d] flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="text-2xl">{tipoCfg.emoji}</span>
                <span className={`font-bold ${tipoCfg.color}`}>{pending.tipo}</span>
                {pending.subtype && <>
                  <ChevronRight className="w-4 h-4 text-[#484f58]" />
                  <span className="text-white">{pending.subtype}</span>
                </>}
                {pending.detail && <>
                  <ChevronRight className="w-4 h-4 text-[#484f58]" />
                  <span className="text-white">{pending.detail}</span>
                </>}
              </div>
              <button onClick={cancel} className="text-[#484f58] hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Children buttons */}
            <div className="p-5">
              <p className="text-xs font-mono text-[#484f58] uppercase tracking-widest mb-3">
                {!pending.subtype && "Elegí la categoría"}
                {pending.subtype && !pending.detail && "Elegí el detalle"}
                {pending.detail && !pending.qualifier && "Elegí cómo fue"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {childrenToShow.map(node => (
                  <button
                    key={node.label}
                    onClick={() => handleSelectChild(node)}
                    className={`group p-4 rounded-xl ${tipoCfg.bgColor} border ${tipoCfg.borderColor} text-left transition-all active:scale-95 hover:scale-[1.02]`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-semibold ${tipoCfg.color}`}>{node.label}</span>
                      {node.children && node.children.length > 0 && (
                        <ChevronRight className={`w-4 h-4 ${tipoCfg.color} opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all`} />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#21262d] flex justify-between items-center">
              <button onClick={goBack} className="text-[#8b949e] hover:text-white text-sm font-mono">
                ← Atrás
              </button>
              <button onClick={cancel} className="text-[#8b949e] hover:text-red-400 text-sm font-mono">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Player step ────────────────────────────────────────── */}
      {showPlayerStep && pending && tipoCfg && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={cancel}>
          <div
            className={`w-full max-w-md bg-[#0d1117] border ${tipoCfg.borderColor} rounded-2xl overflow-hidden shadow-2xl`}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#21262d] flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Users className={`w-4 h-4 ${tipoCfg.color}`} />
                <span className={`font-bold ${tipoCfg.color}`}>{pending.tipo}</span>
                {pending.subtype && <span className="text-[#8b949e]">· {pending.subtype}</span>}
                {pending.detail && <span className="text-[#8b949e]">· {pending.detail}</span>}
                {pending.qualifier && <span className="text-[#8b949e]">· {pending.qualifier}</span>}
              </div>
              <button onClick={cancel} className="text-[#484f58] hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              <p className="text-xs font-mono text-[#484f58] uppercase tracking-widest mb-3">
                ¿Qué jugador?
              </p>

              {players.length > 0 ? (
                <>
                  <input
                    type="text"
                    placeholder="Buscar jugador..."
                    value={playerSearch}
                    onChange={e => setPlayerSearch(e.target.value)}
                    autoFocus
                    className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-cyan-500/50 mb-2"
                  />
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-[#21262d] divide-y divide-[#21262d] mb-3">
                    {filteredPlayers.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPlayer(p.id); }}
                        className={`w-full text-left px-3 py-2 hover:bg-[#161b22] font-mono text-sm transition-colors flex items-center gap-2 ${selectedPlayer === p.id ? "bg-cyan-500/15 text-cyan-300" : "text-white"}`}
                      >
                        {p.number && <span className="text-[#484f58] text-xs">#{p.number}</span>}
                        {p.name}
                      </button>
                    ))}
                    {filteredPlayers.length === 0 && (
                      <div className="px-3 py-2 text-[#484f58] text-xs">Sin resultados</div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handlePlayerConfirm} disabled={!selectedPlayer}
                      className="flex-1 py-2.5 bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-cyan-400 font-bold tracking-widest text-sm transition-all active:scale-95">
                      CONFIRMAR
                    </button>
                    <button onClick={() => handleFire(null, null)}
                      className="px-4 py-2.5 bg-[#21262d] border border-[#30363d] hover:bg-[#30363d] rounded-lg text-[#8b949e] font-mono text-sm transition-all">
                      Sin jugador
                    </button>
                  </div>
                </>
              ) : (
                <button onClick={() => handleFire(null, null)}
                  className="w-full py-3 bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/25 rounded-lg text-cyan-400 font-bold tracking-widest text-sm transition-all active:scale-95">
                  REGISTRAR EVENTO
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
