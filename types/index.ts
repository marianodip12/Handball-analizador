// ─── HANDBALL EVENT MODEL ────────────────────────────────────────────────────
// Hierarchical event tree:
//   Level 1 (top):       Gol | Gol rival | Defensa | Ataque | Transición | Arquero | Especiales
//   Level 2 (subtype):   depends on Level 1
//   Level 3 (detail):    depends on Level 2
//   Level 4 (qualifier): only for Defensa→Intervención→Ayuda  (Positiva | Negativa)

export type VideoMode = "local" | "youtube" | null;

// Top-level (Level 1)
export type EventTipo =
  | "Gol"
  | "Gol rival"
  | "Defensa"
  | "Ataque"
  | "Transición"
  | "Arquero"
  | "Especiales";

export type EventSubtype = string | null;
export type EventDetail = string | null;
export type EventQualifier = "Positiva" | "Negativa" | null;
export type EventResult = "correcto" | "incorrecto" | null;
export type EventResultado = EventResult; // alias

// ─── EVENT TREE ───────────────────────────────────────────────────────────────
export interface EventNode {
  label: string;
  emoji?: string;
  children?: EventNode[];
}

export const EVENT_TREE: EventNode[] = [
  { label: "Gol",        emoji: "🥅" },
  { label: "Gol rival",  emoji: "😤" },
  {
    label: "Defensa", emoji: "🛡️",
    children: [
      { label: "Recuperación", children: [
        { label: "Robo" },
        { label: "Robo de pique" },
        { label: "Corte" },
      ]},
      { label: "Intervención", children: [
        { label: "Anticipación" },
        { label: "Relevo" },
        { label: "Ayuda", children: [
          { label: "Positiva" },
          { label: "Negativa" },
        ]},
      ]},
      { label: "Infracción", children: [
        { label: "Falta" },
      ]},
    ],
  },
  {
    label: "Ataque", emoji: "⚔️",
    children: [
      { label: "Finalización", children: [
        { label: "Gol" },
        { label: "Lanzamiento fallado" },
        { label: "Atajado" },
      ]},
      { label: "Generación", children: [
        { label: "Asistencia" },
      ]},
      { label: "Error", children: [
        { label: "Pérdida" },
        { label: "Error de pase" },
        { label: "Error de recepción" },
        { label: "Error técnico" },
      ]},
    ],
  },
  {
    label: "Transición", emoji: "🔄",
    children: [
      { label: "Transición rápida" },
    ],
  },
  {
    label: "Arquero", emoji: "🧤",
    children: [
      { label: "Atajada", children: [
        { label: "6m" },
        { label: "9m" },
        { label: "Contra" },
        { label: "Contraataque" },
      ]},
      { label: "Gol recibido" },
    ],
  },
  {
    label: "Especiales", emoji: "⚖️",
    children: [
      { label: "Penal", children: [
        { label: "Gol" },
        { label: "Atajado" },
        { label: "Errado" },
      ]},
      { label: "Duelo", children: [
        { label: "Ganado ataque" },
        { label: "Ganado defensa" },
      ]},
    ],
  },
];

// ─── SPORT EVENT ─────────────────────────────────────────────────────────────

export interface SportEvent {
  id: string;
  time: number;
  tipo: EventTipo;
  createdAt: number;

  subtype:     EventSubtype;
  detail:      EventDetail;        // Level 3
  qualifier?:  EventQualifier;     // Level 4 (rare)
  result:      EventResult;
  player_id:   string | null;
  player_name: string | null;
  clip_start:  number;
  clip_end:    number;

  videoFileIndex?: number;

  resultado?: EventResult; // backward-compat
}

// ─── PLAYER ──────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  number?: string;
}

// ─── SCORE / PARTIDO ─────────────────────────────────────────────────────────

export interface Score {
  local: number;
  visitante: number;
}

export interface Partido {
  id: string;
  nombre: string;
  equipoLocal: string;
  equipoVisitante: string;
  fecha: string;
  score: Score;
  events: SportEvent[];
  players: Player[];
  createdAt: number;
}

// ─── EVENT VISUAL CONFIG (per top-level tipo) ────────────────────────────────

export type EventCategory = "binary" | "tree";

export interface EventConfig {
  tipo: EventTipo;
  category: EventCategory;
  emoji: string;
  color: string;
  bgColor: string;
  borderColor: string;
  ringColor: string;
  shortLabel: string;
}

export const EVENT_CONFIGS: EventConfig[] = [
  { tipo: "Gol",         category: "binary", emoji: "🥅", color: "text-green-400",  bgColor: "bg-green-500/10 hover:bg-green-500/20",   borderColor: "border-green-500/40 hover:border-green-400",   ringColor: "ring-green-500",   shortLabel: "GOL"        },
  { tipo: "Gol rival",   category: "binary", emoji: "😤", color: "text-red-400",    bgColor: "bg-red-500/10 hover:bg-red-500/20",       borderColor: "border-red-500/40 hover:border-red-400",       ringColor: "ring-red-500",     shortLabel: "GOL RIVAL"  },
  { tipo: "Defensa",     category: "tree",   emoji: "🛡️", color: "text-cyan-400",   bgColor: "bg-cyan-500/10 hover:bg-cyan-500/20",     borderColor: "border-cyan-500/40 hover:border-cyan-400",     ringColor: "ring-cyan-500",    shortLabel: "DEFENSA"    },
  { tipo: "Ataque",      category: "tree",   emoji: "⚔️", color: "text-orange-400", bgColor: "bg-orange-500/10 hover:bg-orange-500/20", borderColor: "border-orange-500/40 hover:border-orange-400", ringColor: "ring-orange-500",  shortLabel: "ATAQUE"     },
  { tipo: "Transición",  category: "tree",   emoji: "🔄", color: "text-amber-400",  bgColor: "bg-amber-500/10 hover:bg-amber-500/20",   borderColor: "border-amber-500/40 hover:border-amber-400",   ringColor: "ring-amber-500",   shortLabel: "TRANS."     },
  { tipo: "Arquero",     category: "tree",   emoji: "🧤", color: "text-sky-400",    bgColor: "bg-sky-500/10 hover:bg-sky-500/20",       borderColor: "border-sky-500/40 hover:border-sky-400",       ringColor: "ring-sky-500",     shortLabel: "ARQUERO"    },
  { tipo: "Especiales",  category: "tree",   emoji: "⚖️", color: "text-violet-400", bgColor: "bg-violet-500/10 hover:bg-violet-500/20", borderColor: "border-violet-500/40 hover:border-violet-400", ringColor: "ring-violet-500",  shortLabel: "ESPECIALES" },
];

export function getEventConfig(tipo: EventTipo): EventConfig {
  return EVENT_CONFIGS.find(c => c.tipo === tipo) ?? EVENT_CONFIGS[0];
}

export function getEventCategory(tipo: EventTipo): EventCategory {
  return getEventConfig(tipo).category;
}

export function getEventLabel(e: Pick<SportEvent, "tipo" | "subtype" | "detail" | "qualifier">): string {
  const parts: string[] = [e.tipo];
  if (e.subtype)   parts.push(e.subtype);
  if (e.detail)    parts.push(e.detail);
  if (e.qualifier) parts.push(e.qualifier);
  return parts.join(" · ");
}

export function inferResult(e: Pick<SportEvent, "tipo" | "subtype" | "detail" | "qualifier">): EventResult {
  if (e.tipo === "Gol") return "correcto";
  if (e.tipo === "Gol rival") return "incorrecto";

  if (e.tipo === "Defensa") {
    if (e.subtype === "Recuperación") return "correcto";
    if (e.subtype === "Intervención") {
      if (e.detail === "Ayuda" && e.qualifier === "Negativa") return "incorrecto";
      return "correcto";
    }
    if (e.subtype === "Infracción") return "incorrecto";
  }

  if (e.tipo === "Ataque") {
    if (e.subtype === "Finalización") {
      if (e.detail === "Gol") return "correcto";
      return "incorrecto";
    }
    if (e.subtype === "Generación") return "correcto";
    if (e.subtype === "Error") return "incorrecto";
  }

  if (e.tipo === "Arquero") {
    if (e.subtype === "Atajada") return "correcto";
    if (e.subtype === "Gol recibido") return "incorrecto";
  }

  if (e.tipo === "Especiales") {
    if (e.subtype === "Penal") {
      if (e.detail === "Gol") return "correcto";
      return "incorrecto";
    }
    if (e.subtype === "Duelo") return "correcto";
  }

  if (e.tipo === "Transición") return "correcto";

  return null;
}

// ─── Drawing / Annotation ────────────────────────────────────────────────────
export type AnnotationTool = "pen" | "line" | "arrow" | "text";

export interface Annotation {
  id: string;
  tool: AnnotationTool;
  color: string;
  size: number;
  points: { x: number; y: number }[];
  text?: string;
  timeIn: number;
  duration: number;
}

// ─── Migrations ──────────────────────────────────────────────────────────────
export function migrateEvent(e: Partial<SportEvent> & { id: string; time: number; tipo: string; createdAt: number }): SportEvent {
  // Map old soccer tipos to closest handball equivalent
  const oldToNew: Record<string, EventTipo> = {
    "Tiro libre": "Especiales",
    "Corner": "Especiales",
    "Saque de arco": "Arquero",
    "Tiro de larga distancia": "Ataque",
    "Tiro de cerca": "Ataque",
    "Lateral ofensivo": "Ataque",
    "Pelota aérea": "Ataque",
    "Saque del arquero": "Arquero",
    "Pase ofensivo": "Ataque",
    "Desmarque": "Ataque",
    "Salida de Pelota": "Defensa",
    "Perfil Corporal": "Defensa",
    "Transición Ofensiva": "Transición",
    "Transición Defensiva": "Transición",
    "Toma de Decisión": "Ataque",
    "Tiro al Arco": "Ataque",
    "Gambeta": "Ataque",
  };
  const newTipo: EventTipo = (oldToNew[e.tipo] ?? (e.tipo as EventTipo));

  return {
    subtype:     null,
    detail:      null,
    qualifier:   null,
    result:      (e as { resultado?: EventResult }).resultado ?? e.result ?? null,
    player_id:   null,
    player_name: null,
    clip_start:  e.clip_start ?? Math.max(0, e.time - 5),
    clip_end:    e.clip_end   ?? e.time,
    ...e,
    tipo: newTipo,
  } as SportEvent;
}
