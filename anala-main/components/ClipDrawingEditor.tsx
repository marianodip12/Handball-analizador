"use client";
import React, { useRef, useEffect, useState, useCallback } from "react";
import { Play, Pause, Undo2, Trash2, Download, X, Minus, ArrowRight, Type, Pencil, SkipBack, SkipForward } from "lucide-react";
import type { SportEvent } from "@/types";

type Tool = "pen" | "line" | "arrow" | "text";
interface Pt { x: number; y: number; }
interface Annotation {
  id: string; tool: Tool; color: string; size: number;
  points: Pt[]; text?: string;
  timeIn: number; duration: number; // 0 = permanent
}

interface Props {
  localFile: File | null;
  initialTime?: number;
  clipRange?: { start: number; end: number } | null;
  events?: SportEvent[];
  onClose: () => void;
}

const COLORS = ["#ffffff","#ff3333","#33ff88","#3388ff","#ffcc00","#ff33cc","#00ccff","#ff8800"];

function fmt(t: number) {
  const m = Math.floor(t/60), s = Math.floor(t%60), cs = Math.floor((t%1)*100);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}

export default function ClipDrawingEditor({ localFile, initialTime=0, clipRange, onClose }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  const [playing, setPlaying]         = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration]       = useState(0);
  const [tool, setTool]               = useState<Tool>("arrow");
  const [color, setColor]             = useState("#ff3333");
  const [strokeSize, setStrokeSize]   = useState(3);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawing, setDrawing]         = useState<Annotation | null>(null);
  const [isDown, setIsDown]           = useState(false);
  const [textPos, setTextPos]         = useState<Pt | null>(null);
  const [textVal, setTextVal]         = useState("");
  const [annDur, setAnnDur]           = useState(3);
  const [selectedId, setSelectedId]   = useState<string|null>(null);
  const textRef = useRef<HTMLInputElement>(null);

  const clipStart = clipRange?.start ?? 0;
  const clipEnd   = clipRange?.end   ?? Infinity;

  // Setup video
  useEffect(() => {
    if (!localFile) return;
    const url = URL.createObjectURL(localFile);
    const v = videoRef.current; if (!v) return;
    v.src = url; v.currentTime = initialTime;
    return () => URL.revokeObjectURL(url);
  }, [localFile, initialTime]);

  // Sync canvas size
  const syncCanvas = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current; if (!v||!c) return;
    const r = v.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (c.width!==w||c.height!==h) { c.width=w; c.height=h; }
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(syncCanvas);
    if (videoRef.current) ro.observe(videoRef.current);
    return () => ro.disconnect();
  }, [syncCanvas]);

  // Draw one annotation
  const drawAnn = useCallback((ctx: CanvasRenderingContext2D, a: Annotation) => {
    ctx.save();
    ctx.strokeStyle=a.color; ctx.fillStyle=a.color;
    ctx.lineWidth=a.size; ctx.lineCap="round"; ctx.lineJoin="round";
    if (a.tool==="pen" && a.points.length>1) {
      ctx.beginPath(); ctx.moveTo(a.points[0].x,a.points[0].y);
      a.points.slice(1).forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke();
    }
    if ((a.tool==="line"||a.tool==="arrow") && a.points.length===2) {
      const [p1,p2]=a.points;
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
      if (a.tool==="arrow") {
        const ang=Math.atan2(p2.y-p1.y,p2.x-p1.x), L=14+a.size*2.5;
        ctx.beginPath();
        ctx.moveTo(p2.x,p2.y);
        ctx.lineTo(p2.x-L*Math.cos(ang-0.42),p2.y-L*Math.sin(ang-0.42));
        ctx.lineTo(p2.x-L*Math.cos(ang+0.42),p2.y-L*Math.sin(ang+0.42));
        ctx.closePath(); ctx.fill();
      }
    }
    if (a.tool==="text"&&a.text&&a.points.length) {
      ctx.font=`bold ${13+a.size*5}px Inter,Arial,sans-serif`;
      ctx.shadowColor="rgba(0,0,0,0.9)"; ctx.shadowBlur=5;
      ctx.fillText(a.text,a.points[0].x,a.points[0].y);
    }
    ctx.restore();
  }, []);

  // RAF render loop
  const render = useCallback(() => {
    const c=canvasRef.current, v=videoRef.current; if(!c||!v) return;
    syncCanvas();
    const ctx=c.getContext("2d")!;
    ctx.clearRect(0,0,c.width,c.height);
    const t=v.currentTime;
    annotations.forEach(a => {
      const vis = a.duration===0 ? t>=a.timeIn : (t>=a.timeIn && t<a.timeIn+a.duration);
      if (vis) drawAnn(ctx,a);
    });
    if (drawing) drawAnn(ctx,drawing);
    rafRef.current=requestAnimationFrame(render);
  }, [annotations,drawing,drawAnn,syncCanvas]);

  useEffect(() => {
    rafRef.current=requestAnimationFrame(render);
    return ()=>cancelAnimationFrame(rafRef.current);
  }, [render]);

  // Video events
  const onTimeUpdate = () => {
    const v=videoRef.current; if(!v) return;
    setCurrentTime(v.currentTime);
    if (clipRange && v.currentTime>=clipEnd) { v.currentTime=clipStart; }
  };
  const onLoadedMetadata = () => {
    const v=videoRef.current; if(!v) return;
    setDuration(clipRange ? clipEnd-clipStart : v.duration);
  };

  const togglePlay = () => {
    const v=videoRef.current; if(!v) return;
    if(v.paused){v.play();setPlaying(true);}else{v.pause();setPlaying(false);}
  };
  const seek = (t:number) => {
    const v=videoRef.current; if(!v) return;
    v.currentTime=Math.max(clipStart,Math.min(clipEnd===Infinity?v.duration:clipEnd,t));
    setCurrentTime(v.currentTime);
  };

  // Pointer events on canvas
  const getPos = (e:React.PointerEvent):Pt => {
    const r=canvasRef.current!.getBoundingClientRect();
    return {x:e.clientX-r.left,y:e.clientY-r.top};
  };

  const onPDown = (e:React.PointerEvent) => {
    e.preventDefault();
    if(tool==="text"){setTextPos(getPos(e));setTextVal("");setTimeout(()=>textRef.current?.focus(),50);return;}
    setIsDown(true);
    const t=videoRef.current?.currentTime??0;
    setDrawing({id:crypto.randomUUID(),tool,color,size:strokeSize,points:[getPos(e)],timeIn:t,duration:annDur});
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPMove = (e:React.PointerEvent) => {
    if(!isDown||!drawing) return; e.preventDefault();
    const p=getPos(e);
    setDrawing(d=>!d?null:d.tool==="pen"?{...d,points:[...d.points,p]}:{...d,points:[d.points[0],p]});
  };
  const onPUp = (e:React.PointerEvent) => {
    e.preventDefault(); if(!isDown||!drawing) return;
    setIsDown(false);
    if(drawing.points.length>=1) setAnnotations(a=>[...a,drawing]);
    setDrawing(null);
  };

  const commitText = () => {
    if(textPos&&textVal.trim()) {
      const t=videoRef.current?.currentTime??0;
      setAnnotations(a=>[...a,{id:crypto.randomUUID(),tool:"text",color,size:strokeSize,points:[textPos],text:textVal,timeIn:t,duration:annDur}]);
    }
    setTextPos(null); setTextVal("");
  };

  const exportFrame = () => {
    const v=videoRef.current,c=canvasRef.current; if(!v||!c) return;
    const out=document.createElement("canvas");
    out.width=v.videoWidth||c.width; out.height=v.videoHeight||c.height;
    const ctx=out.getContext("2d")!;
    ctx.drawImage(v,0,0,out.width,out.height);
    const sx=out.width/c.width, sy=out.height/c.height;
    ctx.save(); ctx.scale(sx,sy);
    const t=v.currentTime;
    annotations.forEach(a=>{
      const vis=a.duration===0?t>=a.timeIn:(t>=a.timeIn&&t<a.timeIn+a.duration);
      if(vis) drawAnn(ctx,a);
    });
    ctx.restore();
    out.toBlob(blob=>{
      if(!blob) return;
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`frame_${Date.now()}.png`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),3000);
    },"image/png");
  };

  const progress=duration>0?((currentTime-clipStart)/duration)*100:0;

  const tbtn=(t:Tool,icon:React.ReactNode,label:string)=>(
    <button key={t} onClick={()=>setTool(t)} title={label}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all flex items-center gap-1
        ${tool===t?"bg-violet-500/25 border-violet-400/60 text-violet-200":"bg-[#161b22] border-[#30363d] text-[#8b949e] hover:text-white"}`}>
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080b0f]">

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d1117] border-b border-[#21262d] flex-wrap shrink-0">
        <span className="font-display font-bold text-[10px] tracking-widest text-violet-400 uppercase">
          {clipRange?"✂️ Editor de Clip":"🎨 Editor"}
        </span>
        <div className="w-px h-4 bg-[#30363d]"/>
        {tbtn("pen",   <Pencil className="w-3.5 h-3.5"/>,"Trazo")}
        {tbtn("line",  <Minus  className="w-3.5 h-3.5"/>,"Línea")}
        {tbtn("arrow", <ArrowRight className="w-3.5 h-3.5"/>,"Flecha")}
        {tbtn("text",  <Type   className="w-3.5 h-3.5"/>,"Texto")}
        <div className="w-px h-4 bg-[#30363d]"/>
        {COLORS.map(c=>(
          <button key={c} onClick={()=>setColor(c)} style={{background:c}}
            className={`w-5 h-5 rounded-full border-2 transition-all ${color===c?"border-white scale-110":"border-transparent opacity-60 hover:opacity-100"}`}/>
        ))}
        <div className="w-px h-4 bg-[#30363d]"/>
        <div className="flex items-center gap-1.5">
          <span className="text-[#484f58] text-xs font-mono hidden sm:block">Grosor</span>
          <input type="range" min={1} max={10} value={strokeSize} onChange={e=>setStrokeSize(+e.target.value)} className="w-14 accent-violet-500"/>
          <span className="w-4 text-center text-[#8b949e] text-xs font-mono">{strokeSize}</span>
        </div>
        <div className="w-px h-4 bg-[#30363d]"/>
        <div className="flex items-center gap-1.5">
          <span className="text-[#484f58] text-xs font-mono hidden sm:block">Duración</span>
          <input
            type="number" min={0} max={999} step={0.5}
            value={annDur}
            onChange={e => setAnnDur(Math.max(0, +e.target.value))}
            className="w-16 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs font-mono text-[#8b949e] focus:outline-none focus:border-violet-500/50 text-center"
          />
          <span className="text-[#484f58] text-xs font-mono">{annDur === 0 ? "∞" : "seg"}</span>
        </div>
        <div className="w-px h-4 bg-[#30363d]"/>
        <button onClick={()=>setAnnotations(a=>a.slice(0,-1))} disabled={annotations.length===0}
          className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-[#8b949e] hover:text-white disabled:opacity-30 transition-all">
          <Undo2 className="w-3.5 h-3.5"/>
        </button>
        <button onClick={()=>setAnnotations([])} disabled={annotations.length===0}
          className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-rose-400 hover:text-rose-300 disabled:opacity-30 transition-all">
          <Trash2 className="w-3.5 h-3.5"/>
        </button>
        <button onClick={exportFrame}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-400 text-xs font-mono transition-all">
          <Download className="w-3.5 h-3.5"/><span className="hidden sm:inline">Frame PNG</span>
        </button>
        <div className="flex-1"/>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-[#8b949e] hover:text-white transition-all">
          <X className="w-3.5 h-3.5"/>
        </button>
      </div>

      {/* Video + canvas */}
      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
        <div className="relative">
          <video ref={videoRef}
            className="block max-w-full object-contain"
            style={{maxHeight:"calc(100vh - 185px)"}}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
            onPlay={()=>setPlaying(true)}
            onPause={()=>setPlaying(false)}
          />
          <canvas ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{cursor:tool==="text"?"text":"crosshair",touchAction:"none"}}
            onPointerDown={onPDown} onPointerMove={onPMove} onPointerUp={onPUp}
          />
          {textPos && (
            <div className="absolute z-20 flex flex-col gap-1"
              style={{left:textPos.x,top:Math.max(0,textPos.y-48)}}>
              <input ref={textRef} value={textVal} onChange={e=>setTextVal(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")commitText();if(e.key==="Escape"){setTextPos(null);setTextVal("");}}}
                placeholder="Escribí... (Enter para confirmar)"
                style={{color,borderColor:color,fontSize:13+strokeSize*3}}
                className="bg-black/90 border-2 rounded px-2 py-1 font-bold focus:outline-none min-w-[200px] shadow-2xl"
              />
              <div className="flex gap-1">
                <button onClick={commitText} className="text-xs px-2 py-0.5 bg-violet-500/30 border border-violet-500/50 text-violet-200 rounded font-mono">OK</button>
                <button onClick={()=>{setTextPos(null);setTextVal("");}} className="text-xs px-2 py-0.5 bg-[#161b22] border border-[#30363d] text-[#8b949e] rounded font-mono">✕</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls + timeline */}
      <div className="bg-[#0d1117] border-t border-[#21262d] px-4 py-3 flex flex-col gap-2.5 shrink-0">

        {/* Timeline scrubber */}
        <div className="relative w-full h-5 flex items-center">
          <div className="w-full h-1.5 bg-[#21262d] rounded-full cursor-pointer"
            onClick={e=>{const r=e.currentTarget.getBoundingClientRect();seek(clipStart+(e.clientX-r.left)/r.width*duration);}}>
            <div className="h-full bg-violet-500 rounded-full pointer-events-none" style={{width:`${Math.min(100,progress)}%`}}/>
          </div>
          {/* Annotation markers */}
          {annotations.map(a=>{
            const pct=duration>0?((a.timeIn-clipStart)/duration)*100:0;
            return (
              <div key={a.id} onClick={()=>{seek(a.timeIn);setSelectedId(a.id===selectedId?null:a.id);}}
                title={`${a.tool} ${fmt(a.timeIn)} · ${a.duration===0?"∞":a.duration+"s"}`}
                className="absolute -translate-x-1/2 top-0 cursor-pointer z-10"
                style={{left:`${pct}%`}}>
                <div style={{background:a.color}}
                  className={`w-3 h-3 rounded-full border-2 transition-all ${a.id===selectedId?"border-white scale-150":"border-[#0d1117]"}`}/>
              </div>
            );
          })}
        </div>

        {/* Playback buttons */}
        <div className="flex items-center gap-3">
          <button onClick={()=>seek((videoRef.current?.currentTime??0)-5)}
            className="p-1.5 rounded-lg hover:bg-[#21262d] text-[#8b949e] hover:text-white transition-all">
            <SkipBack className="w-4 h-4"/>
          </button>
          <button onClick={togglePlay}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-violet-500 hover:bg-violet-400 text-white transition-all shadow-lg">
            {playing?<Pause className="w-4 h-4"/>:<Play className="w-4 h-4 ml-0.5"/>}
          </button>
          <button onClick={()=>seek((videoRef.current?.currentTime??0)+5)}
            className="p-1.5 rounded-lg hover:bg-[#21262d] text-[#8b949e] hover:text-white transition-all">
            <SkipForward className="w-4 h-4"/>
          </button>
          <span className="font-mono text-sm text-[#00ff88] tabular-nums">{fmt(currentTime)}</span>
          <span className="font-mono text-xs text-[#484f58]">/</span>
          <span className="font-mono text-xs text-[#484f58] tabular-nums">{fmt(clipRange?clipEnd:duration)}</span>
          <div className="flex-1"/>
          {selectedId && (
            <button onClick={()=>{setAnnotations(a=>a.filter(x=>x.id!==selectedId));setSelectedId(null);}}
              className="text-xs font-mono text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded-lg hover:bg-rose-500/10 transition-all">
              🗑 Borrar seleccionada
            </button>
          )}
          {annotations.length>0 && (
            <span className="text-xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
              {annotations.length} anotación{annotations.length>1?"es":""}
            </span>
          )}
        </div>

        {/* Annotation chips */}
        {annotations.length>0 && (
          <div className="flex gap-1.5 flex-wrap max-h-16 overflow-y-auto">
            {annotations.map(a=>(
              <div key={a.id}
                onClick={()=>{seek(a.timeIn);setSelectedId(a.id===selectedId?null:a.id);}}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border cursor-pointer text-xs font-mono transition-all
                  ${a.id===selectedId?"border-white/40 bg-white/10":"border-[#30363d] bg-[#161b22] hover:border-[#484f58]"}`}>
                <div className="w-2 h-2 rounded-full" style={{background:a.color}}/>
                <span className="text-[#8b949e]">
                  {a.tool==="text"?`"${a.text?.slice(0,10)}${(a.text?.length??0)>10?"…":""}"`
                    :a.tool==="arrow"?"→":a.tool==="line"?"—":"✏️"}
                </span>
                <span className="text-[#484f58]">{fmt(a.timeIn)}</span>
                <span className="text-[#484f58]">{a.duration===0?"∞":`${a.duration}s`}</span>
                <button onClick={e=>{e.stopPropagation();setAnnotations(ann=>ann.filter(x=>x.id!==a.id));}}
                  className="text-[#484f58] hover:text-rose-400 transition-all leading-none">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
