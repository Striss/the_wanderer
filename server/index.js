const express = require("express");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs   = require("fs");

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

const BOOST_GAIN      = 1;
const RUN_THRESHOLD   = 40;
const WALK_THRESHOLD  = 1;
const DESTINATION_KM  = 6000;

// Rate limiting
const BOOST_WINDOW_MS = 10000;
const BOOST_MAX       = 30;

// ── Hunger ────────────────────────────────────────────────────────────────────
// Rises from 0→100 in 1 hour (was 4 hours)
const HUNGER_RATE      = 100 / (1 * 3600);
const HUNGER_PER_FEED  = 34;
const DAILY_FEED_LIMIT = 3;

function hungerBurnMultiplier(hunger) {
  return 1 + (hunger / 100) * 3;
}

function hungerSpeedMultiplier(hunger) {
  if (hunger < 50) return 1.0;
  if (hunger < 70) return 0.85;
  if (hunger < 90) return 0.65;
  return 0.45;
}

// ── Energy-based speed boost ──────────────────────────────────────────────────
// The more collective energy, the faster the wanderer moves
function energySpeedMultiplier(energy) {
  if (energy < 100)  return 1.0;
  if (energy < 300)  return 1.2;
  if (energy < 600)  return 1.5;
  if (energy < 1000) return 1.8;
  return 2.5;
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
  arrived:     false,
  lastUpdate:  Date.now(),
};

let reachedMilestones = new Set();

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
const STATE_FILE = "./wanderer-state.json";

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      state.distance    = saved.distance    ?? 0;
      state.totalEnergy = saved.totalEnergy ?? 0;
      state.hunger      = saved.hunger      ?? 0;
      reachedMilestones = new Set(saved.reachedMilestones ?? []);
      console.log(`State restored — ${state.distance.toFixed(2)} km traveled`);
    }
  } catch (e) {
    console.log("No saved state, starting fresh");
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      distance:          state.distance,
      totalEnergy:       state.totalEnergy,
      hunger:            state.hunger,
      reachedMilestones: [...reachedMilestones],
    }));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

loadState();
setInterval(saveState, 10000);

// ─── FEED TRACKING ────────────────────────────────────────────────────────────
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
  if (hunger < 25) return "full";
  if (hunger < 55) return "hungry";
  if (hunger < 80) return "very-hungry";
  return "starving";
}

// ─── TICK ─────────────────────────────────────────────────────────────────────
const TICK_MS = 200;
const ARRIVAL_HOLD_MS = 90000;
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
  saveState();
  broadcastAll({ type: "RESET" });
}

function tick() {
  const now = Date.now();
  const dt  = (now - state.lastUpdate) / 1000;
  state.lastUpdate = now;

  if (state.arrived) return;

  state.hunger      = Math.min(100, state.hunger + HUNGER_RATE * dt);
  state.hungerState = hungerLevel(state.hunger);

  const starving = state.hunger >= 100;

  let speed    = 0;
  let baseBurn = 0;

  if (!starving && state.energy >= RUN_THRESHOLD) {
    state.charState = "run";
    speed    = RUN_SPEED_KMS;
    baseBurn = 0.80;  // faster burn (was 0.40)
  } else if (!starving && state.energy > WALK_THRESHOLD) {
    state.charState = "walk";
    speed    = WALK_SPEED_KMS;
    baseBurn = 0.50;  // faster burn (was 0.16)
  } else {
    state.charState = "sit";
    speed    = 0;
    baseBurn = 0;
  }

  const burnMult   = hungerBurnMultiplier(state.hunger);
  const speedMult  = hungerSpeedMultiplier(state.hunger);
  const energyMult = energySpeedMultiplier(state.energy);

  state.energy   = Math.max(0, state.energy - baseBurn * burnMult * dt);
  state.distance = Math.min(DESTINATION_KM, state.distance + speed * speedMult * energyMult * dt);

  // ── Milestones ──
  for (const m of MILESTONES) {
    if (!reachedMilestones.has(m.km) && state.distance >= m.km) {
      reachedMilestones.add(m.km);
      const isArrival = m.km >= DESTINATION_KM;
      broadcastAll({ type: "MILESTONE", km: m.km, text: m.text, isArrival });
      if (isArrival) {
        state.arrived   = true;
        state.charState = "sit";
        arrivalTimer = setTimeout(doReset, ARRIVAL_HOLD_MS);
      }
    }
  }

  const baseSpeedKmh = state.charState === "run"  ? RUN_SPEED_KMH
                     : state.charState === "walk" ? WALK_SPEED_KMH
                     : 0;
  const effectiveSpeedKmh = parseFloat((baseSpeedKmh * speedMult * energyMult).toFixed(1));

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
    speedKmh:      effectiveSpeedKmh,
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
  return ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    + "-" + NOUNS[Math.floor(Math.random() * NOUNS.length)];
}

wss.on("connection", (ws, req) => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0].trim();
  ws.clientIp = ip;
  ws.username = guestName();

  ws.boostCount       = 0;
  ws.boostWindowStart = Date.now();

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
    feedsUsed:         feedRec.count,
    feedsLimit:        DAILY_FEED_LIMIT,
    feedsResetAt:      feedRec.resetAt,
    reachedMilestones: [...reachedMilestones],
  }));

  broadcastAll({ type: "ONLINE_COUNT", count: wss.clients.size });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      // ── BOOST ──
      if (msg.type === "BOOST") {
        const now = Date.now();

        if (now - ws.boostWindowStart > BOOST_WINDOW_MS) {
          ws.boostCount       = 0;
          ws.boostWindowStart = now;
        }

        if (ws.boostCount >= BOOST_MAX) return;

        ws.boostCount++;
        state.energy += BOOST_GAIN;
        state.totalEnergy += BOOST_GAIN;

        // Send MY_BOOST privately to the sender so only they flash
        ws.send(JSON.stringify({
          type:        "MY_BOOST",
          gain:        BOOST_GAIN,
          energy:      Math.round(state.energy),
          totalEnergy: Math.round(state.totalEnergy),
        }));

        // Broadcast updated energy to everyone (no flash)
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

        broadcastAll({
          type:        "FEED_EVENT",
          hunger:      parseFloat(state.hunger.toFixed(1)),
          hungerState: state.hungerState,
          from:        ws.username,
        });

        ws.send(JSON.stringify({
          type:         "FEED_RESULT",
          success:      true,
          hunger:       parseFloat(state.hunger.toFixed(1)),
          hungerState:  state.hungerState,
          feedsUsed:    rec.count,
          feedsLimit:   DAILY_FEED_LIMIT,
          feedsResetAt: rec.resetAt,
        }));
      }

    } catch {}
  });

  ws.on("close", () => {
    state.onlineCount = wss.clients.size;
    broadcastAll({ type: "ONLINE_COUNT", count: wss.clients.size });
  });

  ws.on("error", () => {});
});

// ─── REST ─────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🐾 Wanderer server on :${PORT}`);
  console.log(`   Burn: walk=${0.50}/s run=${0.80}/s`);
  console.log(`   Hunger: full→starving in 1 hour`);
  console.log(`   Speed scales with energy up to 2.5×`);
  console.log(`   Boost limit: ${BOOST_MAX} per ${BOOST_WINDOW_MS/1000}s per connection`);
});