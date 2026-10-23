// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: fire;

/*
 * Training Streak — a GitHub-style grid of the days you trained, from Strava.
 *
 *   Add it as a widget  → streak count + training grid
 *   Run it in the app   → full year, stats, and what you did on each day
 *
 * Uses the Strava connection from the Dashboard script (⚙︎ → Connect Strava),
 * so connect there first.
 */

const CONFIG = {
  theme: "strava", // "strava" (orange) or "github" (green)
  weeklyGoal: 3, // training days per week that count towards your week streak
  levels: [30, 60, 90], // minutes per day for the 2nd, 3rd and 4th shade
  minMinutes: 10, // ignore activities shorter than this (e.g. a 4-minute walk)
  sports: [], // only count these Strava sport types, e.g. ["Run", "Ride"]. Empty = all.
  units: "metric", // "metric" or "imperial"
};

// ───────────────────────────────────────────────────────────── storage ──

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "streak-data");
if (!fm.fileExists(DIR)) fm.createDirectory(DIR, true);
const filePath = (name) => fm.joinPath(DIR, name);

function readJSON(name, fallback) {
  try {
    const p = filePath(name);
    if (fm.fileExists(p)) return JSON.parse(fm.readString(p));
  } catch (e) {
    console.warn(`Could not read ${name}: ${e}`);
  }
  return fallback;
}

function writeJSON(name, value) {
  fm.writeString(filePath(name), JSON.stringify(value));
}

const DAY = 86400000;
const scriptURL = () => `scriptable:///run/${encodeURIComponent(Script.name())}`;

// ──────────────────────────────────────────────────────────── strava ──
// Same Keychain entry as Dashboard.js, so both scripts share one login.

const STRAVA_KEY = "dashboard.strava";
function stravaCreds() {
  try {
    return Keychain.contains(STRAVA_KEY) ? JSON.parse(Keychain.get(STRAVA_KEY)) : null;
  } catch (e) {
    return null;
  }
}

async function stravaAccessToken() {
  const c = stravaCreds();
  if (!c || !c.refreshToken) throw new Error("Strava isn't connected yet. Open the Dashboard script → ⚙︎ → Connect Strava.");
  if (c.expiresAt * 1000 - 120000 > Date.now()) return c.accessToken;
  const r = new Request("https://www.strava.com/oauth/token");
  r.method = "POST";
  r.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  r.body = [["client_id", c.clientId], ["client_secret", c.clientSecret], ["grant_type", "refresh_token"], ["refresh_token", c.refreshToken]]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const j = await r.loadJSON();
  if (!j.access_token) throw new Error(`Strava: ${j.message || "sign-in failed"} — reconnect in Dashboard ⚙︎.`);
  Object.assign(c, { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at });
  Keychain.set(STRAVA_KEY, JSON.stringify(c));
  return c.accessToken;
}

async function fetchActivities(afterSec) {
  const token = await stravaAccessToken();
  const out = [];
  for (let page = 1; page <= 8; page++) {
    const r = new Request(`https://www.strava.com/api/v3/athlete/activities?after=${afterSec}&per_page=200&page=${page}`);
    r.headers = { Authorization: `Bearer ${token}` };
    const list = await r.loadJSON();
    if (r.response.statusCode === 401) throw new Error("Strava access expired — reconnect in Dashboard ⚙︎.");
    if (!Array.isArray(list)) throw new Error(`Strava: ${list.message || "unexpected response"}`);
    out.push(...list);
    if (list.length < 200) break;
  }
  return out.map((a) => ({
    id: a.id, name: a.name, type: a.sport_type || a.type,
    day: (a.start_date_local || a.start_date).slice(0, 10), // local calendar day of the activity
    start: new Date(a.start_date).getTime(), moving: a.moving_time || 0, distance: a.distance || 0,
  }));
}

// Keeps ~a year of activities on the phone. Small incremental fetch most of
// the time, a full re-sync once a day (to pick up edits and deletions).
async function sync(force) {
  const store = readJSON("activities.json", { acts: {}, lastFull: 0, lastSync: 0 });
  if (!force && Date.now() - store.lastSync < 15 * 60000) return store;
  try {
    const full = force || Date.now() - store.lastFull > DAY || !Object.keys(store.acts).length;
    const newest = Math.max(0, ...Object.values(store.acts).map((a) => a.start));
    const after = full ? Date.now() - 372 * DAY : newest - 3 * DAY;
    const acts = await fetchActivities(Math.floor(after / 1000));
    if (full) store.acts = {};
    acts.forEach((a) => { store.acts[a.id] = a; });
    const cutoff = Date.now() - 372 * DAY;
    Object.keys(store.acts).forEach((id) => { if (store.acts[id].start < cutoff) delete store.acts[id]; });
    if (full) store.lastFull = Date.now();
    store.lastSync = Date.now();
    delete store.stale;
    writeJSON("activities.json", store);
  } catch (e) {
    if (!Object.keys(store.acts).length) throw e;
    console.warn(`Using saved activities (${e.message || e})`);
    store.stale = store.lastSync;
  }
  return store;
}

// ─────────────────────────────────────────────────────────── analysis ──

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (key, n) => { const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d); };
const mondayOf = (key) => { const d = dateOf(key); return addDays(key, -((d.getDay() + 6) % 7)); };

function level(minutes) {
  if (!minutes) return 0;
  const [a, b, c] = CONFIG.levels;
  return minutes < a ? 1 : minutes < b ? 2 : minutes < c ? 3 : 4;
}

function compute(store, now = Date.now()) {
  const today = keyOf(new Date(now));
  const days = {};
  Object.values(store.acts)
    .filter((a) => a.moving >= CONFIG.minMinutes * 60 && (!CONFIG.sports.length || CONFIG.sports.includes(a.type)))
    .sort((a, b) => a.start - b.start)
    .forEach((a) => {
      const d = (days[a.day] = days[a.day] || { moving: 0, distance: 0, acts: [] });
      d.moving += a.moving;
      d.distance += a.distance;
      d.acts.push({ id: a.id, name: a.name, type: a.type, moving: a.moving, distance: a.distance });
    });
  Object.values(days).forEach((d) => { d.level = level(d.moving / 60); });

  // Day streak: today counts if you've trained; if not, the streak is still
  // alive from yesterday until midnight.
  const trainedToday = !!days[today];
  let streak = 0;
  for (let k = trainedToday ? today : addDays(today, -1); days[k]; k = addDays(k, -1)) streak++;

  // Longest streak over the past year
  let longest = 0, run = 0;
  for (let k = addDays(today, -365); k <= today; k = addDays(k, 1)) {
    run = days[k] ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  // Week streak: consecutive weeks (Mon–Sun) hitting the weekly goal. The
  // current week only counts once the goal is reached.
  const weekDays = (monday) => [0, 1, 2, 3, 4, 5, 6].filter((i) => days[addDays(monday, i)]).length;
  const thisMonday = mondayOf(today);
  const thisWeek = weekDays(thisMonday);
  let weekStreak = thisWeek >= CONFIG.weeklyGoal ? 1 : 0;
  for (let m = addDays(thisMonday, -7); weekDays(m) >= CONFIG.weeklyGoal; m = addDays(m, -7)) weekStreak++;

  // Last 12 weeks of training days, for the weekly chart
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const m = addDays(thisMonday, -7 * i);
    weeks.push({ monday: m, days: weekDays(m) });
  }

  // Totals
  const yearAgo = addDays(today, -364), monthAgo = addDays(today, -29);
  let activeYear = 0, timeYear = 0, distYear = 0, activeMonth = 0;
  const sports = {};
  Object.entries(days).forEach(([k, d]) => {
    if (k < yearAgo || k > today) return;
    activeYear++;
    timeYear += d.moving;
    distYear += d.distance;
    if (k >= monthAgo) {
      activeMonth++;
      d.acts.forEach((a) => {
        const s = (sports[a.type] = sports[a.type] || { count: 0, moving: 0 });
        s.count++;
        s.moving += a.moving;
      });
    }
  });

  const last = Object.values(store.acts).sort((a, b) => b.start - a.start)[0] || null;
  return {
    today, days, trainedToday, streak, longest, weekStreak, thisWeek, weeks,
    activeYear, timeYear, distYear, activeMonth,
    sports: Object.entries(sports).map(([type, s]) => Object.assign({ type }, s)).sort((a, b) => b.moving - a.moving),
    last, stale: store.stale || null,
  };
}

// ───────────────────────────────────────────────────────── formatting ──

const THEMES = {
  strava: ["#21262D", "#5C2410", "#9E3A10", "#E2550F", "#FF8A4C"],
  github: ["#21262D", "#0E4429", "#006D32", "#26A641", "#39D353"],
};
const SHADES = THEMES[CONFIG.theme] || THEMES.strava;
const ACCENT = SHADES[4];
const imp = CONFIG.units === "imperial";
const dist = (m) => (imp ? `${Math.round(m / 1609.344).toLocaleString()} mi` : `${Math.round(m / 1000).toLocaleString()} km`);
const hours = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.round((s % 3600) / 60))}m` : `${Math.round(s / 60)}m`);
const sportLabel = (t) => (t || "Workout").replace(/([a-z])([A-Z])/g, "$1 $2");
const SPORT_EMOJI = [[/Run$/, "🏃"], [/Ride$/, "🚴"], [/Swim/, "🏊"], [/^Walk$/, "🚶"], [/^Hike$/, "🥾"], [/WeightTraining|Crossfit/, "🏋️"],
  [/Yoga|Pilates/, "🧘"], [/Rowing|Kayak|Canoe/, "🚣"], [/Ski|Snowboard/, "⛷️"], [/Skateboard/, "🛹"], [/Soccer/, "⚽️"], [/Climb/, "🧗"]];
const sportEmoji = (t) => (SPORT_EMOJI.find(([re]) => re.test(t || "")) || [null, "💪"])[1];

const weekStr = (s) => (s.thisWeek >= CONFIG.weeklyGoal ? `${s.thisWeek} days this week ✓` : `${s.thisWeek}/${CONFIG.weeklyGoal} days this week`);

function streakLine(s) {
  if (s.trainedToday) return s.streak > 1 ? "Trained today ✓" : "Day 1 — keep going!";
  if (s.streak > 0) return "Train today to keep it 🔥";
  return "Start a new streak today";
}

// ──────────────────────────────────────────────────────────── widgets ──

// The grid: one column per week (Mon at the top), newest week on the right.
function gridImage(s, weeks, cell, gap, withMonths) {
  const top = withMonths ? 13 : 0;
  const w = weeks * (cell + gap) - gap, h = top + 7 * (cell + gap) - gap;
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const firstMonday = addDays(mondayOf(s.today), -7 * (weeks - 1));
  let lastMonth = null;
  for (let c = 0; c < weeks; c++) {
    const monday = addDays(firstMonday, 7 * c);
    const x = c * (cell + gap);
    const month = dateOf(monday).getMonth();
    if (withMonths && month !== lastMonth && c < weeks - 1) {
      if (lastMonth !== null || dateOf(monday).getDate() <= 7) {
        ctx.setFont(Font.semiboldSystemFont(9));
        ctx.setTextColor(new Color("#8B949E"));
        ctx.drawText(dateOf(monday).toLocaleDateString(undefined, { month: "short" }), new Point(x, 0));
      }
      lastMonth = month;
    }
    for (let r = 0; r < 7; r++) {
      const k = addDays(monday, r);
      if (k > s.today) continue;
      const d = s.days[k];
      const p = new Path();
      const rect = new Rect(x, top + r * (cell + gap), cell, cell);
      p.addRoundedRect(rect, cell * 0.22, cell * 0.22);
      ctx.addPath(p);
      ctx.setFillColor(new Color(SHADES[d ? d.level : 0]));
      ctx.fillPath();
      if (k === s.today) {
        const o = new Path();
        o.addRoundedRect(rect, cell * 0.22, cell * 0.22);
        ctx.addPath(o);
        ctx.setStrokeColor(new Color("#FFFFFF", 0.85));
        ctx.setLineWidth(1.5);
        ctx.strokePath();
      }
    }
  }
  return { image: ctx.getImage(), size: new Size(w, h) };
}

function wText(stack, str, font, color = "#F0F6FC", opacity = 1) {
  const t = stack.addText(String(str));
  t.font = font;
  t.textColor = new Color(color);
  t.textOpacity = opacity;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function flame(stack, size) {
  const sym = SFSymbol.named("flame.fill");
  sym.applyFont(Font.boldSystemFont(size));
  const img = stack.addImage(sym.image);
  img.imageSize = new Size(size, size);
  img.tintColor = new Color(ACCENT);
}

function addGrid(stack, s, weeks, cell, gap, months) {
  const g = gridImage(s, weeks, cell, gap, months);
  const img = stack.addImage(g.image);
  img.imageSize = g.size;
}

function streakBlock(stack, s, big) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  row.spacing = 4;
  flame(row, big ? 24 : 18);
  wText(row, s.streak, Font.heavyRoundedSystemFont(big ? 36 : 26));
  wText(row, s.streak === 1 ? "day" : "days", Font.semiboldSystemFont(big ? 14 : 12), "#8B949E");
}

function buildWidget(s, family) {
  const w = new ListWidget();
  w.url = scriptURL();
  w.refreshAfterDate = new Date(Date.now() + 30 * 60000);

  if (family === "accessoryInline") {
    wText(w, `🔥 ${s.streak}-day streak · ${weekStr(s)}`, Font.systemFont(12));
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const st = w.addStack();
    st.layoutVertically();
    st.centerAlignContent();
    wText(st, "🔥", Font.systemFont(14));
    wText(st, s.streak, Font.heavyRoundedSystemFont(18));
    return w;
  }
  if (family === "accessoryRectangular") {
    wText(w, `🔥 ${s.streak}-day streak`, Font.boldSystemFont(14));
    wText(w, `${weekStr(s)} · ${s.weekStreak} wk streak`, Font.systemFont(12));
    wText(w, streakLine(s), Font.systemFont(11), "#FFFFFF", 0.8);
    return w;
  }

  w.backgroundColor = new Color("#0D1117");
  const weekLine = weekStr(s);

  if (family === "small") {
    w.setPadding(12, 12, 12, 12);
    streakBlock(w, s, false);
    wText(w, streakLine(s), Font.semiboldSystemFont(10), "#8B949E");
    w.addSpacer();
    addGrid(w, s, 9, 11, 3, false);
    w.addSpacer(6);
    wText(w, weekLine, Font.semiboldSystemFont(11), s.thisWeek >= CONFIG.weeklyGoal ? ACCENT : "#C9D1D9");
    return w;
  }

  if (family === "medium") {
    w.setPadding(14, 14, 14, 14);
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    const left = row.addStack();
    left.layoutVertically();
    left.spacing = 3;
    streakBlock(left, s, false);
    wText(left, "day streak", Font.semiboldSystemFont(11), "#8B949E");
    left.addSpacer(6);
    wText(left, `${s.weekStreak} wk streak`, Font.boldSystemFont(13), ACCENT);
    wText(left, weekLine, Font.semiboldSystemFont(11), "#C9D1D9");
    wText(left, streakLine(s), Font.mediumSystemFont(10), "#8B949E");
    row.addSpacer();
    addGrid(row, s, 14, 11, 3, true);
    return w;
  }

  // large
  w.setPadding(16, 16, 16, 16);
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  streakBlock(head, s, true);
  head.addSpacer();
  const right = head.addStack();
  right.layoutVertically();
  wText(right, `${s.weekStreak} wk streak`, Font.boldSystemFont(14), ACCENT);
  wText(right, `Best: ${s.longest} days`, Font.semiboldSystemFont(12), "#8B949E");
  wText(w, streakLine(s), Font.semiboldSystemFont(12), "#8B949E");
  w.addSpacer(10);
  addGrid(w, s, 22, 11, 3, true);
  w.addSpacer(10);
  const stats = w.addStack();
  stats.layoutHorizontally();
  [[s.thisWeek >= CONFIG.weeklyGoal ? `${s.thisWeek} ✓` : `${s.thisWeek}/${CONFIG.weeklyGoal}`, "this week"], [s.activeMonth, "days · 30d"], [s.activeYear, "days · year"], [hours(s.timeYear), "time · year"]].forEach(([v, k], i) => {
    if (i) stats.addSpacer();
    const c = stats.addStack();
    c.layoutVertically();
    wText(c, v, Font.boldRoundedSystemFont(16));
    wText(c, k, Font.mediumSystemFont(10), "#8B949E");
  });
  w.addSpacer();
  if (s.last) {
    wText(w, `Last: ${sportEmoji(s.last.type)} ${s.last.name} · ${hours(s.last.moving)}`, Font.mediumSystemFont(11), "#C9D1D9");
  }
  return w;
}

function messageWidget(text) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0D1117");
  w.url = scriptURL();
  wText(w, "🔥 Training Streak", Font.boldSystemFont(14));
  w.addSpacer(6);
  const t = wText(w, text, Font.systemFont(12), "#8B949E");
  t.lineLimit = 4;
  return w;
}

// ────────────────────────────────────────────────────────── in-app view ──

async function showDetail(s) {
  const wv = new WebView();
  wv.shouldAllowRequest = (req) => {
    const url = (req && req.url) || "";
    if (url === "streak://refresh") {
      sync(true).then((st) => wv.loadHTML(detailHTML(compute(st)))).catch((e) => console.error(e));
      return false;
    }
    if (url.startsWith("streak://open/")) {
      Safari.open(`https://www.strava.com/activities/${url.slice(14)}`);
      return false;
    }
    return !/^https?:/.test(url);
  };
  await wv.loadHTML(detailHTML(s));
  await wv.present(true);
}

function detailHTML(s) {
  // Pre-format everything here so the page only lays things out.
  const weeks = 53, firstMonday = addDays(mondayOf(s.today), -7 * (weeks - 1));
  const cols = [];
  for (let c = 0; c < weeks; c++) {
    const monday = addDays(firstMonday, 7 * c);
    const md = dateOf(monday);
    cols.push({
      month: md.getDate() <= 7 ? md.toLocaleDateString(undefined, { month: "short" }) : "",
      cells: [0, 1, 2, 3, 4, 5, 6].map((r) => {
        const k = addDays(monday, r);
        if (k > s.today) return null;
        const d = s.days[k];
        return {
          k, level: d ? d.level : 0, today: k === s.today,
          label: dateOf(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
          acts: d ? d.acts.map((a) => ({ id: a.id, text: `${sportEmoji(a.type)} ${a.name}`, meta: [a.distance > 0 ? dist(a.distance) : null, hours(a.moving)].filter(Boolean).join(" · ") })) : [],
        };
      }),
    });
  }
  const view = {
    shades: SHADES, accent: ACCENT, goal: CONFIG.weeklyGoal,
    tiles: [
      ["🔥", s.streak, "day streak"], ["📅", s.weekStreak, "week streak"], ["🏆", s.longest, "longest streak"], ["✅", s.activeYear, "active days · year"],
    ],
    line: streakLine(s),
    cols,
    weeks: s.weeks.map((w) => ({ days: w.days, label: dateOf(w.monday).toLocaleDateString(undefined, { day: "numeric", month: "short" }) })),
    totals: [["Time", hours(s.timeYear)], ["Distance", dist(s.distYear)], ["Last 30 days", `${s.activeMonth} days`]],
    sports: s.sports.slice(0, 6).map((x) => ({ label: `${sportEmoji(x.type)} ${sportLabel(x.type)}`, count: x.count, time: hours(x.moving), moving: x.moving })),
    stale: s.stale ? new Date(s.stale).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null,
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${DETAIL_CSS}</style></head>
<body><main id="app"></main><script>(${DETAIL_PAGE.toString()})(${JSON.stringify(view).replace(/</g, "\\u003c")});</script></body></html>`;
}

const DETAIL_CSS = `
:root{--bg:#0d1117;--card:#161b22;--text:#f0f6fc;--sub:#8b949e;--sep:#30363d}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.35 -apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 32px)}
header{display:flex;align-items:center;justify-content:space-between;margin:4px 2px 14px}
h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em}
.sub{color:var(--sub);font-size:14px;margin-top:2px}
.refresh{border:0;background:var(--card);color:var(--text);width:36px;height:36px;border-radius:50%;font-size:17px}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.tile{background:var(--card);border:1px solid var(--sep);border-radius:16px;padding:12px 14px}
.tile .v{font-size:30px;font-weight:800;letter-spacing:-.02em}
.tile .k{color:var(--sub);font-size:13px}
.card{background:var(--card);border:1px solid var(--sep);border-radius:18px;padding:14px;margin-top:12px}
.card h2{margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--sub)}
.grid-scroll{overflow-x:auto;scrollbar-width:none}
.grid-scroll::-webkit-scrollbar{display:none}
.grid{display:flex;gap:3px;width:max-content}
.col{display:flex;flex-direction:column;gap:3px}
.col .m{height:14px;font-size:10px;color:var(--sub);white-space:nowrap;width:12px;overflow:visible}
.c{width:12px;height:12px;border-radius:3px}
.c.today{outline:1.5px solid #fff;outline-offset:-1.5px}
.c.sel{outline:2px solid var(--accent);outline-offset:1px}
.legend{display:flex;align-items:center;justify-content:flex-end;gap:3px;font-size:11px;color:var(--sub);margin-top:8px}
.legend .c{width:10px;height:10px}
.daydetail{margin-top:10px;font-size:14px;min-height:20px;color:var(--sub)}
.daydetail b{color:var(--text)}
.act{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--sep);color:var(--text)}
.act span:last-child{color:var(--sub);white-space:nowrap}
.plot{display:flex;align-items:flex-end;gap:6px;height:98px;position:relative}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.bar i{display:block;width:100%;border-radius:5px 5px 2px 2px;min-height:3px}
.bar b{font-size:11px;color:var(--text);margin-bottom:2px}
.xl{display:flex;gap:6px;margin-top:4px}
.xl span{flex:1;text-align:center;font-size:10px;color:var(--sub);line-height:1.2}
.goal{position:absolute;left:0;right:0;border-top:1.5px dashed var(--text);opacity:.45;pointer-events:none}
.rowk{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--sep);font-size:15px}
.rowk:first-of-type{border-top:0}
.rowk span:last-child{color:var(--sub)}
.sp{margin-top:6px}
.sp .track{height:6px;border-radius:3px;background:#21262d;margin-top:4px;overflow:hidden}
.sp .track i{display:block;height:100%;border-radius:3px}
.foot{text-align:center;color:var(--sub);font-size:12px;margin-top:14px}
`;

function DETAIL_PAGE(V) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  document.documentElement.style.setProperty("--accent", V.accent);
  const tiles = V.tiles.map(([e, v, k]) => `<div class="tile"><div class="v">${e} ${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join("");
  const grid = V.cols.map((c, ci) => `<div class="col"><div class="m">${esc(c.month)}</div>${c.cells.map((x, ri) => x
    ? `<div class="c ${x.today ? "today" : ""}" data-c="${ci}" data-r="${ri}" style="background:${V.shades[x.level]}"></div>`
    : `<div class="c" style="background:transparent"></div>`).join("")}</div>`).join("");
  const legend = `<div class="legend">Less ${V.shades.map((c) => `<div class="c" style="background:${c}"></div>`).join("")} More</div>`;
  const px = (days) => (days / 7) * 80; // 7 days = 80px, leaving room for the value label
  const bars = V.weeks.map((w) => `<div class="bar"><b>${w.days || ""}</b><i style="height:${px(w.days)}px;background:${w.days >= V.goal ? V.accent : V.shades[2]}"></i></div>`).join("");
  const xl = V.weeks.map((w) => `<span>${esc(w.label)}</span>`).join("");
  const goalLine = `<div class="goal" style="bottom:${px(V.goal)}px"></div>`;
  const maxMoving = Math.max(1, ...V.sports.map((x) => x.moving));
  const sports = V.sports.length ? V.sports.map((x) => `<div class="sp"><div class="rowk" style="border:0;padding:0"><span>${esc(x.label)}</span><span>${x.count}× · ${esc(x.time)}</span></div>
    <div class="track"><i style="width:${(x.moving / maxMoving) * 100}%;background:${V.accent}"></i></div></div>`).join("") : `<div class="sub">No activities in the last 30 days.</div>`;

  document.getElementById("app").innerHTML = `
    <header><div><h1>Training streak</h1><div class="sub">${esc(V.line)}</div></div><button class="refresh" onclick="location.href='streak://refresh'">↻</button></header>
    <div class="tiles">${tiles}</div>
    <section class="card"><h2>Past year</h2><div class="grid-scroll" id="gs"><div class="grid">${grid}</div></div>${legend}
      <div class="daydetail" id="dd">Tap a day to see what you did.</div></section>
    <section class="card"><h2>Training days per week · goal ${V.goal}</h2><div class="plot">${goalLine}${bars}</div><div class="xl">${xl}</div></section>
    <section class="card"><h2>Last 30 days by sport</h2>${sports}</section>
    <section class="card"><h2>Past year totals</h2>${V.totals.map(([k, v]) => `<div class="rowk"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</section>
    <div class="foot">${V.stale ? `Offline — data from ${esc(V.stale)} · ` : ""}Data from Strava</div>`;

  const gs = document.getElementById("gs");
  gs.scrollLeft = gs.scrollWidth; // start at this week
  let selected = null;
  document.querySelectorAll(".c[data-c]").forEach((el) => el.addEventListener("click", () => {
    const x = V.cols[Number(el.dataset.c)].cells[Number(el.dataset.r)];
    if (selected) selected.classList.remove("sel");
    selected = el;
    el.classList.add("sel");
    document.getElementById("dd").innerHTML = `<b>${esc(x.label)}</b>` + (x.acts.length
      ? x.acts.map((a) => `<div class="act" onclick="location.href='streak://open/${a.id}'"><span>${esc(a.text)}</span><span>${esc(a.meta)}</span></div>`).join("")
      : `<div style="margin-top:4px">Rest day 😴</div>`);
  }));
}

// ──────────────────────────────────────────────────────────────── main ──

async function main() {
  const inWidget = config.runsInWidget || config.runsInAccessoryWidget;
  let store;
  try {
    store = await sync(false);
  } catch (e) {
    if (inWidget) { Script.setWidget(messageWidget(String(e.message || e))); return; }
    throw e;
  }
  const s = compute(store);
  if (inWidget) {
    Script.setWidget(buildWidget(s, config.widgetFamily || "small"));
    return;
  }
  await showDetail(s);
}

try {
  await main();
} catch (e) {
  console.error(e);
  if (config.runsInApp) {
    const a = new Alert();
    a.title = "Training Streak";
    a.message = String(e.message || e);
    a.addAction("OK");
    await a.presentAlert();
  }
}
Script.complete();
