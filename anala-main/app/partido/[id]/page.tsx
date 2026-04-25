"use client";
import React, { useRef, useCallback, useState } from "react";
import { Activity, ArrowLeft, Download, ChevronDown, ChevronUp, Pencil, Cloud } from "lucide-react";
import VideoPlayer, { VideoPlayerHandle } from "@/components/VideoPlayer";
import EventButtons from "@/components/EventButtons";
import EventList from "@/components/EventList";
import Scoreboard from "@/components/Scoreboard";
import PlayerPanel from "@/components/PlayerPanel";
import ClipEditor from "@/components/ClipEditor";
import ClipDrawingEditor from "@/components/ClipDrawingEditor";
import { usePartidos } from "@/hooks/usePartidos";
import type { EventTipo, EventSubtype, EventDetail, EventQualifier, EventResult, VideoMode, Score } from "@/types";

export default function PartidoPage({ params }: { params: { id: string } }) {
  const {
    partidos, addEvent, deleteEvent, updateEventResult,
    clearEvents, updateScore, addPlayer, removePlayer, updateClip, useCloud,
  } = usePartidos();
  const partido = partidos.find(p => p.id === params.id);

  const videoRef = useRef<VideoPlayerHandle>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [videoMode, setVideoMode] = useState<VideoMode>(null);
  const [showScore, setShowScore] = useState(true);
  const [showDrawEditor, setShowDrawEditor] = useState(false);
  const [editClipRange, setEditClipRange] = useState<{start: number; end: number} | null>(null);

  const openClipEditor = useCallback((start: number, end: number) => {
    setEditClipRange({ start, end });
    setShowDrawEditor(true);
  }, []);

  const handleEvent = useCallback((
    tipo: EventTipo, subtype: EventSubtype, detail: EventDetail, qualifier: EventQualifier,
    result: EventResult, playerId: string | null, playerName: string | null,
  ) => {
    const time = videoRef.current?.getCurrentTime() ?? 0;
    const fileIndex = (videoRef.current as { getActiveFileIndex?: () => number })?.getActiveFileIndex?.() ?? 0;
    addEvent(params.id, time, tipo, subtype, detail, qualifier, result, playerId, playerName, fileIndex);
  }, [addEvent, params.id]);

  const handleSeek = useCallback((time: number) => {
    videoRef.current?.seekTo(time);
  }, []);

  const handleExport = useCallback(() => {
    if (!partido) return;
    const blob = new Blob([JSON.stringify(partido, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${partido.nombre.replace(/\s+/g,"_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [partido]);

  if (!partido) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-[#00ff88]/30 border-t-[#00ff88] animate-spin" />
          <p className="text-[#484f58] font-mono text-sm">Cargando partido...</p>
          <a href="/" className="text-xs text-[#484f58] hover:text-white font-mono underline">← Volver al inicio</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080b0f]">
      {/* Header */}
      <header className="border-b border-[#21262d] bg-[#0d1117]/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 text-[#484f58] hover:text-white transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-mono text-xs hidden sm:block">INICIO</span>
          </a>
          <div className="w-px h-5 bg-[#30363d]" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Activity className="w-4 h-4 text-[#00ff88] shrink-0" />
            <span className="font-display font-bold text-white tracking-wide truncate text-sm">{partido.nombre}</span>
            {(partido.equipoLocal || partido.equipoVisitante) && (
              <span className="text-[#484f58] font-mono text-xs hidden md:block shrink-0">
                {partido.equipoLocal} vs {partido.equipoVisitante}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Cloud sync indicator */}
            <div title={useCloud ? "Guardado en Supabase" : "Guardado localmente"}
              className={`flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-lg border ${useCloud ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-[#484f58] border-[#21262d]"}`}>
              <Cloud className="w-3 h-3" />
              <span className="hidden sm:block">{useCloud ? "Cloud" : "Local"}</span>
            </div>

            {/* Draw editor button */}
            {videoMode === "local" && (
              <button onClick={() => setShowDrawEditor(true)}
                className="flex items-center gap-1.5 text-xs font-mono text-violet-400 hover:text-violet-300 border border-violet-500/30 hover:border-violet-500/50 px-3 py-1.5 rounded-lg bg-violet-500/10 transition-all">
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:block">EDITOR</span>
              </button>
            )}

            {partido.events.length > 0 && (
              <button onClick={handleExport}
                className="flex items-center gap-1.5 text-xs font-mono text-[#8b949e] hover:text-white border border-[#30363d] hover:border-[#484f58] px-3 py-1.5 rounded-lg bg-[#161b22] transition-all">
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:block">EXPORTAR</span>
              </button>
            )}
            <div className="px-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded-lg font-display font-black text-[#00ff88] text-sm tabular-nums">
              {partido.score.local} : {partido.score.visitante}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        {/* Left column */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Video — sticky below the header on mobile so it stays visible while scrolling */}
          <section className="rounded-2xl bg-[#0d1117] border border-[#21262d] p-2 sm:p-4 sticky top-[60px] z-30 xl:relative xl:top-auto xl:z-auto shadow-2xl xl:shadow-none -mx-4 sm:mx-0 rounded-none sm:rounded-2xl">
            <VideoPlayer ref={videoRef} onModeChange={setVideoMode} partidoId={params.id} />

            {/* Floating "Editar" button — opens drawing editor directly */}
            {videoMode === "local" && (
              <button
                onClick={() => { setEditClipRange(null); setShowDrawEditor(true); }}
                className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full bg-violet-500/90 hover:bg-violet-500 backdrop-blur text-white text-xs font-bold shadow-lg shadow-violet-500/40 transition-all">
                <Pencil className="w-3.5 h-3.5" />
                Editar video
              </button>
            )}
          </section>

          {/* Scoreboard */}
          <section className="rounded-2xl bg-[#0d1117] border border-[#21262d] overflow-hidden">
            <button onClick={() => setShowScore(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#161b22] transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏆</span>
                <span className="font-display font-semibold tracking-widest text-xs text-[#484f58] uppercase">Marcador</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-display font-black text-white text-lg tabular-nums">
                  {partido.score.local} — {partido.score.visitante}
                </span>
                {showScore ? <ChevronUp className="w-4 h-4 text-[#484f58]" /> : <ChevronDown className="w-4 h-4 text-[#484f58]" />}
              </div>
            </button>
            {showScore && (
              <div className="px-4 pb-4">
                <Scoreboard
                  equipoLocal={partido.equipoLocal}
                  equipoVisitante={partido.equipoVisitante}
                  score={partido.score}
                  onScore={(s: Score) => updateScore(params.id, s)}
                />
              </div>
            )}
          </section>

          {/* Players */}
          <PlayerPanel
            players={partido.players}
            onAdd={(name, number) => addPlayer(params.id, name, number)}
            onRemove={id => removePlayer(params.id, id)}
          />

          {/* Event buttons */}
          <section className="rounded-2xl bg-[#0d1117] border border-[#21262d] p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-400 text-sm">⚡</span>
              <span className="font-display font-semibold tracking-widest text-xs text-[#484f58] uppercase">Marcar Evento</span>
              {!videoMode && <span className="text-xs font-mono text-[#484f58] ml-auto">Cargá un video primero</span>}
            </div>
            <EventButtons
              players={partido.players}
              onEvent={handleEvent}
              disabled={!videoMode}
            />
          </section>

          {/* Clip editor panel */}
          <ClipEditor
            events={partido.events}
            playerRef={videoRef}
            onUpdateClip={(eventId, start, end) => updateClip(params.id, eventId, start, end)}
            onEditClip={videoMode === "local" ? openClipEditor : undefined}
          />

          {/* Event list mobile */}
          <section className="rounded-2xl bg-[#0d1117] border border-[#21262d] p-4 xl:hidden">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-display font-semibold tracking-widest text-xs text-[#484f58] uppercase">Timeline</span>
            </div>
            <EventList
              events={partido.events}
              players={partido.players}
              onSeek={handleSeek}
              onDelete={id => deleteEvent(params.id, id)}
              onUpdateResult={(id, r) => updateEventResult(params.id, id, r)}
              onClearAll={() => { if(confirm("¿Borrar todos los eventos?")) clearEvents(params.id); }}
            />
          </section>
        </div>

        {/* Right column — desktop */}
        <aside className="hidden xl:flex flex-col gap-4">
          <section className="rounded-2xl bg-[#0d1117] border border-[#21262d] p-4 flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-display font-semibold tracking-widest text-xs text-[#484f58] uppercase">Timeline de Eventos</span>
            </div>
            <EventList
              events={partido.events}
              players={partido.players}
              onSeek={handleSeek}
              onDelete={id => deleteEvent(params.id, id)}
              onUpdateResult={(id, r) => updateEventResult(params.id, id, r)}
              onClearAll={() => { if(confirm("¿Borrar todos los eventos?")) clearEvents(params.id); }}
            />
          </section>

          <div className="rounded-xl border border-[#21262d] bg-[#0d1117] p-4">
            <p className="font-display font-semibold text-xs tracking-widest text-[#484f58] mb-3 uppercase">Editor de clips</p>
            <ol className="flex flex-col gap-2">
              {[
                "Cada evento guarda automáticamente clip_start (−5s) y clip_end",
                "Click en Preview → va al inicio del clip",
                "← INICIO AQUÍ → fija el inicio en el tiempo actual",
                "FIN AQUÍ → → reproducí hasta donde querés → Confirmar fin",
                "Seleccioná clips y exportá con comandos FFmpeg incluidos",
              ].map((s, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-[#161b22] border border-[#30363d] flex items-center justify-center font-mono text-[9px] text-[#484f58] font-bold mt-0.5">{i+1}</span>
                  <span className="text-[#8b949e] text-xs leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </main>

      {/* Drawing / Clip Editor overlay */}
      {showDrawEditor && (
        <ClipDrawingEditor
          localFile={videoRef.current?.getLocalFile() ?? null}
          initialTime={editClipRange?.start ?? (videoRef.current?.getCurrentTime() ?? 0)}
          clipRange={editClipRange}
          events={partido.events}
          onClose={() => { setShowDrawEditor(false); setEditClipRange(null); }}
        />
      )}
    </div>
  );
}
