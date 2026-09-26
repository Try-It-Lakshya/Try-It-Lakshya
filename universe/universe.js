(() => {
  "use strict";

  const canvas = document.getElementById("universe");
  const ctx = canvas.getContext("2d");
  const tooltip = document.getElementById("tooltip");
  const tipCount = document.getElementById("tip-count");
  const tipDate = document.getElementById("tip-date");
  const tipRepos = document.getElementById("tip-repos");
  const statsEl = document.getElementById("stats");
  const profileEl = document.getElementById("profile");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1;
  let stars = [];
  let links = [];
  let nebulae = [];
  let dust = [];
  let clusters = [];
  let pulses = [];

  const pointer = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, inside: false, active: false };
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  let hovered = null;

  // Deterministic PRNG: same data -> same universe.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // Layout mirrors scripts/generate-universe.mjs: sparse galaxies, open centre.
  // Virtual canvas is 1200x520, mapped onto the viewport.
  const VW = 1200, VH = 520;
  const GALAXIES = [
    { x: 250, y: 285, radius: 170, rotation: -0.25 },
    { x: 900, y: 175, radius: 150, rotation: 0.3 },
    { x: 930, y: 405, radius: 120, rotation: -0.15 },
    { x: 540, y: 105, radius: 100, rotation: 0.1 },
  ];

  function importance(c) {
    if (c <= 0) return 0;
    if (c <= 2) return 0.2;
    if (c <= 5) return 0.4;
    if (c <= 9) return 0.6;
    if (c <= 19) return 0.8;
    return 1;
  }

  let data = null;
  let layout = [];   // meaningful days with virtual coords
  let dustLayout = [];
  let nebulaLayout = [];

  function buildLayout() {
    const random = rng(42069);
    layout = [];
    data.days.forEach((day, i) => {
      const c = day.contributions;
      const imp = importance(c);
      if (imp === 0) return;

      const g = GALAXIES[i % GALAXIES.length];
      let x = 0, y = 0;
      for (let tries = 0; tries < 12; tries++) {
        const a = random() * Math.PI * 2;
        const r = Math.sqrt(random()) * g.radius;
        const ex = Math.cos(a) * r, ey = Math.sin(a) * r * 0.45;
        const cs = Math.cos(g.rotation), sn = Math.sin(g.rotation);
        x = g.x + ex * cs - ey * sn;
        y = g.y + ex * sn + ey * cs;
        if (Math.hypot(x - VW / 2, y - VH / 2) > 95) break;
      }
      layout.push({ day, x, y, imp, phase: random() * Math.PI * 2, freq: 0.15 + random() * 0.25 });
    });

    dustLayout = Array.from({ length: 220 }, () => ({
      nx: random(), ny: random(), r: 0.4 + random() * 0.5, a: 0.08 + random() * 0.2, phase: random() * 6.28,
    }));
    nebulaLayout = Array.from({ length: 4 }, () => ({
      nx: (150 + random() * 900) / VW,
      ny: (100 + random() * 320) / VH,
      rx: (100 + random() * 120) / VW,
      ry: (35 + random() * 50) / VH,
    }));
  }

  function buildStars() {
    const sx = W / VW, sy = H / VH;
    const scale = Math.max(Math.min(sx, sy * 1.2), 0.6);
    const old = stars;
    stars = layout.map((l, i) => {
      const prev = old[i];
      const hx = l.x * sx, hy = l.y * sy;
      return {
        date: l.day.date,
        count: l.day.contributions,
        repos: l.day.repos || [],
        hx, hy,
        x: prev ? prev.x : hx,
        y: prev ? prev.y : hy,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        phase: l.phase,
        freq: l.freq,
        depth: 0.7 + l.imp * 0.4,
        r: (1.3 + l.imp * 2.6) * scale,
        base: 0.3 + l.imp * 0.65,
        imp: l.imp,
        glow: 0,
      };
    });

    // Constellations: count>=3, nearest neighbours, max 2 links each.
    const cand = stars.filter((s) => s.count >= 1);
    const maxD = 120 * sx;
    const pairs = [];
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        const d = Math.hypot(cand[i].hx - cand[j].hx, cand[i].hy - cand[j].hy);
        if (d < maxD) pairs.push([cand[i], cand[j], d, maxD]);
      }
    }
    pairs.sort((p, q) => p[2] - q[2]);
    const deg = new Map();
    links = [];
    for (const p of pairs) {
      if ((deg.get(p[0]) || 0) >= 3 || (deg.get(p[1]) || 0) >= 3) continue;
      deg.set(p[0], (deg.get(p[0]) || 0) + 1);
      deg.set(p[1], (deg.get(p[1]) || 0) + 1);
      links.push(p);
    }

    // clusters = connected components of the link graph
    const parent = new Map();
    const find = (n) => {
      if (!parent.has(n)) parent.set(n, n);
      if (parent.get(n) !== n) parent.set(n, find(parent.get(n)));
      return parent.get(n);
    };
    for (const p of links) parent.set(find(p[0]), find(p[1]));
    const groups = new Map();
    for (const p of links) for (const n of [p[0], p[1]]) {
      const root = find(n);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root).add(n);
    }
    clusters = [...groups.values()].map((g) => [...g]).filter((g) => g.length >= 3);

    dust = dustLayout.map((d) => ({ x: d.nx * W, y: d.ny * H, r: d.r, a: d.a, phase: d.phase }));
    nebulae = nebulaLayout.map((n) => ({ x: n.nx * W, y: n.ny * H, rx: n.rx * W, ry: n.ry * H }));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (data) buildStars();
  }

  // ---- input -----------------------------------------------------------
  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pointer.vx = x - pointer.x;
    pointer.vy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
    pointer.inside = true;
    parallax.tx = (x / W - 0.5) * -34;
    parallax.ty = (y / H - 0.5) * -22;
  }

  canvas.addEventListener("pointerdown", (e) => {
    setPointer(e);
    pointer.vx = pointer.vy = 0;
    pointer.down = true;
    canvas.setPointerCapture(e.pointerId);
    pulses.push({ x: pointer.x, y: pointer.y, t: 0 });
  });
  canvas.addEventListener("pointermove", setPointer);
  const release = () => { pointer.down = false; };
  canvas.addEventListener("pointerup", (e) => {
    release();
    if (e.pointerType !== "mouse") pointer.inside = false;
  });
  canvas.addEventListener("pointercancel", () => { release(); pointer.inside = false; });
  canvas.addEventListener("pointerleave", () => {
    if (!pointer.down) { pointer.inside = false; parallax.tx = parallax.ty = 0; }
  });

  // ---- simulation ------------------------------------------------------
  const PULSE_SPEED = 520;
  const PULSE_LIFE = 1.4;

  function step(dt, t) {
    parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 3);
    parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 3);

    for (const p of pulses) p.t += dt;
    pulses = pulses.filter((p) => p.t < PULSE_LIFE);

    // hover target: nearest star (with a bit of slop for fingers)
    hovered = null;
    if (pointer.inside) {
      let best = pointer.down ? 40 : 28;
      for (const s of stars) {
        if (s.count === 0) continue;
        const d = Math.hypot(s.x + parallax.x * s.depth - pointer.x, s.y + parallax.y * s.depth - pointer.y);
        if (d < best) { best = d; hovered = s; }
      }
    }

    const drift = reduceMotion ? 0 : 1;
    const spring = 2.2, damp = 2.6;

    for (const s of stars) {
      // idle floating: home slowly orbits a small ellipse
      const ax = Math.sin(t * s.freq + s.phase) * 9 * drift;
      const ay = Math.cos(t * s.freq * 0.8 + s.phase) * 7 * drift;
      let fx = (s.hx + ax - s.x) * spring;
      let fy = (s.hy + ay - s.y) * spring;

      if (pointer.inside) {
        const dx = pointer.x - (s.x + parallax.x * s.depth);
        const dy = pointer.y - (s.y + parallax.y * s.depth);
        const d = Math.hypot(dx, dy) || 1;

        if (s === hovered) {
          // hovered star leans toward the cursor
          fx += (dx / d) * Math.min(d, 30) * 6;
          fy += (dy / d) * Math.min(d, 30) * 6;
        } else if (hovered) {
          // neighbours get pushed away from the hovered star
          const hx = s.x - hovered.x, hy = s.y - hovered.y;
          const hd = Math.hypot(hx, hy) || 1;
          if (hd < 110) {
            const k = (1 - hd / 110) * 900;
            fx += (hx / hd) * k;
            fy += (hy / hd) * k;
          }
        }

        // dragging drags stars along with the finger
        if (pointer.down && d < 130) {
          const k = 1 - d / 130;
          fx += pointer.vx * k * 55;
          fy += pointer.vy * k * 55;
        }
      }

      // gravity waves
      for (const p of pulses) {
        const dx = s.x - p.x, dy = s.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const front = p.t * PULSE_SPEED;
        const off = Math.abs(d - front);
        if (off < 60) {
          const k = (1 - off / 60) * (1 - p.t / PULSE_LIFE) * 2600;
          fx += (dx / d) * k;
          fy += (dy / d) * k;
        }
      }

      s.vx += (fx - s.vx * damp) * dt;
      s.vy += (fy - s.vy * damp) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const target = s === hovered ? 1 : 0;
      s.glow += (target - s.glow) * Math.min(1, dt * 8);
    }
    pointer.vx *= 0.6;
    pointer.vy *= 0.6;
  }

  // ---- drawing ---------------------------------------------------------
  function draw(t) {
    ctx.clearRect(0, 0, W, H);

    for (const n of dust) {
      const x = n.x + parallax.x * 0.15, y = n.y + parallax.y * 0.15;
      ctx.fillStyle = `rgba(255,255,255,${n.a * (0.8 + 0.2 * Math.sin(t * 0.8 + n.phase))})`;
      ctx.beginPath();
      ctx.arc(x, y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const n of nebulae) {
      ctx.save();
      ctx.translate(n.x + parallax.x * 0.2, n.y + parallax.y * 0.2);
      ctx.scale(n.rx * 1.6, n.ry * 1.6);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, "rgba(99,102,241,0.21)");
      g.addColorStop(0.45, "rgba(79,70,229,0.075)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }

    // cluster rings
    for (const g of clusters) {
      let mx = 0, my = 0;
      for (const n of g) { mx += n.x + parallax.x * n.depth; my += n.y + parallax.y * n.depth; }
      mx /= g.length; my /= g.length;
      let rad = 0, boost = 0;
      for (const n of g) {
        rad = Math.max(rad, Math.hypot(n.x + parallax.x * n.depth - mx, n.y + parallax.y * n.depth - my));
        boost = Math.max(boost, n.glow);
      }
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = `rgba(139,156,255,${0.22 + boost * 0.35})`;
      ctx.beginPath();
      ctx.arc(mx, my, rad + 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 0.6;
      for (const n of g) {
        if (n.count < 3) continue;
        ctx.strokeStyle = `rgba(165,180,252,${0.4 + n.glow * 0.4})`;
        ctx.beginPath();
        ctx.arc(n.x + parallax.x * n.depth, n.y + parallax.y * n.depth, n.r * 3 * (1 + n.glow * 0.5) + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // constellation lines, stretched by live positions
    ctx.lineWidth = 0.6;
    for (const [a, b, d0, maxD] of links) {
      const ax = a.x + parallax.x * a.depth, ay = a.y + parallax.y * a.depth;
      const bx = b.x + parallax.x * b.depth, by = b.y + parallax.y * b.depth;
      const d = Math.hypot(ax - bx, ay - by);
      if (d > maxD * 1.8) continue;
      const boost = Math.max(a.glow, b.glow);
      const alpha = Math.min(0.8, 0.28 * Math.max(0, 1 - (d - d0) / (maxD * 0.8)) + boost * 0.5);
      ctx.strokeStyle = `rgba(139,156,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // gravity wave rings
    for (const p of pulses) {
      const life = 1 - p.t / PULSE_LIFE;
      ctx.strokeStyle = `rgba(167,139,250,${0.35 * life})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.t * PULSE_SPEED, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of stars) {
      const x = s.x + parallax.x * s.depth;
      const y = s.y + parallax.y * s.depth;
      let alpha = s.base;
      if (s.imp >= 0.4) alpha *= 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.6 + s.phase * 3));
      alpha = Math.min(1, alpha + s.glow * 0.6);

      const r = s.r * (1 + s.glow * 1.2);

      const big = s.count >= 3;
      if (big || s.glow > 0.02) {
        const gr = r * (big ? 3.8 : 3) + s.glow * r * 3;
        const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
        g.addColorStop(0, `rgba(167,139,250,${(big ? 0.2 + s.imp * 0.16 : 0.15) + s.glow * 0.35})`);
        g.addColorStop(1, "rgba(167,139,250,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, gr, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      if (big) {
        const R = r * 3;
        ctx.moveTo(x, y - R);
        ctx.quadraticCurveTo(x, y, x + R, y);
        ctx.quadraticCurveTo(x, y, x, y + R);
        ctx.quadraticCurveTo(x, y, x - R, y);
        ctx.quadraticCurveTo(x, y, x, y - R);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // centre marker
    ctx.strokeStyle = "rgba(139,156,255,0.12)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(W / 2 + parallax.x * 0.5, H / 2 + parallax.y * 0.5, 35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(W / 2 + parallax.x * 0.5, H / 2 + parallax.y * 0.5, 2, 0, Math.PI * 2);
    ctx.fill();

    updateTooltip();
  }

  function updateTooltip() {
    if (!hovered) { tooltip.hidden = true; return; }
    const x = hovered.x + parallax.x * hovered.depth;
    const y = hovered.y + parallax.y * hovered.depth;
    tipCount.textContent = `${hovered.count} contribution${hovered.count === 1 ? "" : "s"}`;
    tipDate.textContent = formatDate(hovered.date);
    tipRepos.replaceChildren(
      ...hovered.repos.slice(0, 4).map((r) => {
        const el = document.createElement("span");
        el.className = "repo";
        el.textContent = r.name;
        return el;
      })
    );
    if (hovered.repos.length > 4) {
      const more = document.createElement("span");
      more.className = "repo";
      more.textContent = `+${hovered.repos.length - 4} more`;
      tipRepos.append(more);
    }
    tooltip.hidden = false;
    const w = tooltip.offsetWidth / 2 + 8;
    tooltip.style.left = Math.min(Math.max(x, w), W - w) + "px";
    tooltip.style.top = Math.max(y - hovered.r * 2 - 10, tooltip.offsetHeight + 8) + "px";
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const t = now / 1000;
    step(dt, t);
    draw(t);
    requestAnimationFrame(frame);
  }

  // ---- boot ------------------------------------------------------------
  window.addEventListener("resize", resize);

  fetch("../assets/contribution-data.json", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((json) => {
      data = json;
      if (data.username) {
        profileEl.textContent = `github.com/${data.username}`;
        profileEl.href = `https://github.com/${data.username}`;
      }
      buildLayout();
      statsEl.textContent = `${data.total} CONTRIBUTIONS · ${layout.length} ACTIVE DAYS`;
      resize();
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      statsEl.textContent = "could not load contribution data";
      console.error(err);
    });

  resize();
})();
