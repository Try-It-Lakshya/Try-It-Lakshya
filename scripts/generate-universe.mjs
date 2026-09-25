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
// Same contribution data → same universe.
let seed = 42069;

function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Generate positions around the universe.
const stars = days.map((day, index) => {
  const contribution = day.contributionCount;

  // Distribute stars in a galaxy-like field.
  const angle =
    random() * Math.PI * 2 +
    Math.sin(index * 0.13) * 0.8;

  const radius =
    50 +
    Math.pow(random(), 0.65) * 500;

  const x =
    cx +
    Math.cos(angle) * radius +
    (random() - 0.5) * 120;

  const y =
    cy +
    Math.sin(angle) * radius * 0.48 +
    (random() - 0.5) * 180;

  const size =
    contribution === 0
      ? 0.7
      : 1.2 + Math.min(contribution, 20) * 0.35;

  const opacity =
    contribution === 0
      ? 0.12
      : 0.35 + Math.min(contribution, 15) / 20;

  return {
    ...day,
    x,
    y,
    size,
    opacity,
  };
});

// Only active stars participate in constellations.
const activeStars = stars.filter(
  (star) => star.contributionCount > 0
);

// Connect nearby active stars.
const lines = [];

for (let i = 0; i < activeStars.length; i++) {
  const a = activeStars[i];

  for (let j = i + 1; j < activeStars.length; j++) {
    const b = activeStars[j];

    const dx = a.x - b.x;
    const dy = a.y - b.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 75) {
      lines.push(`
        <line
          x1="${a.x.toFixed(2)}"
          y1="${a.y.toFixed(2)}"
          x2="${b.x.toFixed(2)}"
          y2="${b.y.toFixed(2)}"
          stroke="#8b5cf6"
          stroke-width="0.7"
          opacity="${clamp(
            0.35 - distance / 250,
            0.04,
            0.22
          )}"
        />
      `);
    }
  }
}

// Nebula clouds.
const nebulae = Array.from({ length: 12 }, () => {
  const x = 100 + random() * 1000;
  const y = 80 + random() * 360;

  const rx = 70 + random() * 180;
  const ry = 30 + random() * 90;

  return `
    <ellipse
      cx="${x.toFixed(1)}"
      cy="${y.toFixed(1)}"
      rx="${rx.toFixed(1)}"
      ry="${ry.toFixed(1)}"
      fill="url(#nebula)"
      opacity="${(0.06 + random() * 0.07).toFixed(3)}"
      filter="url(#blur)"
    />
  `;
}).join("");

// Stars.
const starElements = stars.map((star, index) => {
  if (star.contributionCount === 0) {
    return `
      <circle
        cx="${star.x.toFixed(2)}"
        cy="${star.y.toFixed(2)}"
        r="${star.size}"
        fill="#ffffff"
        opacity="${star.opacity}"
      />
    `;
  }

  const pulseDelay = `${(index % 9) * 0.4}s`;

  return `
    <circle
      cx="${star.x.toFixed(2)}"
      cy="${star.y.toFixed(2)}"
      r="${star.size.toFixed(2)}"
      fill="#ffffff"
      opacity="${star.opacity.toFixed(2)}"
      class="star"
      style="animation-delay:${pulseDelay}"
    />

    ${
      star.contributionCount >= 8
        ? `
      <circle
        cx="${star.x.toFixed(2)}"
        cy="${star.y.toFixed(2)}"
        r="${(star.size * 3).toFixed(2)}"
        fill="#a78bfa"
        opacity="0.12"
        filter="url(#glow)"
      />
    `
        : ""
    }
  `;
}).join("");

// Find strongest contribution day.
const strongestDay = days.reduce(
  (best, day) =>
    day.contributionCount > best.contributionCount
      ? day
      : best,
  days[0]
);

const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${WIDTH}"
  height="${HEIGHT}"
  viewBox="0 0 ${WIDTH} ${HEIGHT}"
  role="img"
  aria-label="GitHub contribution universe"
>

  <defs>

    <radialGradient id="background">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="55%" stop-color="#080b14"/>
      <stop offset="100%" stop-color="#030409"/>
    </radialGradient>

    <radialGradient id="nebula">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="45%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <filter id="blur">
      <feGaussianBlur stdDeviation="28"/>
    </filter>

    <filter id="glow">
      <feGaussianBlur stdDeviation="7"/>
    </filter>

  </defs>

  <rect
    width="${WIDTH}"
    height="${HEIGHT}"
    rx="24"
    fill="url(#background)"
  />

  <!-- Nebula -->
  ${nebulae}

  <!-- Constellations -->
  ${lines.join("")}

  <!-- Stars -->
  ${starElements}

  <!-- Center -->
  <circle
    cx="${cx}"
    cy="${cy}"
    r="2"
    fill="#ffffff"
    opacity="0.9"
  />

  <circle
    cx="${cx}"
    cy="${cy}"
    r="35"
    fill="none"
    stroke="#8b5cf6"
    stroke-width="0.5"
    opacity="0.15"
  />

  <circle
    cx="${cx}"
    cy="${cy}"
    r="65"
    fill="none"
    stroke="#6366f1"
    stroke-width="0.5"
    opacity="0.08"
  />

  <!-- Label -->
  <text
    x="42"
    y="54"
    fill="#ffffff"
    font-family="monospace"
    font-size="14"
    letter-spacing="3"
    opacity="0.85"
  >
    CONTRIBUTION UNIVERSE
  </text>

  <text
    x="42"
    y="78"
    fill="#94a3b8"
    font-family="monospace"
    font-size="11"
  >
    ${calendar.totalContributions} STARS · ${days.length} DAYS
  </text>

  <text
    x="${WIDTH - 42}"
    y="${HEIGHT - 30}"
    text-anchor="end"
    fill="#64748b"
    font-family="monospace"
    font-size="10"
  >
    github.com/${username}
  </text>

  <style>
    .star {
      animation: pulse 4s ease-in-out infinite;
      transform-origin: center;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 0.45;
      }

      50% {
        opacity: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .star {
        animation: none;
      }
    }
  </style>

</svg>
`;

fs.mkdirSync("assets", { recursive: true });

fs.writeFileSync(
  "assets/contribution-universe.svg",
  svg
);

console.log(
  `Generated universe: ${calendar.totalContributions} contributions`
);

console.log(
  `Strongest day: ${strongestDay.date} (${strongestDay.contributionCount})`
);
