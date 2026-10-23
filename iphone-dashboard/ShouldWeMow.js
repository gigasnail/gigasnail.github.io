// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: leaf;

/*
 * Should We Mow? — for Scriptable.
 *
 * Answers two questions:
 *   1. Does the lawn need it?  Estimates growth since the last mow from the
 *      temperature and rain (grass grows fastest around 20°C, hardly at all
 *      when it's cold or very dry).
 *   2. Can we mow now?  Dry grass (rain and morning dew), ground that isn't
 *      soggy, no frost, daylight, and neighbour-friendly hours.
 *
 * Mows are logged in a Reminders list called "Lawn". Share that list in the
 * Reminders app and everyone in the house sees the same history.
 *
 * Log a mow: tap "We just mowed" in the app, or run this script from a
 * Shortcut / Siri with the parameter "mowed".
 */

const CONFIG = {
  location: null, // e.g. { latitude: 55.676, longitude: 12.568, name: "Home" }
  units: "metric", // "metric" (°C, mm) or "imperial" (°F, in)
  list: "Lawn", // Reminders list used to log mows (created if missing)
  // Allowed mowing hours per weekday [from, to). Sunday = 0. null = never that day.
  mowHours: { 0: [10, 18], 1: [8, 20], 2: [8, 20], 3: [8, 20], 4: [8, 20], 5: [8, 20], 6: [9, 18] },
  mowMinutes: 60, // how long a mow takes — windows must be at least this long
  cutHeight: 50, // mm — the height you cut to. Due when grass is ~1/3 taller (25 mm growth)
  grassType: "cool", // "cool" (most of Europe/north US) or "warm" (Bermuda, zoysia, etc.)
  maxGrowth: 5, // mm/day in perfect conditions
  watered: false, // true if you water the lawn (dry spells won't slow growth)
  notify: true, // notify before today's mowing window when the lawn is due
  notifyMinutesBefore: 30,
};

// ───────────────────────────────────────────────────────────── storage ──

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "mow-data");
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

const HOUR = 3600000, DAY = 86400000;
const scriptURL = () => `scriptable:///run/${encodeURIComponent(Script.name())}`;

function withTimeout(promise, ms, what = "Request") {
  return new Promise((resolve, reject) => {
    const timer = Timer.schedule(ms, false, () => reject(new Error(`${what} timed out`)));
    promise.then(
      (v) => { timer.invalidate(); resolve(v); },
      (e) => { timer.invalidate(); reject(e); }
    );
  });
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ──────────────────────────────────────────────────────────── mow log ──
// Stored as completed reminders in the "Lawn" list; the reminder's due date
// is the day of the mow. Falls back to a local file without Reminders access.

async function lawnList(create) {
  try {
    return await Calendar.forRemindersByTitle(CONFIG.list);
  } catch (e) {
    return create ? await Calendar.createForReminders(CONFIG.list) : null;
  }
}

async function loadMows() {
  try {
    const cal = await lawnList(false);
    if (cal) {
      const done = await Reminder.allCompleted([cal]);
      const mows = done
        .filter((r) => /mow/i.test(r.title || ""))
        .map((r) => (r.dueDate || r.completionDate || new Date(0)).getTime())
        .filter((t) => t > 0)
        .sort((a, b) => b - a);
      return { mows, shared: true };
    }
  } catch (e) {
    console.warn(`Reminders unavailable, using local log: ${e}`);
  }
  return { mows: readJSON("mows.json", []).sort((a, b) => b - a), shared: false };
}

async function logMow(when = Date.now()) {
  try {
    const cal = await lawnList(true);
    const r = new Reminder();
    r.title = "✂️ Mowed the lawn";
    r.calendar = cal;
    r.dueDate = new Date(when);
    r.dueDateIncludesTime = false;
    r.isCompleted = true;
    r.save();
  } catch (e) {
    console.warn(`Could not write to Reminders, saving locally: ${e}`);
    writeJSON("mows.json", [when, ...readJSON("mows.json", [])].slice(0, 200));
  }
  writeJSON("notify.json", {}); // re-evaluate notifications
}

async function askLastMowed() {
  const a = new Alert();
  a.title = "When did you last mow? 🌱";
  a.message = "So I can estimate how long the grass is. After this, tap “We just mowed” each time.";
  const options = [["Today", 0], ["Yesterday", 1], ["2–3 days ago", 2.5], ["About a week ago", 7], ["About 2 weeks ago", 14], ["A month or more", 30]];
  options.forEach(([label]) => a.addAction(label));
  a.addCancelAction("Not sure");
  const i = await a.presentAlert();
  if (i === -1) return false;
  await logMow(Date.now() - options[i][1] * DAY);
  return true;
}

// ─────────────────────────────────────────────────────────── fetching ──

async function getLocation() {
  if (CONFIG.location) return CONFIG.location;
  const saved = readJSON("location.json", null);
  try {
    Location.setAccuracyToThreeKilometers();
    const loc = await withTimeout(Location.current(), config.runsInWidget ? 6000 : 12000, "Location");
    const moved = !saved || Math.abs(saved.latitude - loc.latitude) + Math.abs(saved.longitude - loc.longitude) > 0.05;
    let name = saved && !moved ? saved.name : null;
    if (!name) {
      try {
        const g = (await Location.reverseGeocode(loc.latitude, loc.longitude))[0] || {};
        name = g.locality || g.subAdministrativeArea || g.name || null;
      } catch (e) { /* name is optional */ }
    }
    const out = { latitude: loc.latitude, longitude: loc.longitude, name };
    writeJSON("location.json", out);
    return out;
  } catch (e) {
    if (saved) return saved;
    throw new Error("Location unavailable — allow Scriptable to use your location, or set CONFIG.location.");
  }
}

// Two requests: hourly detail around now, and daily history back to the
// last mow (for the growth estimate). Always metric; converted for display.
async function getWeather(pastDays, force) {
  const c = readJSON("weather.json", null);
  if (!force && c && c.pastDays >= pastDays && Date.now() - c.at < 30 * 60000) return c.data;
  try {
    const loc = await getLocation();
    const base = "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${loc.latitude.toFixed(3)}&longitude=${loc.longitude.toFixed(3)}&timezone=auto&timeformat=unixtime&wind_speed_unit=ms`;
    const [hourly, daily] = await Promise.all([
      new Request(base + "&past_days=2&forecast_days=6&hourly=temperature_2m,precipitation,precipitation_probability," +
        "weather_code,wind_gusts_10m,relative_humidity_2m,dew_point_2m,et0_fao_evapotranspiration,is_day").loadJSON(),
      new Request(base + `&past_days=${pastDays}&forecast_days=7&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`).loadJSON(),
    ]);
    if (!hourly.hourly || !daily.daily) throw new Error(hourly.reason || daily.reason || "Weather service error");
    const data = { place: loc.name, hourly: hourly.hourly, daily: daily.daily };
    writeJSON("weather.json", { at: Date.now(), pastDays, data });
    return data;
  } catch (e) {
    if (c) {
      console.warn(`Using cached weather (${e.message || e})`);
      return Object.assign({}, c.data, { stale: c.at });
    }
    throw e;
  }
}

// ──────────────────────────────────────────────────────────── growth ──

// Turf "growth potential" (Gelernter & Stowell): 1.0 at the grass's ideal
// temperature, falling off on a bell curve either side.
function growthPotential(tempC) {
  const [opt, sd] = CONFIG.grassType === "warm" ? [31, 7] : [20, 5.5];
  return Math.exp(-0.5 * ((tempC - opt) / sd) ** 2);
}

function dailyGrowth(days) {
  // days: [{ t, mean, rain }] oldest first. Dry weeks slow growth unless watered.
  return days.map((d, i) => {
    const rain7 = days.slice(Math.max(0, i - 6), i + 1).reduce((s, x) => s + x.rain, 0);
    const water = CONFIG.watered ? 1 : Math.min(1, 0.4 + rain7 / 15);
    return Object.assign({}, d, { gp: growthPotential(d.mean), mm: CONFIG.maxGrowth * growthPotential(d.mean) * water });
  });
}

function growthStatus(weather, lastMow, now) {
  const D = weather.daily;
  const days = dailyGrowth(D.time.map((t, i) => ({
    t: t * 1000, mean: (D.temperature_2m_max[i] + D.temperature_2m_min[i]) / 2, rain: D.precipitation_sum[i] || 0,
  })));
  const today0 = startOfDay(now);
  const target = CONFIG.cutHeight / 2;
  const nextWeek = days.filter((d) => d.t >= today0).slice(0, 7);
  const resting = nextWeek.length && nextWeek.reduce((s, d) => s + d.gp, 0) / nextWeek.length < 0.1;
  const growingToday = (days.find((d) => d.t === today0) || {}).mm || 0;
  if (lastMow == null) return { known: false, target, resting, growingToday };

  // Growth since the mow: whole days after it, plus the elapsed part of today.
  const mowDay = startOfDay(lastMow);
  let grown = 0;
  days.forEach((d) => {
    if (d.t <= mowDay || d.t > today0) return;
    grown += d.t === today0 ? d.mm * ((now - today0) / DAY) : d.mm;
  });
  // When will it reach the target?
  let dueAt = null;
  if (grown >= target) dueAt = now;
  else {
    let acc = grown;
    for (const d of days.filter((x) => x.t >= today0)) {
      const add = d.t === today0 ? d.mm * (1 - (now - today0) / DAY) : d.mm;
      if (acc + add >= target) { dueAt = d.t + ((target - acc) / add) * DAY; break; }
      acc += add;
    }
  }
  // Where the grass will be by tonight — keeps the answer steady through the day.
  const tonight = grown + growingToday * (1 - (now - today0) / DAY);
  return {
    known: true, grown, target, ratio: grown / target, ratioTonight: tonight / target, dueAt, resting, growingToday,
    daysSince: Math.floor((today0 - mowDay) / DAY),
  };
}

// ───────────────────────────────────────────────────────── conditions ──

const LEVEL = { GO: 0, MAYBE: 1, NO: 2 };
const RAIN_CODES = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

// Water on the grass blades, in mm. Rain adds to it, so does dew on calm
// humid nights; sun and wind dry it — slower than pavement.
function updateWetness(wet, h) {
  let w = wet + h.precip;
  if (h.rh >= 92 && h.temp - h.dew <= 2) w += 0.03; // dew forming
  const dry = (0.01 + 1.0 * (h.et0 || 0)) * (h.rh > 95 ? 0.4 : 1);
  return Math.min(0.6, Math.max(0, w - dry));
}

function inMowHours(t) {
  const d = new Date(t), hours = CONFIG.mowHours[d.getDay()];
  return !!hours && d.getHours() >= hours[0] && d.getHours() < hours[1];
}

function conditions(weather, now) {
  const H = weather.hourly;
  const raw = H.time.map((t, i) => ({
    t: t * 1000, temp: H.temperature_2m[i], precip: H.precipitation[i] || 0, pop: H.precipitation_probability[i] || 0,
    code: H.weather_code[i], gust: H.wind_gusts_10m[i], rh: H.relative_humidity_2m[i], dew: H.dew_point_2m[i],
    et0: H.et0_fao_evapotranspiration[i], isDay: !!H.is_day[i],
  }));
  let wet = 0;
  const slots = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const h = raw[i], during = raw[i + 1];
    wet = updateWetness(wet, h);
    const rain24 = raw.slice(Math.max(0, i - 23), i + 1).reduce((s, x) => s + x.precip, 0);
    const frost = raw.slice(Math.max(0, i - 6), i + 1).some((x) => x.temp <= 0);
    const s = { t: h.t, wet, rain24, frost, temp: h.temp, rain: during.precip, pop: during.pop, code: during.code, gust: Math.max(h.gust, during.gust), isDay: h.isDay };
    classify(s);
    slots.push(s);
  }
  return slots;
}

function classify(s) {
  let level = LEVEL.GO;
  const why = [];
  const bump = (lvl, text) => { level = Math.max(level, lvl); why.push(text); };
  if (s.rain >= 0.1 || (RAIN_CODES(s.code) && s.pop >= 50)) bump(LEVEL.NO, "Rain");
  else if (s.pop >= 60) bump(LEVEL.NO, `Rain likely (${s.pop}%)`);
  else if (s.pop >= 40) bump(LEVEL.MAYBE, `${s.pop}% chance of rain`);
  if (s.wet >= 0.15) bump(LEVEL.NO, "Wet grass");
  else if (s.wet >= 0.05) bump(LEVEL.MAYBE, "Grass a bit damp");
  if (s.rain24 >= 20) bump(LEVEL.NO, "Soggy ground");
  else if (s.rain24 >= 10) bump(LEVEL.MAYBE, "Soft ground");
  if (s.frost) bump(LEVEL.NO, "Frost");
  if (s.temp >= 30) bump(LEVEL.MAYBE, "Very hot");
  if (s.gust >= 15) bump(LEVEL.MAYBE, "Very windy");
  if (!s.isDay) bump(LEVEL.NO, "Dark");
  s.level = level;
  s.why = why;
}

function bestWindow(slots) {
  let best = null, run = null;
  for (const s of slots) {
    if (s.level === LEVEL.GO && inMowHours(s.t)) {
      if (run && s.t === run.end) run.end = s.t + HOUR;
      else run = { start: s.t, end: s.t + HOUR };
      if (!best || run.end - run.start > best.end - best.start) best = Object.assign({}, run);
    } else {
      run = null;
    }
  }
  return best && best.end - best.start >= CONFIG.mowMinutes * 60000 ? best : null;
}

// ─────────────────────────────────────────────────────────── analysis ──

async function analyse(force, now = Date.now()) {
  const log = await loadMows();
  const lastMow = log.mows[0] || null;
  const pastDays = lastMow ? Math.min(92, Math.max(9, Math.ceil((now - lastMow) / DAY) + 8)) : 9;
  const weather = await getWeather(pastDays, force);
  const growth = growthStatus(weather, lastMow, now);
  const all = conditions(weather, now);
  const thisHour = Math.floor(now / HOUR) * HOUR;
  const future = all.filter((s) => s.t >= thisHour);
  if (!future.length) throw new Error("Weather forecast is out of date");

  const days = [];
  for (let d = 0; d < 5; d++) {
    const day0 = startOfDay(now + d * DAY);
    const daySlots = future.filter((s) => s.t >= day0 && s.t < day0 + DAY);
    if (!daySlots.length) continue;
    days.push({ t: day0, window: bestWindow(daySlots), maxTemp: Math.max(...daySlots.map((s) => s.temp)), rain: daySlots.reduce((a, s) => a + s.rain, 0) });
  }

  const seasonStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const a = {
    now, place: weather.place, stale: weather.stale || null, growth, slots: future.slice(0, 48), days, cur: future[0],
    lastMow, mowsThisYear: log.mows.filter((t) => t >= seasonStart).length, shared: log.shared,
  };
  a.verdict = verdict(a);
  return a;
}

function verdict(a) {
  const { growth: g, cur, days, now } = a;
  const today = days[0] && days[0].t === startOfDay(now) ? days[0] : null;
  const nextWin = days.find((d) => d.window && d.window.end > now);
  const nowOK = cur.level === LEVEL.GO && inMowHours(cur.t) && today && today.window && today.window.start <= cur.t && today.window.end > now;
  // Due if it will be ~there by tonight, or due within 2 days with no
  // mowing window tomorrow (beat the rain).
  const tomorrow = days.find((d) => d.t === startOfDay(now) + DAY);
  const beatTheRain = g.known && g.dueAt && g.dueAt - now < 2 * DAY && tomorrow && !tomorrow.window && today && today.window && today.window.end > now;
  const due = !g.known || g.ratioTonight >= 0.85 || beatTheRain;
  const overdue = g.known && g.ratio >= 1.4;
  const winText = (w) => `${dayName(w.start, now)} ${span(w)}`;

  if (g.resting && (!g.known || g.ratio < 1)) {
    return { status: "rest", emoji: "💤", title: "Lawn's resting", sub: "Too cold to grow much — no need to mow" };
  }
  if (!due) {
    const when = g.dueAt ? `Due ${relDue(g.dueAt, now)}` : "Not due this week";
    return { status: "wait", emoji: "😌", title: "Not yet", sub: when, next: nextWin ? `Next good window: ${winText(nextWin.window)}` : null };
  }
  const prefix = overdue ? "Getting long! " : beatTheRain && g.ratioTonight < 0.85 ? "Rain tomorrow! " : "";
  if (nowOK) {
    return { status: "go", emoji: overdue ? "😬" : "✂️", title: "Mow today!", sub: `${prefix}Good until ${hm(today.window.end)}` };
  }
  if (today && today.window && today.window.start > now) {
    return { status: "later", emoji: "⏳", title: "Later today", sub: `${prefix}Good ${span(today.window)}`, reason: cur.why[0] };
  }
  const first = cur.why[0] || (inMowHours(cur.t) ? "" : "Quiet hours");
  return {
    status: "no", emoji: /Rain/.test(first) ? "🌧️" : /Frost/.test(first) ? "🥶" : /Dark/.test(first) ? "🌙" : "🙅",
    title: "Not right now",
    sub: nextWin ? `${prefix}Next: ${winText(nextWin.window)}` : `${prefix}No dry window in the next few days`,
    reason: first,
  };
}

// ───────────────────────────────────────────────────────── formatting ──

const hm = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const span = (w) => `${hm(w.start)}–${hm(w.end)}`;
function dayName(t, now = Date.now()) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
}
function relDue(t, now) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ~${diff} days (${new Date(t).toLocaleDateString(undefined, { weekday: "short" })})`;
}
function ago(t, now) {
  const d = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
const imp = CONFIG.units === "imperial";
const temp = (c) => `${Math.round(imp ? c * 9 / 5 + 32 : c)}°`;
const length = (mm) => (imp ? `${(mm / 25.4).toFixed(1)} in` : `${Math.round(mm)} mm`);
const groundStr = (s) => (s.wet >= 0.15 ? "wet grass" : s.wet >= 0.05 ? "damp grass" : "dry grass");

function growthLine(a) {
  const g = a.growth;
  if (!g.known) return "Tap to tell me when you last mowed";
  if (g.daysSince > 45) return `Last mowed ${ago(a.lastMow, a.now)}`;
  return `+${length(g.grown)} · mowed ${ago(a.lastMow, a.now)}`;
}

// ──────────────────────────────────────────────────────── notifications ──

async function scheduleHeadsUp(a) {
  if (!CONFIG.notify) return;
  const state = readJSON("notify.json", {});
  const today = a.days[0] && a.days[0].t === startOfDay(a.now) ? a.days[0] : null;
  const due = !a.growth.known || a.growth.ratioTonight >= 0.85;
  const w = due && !a.growth.resting && today && today.window ? today.window : null;
  const key = w ? `${w.start}-${w.end}` : null;
  if (key === state.key) return;
  await Notification.removePending(["mow-window"]);
  const fireAt = w ? w.start - CONFIG.notifyMinutesBefore * 60000 : 0;
  if (w && fireAt > Date.now()) {
    const n = new Notification();
    n.identifier = "mow-window";
    n.title = "🌱 Good mowing weather today";
    n.body = `The lawn is due and it's dry ${span(w)}.`;
    n.openURL = scriptURL();
    n.setTriggerDate(new Date(fireAt));
    await n.schedule();
  }
  writeJSON("notify.json", { key });
}

// ──────────────────────────────────────────────────────────── widgets ──

const PALETTE = {
  go: ["#3DB86B", "#1E8449"],
  later: ["#2E8FD8", "#1B5FA8"],
  wait: ["#5AA88C", "#3B7D66"],
  rest: ["#6B7F95", "#475668"],
  no: ["#D9534F", "#A33A36"],
};
const LEVEL_COLORS = ["#4CD964", "#FFCC00", "#FF5A5F"];

function wText(stack, str, font, opacity = 1, lines = 1) {
  const t = stack.addText(String(str));
  t.font = font;
  t.textColor = Color.white();
  t.textOpacity = opacity;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.6;
  return t;
}

function growthBar(ratio, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, w, h), h / 2, h / 2);
  ctx.addPath(bg);
  ctx.setFillColor(new Color("#FFFFFF", 0.25));
  ctx.fillPath();
  const fg = new Path();
  fg.addRoundedRect(new Rect(0, 0, Math.max(h, Math.min(1, ratio) * w), h), h / 2, h / 2);
  ctx.addPath(fg);
  ctx.setFillColor(new Color(ratio >= 1.4 ? "#FFD60A" : "#FFFFFF", 0.95));
  ctx.fillPath();
  return ctx.getImage();
}

function timeline(slots, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const n = slots.length, gap = 2, bw = (w - gap * (n - 1)) / n, bh = h - 14;
  slots.forEach((s, i) => {
    const x = i * (bw + gap);
    const p = new Path();
    p.addRoundedRect(new Rect(x, 0, bw, bh), 3, 3);
    ctx.addPath(p);
    const allowed = inMowHours(s.t);
    ctx.setFillColor(new Color(LEVEL_COLORS[s.level], allowed ? 0.9 : 0.35));
    ctx.fillPath();
    if (i % 3 === 0) {
      ctx.setFont(Font.semiboldSystemFont(9));
      ctx.setTextColor(new Color("#FFFFFF", 0.8));
      ctx.drawText(i === 0 ? "Now" : new Date(s.t).toLocaleTimeString(undefined, { hour: "numeric" }), new Point(x, bh + 2));
    }
  });
  return ctx.getImage();
}

function buildWidget(a, family) {
  const v = a.verdict, g = a.growth;
  const w = new ListWidget();
  w.url = scriptURL();
  w.refreshAfterDate = new Date(Date.now() + 45 * 60000);

  if (family === "accessoryInline") {
    wText(w, `${v.emoji} ${v.title} · ${v.sub}`, Font.systemFont(12));
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    wText(s, "🌱", Font.systemFont(15));
    wText(s, g.known ? `${Math.round(Math.min(g.ratio, 9.99) * 100)}%` : "?", Font.heavyRoundedSystemFont(13));
    return w;
  }
  if (family === "accessoryRectangular") {
    wText(w, `${v.emoji} ${v.title}`, Font.boldSystemFont(14));
    wText(w, v.sub, Font.systemFont(12));
    wText(w, growthLine(a), Font.systemFont(11), 0.8);
    return w;
  }

  const grad = new LinearGradient();
  grad.colors = PALETTE[v.status].map((c) => new Color(c));
  grad.locations = [0, 1];
  w.backgroundGradient = grad;
  const small = family === "small";
  w.setPadding(14, 15, 14, 15);

  const top = w.addStack();
  top.layoutHorizontally();
  wText(top, small ? "SHOULD WE MOW?" : `SHOULD WE MOW?${a.place ? " · " + a.place.toUpperCase() : ""}`, Font.heavySystemFont(10), 0.75);
  top.addSpacer();
  if (a.stale) wText(top, "offline", Font.semiboldSystemFont(9), 0.7);

  w.addSpacer(small ? 6 : 4);
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  head.spacing = 6;
  wText(head, v.emoji, Font.systemFont(small ? 24 : 28));
  wText(head, v.title, Font.heavyRoundedSystemFont(small ? 20 : 26));
  wText(w, v.sub, Font.semiboldSystemFont(small ? 12 : 15), 1, 2);
  w.addSpacer();

  if (!small && v.status !== "rest") {
    const img = w.addImage(timeline(a.slots.slice(0, 15), 300, 30));
    img.imageSize = new Size(300, 30);
    w.addSpacer(6);
  }
  if (g.known) {
    const barW = small ? 125 : 300;
    const bar = w.addImage(growthBar(g.ratio, barW, 6));
    bar.imageSize = new Size(barW, 6);
    w.addSpacer(4);
  }
  wText(w, growthLine(a), Font.semiboldSystemFont(11), 0.9);

  if (family === "large" || family === "extraLarge") {
    w.addSpacer(10);
    wText(w, "NEXT DAYS", Font.heavySystemFont(10), 0.75);
    w.addSpacer(4);
    a.days.slice(1, 5).forEach((d) => {
      const row = w.addStack();
      row.layoutHorizontally();
      wText(row, dayName(d.t, a.now), Font.semiboldSystemFont(13)).minimumScaleFactor = 1;
      row.addSpacer();
      wText(row, d.window ? `✅ ${span(d.window)}` : "❌ No window", Font.semiboldSystemFont(13));
      w.addSpacer(4);
    });
    wText(w, `Mowed ${a.mowsThisYear}× this year`, Font.mediumSystemFont(11), 0.75);
  }
  return w;
}

// ────────────────────────────────────────────────────────── in-app view ──

async function showDetail(a) {
  const wv = new WebView();
  const rerender = async (force) => wv.loadHTML(detailHTML(await analyse(force)));
  wv.shouldAllowRequest = (req) => {
    const url = (req && req.url) || "";
    if (!url.startsWith("mow://")) return !/^https?:/.test(url);
    const action = url.slice(6);
    (async () => {
      if (action === "mowed") await logMow();
      if (action === "set") await askLastMowed();
      if (action === "list") Safari.open("x-apple-reminderkit://");
      await rerender(action === "refresh");
    })().catch((e) => console.error(e));
    return false;
  };
  await wv.loadHTML(detailHTML(a));
  await wv.present(true);
}

function detailHTML(a) {
  const g = a.growth;
  const view = {
    v: a.verdict, palette: PALETTE, levelColors: LEVEL_COLORS,
    place: a.place, stale: a.stale ? hm(a.stale) : null, updated: hm(a.now),
    now: [temp(a.cur.temp), groundStr(a.cur), ...a.cur.why.filter((w) => !/grass/i.test(w)).map((w) => w.toLowerCase())].join(" · "),
    growth: g.known ? {
      grown: length(g.grown), target: length(g.target), pct: Math.round(g.ratio * 100),
      last: `Last mowed ${ago(a.lastMow, a.now)} (${new Date(a.lastMow).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })})`,
      due: g.ratio >= 1 ? "Due now" : g.ratioTonight >= 0.85 ? "Due today" : g.dueAt ? `Due ${relDue(g.dueAt, a.now)}` : "Not due this week",
      today: g.growingToday >= 0.05 ? `Growing about ${imp ? (g.growingToday / 25.4).toFixed(2) + " in" : g.growingToday.toFixed(1) + " mm"} a day right now` : "Barely growing right now",
    } : null,
    resting: g.resting,
    count: a.mowsThisYear, shared: a.shared,
    slots: a.slots.map((s) => ({
      hour: new Date(s.t).toLocaleTimeString(undefined, { hour: "numeric" }), day: dayName(s.t, a.now),
      level: s.level, allowed: inMowHours(s.t), why: s.why, temp: temp(s.temp), newDay: new Date(s.t).getHours() === 0,
    })),
    days: a.days.map((d) => ({
      name: dayName(d.t, a.now), date: new Date(d.t).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      window: d.window ? span(d.window) : null, meta: `High ${temp(d.maxTemp)} · ${d.rain >= 0.1 ? (imp ? (d.rain / 25.4).toFixed(2) + " in" : d.rain.toFixed(1) + " mm") + " rain" : "dry"}`,
    })),
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><style>${DETAIL_CSS}</style></head>
<body><main id="app"></main><script>(${DETAIL_PAGE.toString()})(${JSON.stringify(view).replace(/</g, "\\u003c")});</script></body></html>`;
}

const DETAIL_CSS = `
:root{--bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--sub:#6e6e73;--sep:rgba(60,60,67,.13);--fill:rgba(118,118,128,.12);--green:#34c759}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--sub:#98989f;--sep:rgba(84,84,88,.5);--fill:rgba(118,118,128,.24);--green:#30d158}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.35 -apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 32px)}
button{font:inherit;cursor:pointer}
.hero{border-radius:24px;padding:20px;color:#fff;position:relative}
.hero .place{font-size:12px;font-weight:800;letter-spacing:.06em;opacity:.8;text-transform:uppercase}
.hero .big{display:flex;align-items:center;gap:10px;margin-top:8px}
.hero .emoji{font-size:42px}
.hero h1{margin:0;font-size:34px;font-weight:900;letter-spacing:-.02em;line-height:1.1}
.hero .sub{font-size:19px;font-weight:700;margin-top:4px}
.hero .now{font-size:14px;opacity:.9;margin-top:10px}
.hero .next{font-size:14px;font-weight:600;margin-top:4px;opacity:.95}
.refresh{position:absolute;top:16px;right:16px;border:0;background:rgba(255,255,255,.22);color:#fff;width:34px;height:34px;border-radius:50%;font-size:17px}
.mowed{display:block;width:100%;margin-top:14px;padding:15px;border:0;border-radius:16px;background:var(--green);color:#fff;font-size:18px;font-weight:800;transition:transform .1s}
.mowed:active{transform:scale(.98)}
.mowed.done{background:var(--fill);color:var(--text)}
.card{background:var(--card);border-radius:20px;padding:16px;margin-top:14px}
.card h2{margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--sub);display:flex;justify-content:space-between}
.card h2 button{border:0;background:none;color:#007aff;font-weight:600;font-size:14px;text-transform:none;letter-spacing:0;padding:0}
.grow{display:flex;align-items:baseline;gap:8px}
.grow b{font-size:34px;font-weight:800;letter-spacing:-.02em}
.grow span{color:var(--sub);font-size:15px}
.track{height:12px;border-radius:6px;background:var(--fill);margin:12px 0 6px;overflow:hidden;position:relative}
.track i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#8bd17c,var(--green))}
.track i.over{background:linear-gradient(90deg,var(--green),#ffcc00)}
.meta{display:flex;justify-content:space-between;font-size:13px;color:var(--sub)}
.facts{margin-top:10px;font-size:14px;color:var(--sub);line-height:1.6}
.facts b{color:var(--text)}
.cta{border:0;background:var(--fill);color:#007aff;font-weight:600;padding:10px 14px;border-radius:12px}
.strip-wrap{padding-top:16px}
.strip{display:flex;gap:3px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.strip::-webkit-scrollbar{display:none}
.h{flex:0 0 40px;text-align:center;font-size:12px}
.h .blk{height:44px;border-radius:8px;display:grid;place-items:center;color:#fff;font-weight:800}
.h .lbl{color:var(--sub);margin-top:4px;font-weight:600}
.h.daybreak{margin-left:10px;position:relative}
.h.daybreak::before{content:attr(data-day);position:absolute;top:-16px;left:0;font-size:10px;font-weight:800;color:var(--sub);text-transform:uppercase;white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:12px;color:var(--sub)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.detail{font-size:13px;color:var(--sub);margin-top:10px;min-height:18px}
.day{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 0;border-bottom:1px solid var(--sep)}
.day:last-child{border-bottom:0}
.day .n{font-weight:700}
.day .n span{color:var(--sub);font-weight:500;margin-left:6px;font-size:14px}
.day .w{font-weight:700;text-align:right}
.day .m{grid-column:1/-1;font-size:13px;color:var(--sub)}
.foot{text-align:center;color:var(--sub);font-size:12px;margin-top:14px;opacity:.75}
`;

function DETAIL_PAGE(V) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const go = (action) => { location.href = "mow://" + action; };
  window.go = go;
  const v = V.v, G = V.growth;
  const hero = `<section class="hero" style="background:linear-gradient(150deg,${V.palette[v.status][0]},${V.palette[v.status][1]})">
    <button class="refresh" onclick="go('refresh')" aria-label="Refresh">↻</button>
    <div class="place">Should we mow?${V.place ? " · " + esc(V.place) : ""}</div>
    <div class="big"><span class="emoji">${v.emoji}</span><h1>${esc(v.title)}</h1></div>
    <div class="sub">${esc(v.sub)}</div>
    ${v.next ? `<div class="next">${esc(v.next)}</div>` : ""}
    <div class="now">Now: ${esc(V.now)}</div></section>
    <button class="mowed" id="mowed">✂️ We just mowed</button>`;

  const growth = G ? `<section class="card"><h2>The grass <button onclick="go('set')">Change date</button></h2>
      <div class="grow"><b>+${esc(G.grown)}</b><span>of ~${esc(G.target)} before it's due</span></div>
      <div class="track"><i class="${G.pct > 140 ? "over" : ""}" style="width:${Math.min(100, G.pct)}%"></i></div>
      <div class="meta"><span>${esc(G.last)}</span><span>${G.pct}%</span></div>
      <div class="facts"><b>${esc(G.due)}</b> · ${esc(G.today)}${V.resting ? " · cold spell, the lawn is resting" : ""}<br>
      Mowed <b>${V.count}×</b> this year${V.shared ? ` · <a onclick="go('list')" style="color:#007aff">shared “Lawn” list</a>` : ""}</div></section>`
    : `<section class="card"><h2>The grass</h2><div class="facts">Tell me when you last mowed and I'll estimate how long the grass is and when it's due.</div>
      <div style="margin-top:10px"><button class="cta" onclick="go('set')">Set last mow</button></div></section>`;

  const strip = V.slots.map((s, i) => `<div class="h ${s.newDay && i ? "daybreak" : ""}" data-day="${esc(s.day)}" data-i="${i}">
    <div class="blk" style="background:${V.levelColors[s.level]};opacity:${s.allowed ? 1 : 0.35}">${["✓", "~", "✕"][s.level]}</div>
    <div class="lbl">${i ? esc(s.hour) : "Now"}</div></div>`).join("");

  const days = V.days.map((d) => `<div class="day"><div class="n">${esc(d.name)}<span>${esc(d.date)}</span></div>
    <div class="w" style="color:${d.window ? V.levelColors[0] : "var(--sub)"}">${d.window ? "✅ " + esc(d.window) : "❌ No window"}</div>
    <div class="m">${esc(d.meta)}</div></div>`).join("");

  document.getElementById("app").innerHTML = hero + growth +
    `<section class="card"><h2>Next 48 hours</h2><div class="strip-wrap"><div class="strip">${strip}</div></div>
      <div class="legend"><span><i style="background:${V.levelColors[0]}"></i>Good</span><span><i style="background:${V.levelColors[1]}"></i>Meh</span><span><i style="background:${V.levelColors[2]}"></i>No</span><span><i style="background:${V.levelColors[0]};opacity:.35"></i>Quiet hours</span></div>
      <div class="detail" id="detail">Tap an hour to see why.</div></section>` +
    `<section class="card"><h2>Best mowing windows</h2>${days}</section>` +
    `<div class="foot">Updated ${esc(V.updated)}${V.stale ? ` · offline, weather from ${esc(V.stale)}` : ""} · Weather by Open-Meteo</div>`;

  const btn = document.getElementById("mowed");
  btn.addEventListener("click", () => {
    if (btn.classList.contains("done")) return;
    btn.classList.add("done");
    btn.textContent = "✅ Logged — nice work!";
    go("mowed");
  });
  document.querySelectorAll(".h").forEach((el) => el.addEventListener("click", () => {
    const s = V.slots[Number(el.dataset.i)];
    const reasons = s.why.length ? s.why.join(", ") : "dry and fine";
    document.getElementById("detail").textContent =
      `${s.day} ${s.hour}: ${["Good", "Meh", "No"][s.level]} — ${reasons}${s.allowed ? "" : " · outside your mowing hours"} · ${s.temp}`;
  }));
}

// ──────────────────────────────────────────────────────────────── main ──

async function main() {
  const param = String(args.shortcutParameter || (args.queryParameters || {}).action || "").toLowerCase().trim();
  if (param === "mowed") {
    await logMow();
    Script.setShortcutOutput("Logged a mow. Nice work! 🌱");
    return;
  }
  const inWidget = config.runsInWidget || config.runsInAccessoryWidget;
  if (!inWidget && !(await loadMows()).mows.length) await askLastMowed();

  const a = await analyse(false);
  try {
    await scheduleHeadsUp(a);
  } catch (e) {
    console.warn(`Notification not scheduled: ${e}`);
  }
  if (inWidget) {
    Script.setWidget(buildWidget(a, config.widgetFamily || "small"));
    return;
  }
  await showDetail(a);
}

try {
  await main();
} catch (e) {
  console.error(e);
  if (config.runsInWidget) {
    const w = new ListWidget();
    w.addText("🌱 Should we mow?").font = Font.boldSystemFont(14);
    const t = w.addText(String(e.message || e));
    t.font = Font.systemFont(11);
    t.textColor = Color.gray();
    Script.setWidget(w);
  } else if (config.runsInApp) {
    const al = new Alert();
    al.title = "Should we mow?";
    al.message = String(e.message || e);
    al.addAction("OK");
    await al.presentAlert();
  }
}
Script.complete();
