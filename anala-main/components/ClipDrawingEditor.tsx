"use client";
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Play, Pause, Undo2, Trash2, Download, X, Minus, ArrowRight, Type, Pencil, Loader2, Video } from "lucide-react";
import type { SportEvent } from "@/types";

type Tool = "pen" | "line" | "arrow" | "text";
interface Pt { x: number; y: number; }
interface Annotation {
  id: string; tool: Tool; color: string; size: number;
  points: Pt[]; text?: string;
  timeIn: number;     // seconds, clip-relative
  duration: number;   // seconds (0 = until end of clip)
}

interface Props {
  localFile: File | null;
  initialTime?: number;
  clipRange?: { start: number; end: number } | null;
  events?: SportEvent[];
  onClose: () => void;
}

const COLORS = ["#ffffff", "#ff3333", "#33ff88", "#3388ff", "#ffcc00", "#ff33cc", "#00ccff", "#ff8800"];
const TRACK_HEIGHT = 28;
const TRACK_GAP = 4;
const RULER_HEIGHT = 22;

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

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [videoDuration, setVideoDuration] = useState(0);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState("#ff3333");
  const [strokeSize, setStrokeSize] = useState(3);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [isDown, setIsDown] = useState(false);
  const [textPos, setTextPos] = useState<Pt | null>(null);
  const [textVal, setTextVal] = useState("");
  const [defaultDur, setDefaultDur] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(60);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [dragOp, setDragOp] = useState<{
    id: string; mode: "move" | "trim-start" | "trim-end";
    startX: number; origIn: number; origDur: number;
  } | null>(null);

  const clipStart = clipRange?.start ?? 0;
  const clipEnd   = clipRange?.end   ?? Infinity;
  const clipDur   = clipRange ? Math.max(0, clipEnd - clipStart) : videoDuration;
  const layoutDur = clipDur > 0 && clipDur < Infinity ? clipDur : Math.max(videoDuration, 10);

  // Setup video src
  useEffect(() => {
    if (!localFile) return;
    const url = URL.createObjectURL(localFile);
    const v = videoRef.current; if (!v) return;
    v.src = url;
    return () => URL.revokeObjectURL(url);
  }, [localFile]);

  // Resize canvas to match video element pixel dimensions
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

  // Render an annotation onto a 2D context. scaleX/Y allow rendering on
  // an offscreen canvas at arbitrary resolution (used for export).
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
    const c = canvasRef.current, v = videoRef.current; if (!c || !v) return;
    syncCanvas();
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const t = v.currentTime - clipStart;
    annotations.forEach(a => {
      const vis = a.duration === 0 ? t >= a.timeIn : (t >= a.timeIn && t < a.timeIn + a.duration);
      if (vis) drawAnn(ctx, a);
    });
    if (drawing) drawAnn(ctx, drawing);
    rafRef.current = requestAnimationFrame(render);
  }, [annotations, drawing, drawAnn, syncCanvas, clipStart]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // Video events
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    setCurrentTime(v.currentTime);
    if (clipRange && v.currentTime >= clipEnd) v.currentTime = clipStart;
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current; if (!v) return;
    setVideoDuration(v.duration);
    v.currentTime = initialTime;
  };

  const togglePlay = () => {
    const v = videoRef.current; if (!v || exporting) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  const seek = (clipT: number) => {
    const v = videoRef.current; if (!v) return;
    const target = clipStart + Math.max(0, Math.min(layoutDur, clipT));
    v.currentTime = target;
    setCurrentTime(target);
  };

  // Pointer on canvas (drawing)
  const getPos = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPDown = (e: React.PointerEvent) => {
    if (exporting) return;
    e.preventDefault();
    if (tool === "text") {
      setTextPos(getPos(e)); setTextVal("");
      setTimeout(() => textRef.current?.focus(), 50);
      return;
    }
    setIsDown(true);
    const tClip = (videoRef.current?.currentTime ?? 0) - clipStart;
    setDrawing({
      id: crypto.randomUUID(), tool, color, size: strokeSize,
      points: [getPos(e)], timeIn: Math.max(0, tClip), duration: defaultDur,
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
    if (!textPos || !textVal.trim()) { setTextPos(null); setTextVal(""); return; }
    const tClip = (videoRef.current?.currentTime ?? 0) - clipStart;
    setAnnotations(a => [...a, {
      id: crypto.randomUUID(), tool: "text", color, size: strokeSize,
      points: [textPos], text: textVal.trim(),
      timeIn: Math.max(0, tClip), duration: defaultDur,
    }]);
    setTextPos(null); setTextVal("");
  };

  // ─── Track timeline drag/trim ────────────────────────────────────────────
  useEffect(() => {
    if (!dragOp) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragOp.startX;
      const dt = dx / pixelsPerSecond;
      setAnnotations(anns => anns.map(a => {
        if (a.id !== dragOp.id) return a;
        if (dragOp.mode === "move") {
          const newIn = Math.max(0, Math.min(layoutDur - 0.1, dragOp.origIn + dt));
          return { ...a, timeIn: newIn };
        }
        if (dragOp.mode === "trim-start") {
          const newIn = Math.max(0, Math.min(dragOp.origIn + dragOp.origDur - 0.2, dragOp.origIn + dt));
          const delta = newIn - dragOp.origIn;
          const newDur = a.duration === 0 ? 0 : Math.max(0.2, dragOp.origDur - delta);
          return { ...a, timeIn: newIn, duration: newDur };
        }
        if (dragOp.mode === "trim-end") {
          const newDur = Math.max(0.2, dragOp.origDur + dt);
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
  }, [dragOp, pixelsPerSecond, layoutDur]);

  // Click on ruler to seek
  const handleRulerClick = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const newClipT = x / pixelsPerSecond;
    seek(newClipT);
  };

  // ─── Export video with annotations baked in ──────────────────────────────
  const exportVideoWithAnnotations = async () => {
    const v = videoRef.current;
    if (!v || !localFile) return;

    setExporting(true);
    setExportPct(0);
    if (!v.paused) v.pause();
    setPlaying(false);

    try {
      const w = v.videoWidth || 1280;
      const h = v.videoHeight || 720;

      // Offscreen canvas for export
      const expCanvas = document.createElement("canvas");
      expCanvas.width = w; expCanvas.height = h;
      const expCtx = expCanvas.getContext("2d");
      if (!expCtx) throw new Error("No se pudo crear contexto");

      // Scale annotations from preview canvas size to source video size
      const previewC = canvasRef.current;
      const previewW = previewC?.width ?? w;
      const previewH = previewC?.height ?? h;
      const scaleX = w / previewW;
      const scaleY = h / previewH;

      // Set up MediaRecorder on captured canvas stream
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videoStream = (expCanvas as any).captureStream(30) as MediaStream;

      // Try to grab audio from the video element
      let combined = videoStream;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioStream = (v as any).captureStream?.() as MediaStream | undefined;
        const audioTracks = audioStream?.getAudioTracks() ?? [];
        if (audioTracks.length > 0) {
          combined = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
        }
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

      // Seek to clip start, then play & draw
      v.currentTime = clipStart;
      await new Promise<void>(resolve => {
        const handler = () => { v.removeEventListener("seeked", handler); resolve(); };
        v.addEventListener("seeked", handler);
      });

      recorder.start(200);
      v.muted = false;
      v.play().catch(() => {});

      let rafId = 0;
      const draw = () => {
        if (v.currentTime >= clipEnd || v.ended) return;
        // Draw current video frame
        expCtx.drawImage(v, 0, 0, w, h);
        // Overlay visible annotations
        const t = v.currentTime - clipStart;
        annotations.forEach(a => {
          const vis = a.duration === 0 ? t >= a.timeIn : (t >= a.timeIn && t < a.timeIn + a.duration);
          if (vis) drawAnn(expCtx, a, scaleX, scaleY);
        });
        const pct = Math.min(100, Math.round((t / Math.max(0.1, clipDur)) * 100));
        setExportPct(pct);
        rafId = requestAnimationFrame(draw);
      };
      rafId = requestAnimationFrame(draw);

      // Wait until clipEnd
      await new Promise<void>(resolve => {
        const check = () => {
          if (v.currentTime >= clipEnd || v.ended) {
            v.pause();
            cancelAnimationFrame(rafId);
            resolve();
          } else {
            setTimeout(check, 80);
          }
        };
        check();
      });

      const recordedBlob = await new Promise<Blob>(resolve => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder.stop();
      });

      const url = URL.createObjectURL(recordedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clip_anotado_${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setExportPct(100);
      setTimeout(() => { setExporting(false); setExportPct(0); }, 1500);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Error al exportar: ${err instanceof Error ? err.message : "desconocido"}`);
      setExporting(false);
      setExportPct(0);
    }
  };

  // ─── Tracks layout (one annotation per row) ──────────────────────────────
  const tracks = useMemo(() => annotations.map((a, i) => ({ ann: a, row: i })), [annotations]);
  const timelineWidth = Math.max(800, layoutDur * pixelsPerSecond + 40);
  const tracksHeight = tracks.length * (TRACK_HEIGHT + TRACK_GAP) + RULER_HEIGHT + 12;

  const tbtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button key={t} onClick={() => setTool(t)} title={label} disabled={exporting}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all flex items-center gap-1 disabled:opacity-40
        ${tool === t ? "bg-violet-500/25 border-violet-400/60 text-violet-200" : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:text-white"}`}>
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080b0f]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d1117] border-b border-[#21262d] flex-wrap shrink-0">
        <span className="font-display font-bold text-[10px] tracking-widest text-violet-400 uppercase">
          {clipRange ? "✂️ Editor de Clip" : "🎨 Editor"}
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
        <button onClick={() => { setAnnotations([]); setSelectedId(null); }} disabled={annotations.length === 0 || exporting}
          className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-rose-400 hover:text-rose-300 disabled:opacity-30 transition-all">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button onClick={exportVideoWithAnnotations} disabled={exporting || !localFile}
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
          <div className="text-xs text-emerald-400 mb-1 font-mono">Grabando video con anotaciones... {exportPct}%</div>
          <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all" style={{ width: `${exportPct}%` }} />
          </div>
        </div>
      )}

      {/* Video + canvas */}
      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden min-h-0">
        <div className="relative">
          <video ref={videoRef}
            className="block max-w-full object-contain"
            style={{ maxHeight: "calc(100vh - 380px)" }}
            playsInline
            {...{ "webkit-playsinline": "true" } as Record<string, string>}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <canvas ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: exporting ? "wait" : (tool === "text" ? "text" : "crosshair"), touchAction: "none" }}
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
              <div className="flex gap-1">
                <button onClick={commitText} className="text-xs px-2 py-0.5 bg-violet-500/30 border border-violet-500/50 text-violet-200 rounded font-mono">OK</button>
                <button onClick={() => { setTextPos(null); setTextVal(""); }} className="text-xs px-2 py-0.5 bg-[#161b22] border border-[#30363d] text-[#8b949e] rounded font-mono">✕</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Playback controls + zoom */}
      <div className="bg-[#0d1117] border-t border-[#21262d] px-4 py-2 flex items-center gap-3 shrink-0">
        <button onClick={togglePlay} disabled={exporting}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-violet-500 hover:bg-violet-400 text-white transition-all shadow-lg disabled:opacity-40">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <span className="font-mono text-sm text-[#00ff88] tabular-nums">{fmt(currentTime - clipStart)}</span>
        <span className="font-mono text-xs text-[#484f58]">/</span>
        <span className="font-mono text-xs text-[#484f58] tabular-nums">{fmt(layoutDur)}</span>

        <div className="flex-1" />

        {annotations.length > 0 && (
          <span className="text-xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
            {annotations.length} track{annotations.length > 1 ? "s" : ""}
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

      {/* Timeline with tracks */}
      <div ref={timelineRef}
        className="bg-[#0a0e13] border-t border-[#21262d] overflow-x-auto overflow-y-auto shrink-0"
        style={{ maxHeight: 220, minHeight: 100 }}>

        {/* Ruler */}
        <div className="sticky top-0 bg-[#0a0e13] z-20 cursor-pointer"
          style={{ height: RULER_HEIGHT, width: timelineWidth }}
          onClick={handleRulerClick}>
          <div className="relative h-full border-b border-[#21262d]">
            {Array.from({ length: Math.ceil(layoutDur) + 1 }).map((_, i) => (
              <div key={i} className="absolute top-0 h-full text-[10px] font-mono text-[#484f58] border-l border-[#21262d] flex items-center"
                style={{ left: i * pixelsPerSecond }}>
                <span className="ml-1">{fmt(i)}</span>
              </div>
            ))}
            {/* Playhead */}
            <div className="absolute top-0 h-full w-0.5 bg-red-500 pointer-events-none z-30"
              style={{ left: (currentTime - clipStart) * pixelsPerSecond }} />
          </div>
        </div>

        {/* Track rows */}
        <div className="relative" style={{ width: timelineWidth, height: tracksHeight - RULER_HEIGHT }}>
          {/* Continuous playhead through tracks */}
          <div className="absolute top-0 h-full w-0.5 bg-red-500 pointer-events-none z-30"
            style={{ left: (currentTime - clipStart) * pixelsPerSecond }} />

          {tracks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[#484f58] text-xs font-mono">
              Dibujá sobre el video para crear tu primera anotación
            </div>
          )}

          {tracks.map(({ ann, row }) => {
            const isSelected = selectedId === ann.id;
            const left = ann.timeIn * pixelsPerSecond;
            const width = (ann.duration === 0 ? layoutDur - ann.timeIn : ann.duration) * pixelsPerSecond;
            const top = row * (TRACK_HEIGHT + TRACK_GAP) + 6;
            return (
              <div key={ann.id} className="absolute" style={{ top, left: 0, right: 0, height: TRACK_HEIGHT }}>
                {/* Row label (sticky-left would be nice but ok) */}
                <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 pointer-events-none flex items-center gap-1 text-[10px] font-mono text-[#484f58]">
                  <span style={{ color: ann.color }}>{toolIcon(ann.tool)}</span>
                </div>

                {/* Clip block */}
                <div
                  onClick={(e) => { e.stopPropagation(); setSelectedId(ann.id === selectedId ? null : ann.id); seek(ann.timeIn); }}
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setDragOp({ id: ann.id, mode: "move", startX: e.clientX, origIn: ann.timeIn, origDur: ann.duration });
                  }}
                  className={`absolute rounded border-2 overflow-hidden cursor-grab active:cursor-grabbing transition-all flex items-center px-2
                    ${isSelected ? "border-white shadow-lg" : "border-transparent hover:border-white/40"}`}
                  style={{
                    left, width: Math.max(10, width), height: TRACK_HEIGHT,
                    background: `${ann.color}30`,
                    borderLeftColor: isSelected ? "white" : ann.color,
                    borderRightColor: isSelected ? "white" : ann.color,
                  }}
                >
                  {/* Trim start handle */}
                  <div onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setDragOp({ id: ann.id, mode: "trim-start", startX: e.clientX, origIn: ann.timeIn, origDur: ann.duration });
                  }}
                    className="absolute left-0 top-0 w-2 h-full bg-white/30 hover:bg-white/60 cursor-ew-resize z-20" />

                  {/* Trim end handle (only if duration > 0) */}
                  {ann.duration > 0 && (
                    <div onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOp({ id: ann.id, mode: "trim-end", startX: e.clientX, origIn: ann.timeIn, origDur: ann.duration });
                    }}
                      className="absolute right-0 top-0 w-2 h-full bg-white/30 hover:bg-white/60 cursor-ew-resize z-20" />
                  )}

                  {/* Label */}
                  <div className="px-2 flex items-center gap-1.5 text-[10px] font-mono pointer-events-none truncate" style={{ color: "#fff" }}>
                    <span style={{ color: ann.color }}>{toolIcon(ann.tool)}</span>
                    {ann.tool === "text" && ann.text ? `"${ann.text.slice(0, 20)}${ann.text.length > 20 ? "…" : ""}"` : ann.tool}
                    <span className="text-white/60">· {ann.duration === 0 ? "∞" : `${ann.duration.toFixed(1)}s`}</span>
                  </div>
                </div>

                {/* Delete button when selected */}
                {isSelected && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setAnnotations(a => a.filter(x => x.id !== ann.id)); setSelectedId(null); }}
                    className="absolute z-30 rounded bg-red-500 hover:bg-red-400 text-white w-5 h-5 flex items-center justify-center"
                    style={{ left: left + Math.max(10, width) - 22, top: 4 }}
                    title="Borrar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
