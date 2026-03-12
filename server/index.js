const express = require("express");
const { WebSocketServer } = require("ws");
const cors   = require("cors");
const http   = require("http");
const https  = require("https");
const path   = require("path");
const fs     = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
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

// ── Energy cap + online-scaled burn ──────────────────────────────────────────
// Energy is hard-capped. Burn scales with online count so busy periods drain it.
const ENERGY_CAP      = 99999;

// Base burn rates (per second)
const BASE_BURN_WALK  = 0.15;
const BASE_BURN_RUN   = 0.25;

// Each extra online user adds this much to burn rate (beyond the first)
const BURN_PER_USER   = 0.02;
const MAX_USER_BURN   = 4.0;  // cap the online-scaled bonus so it can't go infinite

// ── Hunger ────────────────────────────────────────────────────────────────────
const HUNGER_RATE      = 100 / (15 * 60); // full→starving in 15 minutes
const HUNGER_PER_FEED  = 34;
const DAILY_FEED_LIMIT = 3;

function hungerBurnMultiplier(hunger) {
  return 1 + (hunger / 100) * 3; // 1× to 4×
}

function hungerSpeedMultiplier(hunger) {
  if (hunger < 50) return 1.0;
  if (hunger < 70) return 0.85;
  if (hunger < 90) return 0.65;
  return 0.45;
}

function energySpeedMultiplier(energy) {
  if (energy < 10000)  return 1.0;
  if (energy < 20000)  return 2.0;
  if (energy < 30000)  return 4.0;
  if (energy < 40000)  return 7.0;
  if (energy < 50000)  return 11.0;
  if (energy < 60000)  return 16.0;
  if (energy < 70000)  return 22.0;
  if (energy < 80000)  return 29.0;
  if (energy < 90000)  return 37.0;
  return 46.0;
}

// Scaled burn: base + per-user bonus, capped
function onlineBurnBonus(onlineCount) {
  const extra = Math.max(0, onlineCount - 1) * BURN_PER_USER;
  return Math.min(extra, MAX_USER_BURN);
}

// ─── GEO / FLAG ───────────────────────────────────────────────────────────────
function countryFlag(code) {
  if (!code || code.length !== 2) return "";
  return code.toUpperCase().split("").map(c =>
    String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))
  ).join("");
}

function getFlag(ip, cb) {
  if (!ip || ip === "unknown" || ip.startsWith("127.") ||
      ip.startsWith("192.168.") || ip === "::1") {
    return cb("");
  }
  const url = `https://ip-api.com/json/${ip}?fields=countryCode`;
  https.get(url, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try { cb(countryFlag(JSON.parse(data).countryCode)); }
      catch { cb(""); }
    });
  }).on("error", () => cb(""));
}

// ─── MILESTONES ───────────────────────────────────────────────────────────────
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

// ─── STATE ────────────────────────────────────────────────────────────────────
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
  } catch (e) { console.log("No saved state, starting fresh"); }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      distance:          state.distance,
      totalEnergy:       state.totalEnergy,
      hunger:            state.hunger,
      reachedMilestones: [...reachedMilestones],
    }));
  } catch (e) { console.error("Failed to save state:", e); }
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
const TICK_MS        = 200;
const ARRIVAL_HOLD_MS = 90000;
let arrivalTimer     = null;

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
  const burnBonus = onlineBurnBonus(state.onlineCount);

  let speed    = 0;
  let baseBurn = 0;

  if (!starving && state.energy >= RUN_THRESHOLD) {
    state.charState = "run";
    speed    = RUN_SPEED_KMS;
    baseBurn = BASE_BURN_RUN + burnBonus;
  } else if (!starving && state.energy > WALK_THRESHOLD) {
    state.charState = "walk";
    speed    = WALK_SPEED_KMS;
    baseBurn = BASE_BURN_WALK + burnBonus;
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

  const baseSpeedKmh      = state.charState === "run"  ? RUN_SPEED_KMH
                          : state.charState === "walk" ? WALK_SPEED_KMH : 0;
  const effectiveSpeedKmh = parseFloat((baseSpeedKmh * speedMult * energyMult).toFixed(1));

  // ── Milestones ──
  for (const m of MILESTONES) {
    if (!reachedMilestones.has(m.km) && state.distance >= m.km) {
      reachedMilestones.add(m.km);
      const isArrival = m.km >= DESTINATION_KM;
      broadcastAll({ type: "MILESTONE", km: m.km, text: m.text, isArrival });
      if (isArrival) {
        state.arrived   = true;
        state.charState = "sit";
        arrivalTimer    = setTimeout(doReset, ARRIVAL_HOLD_MS);
      }
    }
  }

  broadcastAll({
    type:          "STATE",
    energy:        Math.round(state.energy),
    energyCap:     ENERGY_CAP,
    totalEnergy:   Math.round(state.totalEnergy),
    hunger:        parseFloat(state.hunger.toFixed(1)),
    hungerState:   state.hungerState,
    distance:      parseFloat(state.distance.toFixed(4)),
    onlineCount:   state.onlineCount,
    charState:     state.charState,
    arrived:       state.arrived,
    destinationKm: DESTINATION_KM,
    speedKmh:      effectiveSpeedKmh,
    burnRate:      parseFloat((baseBurn * burnMult).toFixed(2)),
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
  ws.clientIp  = ip;
  ws.username  = guestName();
  ws.boostCount       = 0;
  ws.boostWindowStart = Date.now();

  state.onlineCount = wss.clients.size;

  const feedRec = getFeedRecord(ip);

  ws.send(JSON.stringify({
    type:              "HELLO",
    energy:            Math.round(state.energy),
    energyCap:         ENERGY_CAP,
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

        // Hard cap — silently reject if at cap
        if (state.energy >= ENERGY_CAP) {
          ws.send(JSON.stringify({
            type:      "BOOST_CAPPED",
            energyCap: ENERGY_CAP,
            energy:    Math.round(state.energy),
          }));
          return;
        }

        state.energy      = Math.min(ENERGY_CAP, state.energy + BOOST_GAIN);
        state.totalEnergy += BOOST_GAIN;

        ws.send(JSON.stringify({
          type:        "MY_BOOST",
          gain:        BOOST_GAIN,
          energy:      Math.round(state.energy),
          totalEnergy: Math.round(state.totalEnergy),
        }));

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
        state.hunger      = Math.max(0, state.hunger - HUNGER_PER_FEED);
        state.hungerState = hungerLevel(state.hunger);

        const feederName = ws.username;
        getFlag(ws.clientIp, (flag) => {
          broadcastAll({
            type:        "FEED_EVENT",
            hunger:      parseFloat(state.hunger.toFixed(1)),
            hungerState: state.hungerState,
            from:        feederName,
            flag,
          });
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
  console.log(`   Energy cap: ${ENERGY_CAP}`);
  console.log(`   Burn: walk=${BASE_BURN_WALK}/s run=${BASE_BURN_RUN}/s + ${BURN_PER_USER}/s per extra user`);
  console.log(`   Hunger: full→starving in 15 min`);
  console.log(`   Boost limit: ${BOOST_MAX} per ${BOOST_WINDOW_MS/1000}s`);
});