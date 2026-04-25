# ⚽ SportTag — Análisis de Video Deportivo

Herramienta de análisis de video deportivo con marcación de eventos en tiempo real.

## ✨ Features

- 🎥 **Video local** (MP4, MOV, AVI, WebM) o **YouTube** (via Iframe API)
- 🎛 **5 tipos de eventos** con selección de resultado (correcto / incorrecto)
- ⏱ **Seek instantáneo** — click en un evento para ir 5s antes
- 💾 **Persistencia automática** via localStorage
- 📊 **Stats en vivo** por tipo de evento
- 📁 **Exportar JSON** de todos los eventos
- 🌙 Diseño dark dashboard, responsive

## 🚀 Setup local

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000)

## 🌐 Deploy en Vercel

### Opción 1: Vercel CLI
```bash
npm install -g vercel
vercel
```

### Opción 2: GitHub + Vercel

1. Subí el proyecto a GitHub
2. Andá a [vercel.com](https://vercel.com) → **New Project**
3. Importá tu repositorio
4. Vercel detecta Next.js automáticamente
5. Click **Deploy** — listo en ~60 segundos

### Configuración de Vercel (ya incluida)
- Framework: **Next.js**
- Build command: `npm run build`
- Output directory: `.next`
- Sin variables de entorno necesarias (todo es frontend)

## 📁 Estructura

```
sports-analyzer/
├── app/
│   ├── layout.tsx          # Root layout con metadata
│   ├── page.tsx            # Dashboard principal
│   └── globals.css         # Estilos globales + fuentes
├── components/
│   ├── VideoPlayer.tsx     # Video local + YouTube IFrame API
│   ├── EventButtons.tsx    # Botones de marcación con resultado
│   └── EventList.tsx       # Lista con seek, delete, stats
├── hooks/
│   └── useEvents.ts        # Estado de eventos + localStorage
└── types/
    └── index.ts            # TypeScript types + config de eventos
```

## 🎛 Tipos de eventos

| Emoji | Evento | Descripción |
|-------|--------|-------------|
| 🟢 | Salida de Pelota | Inicio de jugada desde portería |
| 🔵 | Perfil Corporal | Posición y orientación del cuerpo |
| 🔴 | Defensa | Acción defensiva |
| 🟡 | Transición | Cambio de fase de juego |
| ⚪ | Toma de Decisión | Elección táctica del jugador |

## ⌨️ Uso

- **Click en botón** → seleccioná resultado (correcto / incorrecto / saltar)
- **Doble click en botón** → marca rápida sin resultado
- **Click en evento** → vuelve al video 5 segundos antes
- **Click en badge resultado** → cambia el resultado del evento
- El botón 🗑 aparece al hacer hover sobre un evento

## 📝 Notas

- Los datos se guardan automáticamente en `localStorage`
- El video local no se guarda entre sesiones (es un blob URL temporal)
- Para YouTube, la app extrae el `videoId` de cualquier formato de URL válido
