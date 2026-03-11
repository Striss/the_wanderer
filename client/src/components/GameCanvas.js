import { useEffect, useRef, useCallback } from "react";
import { drawCharacter, CHAR_HEIGHT } from "./character";

const W = 800;
const H = 300;

function generateStars(count) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H * 0.55,
    size: Math.random() < 0.25 ? 2 : 1,
    phase: Math.random() * Math.PI * 2,
  }));
}

function generateClouds() {
  return Array.from({ length: 5 }, (_, i) => ({
    x: i * 180 + Math.random() * 60,
    y: 25 + Math.random() * 55,
    w: 48 + Math.floor(Math.random() * 5) * 8,
    speed: 0.15 + Math.random() * 0.2,
  }));
}

function generateGroundTiles() {
  return Array.from({ length: 40 }, (_, i) => ({
    x: i * 32,
    type: Math.floor(Math.random() * 3),
  }));
}

export default function GameCanvas({ palette, charState, energy, hungerState, arrived, popups, onPopupTick }) {
  const canvasRef = useRef(null);
  const scrollRef = useRef({ ground: 0, hill1: 0, hill2: 0 });
  const animRef = useRef(null);
  const charAnimRef = useRef({ frame: 0, timer: 0 });
  const lastTimeRef = useRef(null);
  const staticRef = useRef(null);
  const hungerStateRef = useRef(hungerState);
  const paletteRef = useRef(palette);
  const arrivedRef = useRef(arrived);
  useEffect(() => { hungerStateRef.current = hungerState; }, [hungerState]);
  useEffect(() => { arrivedRef.current = arrived; }, [arrived]);
  const charStateRef = useRef(charState);
  const energyRef = useRef(energy);
  const popupsRef = useRef(popups);

  useEffect(() => { paletteRef.current = palette; }, [palette]);
  useEffect(() => { charStateRef.current = charState; }, [charState]);
  useEffect(() => { energyRef.current = energy; }, [energy]);
  useEffect(() => { popupsRef.current = popups; }, [popups]);

  useEffect(() => {
    staticRef.current = {
      stars: generateStars(70),
      clouds: generateClouds(),
      groundTiles: generateGroundTiles(),
    };
  }, []);

  const drawFrame = useCallback((timestamp) => {
    const canvas = canvasRef.current;
    if (!canvas || !staticRef.current) {
      animRef.current = requestAnimationFrame(drawFrame);
      return;
    }
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const dt = Math.min((timestamp - (lastTimeRef.current || timestamp)) / 1000, 0.05);
    lastTimeRef.current = timestamp;

    const palette   = paletteRef.current;
    const charState = charStateRef.current;
    const isArrived = arrivedRef.current;

    // ── ARRIVAL SCENE — world stops, fog rolls in, garden appears ──
    if (isArrived) {
      drawArrivalScene(ctx, timestamp, charAnimRef, dt, palette);
      animRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    // Scroll speeds
    let visualSpeed = 0;
    if (charState === "run") visualSpeed = 110;
    else if (charState === "walk") visualSpeed = 60;

    scrollRef.current.ground += visualSpeed * dt;
    scrollRef.current.hill1  += visualSpeed * 0.38 * dt;
    scrollRef.current.hill2  += visualSpeed * 0.15 * dt;

    const { clouds, groundTiles, stars } = staticRef.current;
    clouds.forEach((c) => { c.x -= c.speed * (visualSpeed || 4) * dt * 0.12; });

    // Character animation
    const ca = charAnimRef.current;
    const hungerSlow = hungerStateRef.current === "starving" ? 2.2
      : hungerStateRef.current === "very-hungry" ? 1.6
      : hungerStateRef.current === "hungry" ? 1.2 : 1.0;
    const animSpeed = (charState === "run" ? 0.09 : charState === "walk" ? 0.16 : 1.1) * hungerSlow;
    ca.timer += dt;
    if (ca.timer >= animSpeed) {
      ca.timer = 0;
      const frameCount = charState === "sit" ? 2 : 4;
      ca.frame = (ca.frame + 1) % frameCount;
    }

    // ── SKY ──
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    const sky = palette.sky || ["#001", "#002", "#003", "#004"];
    skyGrad.addColorStop(0,    sky[0]);
    skyGrad.addColorStop(0.35, sky[1]);
    skyGrad.addColorStop(0.7,  sky[2]);
    skyGrad.addColorStop(1,    sky[3]);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // ── STARS ──
    const starAlpha = palette.cloudOpacity < 0.25
      ? 0.85 : Math.max(0, 0.85 - (palette.cloudOpacity - 0.25) * 4);
    if (starAlpha > 0.05) {
      stars.forEach((star) => {
        const twinkle = 0.6 + Math.sin(timestamp * 0.0008 + star.phase) * 0.35;
        ctx.globalAlpha = starAlpha * twinkle;
        ctx.fillStyle = palette.star;
        ctx.fillRect(star.x, star.y, star.size, star.size);
      });
      ctx.globalAlpha = 1;
    }

    // ── CLOUDS ──
    ctx.globalAlpha = palette.cloudOpacity || 0.3;
    clouds.forEach((cloud) => {
      const cx = ((cloud.x % (W + 120) + W + 120) % (W + 120));
      ctx.fillStyle = palette.text;
      ctx.fillRect(cx,      cloud.y,      cloud.w,      8);
      ctx.fillRect(cx + 8,  cloud.y - 8,  cloud.w - 16, 8);
      ctx.fillRect(cx + 4,  cloud.y - 16, cloud.w - 24, 8);
    });
    ctx.globalAlpha = 1;

    // ── HILLS ──
    drawHill(ctx, palette.hill1, scrollRef.current.hill2, 35, H - 105, W);
    drawHill(ctx, palette.hill2, scrollRef.current.hill1, 22, H - 82,  W);

    // ── GROUND ──
    const groundY = H - 60;
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, groundY, W, 60);
    ctx.fillStyle = palette.groundLine;
    ctx.fillRect(0, groundY, W, 4);

    groundTiles.forEach((tile) => {
      const tx = ((tile.x - Math.floor(scrollRef.current.ground) % (W + 80) + W + 80) % (W + 80));
      if (tile.type === 0) {
        ctx.fillStyle = palette.groundLine;
        ctx.fillRect(tx, groundY + 9, 4, 4);
        ctx.fillRect(tx + 10, groundY + 18, 4, 4);
      } else if (tile.type === 1) {
        ctx.fillStyle = palette.hill2;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(tx, groundY + 7, 8, 4);
        ctx.fillRect(tx + 4, groundY + 3, 4, 4);
        ctx.globalAlpha = 1;
      }
    });

    // ── CHARACTER ──
    const charX = 80;
    const charY = groundY - CHAR_HEIGHT - 2;
    const bounce = charState === "sit"
      ? 0
      : Math.sin(timestamp * (charState === "run" ? 0.02 : 0.011))
        * (charState === "run" ? 3.5 : 2);
    drawCharacter(ctx, charState, ca.frame, charX, charY, palette, bounce, hungerStateRef.current);

    // ── POPUPS ──
    popupsRef.current.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.mine) {
        // Your own boost — large, centered above character, accent color
        ctx.font = "bold 14px monospace";
        ctx.fillStyle = "#f5c97a";
        ctx.shadowColor = "#f5c97a";
        ctx.shadowBlur = 8;
        ctx.fillText(p.text, p.x, p.y);
        ctx.shadowBlur = 0;
      } else {
        // Others' boosts — small, subtle
        ctx.font = "bold 8px monospace";
        ctx.fillStyle = palette.accent;
        ctx.fillText(p.text, p.x, p.y);
      }
    });
    ctx.globalAlpha = 1;
    onPopupTick?.(dt);

    // ── SCANLINES ──
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#000";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
    ctx.globalAlpha = 1;

    // ── VIGNETTE ──
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    animRef.current = requestAnimationFrame(drawFrame);
  }, [onPopupTick]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animRef.current);
  }, [drawFrame]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ display: "block", imageRendering: "pixelated", cursor: "pointer" }}
    />
  );
}

// ── ARRIVAL SCENE ────────────────────────────────────────────────────────────
// Soft grey-green coastal morning. World is still. Wanderer sits in garden.
function drawArrivalScene(ctx, timestamp, charAnimRef, dt, _palette) {
  // Fixed arrival palette — grey-green coastal morning
  const SKY_TOP    = "#2a3340";
  const SKY_MID    = "#3d4d50";
  const SKY_LOW    = "#4e5e52";
  const GROUND_COL = "#3a4a38";
  const GROUND_LINE= "#2e3d2c";
  const HILL1      = "#2e3d30";
  const HILL2      = "#364438";
  const FOG        = "rgba(180,195,185,";
  const DAFFODIL   = "#d4b44a";
  const STEM       = "#4a6040";

  // Slow sit animation
  const ca = charAnimRef.current;
  ca.timer += dt;
  if (ca.timer >= 1.2) { ca.timer = 0; ca.frame = (ca.frame + 1) % 2; }

  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0,   SKY_TOP);
  skyGrad.addColorStop(0.5, SKY_MID);
  skyGrad.addColorStop(1,   SKY_LOW);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Far hills, fixed
  drawHill(ctx, HILL1, 0, 35, H - 105, W);
  drawHill(ctx, HILL2, 0, 22, H - 82,  W);

  const groundY = H - 60;

  // Ground
  ctx.fillStyle = GROUND_COL;
  ctx.fillRect(0, groundY, W, 60);
  ctx.fillStyle = GROUND_LINE;
  ctx.fillRect(0, groundY, W, 4);

  // Cottage (right side) — simple pixel art silhouette
  const cotX = W - 180;
  const cotY = groundY - 80;
  // Walls
  ctx.fillStyle = "#4a5248";
  ctx.fillRect(cotX, cotY + 20, 88, 60);
  // Roof
  ctx.fillStyle = "#3a3e38";
  ctx.fillRect(cotX - 4, cotY + 12, 96, 12);
  ctx.fillRect(cotX + 8, cotY + 4,  72, 10);
  ctx.fillRect(cotX + 20, cotY,     48, 6);
  // Door
  ctx.fillStyle = "#2a2e28";
  ctx.fillRect(cotX + 34, cotY + 46, 20, 34);
  // Windows
  ctx.fillStyle = "#6a7870";
  ctx.fillRect(cotX + 8,  cotY + 28, 16, 14);
  ctx.fillRect(cotX + 64, cotY + 28, 16, 14);
  // Soft window glow
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#c8b87a";
  ctx.fillRect(cotX + 9,  cotY + 29, 14, 12);
  ctx.fillRect(cotX + 65, cotY + 29, 14, 12);
  ctx.globalAlpha = 1;
  // Chimney
  ctx.fillStyle = "#3a3e38";
  ctx.fillRect(cotX + 60, cotY - 16, 12, 20);

  // Gate (open, slightly ajar)
  const gateX = cotX - 24;
  ctx.fillStyle = "#3a3e35";
  ctx.fillRect(gateX,     groundY - 24, 4, 24);  // post
  ctx.fillRect(gateX + 4, groundY - 20, 14, 3);  // top rail (open = angled)
  ctx.fillRect(gateX + 4, groundY - 10, 14, 3);  // bottom rail
  ctx.fillRect(gateX + 16, groundY - 22, 3, 22); // far post

  // Daffodils scattered in garden
  const daffs = [
    { x: cotX - 40, h: 14 }, { x: cotX - 52, h: 18 }, { x: cotX - 30, h: 12 },
    { x: cotX + 10, h: 16 }, { x: cotX + 20, h: 13 },
    { x: cotX + 70, h: 15 }, { x: cotX + 90, h: 17 },
  ];
  daffs.forEach(({ x, h }) => {
    // Stem
    ctx.fillStyle = STEM;
    ctx.fillRect(x, groundY - h, 2, h);
    // Bloom — pixely 5×5 flower
    const bloom = 0.7 + Math.sin(timestamp * 0.001 + x * 0.1) * 0.06;
    ctx.globalAlpha = bloom;
    ctx.fillStyle = DAFFODIL;
    ctx.fillRect(x - 2, groundY - h - 4, 6, 4);
    ctx.fillRect(x - 3, groundY - h - 2, 8, 2);
    ctx.globalAlpha = 1;
  });

  // Character — sitting in garden, left of gate
  const charX = cotX - 72;
  const charY = groundY - CHAR_HEIGHT - 2;
  const arrivalPalette = { ..._palette, accent: "#d4b44a" };
  drawCharacter(ctx, "sit", ca.frame, charX, charY, arrivalPalette, 0, "full");

  // Rolling fog — layered, drifts slowly left to right
  const fogOffset = (timestamp * 0.008) % W;
  [
    { y: H - 30, h: 30, alpha: 0.35 },
    { y: H - 55, h: 28, alpha: 0.20 },
    { y: H - 80, h: 30, alpha: 0.12 },
    { y: H - 110, h: 40, alpha: 0.07 },
  ].forEach(({ y, h, alpha }) => {
    const fogGrad = ctx.createLinearGradient(0, y, 0, y + h);
    fogGrad.addColorStop(0, FOG + "0)");
    fogGrad.addColorStop(0.4, FOG + alpha + ")");
    fogGrad.addColorStop(1, FOG + alpha * 1.4 + ")");
    ctx.fillStyle = fogGrad;
    // Two overlapping fog bands at slightly different offsets for movement
    ctx.fillRect(-fogOffset, y, W + fogOffset, h);
    ctx.fillRect(W - fogOffset, y, fogOffset, h);
  });

  // Scanlines
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#000";
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
  ctx.globalAlpha = 1;

  // Vignette — heavier than normal, more intimate
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.9);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

function drawHill(ctx, color, offsetX, amplitude, yBase, W) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-20, H);
  for (let x = -20; x <= W + 20; x += 4) {
    const nx = (x + offsetX) * 0.0028;
    const y = yBase
      - Math.sin(nx) * amplitude
      - Math.sin(nx * 2.1 + 0.5) * (amplitude * 0.45)
      - Math.sin(nx * 0.5) * (amplitude * 0.3);
    ctx.lineTo(x, Math.floor(y / 4) * 4);
  }
  ctx.lineTo(W + 20, H);
  ctx.closePath();
  ctx.fill();
}
