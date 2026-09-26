import fs from "node:fs";

const username = process.env.GITHUB_USERNAME;
const token = process.env.GITHUB_TOKEN;

if (!username || !token) {
  throw new Error("GITHUB_USERNAME and GITHUB_TOKEN are required");
}

const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query,
    variables: { login: username },
  }),
});

const json = await response.json();

if (json.errors) {
  console.error(json.errors);
  process.exit(1);
}

const calendar = json.data.user.contributionsCollection.contributionCalendar;

const days = calendar.weeks.flatMap((week) => week.contributionDays);

const WIDTH = 1200;
const HEIGHT = 520;

const cx = WIDTH / 2;
const cy = HEIGHT / 2;

// Deterministic pseudo-random generator.
// Same contribution data -> same universe.
// NOTE: universe/universe.js mirrors this layout logic; keep them in sync.
let seed = 42069;

function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

// contribution count -> visual importance (0 = invisible)
function starImportance(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 0.08;
  if (count <= 5) return 0.25;
  if (count <= 9) return 0.5;
  if (count <= 19) return 0.8;
  return 1.0;
}

// Stars live in a few galaxies; the centre stays open.
const galaxies = [
  { x: 250, y: 285, radius: 170, rotation: -0.25 },
  { x: 900, y: 175, radius: 150, rotation: 0.3 },
  { x: 930, y: 405, radius: 120, rotation: -0.15 },
  { x: 540, y: 105, radius: 100, rotation: 0.1 },
];

// One random draw per day keeps the layout stable.
const stars = [];

days.forEach((day, index) => {
  const count = day.contributionCount;
  const importance = starImportance(count);
  const roll = random();

  if (importance === 0) return;
  if (count <= 2 && roll >= 0.18) return;
  if (count <= 5 && roll >= 0.45) return;

  const galaxy = galaxies[index % galaxies.length];

  let x, y;
  for (let tries = 0; tries < 12; tries++) {
    const angle = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * galaxy.radius;
    const ex = Math.cos(angle) * r;
    const ey = Math.sin(angle) * r * 0.45;
    const cos = Math.cos(galaxy.rotation);
    const sin = Math.sin(galaxy.rotation);
    x = galaxy.x + ex * cos - ey * sin;
    y = galaxy.y + ex * sin + ey * cos;
    if (Math.hypot(x - cx, y - cy) > 95) break;
  }

  stars.push({
    ...day,
    x,
    y,
    importance,
    size: 0.8 + importance * 2.8,
    opacity: 0.15 + importance * 0.75,
  });
});

// Constellations: only meaningful days, nearest neighbours, max 2 links each.
const candidates = stars.filter((star) => star.contributionCount >= 3);
const degree = new Map();
const pairs = [];

for (let i = 0; i < candidates.length; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const d = Math.hypot(
      candidates[i].x - candidates[j].x,
      candidates[i].y - candidates[j].y
    );
    if (d < 120) pairs.push([candidates[i], candidates[j], d]);
  }
}

pairs.sort((p, q) => p[2] - q[2]);

const lines = [];
const linked = [];

for (const [a, b] of pairs) {
  if ((degree.get(a) ?? 0) >= 3 || (degree.get(b) ?? 0) >= 3) continue;
  degree.set(a, (degree.get(a) ?? 0) + 1);
  degree.set(b, (degree.get(b) ?? 0) + 1);
  lines.push(
    `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="#8b9cff" stroke-width="0.6" opacity="0.28"/>`
  );
  linked.push([a, b]);
}

// Group linked stars into clusters and ring them.
const parent = new Map(stars.map((st) => [st, st]));
const find = (n) => (parent.get(n) === n ? n : (parent.set(n, find(parent.get(n))), parent.get(n)));
for (const [a, b] of linked) parent.set(find(a), find(b));

const clusters = new Map();
for (const [a, b] of linked) {
  for (const n of [a, b]) {
    const root = find(n);
    if (!clusters.has(root)) clusters.set(root, new Set());
    clusters.get(root).add(n);
  }
}

const rings = [];
for (const members of clusters.values()) {
  const list = [...members];
  if (list.length < 3) continue;
  const mx = list.reduce((t, n) => t + n.x, 0) / list.length;
  const my = list.reduce((t, n) => t + n.y, 0) / list.length;
  const rad = Math.max(...list.map((n) => Math.hypot(n.x - mx, n.y - my))) + 18;
  rings.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${rad.toFixed(1)}" fill="none" stroke="#8b9cff" stroke-width="0.5" stroke-dasharray="2 5" opacity="0.22"/>`);
  for (const n of list) {
    if (n.contributionCount >= 6) {
      rings.push(`<circle cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="${(n.size + 5).toFixed(1)}" fill="none" stroke="#a5b4fc" stroke-width="0.6" opacity="0.4"/>`);
    }
  }
}

// Faint background dust (decoration only).
const dust = Array.from({ length: 220 }, () => {
  const x = random() * WIDTH;
  const y = random() * HEIGHT;
  const r = 0.4 + random() * 0.5;
  const o = 0.08 + random() * 0.2;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
}).join("");

// A few subtle nebulae.
const nebulae = Array.from({ length: 4 }, () => {
  const x = 150 + random() * 900;
  const y = 100 + random() * 320;
  return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(100 + random() * 120).toFixed(1)}" ry="${(35 + random() * 50).toFixed(1)}" fill="url(#nebula)" opacity="0.62" filter="url(#blur)"/>`;
}).join("");

const starElements = stars
  .map((star, index) => {
    const glow =
      star.contributionCount >= 20
        ? `<circle cx="${star.x.toFixed(2)}" cy="${star.y.toFixed(2)}" r="${(star.size * 3.5).toFixed(2)}" fill="#a78bfa" opacity="0.22" filter="url(#glow)"/>`
        : "";
    const delay = `${(index % 9) * 0.4}s`;
    return `${glow}<circle cx="${star.x.toFixed(2)}" cy="${star.y.toFixed(2)}" r="${star.size.toFixed(2)}" fill="#fff" opacity="${star.opacity.toFixed(2)}" ${star.importance >= 0.5 ? `class="star" style="animation-delay:${delay}"` : ""}/>`;
  })
  .join("\n    ");

// Find strongest contribution day.
const strongestDay = days.reduce(
  (best, day) =>
    day.contributionCount > best.contributionCount ? day : best,
  days[0]
);

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="GitHub contribution universe">
  <defs>
    <radialGradient id="background">
      <stop offset="0%" stop-color="#0d111d"/>
      <stop offset="55%" stop-color="#070911"/>
      <stop offset="100%" stop-color="#030409"/>
    </radialGradient>

    <radialGradient id="nebula">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
      <stop offset="45%" stop-color="#4f46e5" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="28"/>
    </filter>

    <filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="url(#background)"/>

  ${nebulae}
  ${dust}
  ${rings.join("\n  ")}
  ${lines.join("\n  ")}
  ${starElements}

  <circle cx="${cx}" cy="${cy}" r="2" fill="#fff" opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="35" fill="none" stroke="#8b9cff" stroke-width="0.5" opacity="0.12"/>

  <text x="42" y="54" fill="#fff" font-family="monospace" font-size="14" letter-spacing="3" opacity="0.85">CONTRIBUTION UNIVERSE</text>
  <text x="42" y="78" fill="#94a3b8" font-family="monospace" font-size="11">${stars.length} STARS · ${days.length} DAYS</text>
  <text x="${WIDTH - 42}" y="${HEIGHT - 30}" text-anchor="end" fill="#64748b" font-family="monospace" font-size="10">github.com/${username}</text>

  <style>
    .star { animation: pulse 4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .star { animation: none; } }
  </style>
</svg>
`;

fs.mkdirSync("assets", { recursive: true });

fs.writeFileSync(
  "assets/contribution-universe-preview.svg",
  svg
);

// Data for the interactive universe (universe/index.html).
fs.writeFileSync(
  "assets/contribution-data.json",
  JSON.stringify(
    {
      username,
      total: calendar.totalContributions,
      generatedAt: new Date().toISOString(),
      days: days.map((day) => ({
        date: day.date,
        contributions: day.contributionCount,
        level: day.contributionLevel,
      })),
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Generated universe: ${calendar.totalContributions} contributions`
);

console.log(
  `Strongest day: ${strongestDay.date} (${strongestDay.contributionCount})`
);
