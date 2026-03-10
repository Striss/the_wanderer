import { useState, useCallback, useEffect, useRef } from "react";
import GameCanvas from "./components/GameCanvas";
import { useWandererSocket } from "./hooks/useWandererSocket";
import { getPaletteForTime } from "./hooks/usePalette";
import "./App.css";

const DESTINATION_KM = 6000;
const DAILY_FEED_MAX = 3;

const DESTINATION_LABEL = "A cottage at the edge of a coastal cliff.\nSomeone used to live there.\nThe garden still grows.";

function fmtEnergy(n) { return Math.round(n).toLocaleString(); }

function fmtDistance(km) {
  if (km < 1) return (km * 1000).toFixed(0) + " m";
  return km.toFixed(km < 10 ? 2 : 1) + " km";
}

function fmtCountdown(ms) {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function App() {
  const [energy, setEnergy]               = useState(12);
  const [totalEnergy, setTotalEnergy]     = useState(12);
  const [hunger, setHunger]               = useState(0);
  const [hungerState, setHungerState]     = useState("full");
  const [distance, setDistance]           = useState(0);
  const [onlineCount, setOnlineCount]     = useState(0);
  const [charState, setCharState]         = useState("walk");
  const [arrived, setArrived]             = useState(false);
  const [palette, setPalette]             = useState(() => getPaletteForTime());
  const [popups, setPopups]               = useState([]);
  const [boostFlash, setBoostFlash]       = useState(false);
  const [feedFlash, setFeedFlash]         = useState(false);
  const [timeLabel, setTimeLabel]         = useState("");
  const [username, setUsername]           = useState("");
  const [chatMessages, setChatMessages]   = useState([]);
  const [chatOpen, setChatOpen]           = useState(false);
  const [chatInput, setChatInput]         = useState("");
  const [unread, setUnread]               = useState(0);
  const [wsConnected, setWsConnected]     = useState(false);
  const [feedsUsed, setFeedsUsed]         = useState(0);
  const [feedsResetAt, setFeedsResetAt]   = useState(null);
  const [feedMsg, setFeedMsg]             = useState("");

  // Milestone lore: list of { km, text } already revealed
  const [revealedLore, setRevealedLore]   = useState([]);
  // Active milestone flash: { km, text }
  const [milestoneFlash, setMilestoneFlash] = useState(null);
  const milestoneFlashTimer               = useRef(null);

  // Arrival overlay
  const [showArrivalText, setShowArrivalText] = useState(false);

  const popupIdRef   = useRef(0);
  const chatEndRef   = useRef(null);
  const chatInputRef = useRef(null);
  const feedMsgTimer = useRef(null);

  // Palette clock
  useEffect(() => {
    const update = () => {
      if (!arrived) setPalette(getPaletteForTime());
      const now = new Date();
      setTimeLabel(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, [arrived]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnread(0);
    }
  }, [chatMessages, chatOpen]);

  function showFeedMsg(text, duration = 3000) {
    clearTimeout(feedMsgTimer.current);
    setFeedMsg(text);
    feedMsgTimer.current = setTimeout(() => setFeedMsg(""), duration);
  }

  function triggerMilestone(km, text) {
    clearTimeout(milestoneFlashTimer.current);
    setMilestoneFlash({ km, text });
    milestoneFlashTimer.current = setTimeout(() => setMilestoneFlash(null), 8000);
    setRevealedLore(prev => {
      if (prev.find(m => m.km === km)) return prev;
      return [...prev, { km, text }];
    });
  }

  const handleHello = useCallback((msg) => {
    setEnergy(msg.energy);
    setTotalEnergy(msg.totalEnergy);
    setHunger(msg.hunger ?? 0);
    setHungerState(msg.hungerState ?? "full");
    setDistance(msg.distance);
    setOnlineCount(msg.onlineCount);
    setCharState(msg.charState);
    setArrived(msg.arrived ?? false);
    setUsername(msg.username || "");
    setWsConnected(true);
    if (msg.chatHistory) setChatMessages(msg.chatHistory);
    setFeedsUsed(msg.feedsUsed ?? 0);
    setFeedsResetAt(msg.feedsResetAt ?? null);
    // Restore lore for milestones already passed
    if (msg.reachedMilestones?.length) {
      const ALL_LORE = [
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
      const reached = new Set(msg.reachedMilestones);
      setRevealedLore(ALL_LORE.filter(m => reached.has(m.km)));
    }
    if (msg.arrived) setShowArrivalText(true);
  }, []);

  const handleState = useCallback((msg) => {
    setEnergy(msg.energy);
    setTotalEnergy(msg.totalEnergy);
    setHunger(msg.hunger ?? 0);
    setHungerState(msg.hungerState ?? "full");
    setDistance(msg.distance);
    setOnlineCount(msg.onlineCount);
    setCharState(msg.charState);
    setArrived(msg.arrived ?? false);
  }, []);

  const handleBoostEvent = useCallback((msg) => {
    setEnergy(msg.energy);
    setTotalEnergy(msg.totalEnergy);
    const id = popupIdRef.current++;
    setPopups((prev) => [...prev.slice(-6), {
      id, x: 75 + Math.random() * 60, y: 185 + Math.random() * 20,
      text: `+${fmtEnergy(msg.gain)}`, life: 1,
    }]);
    setBoostFlash(true);
    setTimeout(() => setBoostFlash(false), 130);
  }, []);

  const handleFeedEvent = useCallback((msg) => {
    setHunger(msg.hunger);
    setHungerState(msg.hungerState);
    const id = popupIdRef.current++;
    setPopups((prev) => [...prev.slice(-6), {
      id, x: 130 + Math.random() * 60, y: 185 + Math.random() * 20,
      text: `🍖 FED!`, life: 1.2,
    }]);
    setFeedFlash(true);
    setTimeout(() => setFeedFlash(false), 200);
  }, []);

  const handleFeedResult = useCallback((msg) => {
    setFeedsUsed(msg.feedsUsed);
    setFeedsResetAt(msg.feedsResetAt);
    if (msg.success) {
      setHunger(msg.hunger);
      setHungerState(msg.hungerState);
    } else if (msg.reason === "daily_limit") {
      const msLeft = (msg.feedsResetAt || 0) - Date.now();
      showFeedMsg(`No more food today. Resets in ${fmtCountdown(msLeft)}.`);
    }
  }, []);

  const handleMilestone = useCallback((msg) => {
    triggerMilestone(msg.km, msg.text);
    if (msg.isArrival) {
      setArrived(true);
      setShowArrivalText(true);
    }
  }, []);

  const handleReset = useCallback(() => {
    setArrived(false);
    setShowArrivalText(false);
    setRevealedLore([]);
    setMilestoneFlash(null);
    setEnergy(12);
    setTotalEnergy(0);
    setHunger(0);
    setHungerState("full");
    setDistance(0);
    setCharState("walk");
  }, []);

  const handleOnlineCount = useCallback((count) => setOnlineCount(count), []);

  const handleChatMsg = useCallback((msg) => {
    setChatMessages((prev) => [...prev.slice(-79), msg]);
    setUnread((n) => chatOpen ? 0 : n + 1);
  }, [chatOpen]);

  const handlePopupTick = useCallback((dt) => {
    setPopups((prev) =>
      prev.map((p) => ({ ...p, y: p.y - 38 * dt, life: p.life - dt * 1.3 }))
          .filter((p) => p.life > 0)
    );
  }, []);

  const { sendBoost, sendFeed, sendChat, connected } = useWandererSocket({
    onHello: handleHello,
    onState: handleState,
    onBoostEvent: handleBoostEvent,
    onFeedEvent: handleFeedEvent,
    onFeedResult: handleFeedResult,
    onMilestone: handleMilestone,
    onReset: handleReset,
    onOnlineCount: handleOnlineCount,
    onChatMsg: handleChatMsg,
  });

  useEffect(() => { setWsConnected(connected); }, [connected]);

  const boost = useCallback(() => { if (!arrived) sendBoost(); }, [sendBoost, arrived]);
  const feed  = useCallback(() => { if (!arrived) sendFeed();  }, [sendFeed, arrived]);

  const submitChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    sendChat(text);
    setChatInput("");
  }, [chatInput, sendChat]);

  useEffect(() => {
    const handler = (e) => {
      if (document.activeElement === chatInputRef.current) {
        if (e.code === "Enter") submitChat();
        return;
      }
      if (e.code === "Space") { e.preventDefault(); boost(); }
      if (e.code === "KeyF")  { e.preventDefault(); feed(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [boost, feed, submitChat]);

  // Derived
  const tankDisplayMax  = Math.max(totalEnergy, 50);
  const tankFillPct     = Math.min(100, (energy / tankDisplayMax) * 100);
  const energyColor     = energy > 40 ? "#74c69d" : energy > 10 ? "#ffd166" : "#ef476f";
  const hungerPct       = Math.round(hunger);
  const hungerColor     = hungerState === "starving"    ? "#ef476f"
    : hungerState === "very-hungry" ? "#ff8c42"
    : hungerState === "hungry"      ? "#ffd166"
    : "#74c69d";
  const hungerLabel     = hungerState === "starving"    ? "★ STARVING"
    : hungerState === "very-hungry" ? "VERY HUNGRY"
    : hungerState === "hungry"      ? "HUNGRY"
    : "WELL FED";
  const feedsLeft       = DAILY_FEED_MAX - feedsUsed;
  const canFeed         = feedsLeft > 0 && !arrived;
  const resetCountdown  = feedsResetAt ? fmtCountdown(feedsResetAt - Date.now()) : null;
  const pctToDest       = Math.min(100, (distance / DESTINATION_KM) * 100);
  const kmRemaining     = Math.max(0, DESTINATION_KM - distance);
  const speedLabel      = charState === "run" ? "9.0 km/h" : charState === "walk" ? "5.0 km/h" : "0 km/h";
  const burnMultiplier  = 1 + (hunger / 100) * 3;
  const baseBurn        = charState === "run" ? 0.40 : charState === "walk" ? 0.16 : 0;
  const effectiveBurn   = (baseBurn * burnMultiplier).toFixed(2);

  return (
    <div className="app">
      {/* ── HEADER ── */}
      <header className="header">
        <div className="title-line">
          <span className="diamond">◆</span>
          <span className="title">THE WANDERER</span>
          <span className="diamond">◆</span>
        </div>
        <div className="subtitle">A COLLECTIVE JOURNEY</div>
      </header>

      {/* ── MILESTONE FLASH ── */}
      {milestoneFlash && (
        <div className="milestone-flash">
          <div className="milestone-km">{fmtDistance(milestoneFlash.km)} reached</div>
          <div className="milestone-text">"{milestoneFlash.text}"</div>
        </div>
      )}

      {/* ── CANVAS + CHAT ── */}
      <div className="scene-row">
        <div className={`canvas-wrapper ${arrived ? "" : ""}`} onClick={boost}>
          <div className={`boost-overlay ${boostFlash ? "flash" : ""} ${feedFlash ? "feed-flash" : ""}`} />

          <GameCanvas
            palette={palette}
            charState={charState}
            energy={energy}
            hungerState={hungerState}
            arrived={arrived}
            popups={popups}
            onPopupTick={handlePopupTick}
          />

          {/* Arrival text overlay */}
          {showArrivalText && (
            <div className="arrival-overlay">
              <div className="arrival-text">
                You helped them get here.
                <br />
                <span className="arrival-sub">Thank you for walking.</span>
              </div>
            </div>
          )}

          {/* Normal HUDs — hidden on arrival */}
          {!arrived && <>
            <div className="hud hud-tr">
              <div className="hud-label">REMAINING</div>
              <div className="hud-value">{fmtDistance(kmRemaining)}</div>
            </div>
            <div className="hud hud-tl">
              <div className="hud-scene">{palette.name || "—"}</div>
              {timeLabel && <div className="hud-time">{timeLabel}</div>}
            </div>
            <div className="hud hud-bl">
              {charState === "sit"
                ? <span className="hud-state blink-slow">★ RESTING</span>
                : <span className="hud-state">{charState === "run" ? "▶▶" : "▶"} {speedLabel}</span>
              }
            </div>
            <div className={`hud hud-br ${wsConnected ? "online" : "offline"}`}>
              <span className="dot" />{wsConnected ? `${onlineCount} online` : "connecting..."}
            </div>
            {(hungerState === "starving" || hungerState === "very-hungry") && (
              <div className="hud-hunger-warn blink" style={{ color: hungerColor }}>
                {hungerState === "starving" ? "🍖 STARVING — FEED ME!" : "🍖 VERY HUNGRY"}
              </div>
            )}
          </>}

          {/* Arrived HUD */}
          {arrived && (
            <div className="hud hud-tl">
              <div className="hud-scene arrived-scene">THE COTTAGE</div>
              <div className="hud-time">coastal cliffs · grey-green morning</div>
            </div>
          )}
        </div>

        {/* ── CHAT ── */}
        <div className={`chat-panel ${chatOpen ? "open" : "closed"}`}>
          <button className="chat-toggle" onClick={() => { setChatOpen((v) => !v); setUnread(0); }}>
            {chatOpen ? "✕" : "💬"}
            {!chatOpen && unread > 0 && <span className="unread-badge">{unread > 9 ? "9+" : unread}</span>}
          </button>
          {chatOpen && (
            <>
              <div className="chat-header">
                <span>JOURNEY CHAT</span>
                {username && <span className="chat-username">you: {username}</span>}
              </div>
              <div className="chat-messages">
                {chatMessages.map((m) => (
                  <div key={m.id} className={`chat-msg ${m.type === "system" ? "system" : "user"}`}>
                    {m.type === "user" && <span className="chat-name">{m.username}</span>}
                    <span className="chat-text">{m.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-row">
                <input ref={chatInputRef} className="chat-input" value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="say something..." maxLength={120} />
                <button className="chat-send" onClick={submitChat}>↵</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── DESTINATION LABEL ── (shows before arrival as mystery) */}
      {!arrived && (
        <div className="destination-label">
          {DESTINATION_LABEL.split("\n").map((line, i) => (
            <span key={i}>{line}{i < 2 && <br />}</span>
          ))}
        </div>
      )}

      {/* ── ARRIVED: just the lore, no meters ── */}
      {arrived && revealedLore.length > 0 && (
        <div className="lore-scroll arrived-lore">
          {revealedLore.map((m) => (
            <p key={m.km} className="lore-entry">{m.text}</p>
          ))}
        </div>
      )}

      {/* ── METERS (hidden when arrived) ── */}
      {!arrived && (
        <div className="meters-row">
          <div className="meter-block">
            <div className="meter-labels">
              <span className="meter-label-left">
                ENERGY TANK
                {energy < 10 && <span className="low-warn blink"> !! LOW</span>}
              </span>
              <span className="meter-label-right" style={{ color: energyColor }}>
                {fmtEnergy(energy)} <span className="meter-unit">units</span>
              </span>
            </div>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${tankFillPct}%`, background: energyColor }} />
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="meter-tick" style={{ left: `${(i+1)*10}%` }} />
              ))}
            </div>
            <div className="meter-sub">
              Total contributed: <span style={{ color: "#888" }}>{fmtEnergy(totalEnergy)}</span>
              {charState !== "sit" && <span style={{ color: "#555" }}> · burning {effectiveBurn}/sec</span>}
            </div>
          </div>

          <div className="meter-block">
            <div className="meter-labels">
              <span className="meter-label-left" style={{ color: hungerColor }}>HUNGER — {hungerLabel}</span>
              <span className="meter-label-right" style={{ color: hungerColor }}>
                {hungerPct}<span className="meter-unit">%</span>
              </span>
            </div>
            <div className="meter-track hunger">
              <div className="meter-fill" style={{ width: `${hungerPct}%`, background: hungerColor }} />
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="meter-tick" style={{ left: `${(i+1)*10}%` }} />
              ))}
            </div>
            <div className="meter-sub">
              {hungerState !== "full"
                ? <span style={{ color: hungerColor }}>burn ×{burnMultiplier.toFixed(1)} — energy draining faster!</span>
                : <span style={{ color: "#555" }}>burn ×1.0 — well fed</span>
              }
            </div>
          </div>
        </div>
      )}

      {/* ── STATS ── */}
      {!arrived && (
        <div className="stats-row">
          <div className="stat-block">
            <div className="stat-label">TRAVELED</div>
            <div className="stat-value accent">{fmtDistance(distance)}</div>
          </div>
          <div className="stat-block center">
            <div className="stat-label">DESTINATION</div>
            <div className="progress-wrap">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pctToDest}%` }} />
              </div>
              <div className="progress-pct">{pctToDest.toFixed(3)}%</div>
            </div>
            <div className="stat-remaining">{fmtDistance(kmRemaining)} remaining</div>
          </div>
          <div className="stat-block right">
            <div className="stat-label">SPEED</div>
            <div className="stat-value">{speedLabel}</div>
          </div>
        </div>
      )}

      {/* ── ACTIONS (hidden when arrived) ── */}
      {!arrived && (
        <div className="actions-row">
          <div className="action-block">
            <button className="boost-btn" onClick={boost}>▲ GIVE ENERGY</button>
            <div className="action-hint">CLICK · SPACE · TAP</div>
          </div>
          <div className="action-block">
            <button
              className={`feed-btn ${!canFeed ? "depleted" : ""} ${hungerState === "starving" ? "urgent" : ""}`}
              onClick={feed} disabled={!canFeed}
            >
              🍖 FEED
            </button>
            <div className="action-hint feed-quota" style={{ color: canFeed ? "#9090b8" : "#ef476f" }}>
              {canFeed ? `${feedsLeft} of ${DAILY_FEED_MAX} feeds left today` : `all used · resets in ${resetCountdown}`}
            </div>
            {feedMsg && <div className="feed-msg">{feedMsg}</div>}
          </div>
        </div>
      )}

      {/* ── LORE PANEL (journey so far, shown while walking) ── */}
      {!arrived && revealedLore.length > 0 && (
        <div className="lore-scroll">
          <div className="lore-scroll-title">FRAGMENTS</div>
          {revealedLore.map((m) => (
            <p key={m.km} className="lore-entry">
              <span className="lore-km">{fmtDistance(m.km)} —</span> {m.text}
            </p>
          ))}
        </div>
      )}

      <footer className="lore">
        THE WANDERER WALKS WHETHER YOU WATCH OR NOT.
        <br />
        ENERGY KEEPS THEM MOVING · FOOD KEEPS THEM STRONG.
      </footer>
    </div>
  );
}
