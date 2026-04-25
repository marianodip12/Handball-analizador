"use client";
import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Partido, SportEvent, EventTipo, EventSubtype, EventDetail, EventQualifier, EventResult, Player, Score } from "@/types";
import { migrateEvent } from "@/types";
import { supabase } from "@/lib/supabase";

const LS_KEY = "sporttag-partidos-v3";

function migratePartido(raw: Record<string, unknown>): Partido {
  const p = raw as Partial<Partido>;
  return {
    id:               p.id               ?? uuidv4(),
    nombre:           p.nombre           ?? "",
    equipoLocal:      p.equipoLocal      ?? (raw.equipo_local as string ?? ""),
    equipoVisitante:  p.equipoVisitante  ?? (raw.equipo_visitante as string ?? ""),
    fecha:            p.fecha            ?? "",
    score:            p.score            ?? { local: 0, visitante: 0 },
    players:          p.players          ?? [],
    events:           (p.events ?? []).map(e => migrateEvent(e as SportEvent)),
    createdAt:        p.createdAt        ?? (raw.created_at as number ?? Date.now()),
  };
}

async function sbLoad(): Promise<Partido[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("partidos").select("*").order("created_at", { ascending: false });
  if (error) { console.error("[supabase] load:", error.message); return null; }
  return (data as Record<string, unknown>[]).map(migratePartido);
}

async function sbUpsert(p: Partido): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("partidos").upsert({
    id: p.id, nombre: p.nombre, equipo_local: p.equipoLocal,
    equipo_visitante: p.equipoVisitante, fecha: p.fecha,
    score: p.score, events: p.events, players: p.players, created_at: p.createdAt,
  });
  if (error) console.error("[supabase] upsert:", error.message);
}

async function sbDelete(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("partidos").delete().eq("id", id);
  if (error) console.error("[supabase] delete:", error.message);
}

export function usePartidos() {
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [useCloud, setUseCloud] = useState(false);

  useEffect(() => {
    (async () => {
      const cloud = await sbLoad();
      if (cloud !== null) {
        setPartidos(cloud); setUseCloud(true);
      } else {
        try {
          const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem("sporttag-partidos-v2");
          if (raw) setPartidos((JSON.parse(raw) as Record<string, unknown>[]).map(migratePartido));
        } catch {}
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded || useCloud) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(partidos)); } catch {}
  }, [partidos, loaded, useCloud]);

  const mutate = useCallback((fn: (prev: Partido[]) => Partido[], cloudFn?: (next: Partido[]) => Promise<void>) => {
    setPartidos(prev => {
      const next = fn(prev);
      if (useCloud && cloudFn) cloudFn(next).catch(console.error);
      return next;
    });
  }, [useCloud]);

  const crearPartido = useCallback((nombre: string, equipoLocal="", equipoVisitante="", fecha=""): Partido => {
    const p: Partido = { id: uuidv4(), nombre, equipoLocal, equipoVisitante, fecha, score: { local:0, visitante:0 }, players: [], events: [], createdAt: Date.now() };
    mutate(prev => [p, ...prev], async () => { await sbUpsert(p); });
    return p;
  }, [mutate]);

  const borrarPartido = useCallback((id: string) => {
    mutate(prev => prev.filter(p => p.id !== id), async () => { await sbDelete(id); });
  }, [mutate]);

  const updateScore = useCallback((partidoId: string, score: Score) => {
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, score }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
  }, [mutate]);

  const addPlayer = useCallback((partidoId: string, name: string, number?: string): Player => {
    const player: Player = { id: uuidv4(), name, number };
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, players: [...p.players, player] }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
    return player;
  }, [mutate]);

  const removePlayer = useCallback((partidoId: string, playerId: string) => {
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, players: p.players.filter(pl => pl.id !== playerId) }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
  }, [mutate]);

  // ── addEvent now accepts the full hierarchy ──────────────────────────────
  const addEvent = useCallback((
    partidoId: string, time: number, tipo: EventTipo,
    subtype: EventSubtype = null,
    detail: EventDetail = null,
    qualifier: EventQualifier = null,
    result: EventResult = null,
    playerId: string | null = null, playerName: string | null = null,
    videoFileIndex: number = 0,
  ): SportEvent => {
    const event: SportEvent = {
      id: uuidv4(), time, tipo, createdAt: Date.now(),
      subtype, detail, qualifier, result,
      player_id: playerId, player_name: playerName,
      clip_start: Math.max(0, time - 5), clip_end: time,
      videoFileIndex,
    };
    mutate(prev => prev.map(p => {
      if (p.id !== partidoId) return p;
      const events = [...p.events, event].sort((a, b) => a.time - b.time);
      let score = p.score;
      if (tipo === "Gol")       score = { ...score, local:     score.local + 1 };
      if (tipo === "Gol rival") score = { ...score, visitante: score.visitante + 1 };
      return { ...p, events, score };
    }), async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
    return event;
  }, [mutate]);

  const deleteEvent = useCallback((partidoId: string, eventId: string) => {
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, events: p.events.filter(e => e.id !== eventId) }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
  }, [mutate]);

  const updateEventResult = useCallback((partidoId: string, eventId: string, result: EventResult) => {
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, events: p.events.map(e => e.id === eventId ? { ...e, result, resultado: result } : e) }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
  }, [mutate]);

  const updateClip = useCallback((partidoId: string, eventId: string, clip_start: number, clip_end: number) => {
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, events: p.events.map(e => e.id === eventId ? { ...e, clip_start, clip_end } : e) }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
  }, [mutate]);

  const clearEvents = useCallback((partidoId: string) => {
    mutate(prev => prev.map(p => p.id !== partidoId ? p : { ...p, events: [], score: { local:0, visitante:0 } }),
      async next => { const p = next.find(x => x.id === partidoId); if (p) await sbUpsert(p); });
  }, [mutate]);

  return { partidos, loaded, useCloud, crearPartido, borrarPartido, updateScore, addPlayer, removePlayer, addEvent, deleteEvent, updateEventResult, updateClip, clearEvents };
}
