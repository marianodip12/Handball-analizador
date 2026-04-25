"use client";
import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  Scissors, Play, Square, Download, Check, ChevronDown, ChevronUp,
  Film, Filter, Loader2, AlertCircle, CheckCircle2, Combine, Layers,
} from "lucide-react";
import { getEventConfig, getEventLabel, inferResult, EVENT_TREE } from "@/types";
import type { SportEvent } from "@/types";
import TimelineEditor, { TimelineClip } from "./TimelineEditor";

interface PlayerHandle {
  getCurrentTime: () => number;
  seekTo: (time: number) => void;
  getLocalFile?: () => File | null;
  getAllFiles?: () => File[];
  getActiveFileIndex?: () => number;
}

interface ClipEditorProps {
  events: SportEvent[];
  playerRef: React.RefObject<PlayerHandle>;
  onUpdateClip: (eventId: string, clip_start: number, clip_end: number) => void;
  onEditClip?: (start: number, end: number) => void;
  open?: boolean;
  setOpen?: (val: boolean) => void;
}

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ds = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${ds}`;
}
function duration(start: number, end: number) {
  return `${Math.max(0, end - start).toFixed(1)}s`;
}

type FilterState = { tipo: string; subtype: string; result: string };


// ─── MediaRecorder-based cutter (universal fallback for any video format) ────
// Works with MP4, MOV, WebM, etc. — plays the video at 1x speed and records
// only the requested range. Produces WebM output by default (or MP4 on Safari).
// Slower than copy-cutting but works without any WASM or SIMD.
async function cutWithMediaRecorder(
  sourceFile: File,
  clipStart: number,
  clipEnd: number,
  onProgress?: (pct: number) => void,
): Promise<{ data: Uint8Array; mime: string; ext: string }> {
  const url = URL.createObjectURL(sourceFile);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = false;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (video as any).playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("No se pudo cargar el video"));
      setTimeout(() => reject(new Error("Timeout cargando video")), 15000);
    });

    let w = video.videoWidth || 1280;
    let h = video.videoHeight || 720;
    if (w < 64 || h < 64) {
      w = 1280;
      h = 720;
    }

    // Capture video frames via canvas + captureStream
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear contexto de canvas");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videoStream = (canvas as any).captureStream(30) as MediaStream;

    // Try to capture audio from the video element
    let combinedStream = videoStream;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioStream = (video as any).captureStream?.() as MediaStream | undefined;
      if (audioStream) {
        const audioTracks = audioStream.getAudioTracks();
        if (audioTracks.length > 0) {
          combinedStream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioTracks,
          ]);
        }
      }
    } catch { /* ignore — export without audio */ }

    // Pick best available MIME type
    const candidates = [
      "video/mp4;codecs=avc1",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    let mimeType = "";
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) { mimeType = c; break; }
    }
    if (!mimeType) throw new Error("MediaRecorder no soporta ningún formato de video");

    const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 5_000_000, // 5 Mbps — decent quality
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const clipDuration = clipEnd - clipStart;

    // Seek to start and wait for ready
    video.currentTime = clipStart;
    await new Promise<void>((resolve) => {
      const handler = () => { video.removeEventListener("seeked", handler); resolve(); };
      video.addEventListener("seeked", handler);
    });

    recorder.start(200);
    video.play().catch(() => {});

    // Draw frames from video to canvas while playing
    let rafId = 0;
    const draw = () => {
      if (video.ended || video.currentTime >= clipEnd) return;
      ctx.drawImage(video, 0, 0, w, h);
      const pct = Math.min(100, Math.round(((video.currentTime - clipStart) / clipDuration) * 100));
      onProgress?.(pct);
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    // Stop when we reach clipEnd
    await new Promise<void>((resolve) => {
      const check = () => {
        if (video.currentTime >= clipEnd || video.ended) {
          video.pause();
          cancelAnimationFrame(rafId);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Stop recorder and wait for final chunk
    const recordedBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.stop();
    });

    const arrayBuf = await recordedBlob.arrayBuffer();
    return { data: new Uint8Array(arrayBuf), mime: mimeType, ext };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── Unified cutter ──────────────────────────────────────────────────────────
// Strategy: use MediaRecorder (works everywhere, no WASM issues).
// Output is WebM or MP4 depending on browser support — CapCut, Premiere,
// DaVinci, and most editors accept both.
async function cutClipUniversal(
  sourceFile: File,
  clipStart: number,
  clipEnd: number,
  onProgress?: (pct: number) => void,
): Promise<{ data: Uint8Array; ext: string }> {
  const result = await cutWithMediaRecorder(sourceFile, clipStart, clipEnd, onProgress);
  return { data: result.data, ext: result.ext };
}

// ─── Concat multiple clips into one video ────────────────────────────────────
// For same-source clips, we concatenate the WebM/MP4 files produced by
// MediaRecorder. WebM concat is trivial (just concat bytes — browsers handle
// the container), MP4 concat is more complex but we use a simple approach:
// record them back-to-back into a single MediaRecorder session.
async function compileClipsUniversal(
  clips: Array<{ file: File; start: number; end: number }>,
  onProgress?: (overallPct: number, label: string) => void,
): Promise<{ data: Uint8Array; ext: string }> {
  if (clips.length === 0) throw new Error("No hay clips para compilar");
  if (clips.length === 1) {
    const r = await cutClipUniversal(clips[0].file, clips[0].start, clips[0].end, p => onProgress?.(p, "Cortando clip..."));
    return r;
  }

  // Multi-clip compile: record each clip sequentially into the SAME MediaRecorder
  // by swapping video sources and canvas streams. We use a persistent canvas.
  const w = 1280, h = 720; // target dimensions — we'll scale to fit
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear contexto");

  // Use first clip to determine dimensions
  const firstClip = clips[0];
  const firstUrl = URL.createObjectURL(firstClip.file);
  const probeVideo = document.createElement("video");
  probeVideo.src = firstUrl;
  probeVideo.muted = true;
  await new Promise<void>((resolve, reject) => {
    probeVideo.onloadedmetadata = () => resolve();
    probeVideo.onerror = () => reject(new Error("No se pudo leer el primer clip"));
    setTimeout(() => reject(new Error("Timeout")), 10000);
  });
  canvas.width  = probeVideo.videoWidth  || w;
  canvas.height = probeVideo.videoHeight || h;
  URL.revokeObjectURL(firstUrl);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videoStream = (canvas as any).captureStream(30) as MediaStream;

  const candidates = [
    "video/mp4;codecs=avc1",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  let mimeType = "";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) { mimeType = c; break; }
  }
  if (!mimeType) throw new Error("MediaRecorder no soporta video");
  const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";

  const recorder = new MediaRecorder(videoStream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start(200);

  const totalDuration = clips.reduce((a, c) => a + (c.end - c.start), 0);
  let elapsedDuration = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const clipDur = clip.end - clip.start;
    const label = `Clip ${i + 1}/${clips.length}`;

    const url = URL.createObjectURL(clip.file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true; // audio mixing across clips is complex — skip for multi-clip
    video.crossOrigin = "anonymous";

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(`Clip ${i+1} no carga`));
        setTimeout(() => reject(new Error(`Clip ${i+1} timeout`)), 15000);
      });

      video.currentTime = clip.start;
      await new Promise<void>((resolve) => {
        const h = () => { video.removeEventListener("seeked", h); resolve(); };
        video.addEventListener("seeked", h);
      });

      video.play().catch(() => {});

      let rafId = 0;
      const draw = () => {
        if (video.currentTime >= clip.end || video.ended) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const localPct = Math.min(1, (video.currentTime - clip.start) / clipDur);
        const overallPct = Math.round(((elapsedDuration + localPct * clipDur) / totalDuration) * 100);
        onProgress?.(overallPct, label);
        rafId = requestAnimationFrame(draw);
      };
      rafId = requestAnimationFrame(draw);

      await new Promise<void>((resolve) => {
        const check = () => {
          if (video.currentTime >= clip.end || video.ended) {
            video.pause();
            cancelAnimationFrame(rafId);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      elapsedDuration += clipDur;
    } finally {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
    }
  }

  const recordedBlob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.stop();
  });

  const arrayBuf = await recordedBlob.arrayBuffer();
  return { data: new Uint8Array(arrayBuf), ext };
}

export default function ClipEditor({ events, playerRef, onUpdateClip, onEditClip, open: externalOpen, setOpen: externalSetOpen }: ClipEditorProps) {
  const [localOpen, setLocalOpen] = useState(true);
  const open = externalOpen !== undefined ? externalOpen : localOpen;
  const setOpen = externalSetOpen || setLocalOpen;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingEnd, setSettingEnd] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>({ tipo: "", subtype: "", result: "" });
  const [exportStatus, setExportStatus] = useState<"idle"|"loading-ffmpeg"|"exporting"|"compiling"|"done"|"error">("idle");
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [wasmPct, setWasmPct] = useState(0);
  const [clipErrors, setClipErrors] = useState<string[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const abortRef = useRef(false);

  const clips = useMemo(() => {
    let list = events.filter(e => e.clip_start !== undefined);
    if (filter.tipo)    list = list.filter(e => e.tipo === filter.tipo);
    if (filter.subtype) list = list.filter(e => e.subtype === filter.subtype);
    if (filter.result) {
      list = list.filter(e => {
        const r = e.result ?? e.resultado ?? inferResult(e);
        return r === filter.result;
      });
    }
    return list;
  }, [events, filter]);

  const uniqueTipos = useMemo(() => Array.from(new Set(events.map(e => e.tipo))), [events]);

  // Subtypes available for the currently-selected tipo (from EVENT_TREE)
  const availableSubtypes = useMemo<string[]>(() => {
    if (!filter.tipo) return [];
    const node = EVENT_TREE.find(n => n.label === filter.tipo);
    return node?.children?.map(c => c.label) ?? [];
  }, [filter.tipo]);

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { if (selected.size === clips.length) setSelected(new Set()); else setSelected(new Set(clips.map(e => e.id))); };

  const handlePreview = useCallback((event: SportEvent) => {
    playerRef.current?.seekTo(event.clip_start ?? Math.max(0, event.time - 5));
  }, [playerRef]);

  const handleSetEnd = useCallback((eventId: string, event: SportEvent) => {
    if (settingEnd === eventId) {
      const t = playerRef.current?.getCurrentTime() ?? event.time;
      onUpdateClip(eventId, event.clip_start ?? Math.max(0, event.time - 5), t);
      setSettingEnd(null);
    } else {
      playerRef.current?.seekTo(event.clip_start ?? Math.max(0, event.time - 5));
      setSettingEnd(eventId);
    }
  }, [settingEnd, playerRef, onUpdateClip]);

  const handleSetStart = useCallback((event: SportEvent) => {
    const t = playerRef.current?.getCurrentTime() ?? event.time;
    onUpdateClip(event.id, t, event.clip_end ?? event.time);
  }, [playerRef, onUpdateClip]);

  // ── Build clip list for export ────────────────────────────────────────────
  const buildClipsToExport = useCallback(() => {
    return clips
      .filter(e => selected.has(e.id))
      .map(e => {
        const cfg = getEventConfig(e.tipo);
        return {
          ...e,
          clip_start: e.clip_start ?? Math.max(0, e.time - 5),
          clip_end: e.clip_end ?? e.time,
          label: `${cfg.emoji} ${e.tipo}${e.subtype ? ` (${e.subtype})` : ""}${e.player_name ? ` — ${e.player_name}` : ""}`,
        };
      });
  }, [clips, selected]);

  // ── Resolve source file for a clip ───────────────────────────────────────
  const resolveFile = useCallback((videoFileIndex: number | undefined): File | null => {
    const allFiles = (playerRef.current as { getAllFiles?: () => File[] })?.getAllFiles?.() ?? [];
    const localFile = (playerRef.current as { getLocalFile?: () => File | null })?.getLocalFile?.();
    if (allFiles.length > 0) return allFiles[videoFileIndex ?? 0] ?? allFiles[0];
    return localFile ?? null;
  }, [playerRef]);

  // ── Export: individual clips (MediaRecorder — works anywhere) ─────────────
  const handleExportIndividual = useCallback(async () => {
    const clipsToExport = buildClipsToExport();
    const localFile = resolveFile(0);

    // No local file → export JSON
    if (!localFile) {
      const exportData = {
        exported_at: new Date().toISOString(),
        total_clips: clipsToExport.length,
        clips: clipsToExport.map(c => ({
          id: c.id, tipo: c.tipo, subtype: c.subtype ?? null,
          result: c.result ?? c.resultado ?? null, player_name: c.player_name ?? null,
          timestamp: c.time, clip_start: c.clip_start, clip_end: c.clip_end,
          duration_seconds: Math.max(0, c.clip_end - c.clip_start), label: getEventLabel(c),
        })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `clips_${new Date().toISOString().slice(0,10)}.json`; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    try {
      setExportError(null); setClipErrors([]); abortRef.current = false;
      setExportStatus("exporting");
      setWasmPct(0);

      const errors: string[] = [];

      for (let i = 0; i < clipsToExport.length; i++) {
        if (abortRef.current) break;
        const clip = clipsToExport[i];
        const sourceFile = resolveFile(clip.videoFileIndex) ?? localFile;
        const safeName = clip.tipo.replace(/[^a-zA-Z0-9]/g, "_");

        setExportProgress({ current: i + 1, total: clipsToExport.length, label: getEventLabel(clip) });

        try {
          const result = await cutClipUniversal(sourceFile, clip.clip_start, clip.clip_end, pct => setWasmPct(pct));
          const outName = `clip_${String(i+1).padStart(2,"0")}_${safeName}.${result.ext}`;
          const mimeType = result.ext === "mp4" ? "video/mp4" : "video/webm";

          await new Promise<void>((resolve) => {
            const url = URL.createObjectURL(new Blob([result.data.buffer as ArrayBuffer], { type: mimeType }));
            const a = document.createElement("a");
            a.href = url; a.download = outName; a.style.display = "none";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 800);
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "error desconocido";
          console.error(`Clip ${i+1} falló:`, msg);
          errors.push(`Clip ${i+1} (${getEventLabel(clip)}): ${msg}`);
        }
      }

      setClipErrors(errors);
      setExportStatus(errors.length === clipsToExport.length ? "error" : "done");
      if (errors.length > 0 && errors.length < clipsToExport.length) {
        setExportError(`${errors.length} clip(s) fallaron, el resto se exportó correctamente.`);
      } else if (errors.length === clipsToExport.length) {
        setExportError("Todos los clips fallaron.");
      }
      setTimeout(() => { setExportStatus("idle"); setExportProgress(null); }, 5000);
    } catch (err: unknown) {
      console.error(err);
      setExportStatus("error");
      setExportError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setExportProgress(null);
    }
  }, [buildClipsToExport, resolveFile]);

  // ── Export: compile all selected clips into one video ─────────────────────
  const handleCompile = useCallback(async () => {
    const clipsToExport = buildClipsToExport();
    const localFile = resolveFile(0);

    if (!localFile) {
      alert("Necesitás cargar un video local para compilar.");
      return;
    }
    if (clipsToExport.length < 1) return;

    try {
      setExportError(null); setClipErrors([]); abortRef.current = false;
      setExportStatus("compiling");
      setWasmPct(0);

      const clipsForCompile = clipsToExport.map(c => ({
        file: resolveFile(c.videoFileIndex) ?? localFile,
        start: c.clip_start,
        end: c.clip_end,
      }));

      setExportProgress({
        current: 1,
        total: clipsToExport.length,
        label: `Compilando ${clipsToExport.length} clips...`,
      });

      const result = await compileClipsUniversal(clipsForCompile, (pct, label) => {
        setWasmPct(pct);
        setExportProgress({ current: 1, total: clipsToExport.length, label });
      });

      const mimeType = result.ext === "mp4" ? "video/mp4" : "video/webm";
      const blob = new Blob([result.data.buffer as ArrayBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compilado_${new Date().toISOString().slice(0,10)}.${result.ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setExportStatus("done");
      setTimeout(() => { setExportStatus("idle"); setExportProgress(null); }, 5000);
    } catch (err: unknown) {
      console.error(err);
      setExportStatus("error");
      setExportError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setExportProgress(null);
    }
  }, [buildClipsToExport, resolveFile]);

  // ── Timeline-aware variants (accept TimelineClip[] directly) ──────────────
  const handleExportIndividualFromTimeline = useCallback(async (timelineClips: TimelineClip[]) => {
    try {
      setExportError(null); setClipErrors([]); abortRef.current = false;
      setExportStatus("exporting");
      setWasmPct(0);

      const errors: string[] = [];
      for (let i = 0; i < timelineClips.length; i++) {
        if (abortRef.current) break;
        const tc = timelineClips[i];
        const safeName = tc.label.replace(/[^a-zA-Z0-9]/g, "_");
        setExportProgress({ current: i + 1, total: timelineClips.length, label: tc.label });
        try {
          const result = await cutClipUniversal(tc.sourceFile, tc.sourceStart, tc.sourceEnd, pct => setWasmPct(pct));
          const outName = `clip_${String(i+1).padStart(2,"0")}_${safeName}.${result.ext}`;
          const mimeType = result.ext === "mp4" ? "video/mp4" : "video/webm";
          await new Promise<void>((resolve) => {
            const url = URL.createObjectURL(new Blob([result.data.buffer as ArrayBuffer], { type: mimeType }));
            const a = document.createElement("a");
            a.href = url; a.download = outName; a.style.display = "none";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 800);
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "error desconocido";
          errors.push(`Clip ${i+1} (${tc.label}): ${msg}`);
        }
      }
      setClipErrors(errors);
      setExportStatus(errors.length === timelineClips.length ? "error" : "done");
      if (errors.length > 0 && errors.length < timelineClips.length) {
        setExportError(`${errors.length} clip(s) fallaron.`);
      } else if (errors.length === timelineClips.length) {
        setExportError("Todos los clips fallaron.");
      }
      setTimeout(() => { setExportStatus("idle"); setExportProgress(null); }, 5000);
    } catch (err) {
      setExportStatus("error");
      setExportError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setExportProgress(null);
    }
  }, []);

  const handleCompileFromTimeline = useCallback(async (timelineClips: TimelineClip[]) => {
    if (timelineClips.length < 1) return;
    try {
      setExportError(null); setClipErrors([]); abortRef.current = false;
      setExportStatus("compiling");
      setWasmPct(0);

      const clipsForCompile = timelineClips.map(tc => ({
        file: tc.sourceFile,
        start: tc.sourceStart,
        end: tc.sourceEnd,
      }));

      setExportProgress({
        current: 1,
        total: timelineClips.length,
        label: `Compilando ${timelineClips.length} clips...`,
      });

      const result = await compileClipsUniversal(clipsForCompile, (pct, label) => {
        setWasmPct(pct);
        setExportProgress({ current: 1, total: timelineClips.length, label });
      });

      const mimeType = result.ext === "mp4" ? "video/mp4" : "video/webm";
      const blob = new Blob([result.data.buffer as ArrayBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compilado_${new Date().toISOString().slice(0,10)}.${result.ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setExportStatus("done");
      setTimeout(() => { setExportStatus("idle"); setExportProgress(null); }, 5000);
    } catch (err) {
      setExportStatus("error");
      setExportError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setExportProgress(null);
    }
  }, []);

  const isBusy = exportStatus === "loading-ffmpeg" || exportStatus === "exporting" || exportStatus === "compiling";
  const hasLocalFile = !!(playerRef.current as { getLocalFile?: () => File | null })?.getLocalFile?.();


  return (
    <div className="rounded-2xl bg-[#0d1117] border border-[#21262d] overflow-hidden">
      {/* Header collapsible */}
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#161b22] transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Scissors className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="text-white font-semibold text-sm">Editor de Clips</p>
            <p className="text-[#8b949e] text-xs">
              {clips.length} clip{clips.length !== 1 ? "s" : ""} · {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-[#8b949e]" /> : <ChevronDown className="w-5 h-5 text-[#8b949e]" />}
      </button>

      {open && (
        <>
          {/* Filters bar */}
          <div className="px-4 py-3 flex gap-2 flex-wrap items-center border-t border-[#21262d] bg-[#010409]">
            <Filter className="w-3.5 h-3.5 text-[#484f58]" />
            <select value={filter.tipo} onChange={e => setFilter(f => ({ tipo: e.target.value, subtype: "", result: f.result }))}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-2 py-1.5 text-xs font-mono text-[#c9d1d9] focus:outline-none focus:border-cyan-500">
              <option value="">Todos los tipos</option>
              {uniqueTipos.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {filter.tipo && availableSubtypes.length > 0 && (
              <select value={filter.subtype} onChange={e => setFilter(f => ({ ...f, subtype: e.target.value }))}
                className="bg-[#0d1117] border border-[#30363d] rounded-lg px-2 py-1.5 text-xs font-mono text-[#c9d1d9] focus:outline-none focus:border-cyan-500">
                <option value="">Todos los subtipos</option>
                {availableSubtypes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <select value={filter.result} onChange={e => setFilter(f => ({ ...f, result: e.target.value }))}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-2 py-1.5 text-xs font-mono text-[#c9d1d9] focus:outline-none focus:border-cyan-500">
              <option value="">OK + ERR</option>
              <option value="correcto">✓ Correcto</option>
              <option value="incorrecto">✗ Incorrecto</option>
            </select>

            <div className="flex-1" />

            <button onClick={toggleAll}
              className="text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
              {selected.size === clips.length ? "Deseleccionar todo" : "Seleccionar todo"}
            </button>
          </div>

          {/* Clips timeline */}
          <div className="p-3 max-h-[400px] overflow-y-auto space-y-2 bg-[#0d1117]">
            {clips.length === 0 ? (
              <div className="text-center py-12 text-[#484f58]">
                <Film className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-mono">Sin clips para mostrar</p>
                <p className="text-xs mt-1">Agregá eventos durante el partido para generar clips</p>
              </div>
            ) : (
              clips.map(ev => {
                const isSelected = selected.has(ev.id);
                const cfg = getEventConfig(ev.tipo);
                const clipDur = Math.max(0, ev.clip_end - ev.clip_start);
                return (
                  <div key={ev.id}
                    className={`group relative rounded-xl border transition-all overflow-hidden ${
                      isSelected
                        ? "bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border-cyan-500/50"
                        : "bg-[#161b22] border-[#21262d] hover:border-[#30363d]"
                    }`}>
                    <div className="flex items-center gap-3 p-3">
                      {/* Checkbox */}
                      <button onClick={() => toggleSelect(ev.id)}
                        className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all ${
                          isSelected
                            ? "bg-cyan-500 border-cyan-500"
                            : "bg-transparent border-2 border-[#30363d] hover:border-[#8b949e]"
                        }`}>
                        {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </button>

                      {/* Icon */}
                      <div className="text-2xl flex-shrink-0">{cfg?.emoji ?? "🎬"}</div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-white font-semibold text-sm truncate">
                            {ev.tipo}
                          </span>
                          {ev.subtype && <span className="text-[#8b949e] font-normal text-xs">· {ev.subtype}</span>}
                          {ev.detail && <span className="text-[#8b949e] font-normal text-xs">· {ev.detail}</span>}
                          {ev.qualifier && <span className="text-[#8b949e] font-normal text-xs">· {ev.qualifier}</span>}
                          {ev.player_name && (
                            <span className="text-xs px-1.5 py-0.5 bg-[#0d1117] border border-[#21262d] rounded text-[#8b949e]">
                              {ev.player_name}
                            </span>
                          )}
                        </div>

                        {/* Timeline bar */}
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-cyan-400">{fmt(ev.clip_start)}</span>
                          <div className="flex-1 h-1 bg-[#21262d] rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{width: "100%"}} />
                          </div>
                          <span className="text-cyan-400">{fmt(ev.clip_end)}</span>
                          <span className="text-[#8b949e] tabular-nums">{clipDur.toFixed(1)}s</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handlePreview(ev)}
                          title="Preview"
                          className="w-8 h-8 rounded-lg bg-[#21262d] hover:bg-cyan-500/20 hover:text-cyan-400 text-[#8b949e] flex items-center justify-center transition-colors">
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button onClick={() => handleSetStart(ev)}
                          title="Fijar inicio aquí"
                          className="px-2 h-8 rounded-lg bg-[#21262d] hover:bg-cyan-500/20 hover:text-cyan-400 text-[#8b949e] text-xs font-mono flex items-center transition-colors">
                          ← Inicio
                        </button>
                        <button onClick={() => handleSetEnd(ev.id, ev)}
                          title={settingEnd === ev.id ? "Confirmar fin" : "Fijar fin aquí"}
                          className={`px-2 h-8 rounded-lg text-xs font-mono flex items-center transition-colors ${
                            settingEnd === ev.id
                              ? "bg-amber-500 text-black"
                              : "bg-[#21262d] hover:bg-cyan-500/20 hover:text-cyan-400 text-[#8b949e]"
                          }`}>
                          {settingEnd === ev.id ? "✓ Confirmar" : "Fin →"}
                        </button>
                        {onEditClip && (
                          <button onClick={() => onEditClip(ev.clip_start, ev.clip_end)}
                            title="Editar con dibujos"
                            className="w-8 h-8 rounded-lg bg-[#21262d] hover:bg-violet-500/20 hover:text-violet-400 text-[#8b949e] flex items-center justify-center transition-colors">
                            ✏️
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom action bar — CapCut style */}
          <div className="p-3 bg-gradient-to-r from-[#010409] via-[#0d1117] to-[#010409] border-t border-[#21262d] flex items-center gap-2 flex-wrap">
            {/* Status on left */}
            <div className="flex-1 min-w-0">
              {exportStatus === "idle" && (
                <div className="text-xs text-[#8b949e]">
                  {selected.size === 0 ? (
                    <span>Seleccioná clips para exportar</span>
                  ) : (
                    <span>
                      <span className="text-cyan-400 font-semibold">{selected.size}</span> clip{selected.size !== 1 ? "s" : ""} seleccionado{selected.size !== 1 ? "s" : ""}
                      {hasLocalFile && <span className="ml-2">· listo para descargar</span>}
                    </span>
                  )}
                </div>
              )}
              {(exportStatus === "exporting" || exportStatus === "compiling") && exportProgress && (
                <div>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    <span className="text-white font-semibold">
                      {exportStatus === "compiling" ? "Compilando video..." : `Clip ${exportProgress.current}/${exportProgress.total}`}
                    </span>
                    <span className="text-[#8b949e] truncate">{exportProgress.label}</span>
                  </div>
                  <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all" style={{width: `${wasmPct}%`}} />
                  </div>
                </div>
              )}
              {exportStatus === "done" && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  Exportación completada
                </div>
              )}
              {exportStatus === "error" && exportError && (
                <div className="flex items-start gap-2 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Error al exportar</p>
                    <p className="text-red-300/80">{exportError}</p>
                    {clipErrors.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[10px]">
                        {clipErrors.slice(0, 3).map((e, i) => <li key={i} className="font-mono text-red-300/60">· {e}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons on right */}
            <div className="flex items-center gap-2">
              {hasLocalFile && selected.size >= 1 && (
                <button
                  onClick={() => setShowTimeline(true)}
                  disabled={isBusy}
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-400 hover:to-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-violet-500/20 transition-all">
                  <Layers className="w-4 h-4" />
                  Editar timeline
                </button>
              )}

              <button
                onClick={handleExportIndividual}
                disabled={selected.size === 0 || isBusy}
                className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all">
                <Download className="w-4 h-4" />
                Descargar {selected.size > 0 ? `${selected.size} video${selected.size !== 1 ? "s" : ""}` : "videos"}
              </button>

              {hasLocalFile && (
                <button
                  onClick={handleCompile}
                  disabled={selected.size === 0 || isBusy}
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all">
                  <Combine className="w-4 h-4" />
                  Compilar en 1 video
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Timeline Editor Modal */}
      {showTimeline && (
        <TimelineEditor
          clips={(() => {
            const localFile = resolveFile(0);
            const selectedClips = clips.filter(c => selected.has(c.id));
            return selectedClips.map(c => {
              const cfg = getEventConfig(c.tipo);
              const colorMap: Record<string, string> = {
                "Gol": "#10b981",
                "Gol rival": "#ef4444",
                "Defensa": "#06b6d4",
                "Ataque": "#f97316",
                "Transición": "#f59e0b",
                "Arquero": "#0ea5e9",
                "Especiales": "#8b5cf6",
              };
              const color = colorMap[c.tipo] ?? "#06b6d4";
              return {
                id: c.id,
                sourceFile: resolveFile(c.videoFileIndex) ?? localFile!,
                sourceStart: c.clip_start ?? 0,
                sourceEnd: c.clip_end ?? 0,
                label: c.tipo + (c.subtype ? ` · ${c.subtype}` : ""),
                emoji: cfg?.emoji ?? "🎬",
                color,
              } as TimelineClip;
            }).filter(c => c.sourceFile);
          })()}
          onClose={() => setShowTimeline(false)}
          onExportIndividual={async (timelineClips) => {
            // Temporarily replace selected clips with timeline's clips
            await handleExportIndividualFromTimeline(timelineClips);
          }}
          onCompile={async (timelineClips) => {
            await handleCompileFromTimeline(timelineClips);
          }}
          exportStatus={exportStatus === "loading-ffmpeg" ? "idle" : exportStatus}
          exportProgress={exportProgress}
          exportPct={wasmPct}
          exportError={exportError}
        />
      )}
    </div>
  );
}
