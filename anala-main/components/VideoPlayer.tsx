"use client";
import React, {
  useRef, useState, useEffect, useCallback,
  forwardRef, useImperativeHandle,
} from "react";
import { Upload, Youtube, Clock, Plus, Film, X, ChevronDown, ChevronUp } from "lucide-react";
import type { VideoMode } from "@/types";
import { saveVideoFile, loadVideoFile } from "@/lib/videoDB";

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  seekTo: (time: number) => void;
  getMode: () => VideoMode;
  getLocalFile: () => File | null;
  getVideoElement: () => HTMLVideoElement | null;
  getAllFiles: () => File[];
  getActiveFileIndex: () => number;
}

interface VideoFile { file: File; url: string; }

interface VideoPlayerProps {
  onModeChange?: (mode: VideoMode) => void;
  partidoId?: string;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

declare global {
  interface Window {
    YT: { Player: new (id: string, opts: { videoId: string; playerVars?: Record<string, number|string>; events?: { onReady?: (e:{target:YTPlayer})=>void; onStateChange?: (e:{data:number})=>void; }; }) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }; };
    onYouTubeIframeAPIReady: () => void; _ytApiReady: boolean; _ytApiLoading: boolean; _ytApiCallbacks: (()=>void)[];
  }
}
interface YTPlayer { getCurrentTime: ()=>number; seekTo: (s:number, a:boolean)=>void; playVideo: ()=>void; pauseVideo: ()=>void; destroy: ()=>void; }

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window._ytApiReady) { resolve(); return; }
    if (!window._ytApiCallbacks) window._ytApiCallbacks = [];
    window._ytApiCallbacks.push(resolve);
    if (!window._ytApiLoading) {
      window._ytApiLoading = true;
      const tag = document.createElement("script"); tag.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => { window._ytApiReady = true; (window._ytApiCallbacks??[]).forEach(cb=>cb()); window._ytApiCallbacks=[]; };
    }
  });
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ onModeChange, partidoId }, ref) => {
  const [mode, setMode] = useState<VideoMode>(null);
  const [screen, setScreen] = useState<"pick"|"yt-input"|"playing">("pick");
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showFileList, setShowFileList] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytId, setYtId] = useState<string|null>(null);
  const [ytError, setYtError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<YTPlayer|null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const activeFile = files[activeIdx] ?? null;
  const localSrc   = activeFile?.url ?? null;
  const localName  = activeFile?.file.name ?? "";

  // Cleanup blob URLs on unmount
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => { filesRef.current.forEach(f => URL.revokeObjectURL(f.url)); }, []);

  // Auto-restore from IndexedDB
  useEffect(() => {
    if (!partidoId) return;
    loadVideoFile(partidoId).then(file => {
      if (!file) return;
      const url = URL.createObjectURL(file);
      setFiles([{file, url}]); setActiveIdx(0); setMode("local"); setScreen("playing"); onModeChange?.("local");
    }).catch(()=>{});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partidoId]);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => { if (mode==="local"&&videoRef.current) return videoRef.current.currentTime; if (mode==="youtube"&&ytPlayerRef.current) { try{return ytPlayerRef.current.getCurrentTime();}catch{return 0;} } return 0; },
    seekTo: (time:number) => { const t=Math.max(0,time); if(mode==="local"&&videoRef.current){videoRef.current.currentTime=t;videoRef.current.play().catch(()=>{});setIsPlaying(true);} if(mode==="youtube"&&ytPlayerRef.current){try{ytPlayerRef.current.seekTo(t,true);ytPlayerRef.current.playVideo();setIsPlaying(true);}catch{}} },
    getMode: () => mode,
    getLocalFile: () => files[activeIdx]?.file ?? null,
    getVideoElement: () => videoRef.current,
    getAllFiles: () => files.map(f => f.file),
    getActiveFileIndex: () => activeIdx,
  }));

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (screen !== "playing") return;
    intervalRef.current = setInterval(() => {
      if (mode==="local"&&videoRef.current) setCurrentTime(videoRef.current.currentTime);
      else if (mode==="youtube"&&ytPlayerRef.current) { try{setCurrentTime(ytPlayerRef.current.getCurrentTime());}catch{} }
    }, 200);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [mode, screen]);

  useEffect(() => {
    if (!ytId) return;
    let cancelled = false;
    (async () => {
      await loadYouTubeAPI(); if(cancelled)return;
      if(ytPlayerRef.current){try{ytPlayerRef.current.destroy();}catch{}ytPlayerRef.current=null;}
      await new Promise(r=>setTimeout(r,80)); if(cancelled||!document.getElementById("yt-player-container"))return;
      ytPlayerRef.current = new window.YT.Player("yt-player-container",{videoId:ytId,playerVars:{autoplay:0,rel:0,modestbranding:1,enablejsapi:1},events:{onStateChange:(e)=>{try{setIsPlaying(e.data===window.YT.PlayerState.PLAYING);}catch{}}}});
    })();
    return () => { cancelled=true; };
  }, [ytId]);

  const destroyYT = useCallback(() => { if(ytPlayerRef.current){try{ytPlayerRef.current.destroy();}catch{}ytPlayerRef.current=null;} setYtId(null);setYtUrl("");setYtError(""); }, []);

  const loadNewFiles = useCallback((newFiles: File[], append=false) => {
    const mapped: VideoFile[] = newFiles.map(f => ({file:f, url:URL.createObjectURL(f)}));
    destroyYT();
    if (!append || files.length===0) {
      files.forEach(f => URL.revokeObjectURL(f.url));
      setFiles(mapped); setActiveIdx(0); setMode("local"); setScreen("playing"); setCurrentTime(0); setIsPlaying(false);
      onModeChange?.("local");
      if (partidoId && newFiles[0]) saveVideoFile(partidoId, newFiles[0]).catch(()=>{});
    } else {
      setFiles(prev => [...prev, ...mapped]);
      setShowFileList(true);
    }
  }, [files, destroyYT, onModeChange, partidoId]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []); if(!picked.length)return;
    loadNewFiles(picked, false); e.target.value="";
  }, [loadNewFiles]);

  const handleAddFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []); if(!picked.length)return;
    loadNewFiles(picked, true); e.target.value="";
  }, [loadNewFiles]);

  const handleSwitchFile = useCallback((idx: number) => {
    if(idx===activeIdx)return; setActiveIdx(idx); setCurrentTime(0); setIsPlaying(false);
    if(videoRef.current) videoRef.current.currentTime=0;
  }, [activeIdx]);

  const handleRemoveFile = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    URL.revokeObjectURL(files[idx].url);
    setFiles(prev => prev.filter((_,i)=>i!==idx));
    if(activeIdx>=idx&&activeIdx>0) setActiveIdx(p=>p-1);
  }, [files, activeIdx]);

  const handleYtSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const id = extractYouTubeId(ytUrl); if(!id){setYtError("URL inválida. Revisá el formato.");return;}
    setYtError(""); files.forEach(f=>URL.revokeObjectURL(f.url)); setFiles([]);
    setYtId(id); setMode("youtube"); setScreen("playing"); setCurrentTime(0); setIsPlaying(false); onModeChange?.("youtube");
  }, [ytUrl, files, onModeChange]);

  const handleChange = useCallback(() => {
    destroyYT(); files.forEach(f=>URL.revokeObjectURL(f.url)); setFiles([]); setMode(null); setScreen("pick"); setCurrentTime(0); setIsPlaying(false); onModeChange?.(null);
  }, [destroyYT, files, onModeChange]);

  const fmt = (t: number) => { const m=Math.floor(t/60),s=Math.floor(t%60),ds=Math.floor((t%1)*10); return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${ds}`; };

  return (
    <div className="flex flex-col gap-3">
      {/* Source picker */}
      {screen==="pick" && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={()=>fileInputRef.current?.click()} className="flex flex-col items-center gap-3 p-6 rounded-xl border border-[#30363d] bg-[#161b22] hover:border-[#00ff88]/50 hover:bg-[#00ff88]/5 transition-all group">
            <div className="w-12 h-12 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/30 flex items-center justify-center group-hover:bg-[#00ff88]/20 transition-colors"><Upload className="w-5 h-5 text-[#00ff88]" /></div>
            <div className="text-center"><p className="font-display font-semibold text-white tracking-wide text-sm">VIDEO LOCAL</p><p className="text-xs text-[#484f58] mt-1 font-mono">MP4 · MOV · WebM</p></div>
          </button>
          <button onClick={()=>setScreen("yt-input")} className="flex flex-col items-center gap-3 p-6 rounded-xl border border-[#30363d] bg-[#161b22] hover:border-red-500/50 hover:bg-red-500/5 transition-all group">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center group-hover:bg-red-500/20 transition-colors"><Youtube className="w-5 h-5 text-red-400" /></div>
            <div className="text-center"><p className="font-display font-semibold text-white tracking-wide text-sm">YOUTUBE</p><p className="text-xs text-[#484f58] mt-1 font-mono">Pegá el link</p></div>
          </button>
        </div>
      )}

      {/* YouTube URL form */}
      {screen==="yt-input" && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input type="text" autoFocus value={ytUrl} onChange={e=>setYtUrl(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();handleYtSubmit(e as unknown as React.FormEvent);}}} placeholder="https://www.youtube.com/watch?v=..." className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 text-white placeholder-[#484f58] font-mono text-sm focus:outline-none focus:border-red-500/50 transition-colors" />
            <button onClick={handleYtSubmit} className="px-5 py-3 bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 rounded-lg text-red-400 font-display font-semibold tracking-wide transition-all">CARGAR</button>
          </div>
          {ytError && <p className="text-red-400 text-xs font-mono">{ytError}</p>}
          <button type="button" onClick={()=>setScreen("pick")} className="text-[#484f58] text-xs hover:text-white font-mono text-left transition-colors">← volver</button>
        </div>
      )}

      {/* Playing: Local */}
      {screen==="playing" && mode==="local" && localSrc && (
        <div className="flex flex-col gap-2">
          <div className="relative rounded-xl overflow-hidden border border-[#30363d] bg-black">
            <video ref={videoRef} src={localSrc} controls playsInline {...{"webkit-playsinline": "true", "x5-playsinline": "true"} as Record<string, string>} className="w-full max-h-[45vh] sm:max-h-[420px] object-contain bg-black rounded-lg" onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161b22] rounded-lg border border-[#21262d] w-fit">
              <Clock className="w-3.5 h-3.5 text-[#00ff88]" />
              <span className="font-mono text-sm text-[#00ff88] tabular-nums">{fmt(currentTime)}</span>
              {isPlaying && <span className="w-1.5 h-1.5 bg-[#00ff88] rounded-full animate-pulse" />}
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              <span className="text-[#484f58] font-mono text-xs truncate max-w-[120px]">{localName}</span>
              <button onClick={()=>addFileInputRef.current?.click()} title="Agregar más videos al playlist" className="flex items-center gap-1 text-xs font-mono text-violet-400 hover:text-violet-300 border border-violet-500/30 hover:border-violet-500/50 px-2.5 py-1 rounded-lg bg-violet-500/10 transition-all">
                <Plus className="w-3 h-3" /> VIDEO
              </button>
              <button onClick={()=>fileInputRef.current?.click()} className="text-xs font-mono text-[#484f58] hover:text-white border border-[#30363d] hover:border-[#484f58] px-2.5 py-1 rounded-lg bg-[#161b22] transition-all">cambiar</button>
              <button onClick={handleChange} className="text-xs font-mono text-[#484f58] hover:text-white border border-[#30363d] hover:border-[#484f58] px-2.5 py-1 rounded-lg bg-[#161b22] transition-all">otra fuente</button>
            </div>
          </div>

          {/* Multi-file playlist */}
          {files.length > 1 && (
            <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
              <button onClick={()=>setShowFileList(v=>!v)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#161b22] transition-colors">
                <div className="flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-xs font-mono text-[#484f58] uppercase tracking-widest">Videos cargados</span>
                  <span className="text-xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">{files.length}</span>
                  <span className="text-xs font-mono text-[#484f58]">· activo: #{activeIdx+1}</span>
                </div>
                {showFileList ? <ChevronUp className="w-3.5 h-3.5 text-[#484f58]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#484f58]" />}
              </button>
              {showFileList && (
                <div className="px-3 pb-3 flex flex-col gap-1.5">
                  {files.map((vf, idx) => (
                    <div key={idx} onClick={()=>handleSwitchFile(idx)} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${idx===activeIdx?"border-violet-500/50 bg-violet-500/10":"border-[#21262d] bg-[#161b22] hover:border-[#30363d]"}`}>
                      <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-mono font-bold shrink-0 ${idx===activeIdx?"bg-violet-500 border-violet-500 text-white":"border-[#30363d] text-[#484f58]"}`}>{idx+1}</span>
                      <span className={`flex-1 text-xs font-mono truncate ${idx===activeIdx?"text-violet-300":"text-[#8b949e]"}`}>{vf.file.name}</span>
                      <span className="text-[10px] font-mono text-[#484f58] shrink-0">{(vf.file.size/(1024*1024)).toFixed(0)} MB</span>
                      {files.length>1 && <button onClick={e=>handleRemoveFile(idx,e)} className="text-[#484f58] hover:text-rose-400 transition-colors shrink-0"><X className="w-3 h-3" /></button>}
                    </div>
                  ))}
                  <button onClick={()=>addFileInputRef.current?.click()} className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-[#30363d] hover:border-violet-500/40 rounded-lg text-[#484f58] hover:text-violet-400 font-mono text-xs transition-all">
                    <Plus className="w-3 h-3" /> Agregar video
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Playing: YouTube */}
      {screen==="playing" && mode==="youtube" && (
        <div className="flex flex-col gap-2">
          <div className="relative rounded-xl overflow-hidden border border-[#30363d] bg-black"><div id="yt-player-container" className="w-full aspect-video" /></div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161b22] rounded-lg border border-[#21262d] w-fit"><Clock className="w-3.5 h-3.5 text-red-400" /><span className="font-mono text-sm text-red-400 tabular-nums">{fmt(currentTime)}</span>{isPlaying&&<span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />}</div>
            <div className="flex gap-2">
              <button onClick={()=>{setScreen("yt-input");destroyYT();setMode(null);onModeChange?.(null);}} className="text-xs font-mono text-[#484f58] hover:text-white border border-[#30363d] hover:border-[#484f58] px-2.5 py-1 rounded-lg bg-[#161b22] transition-all">otro video YT</button>
              <button onClick={handleChange} className="text-xs font-mono text-[#484f58] hover:text-white border border-[#30363d] hover:border-[#484f58] px-2.5 py-1 rounded-lg bg-[#161b22] transition-all">otra fuente</button>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
      <input ref={addFileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={handleAddFiles} />
    </div>
  );
});

VideoPlayer.displayName = "VideoPlayer";
export default VideoPlayer;
