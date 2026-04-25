"use client";
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Play, Pause, Download, Combine, Trash2, Loader2, AlertCircle, CheckCircle2, Scissors, RotateCcw, GripVertical, Plus } from "lucide-react";
import type { SportEvent } from "@/types";
import { getEventConfig } from "@/types";

export interface TimelineClip {
  id: string;
  sourceFile: File;
  sourceStart: number; // time in source video (seconds)
  sourceEnd: number;   // time in source video (seconds)
  label: string;
  emoji: string;
  color: string;
}

interface TimelineEditorProps {
  clips: TimelineClip[];
  onClose: () => void;
  onExportIndividual: (clips: TimelineClip[]) => Promise<void>;
  onCompile: (clips: TimelineClip[]) => Promise<void>;
  exportStatus: "idle" | "exporting" | "compiling" | "done" | "error";
  exportProgress: { current: number; total: number; label: string } | null;
  exportPct: number;
  exportError: string | null;
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ds = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${ds}`;
}

export default function TimelineEditor({
  clips: initialClips,
  onClose,
  onExportIndividual,
  onCompile,
  exportStatus,
  exportProgress,
  exportPct,
  exportError,
}: TimelineEditorProps) {
  const [clips, setClips] = useState<TimelineClip[]>(initialClips);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(initialClips[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [virtualTime, setVirtualTime] = useState(0); // position in the compiled timeline
  const [pixelsPerSecond, setPixelsPerSecond] = useState(60);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [trimming, setTrimming] = useState<{ clipId: string; edge: "start" | "end" } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const blobUrlCache = useRef<WeakMap<File, string>>(new WeakMap());
  const animationRef = useRef<number>(0);

  // Compute clip positions in the virtual timeline
  const clipLayout = useMemo(() => {
    let currentTime = 0;
    return clips.map(clip => {
      const duration = Math.max(0.1, clip.sourceEnd - clip.sourceStart);
      const layout = {
        clip,
        startInTimeline: currentTime,
        endInTimeline: currentTime + duration,
        duration,
      };
      currentTime += duration;
      return layout;
    });
  }, [clips]);

  const totalDuration = clipLayout.reduce((sum, l) => sum + l.duration, 0);

  // Get the clip that should be playing at a given virtual time
  const getClipAtTime = useCallback((t: number) => {
    for (const layout of clipLayout) {
      if (t >= layout.startInTimeline && t < layout.endInTimeline) {
        return layout;
      }
    }
    return clipLayout[clipLayout.length - 1] ?? null;
  }, [clipLayout]);

  // Get blob URL for a file (cached)
  const getBlobUrl = useCallback((file: File): string => {
    const cached = blobUrlCache.current.get(file);
    if (cached) return cached;
    const url = URL.createObjectURL(file);
    blobUrlCache.current.set(file, url);
    return url;
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    const cache = blobUrlCache.current;
    return () => {
      // WeakMap auto-cleanups but revoke explicitly for safety
      clips.forEach(c => {
        const url = cache.get(c.sourceFile);
        if (url) URL.revokeObjectURL(url);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync video source and time when virtualTime changes
  useEffect(() => {
    const layout = getClipAtTime(virtualTime);
    if (!layout || !videoRef.current) return;

    const video = videoRef.current;
    const blobUrl = getBlobUrl(layout.clip.sourceFile);
    const positionInClip = virtualTime - layout.startInTimeline;
    const sourceTime = layout.clip.sourceStart + positionInClip;

    if (video.src !== blobUrl) {
      video.src = blobUrl;
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = sourceTime;
      }, { once: true });
    } else {
      // Only seek if drift > 0.3s to avoid constant re-seeks during playback
      if (Math.abs(video.currentTime - sourceTime) > 0.3) {
        video.currentTime = sourceTime;
      }
    }
  }, [virtualTime, getClipAtTime, getBlobUrl]);

  // Handle auto-advance between clips during playback
  useEffect(() => {
    if (!playing) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      videoRef.current?.pause();
      return;
    }

    videoRef.current?.play().catch(() => {});

    const tick = () => {
      if (!videoRef.current) return;
      const layout = getClipAtTime(virtualTime);
      if (!layout) { setPlaying(false); return; }

      const sourceTime = videoRef.current.currentTime;
      const positionInClip = sourceTime - layout.clip.sourceStart;
      const newVirtualTime = layout.startInTimeline + positionInClip;

      // Check if we've reached the end of current clip
      if (sourceTime >= layout.clip.sourceEnd) {
        // Jump to next clip
        const nextVirtualTime = layout.endInTimeline + 0.01;
        if (nextVirtualTime >= totalDuration) {
          setPlaying(false);
          setVirtualTime(totalDuration);
          return;
        }
        setVirtualTime(nextVirtualTime);
      } else if (newVirtualTime >= totalDuration) {
        setPlaying(false);
        setVirtualTime(totalDuration);
        return;
      } else {
        setVirtualTime(newVirtualTime);
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [playing, getClipAtTime, virtualTime, totalDuration]);

  // Drag & drop to reorder clips
  const handleDragStart = (clipId: string, e: React.DragEvent) => {
    setDraggingClipId(clipId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetClipId: string) => {
    e.preventDefault();
    if (!draggingClipId || draggingClipId === targetClipId) return;
    const sourceIdx = clips.findIndex(c => c.id === draggingClipId);
    const targetIdx = clips.findIndex(c => c.id === targetClipId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    const newClips = [...clips];
    const [removed] = newClips.splice(sourceIdx, 1);
    newClips.splice(targetIdx, 0, removed);
    setClips(newClips);
  };

  const handleDragEnd = () => setDraggingClipId(null);

  // Delete a clip
  const removeClip = (clipId: string) => {
    setClips(cs => cs.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(clips[0]?.id ?? null);
    }
  };

  // Trimming edges by dragging
  const handleTrimStart = (clipId: string, edge: "start" | "end", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTrimming({ clipId, edge });
  };

  useEffect(() => {
    if (!trimming) return;
    const handleMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const deltaTime = x / pixelsPerSecond;

      setClips(cs => cs.map(c => {
        if (c.id !== trimming.clipId) return c;
        const sourceDuration = c.sourceEnd - c.sourceStart;
        const layout = clipLayout.find(l => l.clip.id === c.id);
        if (!layout) return c;

        if (trimming.edge === "start") {
          const newStart = Math.max(0, Math.min(c.sourceEnd - 0.2, c.sourceStart + (deltaTime - layout.startInTimeline)));
          return { ...c, sourceStart: newStart };
        } else {
          const newEnd = Math.max(c.sourceStart + 0.2, c.sourceStart + sourceDuration + (deltaTime - layout.endInTimeline));
          return { ...c, sourceEnd: newEnd };
        }
      }));
    };
    const handleUp = () => setTrimming(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [trimming, pixelsPerSecond, clipLayout]);

  // Click on timeline to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || draggingClipId || trimming) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const newTime = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
    setVirtualTime(newTime);
  };

  // Add video files to timeline (like CapCut's "+" button)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAddVideos = () => fileInputRef.current?.click();

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // reset so same file can be re-added
    if (files.length === 0) return;

    const newClips: TimelineClip[] = [];
    for (const file of files) {
      // Read video metadata to get duration
      const url = URL.createObjectURL(file);
      try {
        const duration = await new Promise<number>((resolve, reject) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.onloadedmetadata = () => resolve(v.duration);
          v.onerror = () => reject(new Error("No se pudo leer el video"));
          v.src = url;
          setTimeout(() => reject(new Error("Timeout")), 10000);
        });
        newClips.push({
          id: `imported_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sourceFile: file,
          sourceStart: 0,
          sourceEnd: duration,
          label: file.name.replace(/\.[^.]+$/, "").slice(0, 30),
          emoji: "🎬",
          color: "#6366f1",
        });
      } catch (err) {
        console.error(`No se pudo agregar ${file.name}:`, err);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    if (newClips.length > 0) {
      setClips(cs => [...cs, ...newClips]);
      setSelectedClipId(newClips[0].id);
    }
  };

  const isBusy = exportStatus === "exporting" || exportStatus === "compiling";

  return (
    <div className="fixed inset-0 z-[100] bg-[#0a0e13] flex flex-col">
      {/* Top bar */}
      <div className="h-14 bg-[#0d1117] border-b border-[#21262d] flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-[#8b949e] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-[#30363d]" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Scissors className="w-3.5 h-3.5 text-white" />
            </div>
            <p className="text-white font-semibold text-sm">Timeline</p>
            <span className="text-xs font-mono text-[#8b949e]">
              {clips.length} clip{clips.length !== 1 ? "s" : ""} · {fmt(totalDuration)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleFilesSelected}
            className="hidden"
          />

          {/* Add videos button */}
          <button
            onClick={handleAddVideos}
            disabled={isBusy}
            className="px-3 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 transition-colors">
            <Plus className="w-4 h-4" />
            Agregar videos
          </button>

          <div className="w-px h-6 bg-[#30363d]" />

          {exportStatus === "done" && (
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold px-3">
              <CheckCircle2 className="w-4 h-4" /> Listo
            </div>
          )}
          {exportStatus === "error" && exportError && (
            <div className="flex items-center gap-2 text-red-400 text-xs px-3 max-w-md truncate" title={exportError}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {exportError}
            </div>
          )}

          <button
            onClick={() => onExportIndividual(clips)}
            disabled={clips.length === 0 || isBusy}
            className="px-4 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-2 transition-colors">
            <Download className="w-4 h-4" />
            Descargar videos
          </button>
          <button
            onClick={() => onCompile(clips)}
            disabled={clips.length === 0 || isBusy}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all">
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Combine className="w-4 h-4" />}
            Exportar video
          </button>
        </div>
      </div>

      {/* Progress bar during export */}
      {isBusy && exportProgress && (
        <div className="bg-[#0d1117] border-b border-[#21262d] px-4 py-2">
          <div className="flex items-center gap-3 text-xs mb-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            <span className="text-white font-semibold">
              {exportStatus === "compiling" ? "Compilando video..." : `Clip ${exportProgress.current}/${exportProgress.total}`}
            </span>
            <span className="text-[#8b949e] truncate">{exportProgress.label}</span>
          </div>
          <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all" style={{width: `${exportPct}%`}} />
          </div>
        </div>
      )}

      {/* Main area: Preview + Timeline */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Video preview */}
        <div className="flex-1 bg-black flex items-center justify-center min-h-0 relative">
          {clips.length === 0 ? (
            <div className="text-center text-[#484f58]">
              <Scissors className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Sin clips en el timeline</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="max-w-full max-h-full"
              onClick={() => setPlaying(p => !p)}
              playsInline
            />
          )}
        </div>

        {/* Playback controls */}
        <div className="bg-[#0d1117] border-t border-[#21262d] px-4 py-2 flex items-center gap-3">
          <button
            onClick={() => setPlaying(p => !p)}
            disabled={clips.length === 0}
            className="w-9 h-9 rounded-full bg-white hover:bg-white/90 disabled:opacity-40 text-black flex items-center justify-center transition-all">
            {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <div className="text-xs font-mono text-[#8b949e]">
            <span className="text-cyan-400">{fmt(virtualTime)}</span>
            <span className="mx-1">/</span>
            <span>{fmt(totalDuration)}</span>
          </div>

          <div className="flex-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-[#0a0e13] rounded-lg p-1">
            <button
              onClick={() => setPixelsPerSecond(p => Math.max(20, p - 20))}
              className="w-7 h-7 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white text-xs flex items-center justify-center transition-colors">
              −
            </button>
            <span className="text-xs font-mono text-[#8b949e] px-2">{pixelsPerSecond}px/s</span>
            <button
              onClick={() => setPixelsPerSecond(p => Math.min(200, p + 20))}
              className="w-7 h-7 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white text-xs flex items-center justify-center transition-colors">
              +
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          className="h-44 bg-[#0a0e13] border-t border-[#21262d] overflow-x-auto overflow-y-hidden relative cursor-pointer"
        >
          {/* Time ruler */}
          <div className="h-6 border-b border-[#21262d] sticky top-0 bg-[#0a0e13] z-10 relative" style={{width: Math.max(800, totalDuration * pixelsPerSecond + 120)}}>
            {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => (
              <div key={i} className="absolute top-0 h-full flex items-center text-[10px] font-mono text-[#484f58] border-l border-[#21262d]" style={{left: i * pixelsPerSecond}}>
                <span className="ml-1">{fmt(i)}</span>
              </div>
            ))}
          </div>

          {/* Clips track */}
          <div className="relative mt-2 h-24" style={{width: Math.max(800, totalDuration * pixelsPerSecond + 120)}}>
            {clipLayout.map((layout, idx) => {
              const { clip, startInTimeline, duration } = layout;
              const isSelected = selectedClipId === clip.id;
              const isDragging = draggingClipId === clip.id;

              return (
                <div
                  key={clip.id}
                  draggable
                  onDragStart={e => handleDragStart(clip.id, e)}
                  onDragOver={e => handleDragOver(e, clip.id)}
                  onDragEnd={handleDragEnd}
                  onClick={e => { e.stopPropagation(); setSelectedClipId(clip.id); setVirtualTime(startInTimeline); }}
                  className={`absolute top-0 h-full rounded-lg border-2 overflow-hidden transition-all ${
                    isSelected
                      ? "border-cyan-400 shadow-lg shadow-cyan-500/30 z-10"
                      : "border-[#30363d] hover:border-[#484f58]"
                  } ${isDragging ? "opacity-50" : "opacity-100"}`}
                  style={{
                    left: startInTimeline * pixelsPerSecond,
                    width: Math.max(40, duration * pixelsPerSecond),
                    background: `linear-gradient(135deg, ${clip.color}40, ${clip.color}20)`,
                  }}
                >
                  {/* Drag handle (left edge for trimming) */}
                  <div
                    onMouseDown={e => handleTrimStart(clip.id, "start", e)}
                    className="absolute left-0 top-0 w-2 h-full bg-white/20 hover:bg-white/40 cursor-ew-resize z-20"
                  />
                  {/* Drag handle (right edge for trimming) */}
                  <div
                    onMouseDown={e => handleTrimStart(clip.id, "end", e)}
                    className="absolute right-0 top-0 w-2 h-full bg-white/20 hover:bg-white/40 cursor-ew-resize z-20"
                  />

                  {/* Clip content */}
                  <div className="p-2 h-full flex flex-col justify-between pointer-events-none">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <GripVertical className="w-3 h-3 text-white/40 flex-shrink-0" />
                      <span className="text-base flex-shrink-0">{clip.emoji}</span>
                      <span className="text-white font-semibold text-xs truncate">{clip.label}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-white/70">
                      <span>#{idx + 1}</span>
                      <span>{duration.toFixed(1)}s</span>
                    </div>
                  </div>

                  {/* Delete button (shows on hover) */}
                  <button
                    onClick={e => { e.stopPropagation(); removeClip(clip.id); }}
                    className="absolute top-1 right-1 w-5 h-5 rounded bg-red-500/80 hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center z-30 transition-opacity"
                    style={{ opacity: isSelected ? 1 : 0 }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {/* Playhead */}
            {totalDuration > 0 && (
              <div
                className="absolute top-0 h-full w-0.5 bg-red-500 pointer-events-none z-20"
                style={{ left: virtualTime * pixelsPerSecond }}
              >
                <div className="absolute -top-1 -left-1.5 w-3 h-3 rotate-45 bg-red-500" />
              </div>
            )}

            {/* Add video button at the end of timeline */}
            <button
              onClick={e => { e.stopPropagation(); handleAddVideos(); }}
              className="absolute top-0 h-full w-16 rounded-lg border-2 border-dashed border-[#30363d] hover:border-cyan-400 hover:bg-cyan-500/10 text-[#484f58] hover:text-cyan-400 flex flex-col items-center justify-center gap-1 transition-all z-10"
              style={{ left: totalDuration * pixelsPerSecond + 8 }}
              title="Agregar videos al timeline"
            >
              <Plus className="w-5 h-5" />
              <span className="text-[9px] font-semibold">Agregar</span>
            </button>
          </div>

          {/* Empty state */}
          {clips.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[#484f58] text-xs pointer-events-none gap-3">
              <p>Sin clips en el timeline</p>
              <button
                onClick={handleAddVideos}
                className="pointer-events-auto px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-2 transition-colors">
                <Plus className="w-4 h-4" />
                Agregar videos
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
