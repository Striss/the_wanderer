// Palettes keyed to real time of day (hour 0-24)
// Each palette has a peak hour; the system blends between them slowly.

export const TIME_PALETTES = [
  {
    name: "DEEP NIGHT",
    hour: 0,
    sky: ["#000814", "#001233", "#001845", "#012a4a"],
    ground: "#010a13",
    groundLine: "#012a4a",
    hill1: "#001233",
    hill2: "#001845",
    star: "#caf0f8",
    accent: "#48cae4",
    text: "#90e0ef",
    ui: "#48cae4",
    cloudOpacity: 0.15,
  },
  {
    name: "PRE-DAWN",
    hour: 4,
    sky: ["#0d0221", "#3a0f5e", "#6b2d8b", "#a855b5"],
    ground: "#1a0a2e",
    groundLine: "#3a0f5e",
    hill1: "#2d0845",
    hill2: "#4a1a6e",
    star: "#e8c9f5",
    accent: "#c77dff",
    text: "#e0aaff",
    ui: "#c77dff",
    cloudOpacity: 0.2,
  },
  {
    name: "DAWN",
    hour: 6,
    sky: ["#1a1040", "#6b2d6b", "#c2502a", "#f4a261"],
    ground: "#2d1b0e",
    groundLine: "#5c3320",
    hill1: "#3d1f5c",
    hill2: "#8b3a3a",
    star: "#ffd6a5",
    accent: "#f4a261",
    text: "#ffd6a5",
    ui: "#f4a261",
    cloudOpacity: 0.35,
  },
  {
    name: "MORNING",
    hour: 9,
    sky: ["#0a2342", "#1b4f72", "#2e86ab", "#a8dadc"],
    ground: "#1a3a2e",
    groundLine: "#2d6a4f",
    hill1: "#1b4332",
    hill2: "#2e7d52",
    star: "#e8f4f8",
    accent: "#48cae4",
    text: "#caf0f8",
    ui: "#48cae4",
    cloudOpacity: 0.5,
  },
  {
    name: "MIDDAY",
    hour: 12,
    sky: ["#0077b6", "#0096c7", "#00b4d8", "#90e0ef"],
    ground: "#1b4332",
    groundLine: "#40916c",
    hill1: "#2d6a4f",
    hill2: "#52b788",
    star: "#d8f3dc",
    accent: "#74c69d",
    text: "#d8f3dc",
    ui: "#74c69d",
    cloudOpacity: 0.6,
  },
  {
    name: "AFTERNOON",
    hour: 15,
    sky: ["#1d3557", "#457b9d", "#a8c5da", "#e2c882"],
    ground: "#2d2a1e",
    groundLine: "#5c5020",
    hill1: "#3d3520",
    hill2: "#6b5e30",
    star: "#f5e6a3",
    accent: "#e2c882",
    text: "#f5e6a3",
    ui: "#e2c882",
    cloudOpacity: 0.45,
  },
  {
    name: "GOLDEN HOUR",
    hour: 17,
    sky: ["#1a0a00", "#6b2500", "#c45e00", "#f4a500"],
    ground: "#2d1200",
    groundLine: "#6b3000",
    hill1: "#3d1800",
    hill2: "#8b4000",
    star: "#ffd166",
    accent: "#ef8c00",
    text: "#ffd166",
    ui: "#ef8c00",
    cloudOpacity: 0.5,
  },
  {
    name: "DUSK",
    hour: 19,
    sky: ["#0d0221", "#4a1942", "#9b3a5c", "#e07060"],
    ground: "#1a0a1a",
    groundLine: "#4a1942",
    hill1: "#2d0d2d",
    hill2: "#6b2050",
    star: "#f5c9d0",
    accent: "#e07060",
    text: "#f5c9d0",
    ui: "#e07060",
    cloudOpacity: 0.3,
  },
  {
    name: "TWILIGHT",
    hour: 21,
    sky: ["#020010", "#0d0633", "#1a0f5e", "#2d1a8b"],
    ground: "#05030f",
    groundLine: "#1a0f5e",
    hill1: "#0d0633",
    hill2: "#1a1045",
    star: "#c8c5f5",
    accent: "#7b68ee",
    text: "#c8c5f5",
    ui: "#7b68ee",
    cloudOpacity: 0.2,
  },
  {
    name: "NIGHT",
    hour: 23,
    sky: ["#000208", "#000814", "#001020", "#001830"],
    ground: "#000810",
    groundLine: "#001030",
    hill1: "#000a1a",
    hill2: "#001228",
    star: "#caf0f8",
    accent: "#48cae4",
    text: "#90e0ef",
    ui: "#48cae4",
    cloudOpacity: 0.1,
  },
];

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerpColor(c1, c2, t) {
  if (!c1 || !c2) return c1 || "#000";
  const r1 = hexToRgb(c1), r2 = hexToRgb(c2);
  const r = Math.round(r1[0] + (r2[0] - r1[0]) * t);
  const g = Math.round(r1[1] + (r2[1] - r1[1]) * t);
  const b = Math.round(r1[2] + (r2[2] - r1[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function lerpPalette(p1, p2, t) {
  const result = { name: t < 0.5 ? p1.name : p2.name };
  const stringKeys = ["ground", "groundLine", "hill1", "hill2", "star", "accent", "text", "ui"];
  stringKeys.forEach((k) => {
    result[k] = lerpColor(p1[k], p2[k], t);
  });
  result.sky = p1.sky.map((c, i) => lerpColor(c, p2.sky[i], t));
  result.cloudOpacity = p1.cloudOpacity + (p2.cloudOpacity - p1.cloudOpacity) * t;
  return result;
}

// Get the current palette blended from real wall-clock time
export function getPaletteForTime(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

  // Find the two surrounding palette anchor points
  const sorted = [...TIME_PALETTES].sort((a, b) => a.hour - b.hour);
  let p1 = sorted[sorted.length - 1];
  let p2 = sorted[0];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (hour >= sorted[i].hour && hour < sorted[i + 1].hour) {
      p1 = sorted[i];
      p2 = sorted[i + 1];
      break;
    }
  }

  // Normalize t within the window
  let windowSize = p2.hour - p1.hour;
  if (windowSize <= 0) windowSize += 24;
  let elapsed = hour - p1.hour;
  if (elapsed < 0) elapsed += 24;
  const t = Math.min(1, elapsed / windowSize);

  return lerpPalette(p1, p2, t);
}
