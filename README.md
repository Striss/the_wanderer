# 🚶 The Wanderer

A collaborative pixel-art web experience. A lone traveler walks endlessly toward a
mysterious destination — powered by the collective energy of everyone watching.

The world runs whether anyone is looking. The background shifts through real-time
palettes tied to the clock — deep navy at midnight, ember orange at dawn, sky blue
at noon, blood purple at dusk. Your keystrokes keep the Wanderer moving.

---

## Project Structure

```
wanderer/
├── server/          # Node.js WebSocket + Express backend
│   ├── index.js     # Main server — game tick, shared state, WS hub
│   └── package.json
├── client/          # React frontend
│   ├── src/
│   │   ├── App.js              # Main UI component
│   │   ├── App.css             # Retro pixel styles
│   │   ├── components/
│   │   │   ├── GameCanvas.js   # Canvas renderer (rAF loop)
│   │   │   └── character.js    # Pixel art frames + draw function
│   │   └── hooks/
│   │       ├── useWandererSocket.js  # WS client with auto-reconnect
│   │       └── usePalette.js         # Time-of-day palette system
│   └── public/
│       └── index.html
└── package.json     # Root convenience scripts
```

---

## Quick Start

### 1. Install dependencies

```bash
# From the wanderer/ root
npm run install:all

# Or manually:
npm install --prefix server
npm install --prefix client
```

### 2. Run both together (requires concurrently)

```bash
npm install          # installs concurrently at root
npm run dev          # starts server on :3001 + client on :3000
```

### 3. Or run separately

```bash
# Terminal 1 — server
npm run dev:server

# Terminal 2 — client
npm run dev:client
```

Open **http://localhost:3000** in multiple browser tabs to test multiplayer.

---

## How It Works

### Server (`server/index.js`)

- Runs a **10Hz game tick** that:
  - Drains energy over time (faster when players are active)
  - Advances distance based on energy level
  - Determines character state: `run` / `walk` / `sit`
  - Broadcasts state to all WebSocket clients
- Handles `BOOST` messages from clients → adds energy → broadcasts `BOOST_EVENT` to all
- Tracks online count from WS connections
- REST endpoint at `/state` for initial load fallback

### Client

**`usePalette.js`** — Time-of-day palette engine
- 10 palette anchors mapped to hours of the day (midnight, pre-dawn, dawn, morning, etc.)
- Blends smoothly between adjacent palettes using linear color interpolation
- Updates every 30 seconds — changes are imperceptibly slow, like a real sky
- Stars fade as daylight grows; clouds thicken at midday

**`useWandererSocket.js`** — Multiplayer connection
- WebSocket client with automatic reconnection (2s delay)
- Handles `HELLO`, `STATE`, `BOOST_EVENT`, `ONLINE_COUNT` message types
- Exposes `sendBoost()` to push energy events

**`GameCanvas.js`** — Canvas render loop
- `requestAnimationFrame` loop, 60fps
- Parallax scrolling: ground > near hills > far hills > clouds > stars
- CRT scanline overlay + radial vignette
- Pixel popup animations for boost events
- Character bounce interpolated from sine wave

**`character.js`** — Pixel art
- Hand-authored 8×12 pixel grids for run (4 frames), walk (2 frames), sit (1 frame)
- Colors driven by current palette accent

---

## Palette Schedule

| Time       | Name         | Mood                        |
|------------|--------------|-----------------------------|
| 00:00      | DEEP NIGHT   | Navy black, cyan stars      |
| 04:00      | PRE-DAWN     | Deep purple, violet glow    |
| 06:00      | DAWN         | Indigo to orange fire       |
| 09:00      | MORNING      | Steel blue, fresh green     |
| 12:00      | MIDDAY       | Bright sky, lush ground     |
| 15:00      | AFTERNOON    | Warm haze, golden tones     |
| 17:00      | GOLDEN HOUR  | Amber, burnt orange         |
| 19:00      | DUSK         | Mauve, rose, deep shadow    |
| 21:00      | TWILIGHT     | Indigo, lavender stars      |
| 23:00      | NIGHT        | Black, deep navy, cyan      |

---

## Deployment

### Server (any Node host — Railway, Render, Fly.io, etc.)

```bash
cd server
PORT=3001 node index.js
```

Set `PORT` via environment variable. The server exposes:
- `ws://your-host/` — WebSocket
- `http://your-host/state` — REST state snapshot
- `http://your-host/health` — Health check

### Client (Vercel, Netlify, etc.)

```bash
cd client
REACT_APP_WS_URL=wss://your-server-host npm run build
```

The built `client/build/` folder is a static React app. Deploy it anywhere.

### Environment Variables

| Variable             | Default                  | Description               |
|----------------------|--------------------------|---------------------------|
| `PORT`               | `3001`                   | Server port               |
| `REACT_APP_WS_URL`   | `ws://localhost:3001`    | WebSocket server URL      |

---

## Extending

**Persist state across server restarts** — add a JSON file or SQLite write in `server/index.js`
on process exit, reload on startup.

**Milestone events** — emit special WS messages at distance thresholds (500km, 1000km, etc.)
and show celebratory overlays on the client.

**Weather system** — add a rain/storm mode triggered by low energy that darkens the palette
and adds falling pixel particles.

**Sound** — hook a Web Audio API chiptune engine to the boost event for satisfying bleeps.

**Leaderboard** — track per-session boost counts and show top contributors.
