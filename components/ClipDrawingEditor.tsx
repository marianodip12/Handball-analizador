"use client";
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Play, Pause, Undo2, Trash2, X, Minus, ArrowRight, Type, Pencil, Loader2, Video, Plus, Scissors } from "lucide-react";
import type { SportEvent } from "@/types";

type Tool = "pen" | "line" | "arrow" | "text";
interface Pt { x: number; y: number; }

interface Annotation {
  id: string; tool: Tool; color: string; size: number;
  points: Pt[]; text?: string;
  videoId: string;     // which video the annotation belongs to
  timeIn: number;      // seconds, video-clip-relative
  duration: number;    // seconds (0 = until end of clip)
}

interface VideoTrack {
  id: string;
  file: File;
  url: string;
  fullDuration: number;
  clipStart: number;
  clipEnd: number;
}

interface Props {
  localFile: File | null;
  initialTime?: number;
  clipRange?: { start: number; end: number } | null;
  events?: SportEvent[];
  onClose: () => void;
}

const COLORS = ["#ffffff", "#ff3333", "#33ff88", "#3388ff", "#ffcc00", "#ff33cc", "#00ccff", "#ff8800"];
const ANNOTATION_TRACK_HEIGHT = 26;
const ANNOTATION_TRACK_GAP = 4;
const RULER_HEIGHT = 22;
const VIDEO_TRACK_HEIGHT = 56;

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function toolIcon(t: Tool) {
  if (t === "pen") return "✏️";
  if (t === "line") return "—";
  if (t === "arrow") return "→";
  return "T";
}

export default function ClipDrawingEditor({ localFile, initialTime = 0, clipRange, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videos, setVideos] = useState<VideoTrack[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState("#ff3333");
  const [strokeSize, setStrokeSize] = useState(3);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [isDown, setIsDown] = useState(false);
  const [textPos, setTextPos] = useState<Pt | null>(null);
  const [textVal, setTextVal] = useState("");
  const [defaultDur, setDefaultDur] = useState(3);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(60);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [dragOp, setDragOp] = useState<{
    kind: "ann-move" | "ann-trim-start" | "ann-trim-end" | "video-trim-start" | "video-trim-end";
    id: string; startX: number; orig1: number; orig2: number;
  } | null>(null);

  const activeVideo = useMemo(() => videos.find(v => v.id === activeVideoId) ?? null, [videos, activeVideoId]);
  const activeClipDur = activeVideo ? Math.max(0, activeVideo.clipEnd - activeVideo.clipStart) : 0;

  // Initial video from props
  useEffect(() => {
    if (!localFile || videos.length > 0) return;
    const url = URL.createObjectURL(localFile);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      const cs = clipRange?.start ?? 0;
      const ce = clipRange?.end ?? probe.duration;
      const v: VideoTrack = {
        id: "v_" + Math.random().toString(36).slice(2, 8),
        file: localFile,
        url,
        fullDuration: probe.duration,
        clipStart: cs,
        clipEnd: Math.min(ce, probe.duration),
      };
      setVideos([v]);
      setActiveVideoId(v.id);
    };
    probe.onerror = () => URL.revokeObjectURL(url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFile]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      videos.forEach(v => URL.revokeObjectURL(v.url));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When active video changes, swap src
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeVideo) return;
    if (v.src !== activeVideo.url) {
      v.src = activeVideo.url;
      v.addEventListener("loadedmetadata", () => {
        v.currentTime = activeVideo.clipStart + initialTime;
      }, { once: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideoId]);

  // Resize canvas to match video
  const syncCanvas = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current; if (!v || !c) return;
    const r = v.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(syncCanvas);
    if (videoRef.current) ro.observe(videoRef.current);
    return () => ro.disconnect();
  }, [syncCanvas]);

  // Render annotation
  const drawAnn = useCallback((ctx: CanvasRenderingContext2D, a: Annotation, scaleX = 1, scaleY = 1) => {
    ctx.save();
    ctx.strokeStyle = a.color; ctx.fillStyle = a.color;
    const sMax = Math.max(scaleX, scaleY);
    ctx.lineWidth = a.size * sMax; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const pts = a.points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));

    if (a.tool === "pen" && pts.length > 1) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }
    if ((a.tool === "line" || a.tool === "arrow") && pts.length === 2) {
      const [p1, p2] = pts;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      if (a.tool === "arrow") {
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const L = (14 + a.size * 2.5) * sMax;
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - L * Math.cos(ang - 0.42), p2.y - L * Math.sin(ang - 0.42));
        ctx.lineTo(p2.x - L * Math.cos(ang + 0.42), p2.y - L * Math.sin(ang + 0.42));
        ctx.closePath(); ctx.fill();
      }
    }
    if (a.tool === "text" && a.text && pts.length) {
      ctx.font = `bold ${(13 + a.size * 5) * sMax}px Inter,Arial,sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 5 * sMax;
      ctx.fillText(a.text, pts[0].x, pts[0].y);
    }
    ctx.restore();
  }, []);

  // RAF render loop
  const render = useCallback(() => {
    const c = canvasRef.current, v = videoRef.current; if (!c || !v || !activeVideo) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }
    syncCanvas();
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const t = v.currentTime - activeVideo.clipStart; // clip-relative
    annotations
      .filter(a => a.videoId === activeVideo.id)
      .forEach(a => {
        const vis = a.duration === 0 ? t >= a.timeIn : (t >= a.timeIn && t < a.timeIn + a.duration);
        if (vis) drawAnn(ctx, a);
      });
    if (drawing && drawing.videoId === activeVideo.id) drawAnn(ctx, drawing);
    rafRef.current = requestAnimationFrame(render);
  }, [annotations, drawing, drawAnn, syncCanvas, activeVideo]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // Video events
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v || !activeVideo) return;
    setCurrentTime(v.currentTime);
    if (v.currentTime >= activeVideo.clipEnd) v.currentTime = activeVideo.clipStart;
  };

  const togglePlay = () => {
    const v = videoRef.current; if (!v || exporting) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  const seek = (clipT: number) => {
    const v = videoRef.current; if (!v || !activeVideo) return;
    const target = activeVideo.clipStart + Math.max(0, Math.min(activeClipDur, clipT));
    v.currentTime = target;
    setCurrentTime(target);
  };

  // Drawing
  const getPos = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPDown = (e: React.PointerEvent) => {
    if (exporting || !activeVideo) return;
    e.preventDefault();
    if (tool === "text") {
      setTextPos(getPos(e)); setTextVal("");
      setTimeout(() => textRef.current?.focus(), 50);
      return;
    }
    setIsDown(true);
    const tClip = (videoRef.current?.currentTime ?? 0) - activeVideo.clipStart;
    setDrawing({
      id: crypto.randomUUID(), tool, color, size: strokeSize,
      points: [getPos(e)], videoId: activeVideo.id,
      timeIn: Math.max(0, tClip), duration: defaultDur,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPMove = (e: React.PointerEvent) => {
    if (!isDown || !drawing) return; e.preventDefault();
    setDrawing(d => {
      if (!d) return null;
      if (d.tool === "pen") return { ...d, points: [...d.points, getPos(e)] };
      return { ...d, points: [d.points[0], getPos(e)] };
    });
  };

  const onPUp = () => {
    if (!drawing) return;
    setIsDown(false);
    if (drawing.points.length > 0) setAnnotations(a => [...a, drawing]);
    setDrawing(null);
  };

  const commitText = () => {
    if (!textPos || !textVal.trim() || !activeVideo) { setTextPos(null); setTextVal(""); return; }
    const tClip = (videoRef.current?.currentTime ?? 0) - activeVideo.clipStart;
    setAnnotations(a => [...a, {
      id: crypto.randomUUID(), tool: "text", color, size: strokeSize,
      points: [textPos], text: textVal.trim(), videoId: activeVideo.id,
      timeIn: Math.max(0, tClip), duration: defaultDur,
    }]);
    setTextPos(null); setTextVal("");
  };

  // Drag handler
  useEffect(() => {
    if (!dragOp) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragOp.startX;
      const dt = dx / pixelsPerSecond;

      if (dragOp.kind === "video-trim-start" || dragOp.kind === "video-trim-end") {
        setVideos(vs => vs.map(v => {
          if (v.id !== dragOp.id) return v;
          if (dragOp.kind === "video-trim-start") {
            const newStart = Math.max(0, Math.min(v.clipEnd - 0.2, dragOp.orig1 + dt));
            return { ...v, clipStart: newStart };
          } else {
            const newEnd = Math.max(v.clipStart + 0.2, Math.min(v.fullDuration, dragOp.orig2 + dt));
            return { ...v, clipEnd: newEnd };
          }
        }));
        return;
      }

      // Annotation drag
      setAnnotations(anns => anns.map(a => {
        if (a.id !== dragOp.id) return a;
        if (dragOp.kind === "ann-move") {
          const newIn = Math.max(0, Math.min(activeClipDur - 0.1, dragOp.orig1 + dt));
          return { ...a, timeIn: newIn };
        }
        if (dragOp.kind === "ann-trim-start") {
          const newIn = Math.max(0, Math.min(dragOp.orig1 + dragOp.orig2 - 0.2, dragOp.orig1 + dt));
          const delta = newIn - dragOp.orig1;
          const newDur = a.duration === 0 ? 0 : Math.max(0.2, dragOp.orig2 - delta);
          return { ...a, timeIn: newIn, duration: newDur };
        }
        if (dragOp.kind === "ann-trim-end") {
          const newDur = Math.max(0.2, dragOp.orig2 + dt);
          return { ...a, duration: newDur };
        }
        return a;
      }));
    };
    const handleUp = () => setDragOp(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragOp, pixelsPerSecond, activeClipDur]);

  // Click on ruler to seek
  const handleRulerClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || !activeVideo) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const newClipT = x / pixelsPerSecond;
    seek(newClipT);
  };

  // Add videos
  const handleAddVideos = () => fileInputRef.current?.click();

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const newVideos: VideoTrack[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      try {
        const fullDuration = await new Promise<number>((resolve, reject) => {
          const probe = document.createElement("video");
          probe.preload = "metadata";
          probe.onloadedmetadata = () => resolve(probe.duration || 0);
          probe.onerror = () => reject(new Error("No se pudo leer el video"));
          probe.src = url;
          setTimeout(() => reject(new Error("Timeout")), 10000);
        });
        newVideos.push({
          id: "v_" + Math.random().toString(36).slice(2, 8),
          file, url, fullDuration,
          clipStart: 0, clipEnd: fullDuration,
        });
      } catch (err) {
        console.error(`No se pudo agregar ${file.name}:`, err);
        URL.revokeObjectURL(url);
      }
    }
    if (newVideos.length > 0) {
      setVideos(vs => [...vs, ...newVideos]);
      if (!activeVideoId) setActiveVideoId(newVideos[0].id);
    }
  };

  const removeVideo = (id: string) => {
    setVideos(vs => {
      const newList = vs.filter(v => v.id !== id);
      const target = vs.find(v => v.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return newList;
    });
    setAnnotations(anns => anns.filter(a => a.videoId !== id));
    if (activeVideoId === id) {
      const remaining = videos.filter(v => v.id !== id);
      setActiveVideoId(remaining[0]?.id ?? null);
    }
  };

  // Export — concatenates clips of all videos, with annotations baked in per-video
  const exportVideoWithAnnotations = async () => {
    const v = videoRef.current;
    if (!v || videos.length === 0) return;

    setExporting(true);
    setExportPct(0);
    if (!v.paused) v.pause();
    setPlaying(false);

    try {
      // Output canvas using first video dimensions
      const firstVideo = videos[0];
      const probe = document.createElement("video");
      probe.src = firstVideo.url; probe.muted = true;
      await new Promise<void>(r => { probe.onloadedmetadata = () => r(); });
      const w = probe.videoWidth || 1280;
      const h = probe.videoHeight || 720;

      const expCanvas = document.createElement("canvas");
      expCanvas.width = w; expCanvas.height = h;
      const expCtx = expCanvas.getContext("2d");
      if (!expCtx) throw new Error("No se pudo crear contexto");

      const previewC = canvasRef.current;
      const previewW = previewC?.width ?? w;
      const previewH = previewC?.height ?? h;
      const scaleX = w / previewW;
      const scaleY = h / previewH;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videoStream = (expCanvas as any).captureStream(30) as MediaStream;
      // Audio from current playback element
      let combined = videoStream;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioStream = (v as any).captureStream?.() as MediaStream | undefined;
        const audioTracks = audioStream?.getAudioTracks() ?? [];
        if (audioTracks.length > 0) combined = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
      } catch { /* no audio */ }

      const candidates = [
        "video/mp4;codecs=avc1",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      let mimeType = "";
      for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) { mimeType = c; break; }
      if (!mimeType) throw new Error("MediaRecorder no soporta video");

      const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";

      const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(200);

      const totalDuration = videos.reduce((sum, vt) => sum + Math.max(0, vt.clipEnd - vt.clipStart), 0);
      let elapsed = 0;

      // Process each video segment sequentially
      for (let vi = 0; vi < videos.length; vi++) {
        const vt = videos[vi];
        const dur = Math.max(0, vt.clipEnd - vt.clipStart);
        if (dur < 0.1) continue;

        // Switch active video
        v.src = vt.url;
        v.muted = false;
        await new Promise<void>(r => {
          const handler = () => { v.removeEventListener("loadedmetadata", handler); r(); };
          v.addEventListener("loadedmetadata", handler);
        });

        v.currentTime = vt.clipStart;
        await new Promise<void>(r => {
          const handler = () => { v.removeEventListener("seeked", handler); r(); };
          v.addEventListener("seeked", handler);
        });

        v.play().catch(() => {});

        let rafId = 0;
        const draw = () => {
          if (v.currentTime >= vt.clipEnd || v.ended) return;
          expCtx.drawImage(v, 0, 0, w, h);
          const t = v.currentTime - vt.clipStart;
          annotations
            .filter(a => a.videoId === vt.id)
            .forEach(a => {
              const vis = a.duration === 0 ? t >= a.timeIn : (t >= a.timeIn && t < a.timeIn + a.duration);
              if (vis) drawAnn(expCtx, a, scaleX, scaleY);
            });
          const localPct = Math.min(1, t / Math.max(0.1, dur));
          const overall = Math.round(((elapsed + localPct * dur) / Math.max(0.1, totalDuration)) * 100);
          setExportPct(overall);
          rafId = requestAnimationFrame(draw);
        };
        rafId = requestAnimationFrame(draw);

        await new Promise<void>(resolve => {
          const check = () => {
            if (v.currentTime >= vt.clipEnd || v.ended) {
              v.pause();
              cancelAnimationFrame(rafId);
              resolve();
            } else setTimeout(check, 80);
          };
          check();
        });

        elapsed += dur;
      }

      // Force a final data flush before stopping
      recorder.requestData();
      await new Promise(r => setTimeout(r, 200));

      const recordedBlob = await new Promise<Blob>((resolve, reject) => {
        let resolved = false;
        recorder.onstop = () => {
          if (resolved) return;
          resolved = true;
          resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.onerror = () => {
          if (resolved) return;
          resolved = true;
          reject(new Error("MediaRecorder error"));
        };
        try {
          if (recorder.state !== "inactive") recorder.stop();
          else resolve(new Blob(chunks, { type: mimeType }));
        } catch (e) {
          if (!resolved) { resolved = true; reject(e); }
        }
        // Hard timeout — never wait more than 5s for stop event
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          resolve(new Blob(chunks, { type: mimeType }));
        }, 5000);
      });

      if (recordedBlob.size === 0) {
        throw new Error("El video grabado salió vacío. Probá de nuevo.");
      }

      const url = URL.createObjectURL(recordedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clip_anotado_${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setExportPct(100);
      // Reset state immediately after download triggered
      setExporting(false);
      setExportPct(0);

      // Restore active video
      if (activeVideo) v.src = activeVideo.url;
    } catch (err) {
      console.error("Export error:", err);
      alert(`Error al exportar: ${err instanceof Error ? err.message : "desconocido"}`);
      setExporting(false);
      setExportPct(0);
    }
  };

  // Tracks for current video annotations
  const annsForActive = useMemo(() =>
    annotations.filter(a => a.videoId === activeVideoId).map((a, i) => ({ ann: a, row: i })),
    [annotations, activeVideoId]
  );
  const timelineWidth = Math.max(800, activeClipDur * pixelsPerSecond + 40);
  const tracksHeight = annsForActive.length * (ANNOTATION_TRACK_HEIGHT + ANNOTATION_TRACK_GAP) + 12;

  const tbtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button key={t} onClick={() => setTool(t)} title={label} disabled={exporting}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all flex items-center gap-1 disabled:opacity-40
        ${tool === t ? "bg-violet-500/25 border-violet-400/60 text-violet-200" : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:text-white"}`}>
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080b0f]">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="video/*" multiple onChange={handleFilesSelected} className="hidden" />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d1117] border-b border-[#21262d] flex-wrap shrink-0">
        <span className="font-display font-bold text-[10px] tracking-widest text-violet-400 uppercase">
          🎬 Editor
        </span>
        <div className="w-px h-4 bg-[#30363d]" />
        {tbtn("pen",   <Pencil className="w-3.5 h-3.5" />, "Trazo")}
        {tbtn("line",  <Minus  className="w-3.5 h-3.5" />, "Línea")}
        {tbtn("arrow", <ArrowRight className="w-3.5 h-3.5" />, "Flecha")}
        {tbtn("text",  <Type   className="w-3.5 h-3.5" />, "Texto")}
        <div className="w-px h-4 bg-[#30363d]" />
        {COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} style={{ background: c }} disabled={exporting}
            className={`w-5 h-5 rounded-full border-2 transition-all disabled:opacity-40 ${color === c ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"}`} />
        ))}
        <div className="w-px h-4 bg-[#30363d]" />
        <div className="flex items-center gap-1.5">
          <span className="text-[#484f58] text-xs font-mono hidden sm:block">Grosor</span>
          <input type="range" min={1} max={10} value={strokeSize} onChange={e => setStrokeSize(+e.target.value)} className="w-14 accent-violet-500" disabled={exporting} />
          <span className="w-4 text-center text-[#8b949e] text-xs font-mono">{strokeSize}</span>
        </div>
        <div className="w-px h-4 bg-[#30363d]" />
        <div className="flex items-center gap-1.5">
          <span className="text-[#484f58] text-xs font-mono hidden sm:block">Duración</span>
          <input type="number" min={0} max={999} step={0.5} value={defaultDur}
            onChange={e => setDefaultDur(Math.max(0, +e.target.value))} disabled={exporting}
            className="w-14 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-violet-500/50 text-center disabled:opacity-40" />
          <span className="text-[#484f58] text-xs font-mono">{defaultDur === 0 ? "∞" : "s"}</span>
        </div>
        <div className="w-px h-4 bg-[#30363d]" />
        <button onClick={() => setAnnotations(a => a.slice(0, -1))} disabled={annotations.length === 0 || exporting}
          className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-[#8b949e] hover:text-white disabled:opacity-30 transition-all">
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => { setAnnotations([]); setSelectedAnnId(null); }} disabled={annotations.length === 0 || exporting}
          className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-rose-400 hover:text-rose-300 disabled:opacity-30 transition-all">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleAddVideos} disabled={exporting}
          className="px-2.5 py-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-[#8b949e] hover:text-white text-xs font-mono flex items-center gap-1 transition-all disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Video</span>
        </button>
        <div className="flex-1" />
        <button onClick={exportVideoWithAnnotations} disabled={exporting || videos.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white text-xs font-bold disabled:opacity-50 transition-all shadow-lg">
          {exporting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {exportPct}%</> : <><Video className="w-3.5 h-3.5" /> Exportar video</>}
        </button>
        <button onClick={onClose} disabled={exporting}
          className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-[#8b949e] hover:text-white transition-all disabled:opacity-40">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Export progress */}
      {exporting && (
        <div className="bg-[#0d1117] border-b border-[#21262d] px-4 py-2">
          <div className="text-xs text-emerald-400 mb-1 font-mono">Grabando con anotaciones... {exportPct}%</div>
          <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all" style={{ width: `${exportPct}%` }} />
          </div>
        </div>
      )}

      {/* Video preview — bigger now */}
      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden min-h-0 relative">
        {videos.length === 0 ? (
          <div className="text-center text-[#484f58]">
            <Video className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm mb-3">Sin videos cargados</p>
            <button onClick={handleAddVideos}
              className="px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-semibold flex items-center gap-2 mx-auto">
              <Plus className="w-4 h-4" /> Agregar video
            </button>
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center">
            <video ref={videoRef}
              className="block max-w-full max-h-full object-contain"
              playsInline
              {...{ "webkit-playsinline": "true" } as Record<string, string>}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <canvas ref={canvasRef}
              className="absolute pointer-events-auto"
              style={{
                width: videoRef.current?.getBoundingClientRect().width,
                height: videoRef.current?.getBoundingClientRect().height,
                cursor: exporting ? "wait" : (tool === "text" ? "text" : "crosshair"),
                touchAction: "none"
              }}
              onPointerDown={onPDown} onPointerMove={onPMove} onPointerUp={onPUp}
            />
            {textPos && (
              <div className="absolute z-20 flex flex-col gap-1"
                style={{ left: textPos.x, top: Math.max(0, textPos.y - 48) }}>
                <input ref={textRef} value={textVal} onChange={e => setTextVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") { setTextPos(null); setTextVal(""); } }}
                  placeholder="Escribí... (Enter para confirmar)"
                  style={{ color, borderColor: color, fontSize: 13 + strokeSize * 3 }}
                  className="bg-black/90 border-2 rounded px-2 py-1 font-bold focus:outline-none min-w-[200px] shadow-2xl" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="bg-[#0d1117] border-t border-[#21262d] px-4 py-2 flex items-center gap-3 shrink-0">
        <button onClick={togglePlay} disabled={exporting || videos.length === 0}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-violet-500 hover:bg-violet-400 text-white transition-all shadow-lg disabled:opacity-40">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <span className="font-mono text-sm text-[#00ff88] tabular-nums">
          {fmt(activeVideo ? currentTime - activeVideo.clipStart : 0)}
        </span>
        <span className="font-mono text-xs text-[#484f58]">/</span>
        <span className="font-mono text-xs text-[#484f58] tabular-nums">{fmt(activeClipDur)}</span>

        <div className="flex-1" />

        {annsForActive.length > 0 && (
          <span className="text-xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
            {annsForActive.length} anotación{annsForActive.length > 1 ? "es" : ""}
          </span>
        )}

        <div className="flex items-center gap-1 bg-[#0a0e13] rounded-lg p-1">
          <button onClick={() => setPixelsPerSecond(p => Math.max(20, p - 20))}
            className="w-7 h-7 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white text-xs flex items-center justify-center transition-colors">−</button>
          <span className="text-xs font-mono text-[#8b949e] px-2">{pixelsPerSecond}px/s</span>
          <button onClick={() => setPixelsPerSecond(p => Math.min(200, p + 20))}
            className="w-7 h-7 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white text-xs flex items-center justify-center transition-colors">+</button>
        </div>
      </div>

      {/* Timeline */}
      <div ref={timelineRef}
        className="bg-[#0a0e13] border-t border-[#21262d] overflow-x-auto overflow-y-auto shrink-0"
        style={{ maxHeight: 280, minHeight: 140 }}>
        <div style={{ width: timelineWidth }}>

          {/* Ruler */}
          <div className="sticky top-0 bg-[#0a0e13] z-20 cursor-pointer"
            style={{ height: RULER_HEIGHT }}
            onClick={handleRulerClick}>
            <div className="relative h-full border-b border-[#21262d]">
              {Array.from({ length: Math.ceil(activeClipDur) + 1 }).map((_, i) => (
                <div key={i} className="absolute top-0 h-full text-[10px] font-mono text-[#484f58] border-l border-[#21262d] flex items-center"
                  style={{ left: i * pixelsPerSecond }}>
                  <span className="ml-1">{fmt(i)}</span>
                </div>
              ))}
              {/* Playhead in ruler */}
              {activeVideo && (
                <div className="absolute top-0 h-full w-0.5 bg-red-500 pointer-events-none z-30"
                  style={{ left: (currentTime - activeVideo.clipStart) * pixelsPerSecond }} />
              )}
            </div>
          </div>

          {/* Video clip rows (one per video, with trim handles) */}
          {videos.map(vt => {
            const isActive = vt.id === activeVideoId;
            const dur = Math.max(0, vt.clipEnd - vt.clipStart);
            return (
              <div key={vt.id}
                onClick={() => setActiveVideoId(vt.id)}
                className={`relative cursor-pointer border-b border-[#21262d] transition-colors ${isActive ? "bg-violet-500/5" : "hover:bg-[#161b22]/50"}`}
                style={{ height: VIDEO_TRACK_HEIGHT }}>

                {/* Track bar */}
                <div className="absolute"
                  style={{ left: 0, top: 8, width: dur * pixelsPerSecond, height: VIDEO_TRACK_HEIGHT - 16 }}>

                  {/* Background = full video range */}
                  <div className={`absolute inset-0 rounded border-2 overflow-hidden ${isActive ? "border-violet-400" : "border-[#30363d]"}`}
                    style={{ background: isActive ? "rgba(139, 92, 246, 0.15)" : "rgba(48, 54, 61, 0.4)" }}>
                    <div className="px-3 h-full flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 truncate">
                        <Scissors className="w-3 h-3 text-violet-400 flex-shrink-0" />
                        <span className="text-white font-mono truncate">{vt.file.name}</span>
                      </div>
                      <span className="text-[#8b949e] font-mono flex-shrink-0">{dur.toFixed(1)}s</span>
                    </div>

                    {/* Trim start handle */}
                    <div onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOp({ kind: "video-trim-start", id: vt.id, startX: e.clientX, orig1: vt.clipStart, orig2: vt.clipEnd });
                    }}
                      className="absolute left-0 top-0 w-2 h-full bg-white/30 hover:bg-white/60 cursor-ew-resize z-20" title="Recortar inicio" />

                    {/* Trim end handle */}
                    <div onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOp({ kind: "video-trim-end", id: vt.id, startX: e.clientX, orig1: vt.clipStart, orig2: vt.clipEnd });
                    }}
                      className="absolute right-0 top-0 w-2 h-full bg-white/30 hover:bg-white/60 cursor-ew-resize z-20" title="Recortar fin" />
                  </div>
                </div>

                {/* Delete video button (only if multiple) */}
                {videos.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeVideo(vt.id); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded bg-red-500/80 hover:bg-red-500 text-white flex items-center justify-center z-20"
                    title="Eliminar video">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Annotation tracks (only for active video) */}
          {activeVideo && annsForActive.length > 0 && (
            <div className="relative pt-2" style={{ height: tracksHeight }}>
              {/* Playhead */}
              <div className="absolute top-0 h-full w-0.5 bg-red-500 pointer-events-none z-30"
                style={{ left: (currentTime - activeVideo.clipStart) * pixelsPerSecond }} />

              {annsForActive.map(({ ann, row }) => {
                const isSelected = selectedAnnId === ann.id;
                const left = ann.timeIn * pixelsPerSecond;
                const width = (ann.duration === 0 ? activeClipDur - ann.timeIn : ann.duration) * pixelsPerSecond;
                const top = row * (ANNOTATION_TRACK_HEIGHT + ANNOTATION_TRACK_GAP) + 6;

                return (
                  <div key={ann.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedAnnId(ann.id === selectedAnnId ? null : ann.id); seek(ann.timeIn); }}
                    onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOp({ kind: "ann-move", id: ann.id, startX: e.clientX, orig1: ann.timeIn, orig2: ann.duration });
                    }}
                    className={`absolute rounded border-2 overflow-hidden cursor-grab active:cursor-grabbing transition-all flex items-center
                      ${isSelected ? "border-white shadow-lg" : "border-transparent hover:border-white/40"}`}
                    style={{
                      left, width: Math.max(20, width), height: ANNOTATION_TRACK_HEIGHT, top,
                      background: `${ann.color}30`,
                      borderLeftColor: isSelected ? "white" : ann.color,
                      borderRightColor: isSelected ? "white" : ann.color,
                    }}
                  >
                    {/* Trim start */}
                    <div onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOp({ kind: "ann-trim-start", id: ann.id, startX: e.clientX, orig1: ann.timeIn, orig2: ann.duration });
                    }}
                      className="absolute left-0 top-0 w-2 h-full bg-white/30 hover:bg-white/60 cursor-ew-resize z-20" />
                    {ann.duration > 0 && (
                      <div onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setDragOp({ kind: "ann-trim-end", id: ann.id, startX: e.clientX, orig1: ann.timeIn, orig2: ann.duration });
                      }}
                        className="absolute right-0 top-0 w-2 h-full bg-white/30 hover:bg-white/60 cursor-ew-resize z-20" />
                    )}
                    <div className="px-3 flex items-center gap-1.5 text-[10px] font-mono pointer-events-none truncate text-white">
                      <span style={{ color: ann.color }}>{toolIcon(ann.tool)}</span>
                      {ann.tool === "text" && ann.text ? `"${ann.text.slice(0, 20)}${ann.text.length > 20 ? "…" : ""}"` : ann.tool}
                      <span className="text-white/60">· {ann.duration === 0 ? "∞" : `${ann.duration.toFixed(1)}s`}</span>
                    </div>

                    {isSelected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setAnnotations(a => a.filter(x => x.id !== ann.id)); setSelectedAnnId(null); }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 z-30 rounded bg-red-500 hover:bg-red-400 text-white w-4 h-4 flex items-center justify-center pointer-events-auto"
                        title="Borrar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
