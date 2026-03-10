const express = require("express");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const http = require("http");

const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const WALK_SPEED_KMH  = 5.04;
const RUN_SPEED_KMH   = 9.0;
const WALK_SPEED_KMS  = WALK_SPEED_KMH / 3600;
const RUN_SPEED_KMS   = RUN_SPEED_KMH  / 3600;

const BOOST_GAIN      = 1;      // 1 click = 1 energy unit
const RUN_THRESHOLD   = 40;
const WALK_THRESHOLD  = 1;
const DESTINATION_KM  = 6000;

// ── Hunger ────────────────────────────────────────────────────────────────────
// Hunger 0 = full, 100 = starving
// Rises from 0→100 in 4 hours = 14400 seconds
// hunger_rate = 100 / 14400 = ~0.00694 units/sec
const HUNGER_RATE       = 100 / (4 * 3600); // units/sec
const HUNGER_PER_FEED   = 34;   // one feed = ~34 hunger reduction (3 feeds = full reset)
const DAILY_FEED_LIMIT  = 3;

// Hunger multiplier on energy burn:
//   0%  hunger → 1.0× burn
//   50% hunger → 2.0× burn
//   100% hunger → 4.0× burn  (exponential feel)
function hungerBurnMultiplier(hunger) {
  return 1 + (hunger / 100) * 3;  // 1× to 4×
}

// Hunger also reduces speed when very hungry (sluggish above 70%)
function hungerSpeedMultiplier(hunger) {
  if (hunger < 50) return 1.0;
  if (hunger < 70) return 0.85;
  if (hunger < 90) return 0.65;
  return 0.45; // very slow when nearly starving
}

// ─── SHARED STATE ─────────────────────────────────────────────────────────────
const MILESTONES = [
  { km: 500,  text: "The wanderer has been walking for a long time. They don't talk about why." },
  { km: 1200, text: "Someone once told them: if you ever feel lost, just keep moving. The world is smaller than it seems." },
  { km: 2000, text: "They used to live somewhere cold. They left when the house got too quiet." },
  { km: 3000, text: "Halfway. The wanderer sits for a long time before getting up again." },
  { km: 4000, text: "They've started recognising the quality of light in the late afternoon. It looked like this, back then." },
  { km: 5000, text: "The cottage was built by hand. It took two summers." },
  { km: 5500, text: "There are daffodils in spring, apparently. Someone told them that once." },
  { km: 5900, text: "They're not sure what they'll do when they get there. Stand in the garden, maybe." },
  { km: 6000, text: "The gate is open. It was always left open." },
];

let state = {
  energy:      12,
  totalEnergy: 12,
  hunger:      0,
  distance:    0,
  onlineCount: 0,
  charState:   "walk",
  hungerState: "full",
  arrived:     false,   // true once destination reached
  lastUpdate:  Date.now(),
};

let reachedMilestones = new Set();

// Per-IP feed tracking: { "ip": { count, resetAt } }
const feedTracker = new Map();

function getUtcMidnight() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function getFeedRecord(ip) {
  const now = Date.now();
  let rec = feedTracker.get(ip);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: getUtcMidnight() };
    feedTracker.set(ip, rec);
  }
  return rec;
}

function hungerLevel(hunger) {
  if (hunger < 25)  return "full";
  if (hunger < 55)  return "hungry";
  if (hunger < 80)  return "very-hungry";
  return "starving";
}

// ─── TICK ─────────────────────────────────────────────────────────────────────
const TICK_MS = 200;
// How long to hold the arrival screen before auto-resetting (ms)
const ARRIVAL_HOLD_MS = 90000; // 90 seconds
let arrivalTimer = null;

function doReset() {
  state.energy      = 12;
  state.totalEnergy = 0;
  state.hunger      = 0;
  state.distance    = 0;
  state.charState   = "walk";
  state.hungerState = "full";
  state.arrived     = false;
  state.lastUpdate  = Date.now();
  reachedMilestones = new Set();
  arrivalTimer      = null;
  broadcastAll({ type: "RESET" });
}

function tick() {
  const now = Date.now();
  const dt  = (now - state.lastUpdate) / 1000;
  state.lastUpdate = now;

  // If arrived, don't tick movement — just hold still
  if (state.arrived) return;

  // Hunger rises passively
  state.hunger      = Math.min(100, state.hunger + HUNGER_RATE * dt);
  state.hungerState = hungerLevel(state.hunger);

  const starving = state.hunger >= 100;

  let speed    = 0;
  let baseBurn = 0;

  if (!starving && state.energy >= RUN_THRESHOLD) {
    state.charState = "run";
    speed    = RUN_SPEED_KMS;
    baseBurn = 0.40;
  } else if (!starving && state.energy > WALK_THRESHOLD) {
    state.charState = "walk";
    speed    = WALK_SPEED_KMS;
    baseBurn = 0.16;
  } else {
    state.charState = "sit";
    speed    = 0;
    baseBurn = 0;
  }

  const burnMult  = hungerBurnMultiplier(state.hunger);
  const speedMult = hungerSpeedMultiplier(state.hunger);

  state.energy   = Math.max(0, state.energy - baseBurn * burnMult * dt);
  state.distance = Math.min(DESTINATION_KM, state.distance + speed * speedMult * dt);

  // ── Check milestones ──
  for (const m of MILESTONES) {
    if (!reachedMilestones.has(m.km) && state.distance >= m.km) {
      reachedMilestones.add(m.km);
      const isArrival = m.km >= DESTINATION_KM;

      const milestoneMsg = {
        id: Date.now() + Math.random(),
        type: "system",
        text: m.text,
        ts: Date.now(),
      };
      chatHistory = [...chatHistory.slice(-(MAX_CHAT - 1)), milestoneMsg];
      broadcastAll({ type: "CHAT_MSG", msg: milestoneMsg });
      broadcastAll({ type: "MILESTONE", km: m.km, text: m.text, isArrival });

      if (isArrival) {
        state.arrived   = true;
        state.charState = "sit";
        // Schedule reset after hold period
        arrivalTimer = setTimeout(doReset, ARRIVAL_HOLD_MS);
      }
    }
  }

  broadcastAll({
    type:          "STATE",
    energy:        Math.round(state.energy),
    totalEnergy:   Math.round(state.totalEnergy),
    hunger:        parseFloat(state.hunger.toFixed(1)),
    hungerState:   state.hungerState,
    distance:      parseFloat(state.distance.toFixed(4)),
    onlineCount:   state.onlineCount,
    charState:     state.charState,
    arrived:       state.arrived,
    destinationKm: DESTINATION_KM,
  });
}

setInterval(tick, TICK_MS);

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

const ADJECTIVES = ["swift","brave","quiet","misty","bold","wild","calm","lucky","tiny","fuzzy","sleepy","jolly","snappy","gentle","nimble","curious","wandering"];
const NOUNS      = ["fox","pebble","cloud","spark","leaf","stone","river","moon","star","ember","birch","creek","finch","acorn","fern","moth","wren","dusk"];
function guestName() {
  return ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]
    + "-" + NOUNS[Math.floor(Math.random()*NOUNS.length)];
}

const MAX_CHAT = 80;
let chatHistory = [];

wss.on("connection", (ws, req) => {
  // Get client IP (works behind proxies too)
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0].trim();
  ws.clientIp = ip;
  ws.username = guestName();

  state.onlineCount = wss.clients.size;

  const feedRec = getFeedRecord(ip);

  ws.send(JSON.stringify({
    type:              "HELLO",
    energy:            Math.round(state.energy),
    totalEnergy:       Math.round(state.totalEnergy),
    hunger:            parseFloat(state.hunger.toFixed(1)),
    hungerState:       state.hungerState,
    distance:          state.distance,
    onlineCount:       state.onlineCount,
    charState:         state.charState,
    arrived:           state.arrived,
    destinationKm:     DESTINATION_KM,
    username:          ws.username,
    chatHistory,
    feedsUsed:         feedRec.count,
    feedsLimit:        DAILY_FEED_LIMIT,
    feedsResetAt:      feedRec.resetAt,
    reachedMilestones: [...reachedMilestones],
  }));

  broadcastAll({ type: "ONLINE_COUNT", count: wss.clients.size });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      // ── ENERGY BOOST ──
      if (msg.type === "BOOST") {
        state.energy += BOOST_GAIN;
        state.totalEnergy += BOOST_GAIN;
        broadcastAll({
          type:        "BOOST_EVENT",
          gain:        BOOST_GAIN,
          energy:      Math.round(state.energy),
          totalEnergy: Math.round(state.totalEnergy),
          from:        ws.username,
        });
      }

      // ── FEED ──
      if (msg.type === "FEED") {
        const rec = getFeedRecord(ws.clientIp);
        if (rec.count >= DAILY_FEED_LIMIT) {
          ws.send(JSON.stringify({
            type:         "FEED_RESULT",
            success:      false,
            reason:       "daily_limit",
            feedsUsed:    rec.count,
            feedsLimit:   DAILY_FEED_LIMIT,
            feedsResetAt: rec.resetAt,
          }));
          return;
        }
        rec.count++;
        state.hunger = Math.max(0, state.hunger - HUNGER_PER_FEED);
        state.hungerState = hungerLevel(state.hunger);

        // Tell everyone hunger dropped
        broadcastAll({
          type:        "FEED_EVENT",
          hunger:      parseFloat(state.hunger.toFixed(1)),
          hungerState: state.hungerState,
          from:        ws.username,
        });

        // Tell feeder their new quota
        ws.send(JSON.stringify({
          type:         "FEED_RESULT",
          success:      true,
          hunger:       parseFloat(state.hunger.toFixed(1)),
          hungerState:  state.hungerState,
          feedsUsed:    rec.count,
          feedsLimit:   DAILY_FEED_LIMIT,
          feedsResetAt: rec.resetAt,
        }));

        // Chat announcement
        const feedMsg = {
          id: Date.now() + Math.random(), type: "system",
          text: `${ws.username} fed the wanderer 🍖`, ts: Date.now(),
        };
        chatHistory = [...chatHistory.slice(-(MAX_CHAT-1)), feedMsg];
        broadcastAll({ type: "CHAT_MSG", msg: feedMsg });
      }

      // ── CHAT ──
      if (msg.type === "CHAT" && typeof msg.text === "string") {
        const text = msg.text.trim().slice(0, 120);
        if (!text) return;
        const chatMsg = {
          id: Date.now() + Math.random(), type: "user",
          username: ws.username, text, ts: Date.now(),
        };
        chatHistory = [...chatHistory.slice(-(MAX_CHAT-1)), chatMsg];
        broadcastAll({ type: "CHAT_MSG", msg: chatMsg });
      }

    } catch {}
  });

  ws.on("close", () => {
    state.onlineCount = wss.clients.size;
    broadcastAll({ type: "ONLINE_COUNT", count: wss.clients.size });
  });

  ws.on("error", () => {});
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Serve React build
app.use(express.static(path.join(__dirname, "../client/build")));

// Catch-all: send index.html for any unknown route
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🐾 Wanderer server on :${PORT}`);
  console.log(`   Hunger rate: full→starving in 4 hours`);
  console.log(`   Daily feed limit: ${DAILY_FEED_LIMIT} per IP`);
});
