// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: road;

/*
 * Skate Check — "Can I skate today?" for Scriptable.
 *
 *   Add it as a widget  → today's verdict and best dry window
 *   Run it in the app   → hour-by-hour detail and the next few days
 *
 * It models how wet the ground is (rain in the last 24h vs. how fast sun,
 * wind and warmth dry it), so it knows the street is still wet after the
 * rain has stopped. Weather from Open-Meteo, no account needed.
 */

const CONFIG = {
  // Fixed location instead of GPS, e.g. { latitude: 55.676, longitude: 12.568, name: "Copenhagen" }
  location: null,
  units: "metric", // "metric" (°C, m/s) or "imperial" (°F, mph)
  skateHours: [8, 22], // only suggest windows between these hours
  minTemp: 5, // °C — colder than this is a "maybe"
  maxGust: 12, // m/s — gusts above this are a no (12 m/s ≈ 43 km/h)
  maxRainChance: 35, // % — above this is a "maybe", 60% or more is a no
  daylightOnly: false, // true = only suggest windows while it's light out
  notify: true, // notification shortly before today's dry window starts
  notifyMinutesBefore: 30,
};

// ───────────────────────────────────────────────────────────── storage ──

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "skate-data");
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

// Always fetched in metric; converted for display only.
async function getForecast(force) {
  const c = readJSON("forecast.json", null);
  if (!force && c && Date.now() - c.at < 20 * 60000) return c.data;
  try {
    const loc = await getLocation();
    const url = "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${loc.latitude.toFixed(3)}&longitude=${loc.longitude.toFixed(3)}` +
      "&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code," +
      "wind_speed_10m,wind_gusts_10m,relative_humidity_2m,dew_point_2m,et0_fao_evapotranspiration,is_day" +
      "&daily=sunrise,sunset" +
      "&timezone=auto&timeformat=unixtime&past_days=1&forecast_days=5&wind_speed_unit=ms";
    const j = await new Request(url).loadJSON();
    if (!j.hourly) throw new Error(j.reason || "Weather service error");
    const data = { place: loc.name, hourly: j.hourly, daily: j.daily };
    writeJSON("forecast.json", { at: Date.now(), data });
    return data;
  } catch (e) {
    if (c) {
      console.warn(`Using cached forecast (${e.message || e})`);
      return Object.assign({}, c.data, { stale: c.at });
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────── analysis ──

const RAIN_CODES = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SNOW_CODES = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const LEVEL = { GO: 0, MAYBE: 1, NO: 2 };

// Rough model of a water film on asphalt, in mm. Rain adds to it (capped
// — the rest runs off), evaporation removes it. Sunny/windy/warm hours dry
// fast; cold, humid nights hardly dry at all.
function dryingRate(h) {
  let rate = 0.03 + 1.5 * (h.et0 || 0) + 0.004 * (h.wind || 0);
  if (h.temp < 2) rate *= 0.5;
  if (h.rh > 95) rate *= 0.5;
  return rate;
}

function analyse(fc, now = Date.now()) {
  const H = fc.hourly;
  // Open-Meteo hourly values describe the hour *ending* at time t.
  const raw = H.time.map((t, i) => ({
    t: t * 1000, temp: H.temperature_2m[i], feels: H.apparent_temperature[i], precip: H.precipitation[i] || 0,
    pop: H.precipitation_probability[i] || 0, code: H.weather_code[i], wind: H.wind_speed_10m[i],
    gust: H.wind_gusts_10m[i], rh: H.relative_humidity_2m[i], dew: H.dew_point_2m[i],
    et0: H.et0_fao_evapotranspiration[i], isDay: !!H.is_day[i],
  }));

  // A "slot" is the hour starting at t: ground wetness at its start, and the
  // weather during it (taken from the next entry).
  let wet = 0;
  const slots = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const h = raw[i], during = raw[i + 1];
    wet = Math.min(1, Math.max(0, wet + h.precip - dryingRate(h)));
    const s = {
      t: h.t, wet, temp: h.temp, feels: h.feels, rain: during.precip, pop: during.pop, code: during.code,
      wind: Math.max(h.wind, during.wind), gust: Math.max(h.gust, during.gust), rh: h.rh, dew: h.dew, isDay: h.isDay,
    };
    classify(s);
    slots.push(s);
  }

  const thisHour = Math.floor(now / HOUR) * HOUR;
  const future = slots.filter((s) => s.t >= thisHour);
  const cur = future[0];
  if (!cur) throw new Error("Forecast is out of date");

  // Best windows for today + the next 3 days
  const days = [];
  for (let d = 0; d < 4; d++) {
    const day0 = startOfDay(now + d * DAY);
    const daySlots = future.filter((s) => s.t >= day0 && s.t < day0 + DAY);
    const inHours = daySlots.filter((s) => inSkateHours(s.t) && !(CONFIG.daylightOnly && !s.isDay));
    if (!daySlots.length) continue;
    const best = bestRun(inHours, LEVEL.GO) || bestRun(inHours, LEVEL.MAYBE);
    days.push({
      t: day0,
      window: best,
      maxTemp: Math.max(...daySlots.map((s) => s.temp)),
      minTemp: Math.min(...daySlots.map((s) => s.temp)),
      rain: daySlots.reduce((a, s) => a + s.rain, 0),
      maxGust: Math.max(...daySlots.map((s) => s.gust)),
      goHours: inHours.filter((s) => s.level === LEVEL.GO).length,
    });
  }

  // How long until the ground is dry again?
  let dryBy = null;
  if (cur.wet >= 0.08) {
    const d = future.find((s) => s.wet < 0.08 && s.rain < 0.1);
    dryBy = d ? d.t : null;
  }

  return { place: fc.place, stale: fc.stale || null, now, cur, slots: future.slice(0, 48), days, dryBy, verdict: verdict(cur, future, days, now) };
}

function classify(s) {
  let level = LEVEL.GO;
  const why = [];
  const bump = (lvl, text) => { level = Math.max(level, lvl); why.push(text); };
  if (SNOW_CODES(s.code)) bump(LEVEL.NO, "Snow");
  if (s.rain >= 0.1 || (RAIN_CODES(s.code) && s.pop >= 50)) bump(LEVEL.NO, s.rain >= 1 ? "Heavy rain" : "Rain");
  else if (s.pop >= 60) bump(LEVEL.NO, `Rain likely (${s.pop}%)`);
  else if (s.pop >= CONFIG.maxRainChance) bump(LEVEL.MAYBE, `${s.pop}% chance of rain`);
  if (s.wet >= 0.25) bump(LEVEL.NO, "Wet ground");
  else if (s.wet >= 0.08) bump(LEVEL.MAYBE, "Ground still drying");
  if (s.temp <= 1) bump(LEVEL.NO, "Ice risk");
  else if (s.temp < CONFIG.minTemp) bump(LEVEL.MAYBE, "Cold");
  if (s.gust >= CONFIG.maxGust) bump(LEVEL.NO, "Strong gusts");
  else if (s.gust >= CONFIG.maxGust * 0.75) bump(LEVEL.MAYBE, "Gusty");
  if (s.rh >= 96 && s.temp - s.dew < 1 && s.rain < 0.1) bump(LEVEL.MAYBE, "Damp (dew)");
  if (!s.isDay) {
    if (CONFIG.daylightOnly) bump(LEVEL.NO, "Dark");
    else why.push("Dark");
  }
  s.level = level;
  s.why = why;
}

function bestRun(slots, maxLevel) {
  let best = null, run = null;
  for (const s of slots) {
    const contiguous = run && s.t === run.end;
    if (s.level <= maxLevel) {
      if (contiguous) run.end = s.t + HOUR;
      else run = { start: s.t, end: s.t + HOUR, level: maxLevel };
      if (!best || run.end - run.start > best.end - best.start) best = Object.assign({}, run);
    } else {
      run = null;
    }
  }
  if (best) best.hours = (best.end - best.start) / HOUR;
  return best;
}

function runFrom(future, i, maxLevel) {
  let end = future[i].t + HOUR;
  for (let j = i + 1; j < future.length && future[j].level <= maxLevel && j < i + 24; j++) end = future[j].t + HOUR;
  return end;
}

function verdict(cur, future, days, now) {
  const today = days[0] && days[0].t === startOfDay(now) ? days[0] : null;
  const todayGo = today && today.window && today.window.level === LEVEL.GO && today.window.end > now ? today.window : null;
  const upcoming = (lvl) => days.find((d) => d.window && d.window.level === lvl && d.window.start > now);
  const next = upcoming(LEVEL.GO) || upcoming(LEVEL.MAYBE);

  if (cur.level === LEVEL.GO) {
    const end = runFrom(future, 0, LEVEL.GO);
    const dayEnd = startOfDay(now) + CONFIG.skateHours[1] * HOUR;
    let sub = `Dry until ${hm(end)}`;
    if (now < dayEnd && end >= dayEnd) sub = new Date(now).getHours() < 12 ? "Dry all day" : "Dry for the rest of the day";
    return { status: "go", emoji: "🛹", title: "Go skate!", sub, window: { start: cur.t, end } };
  }
  if (todayGo && todayGo.start > now) {
    return { status: "later", emoji: "⏳", title: "Later today", sub: `Dry ${span(todayGo)}`, window: todayGo, reason: cur.why[0] };
  }
  if (cur.level === LEVEL.MAYBE) {
    return { status: "maybe", emoji: "🤔", title: "Maybe", sub: cur.why[0] || "Not ideal", window: null, reason: cur.why[0] };
  }
  const first = cur.why[0] || "";
  const emoji = /Snow/.test(first) ? "❄️" : /Rain/.test(first) ? "☔️" : /Wet/.test(first) ? "💦" : /Ice/.test(first) ? "🧊" : /gust/i.test(first) ? "💨" : "🚫";
  let sub = "No dry window soon";
  if (next) sub = `${next.window.level === LEVEL.GO ? "Next" : "Maybe"}: ${dayName(next.window.start, now)} ${span(next.window)}`;
  return { status: "no", emoji, title: "Not now", sub, window: next ? next.window : null, reason: first };
}

// ───────────────────────────────────────────────────────── formatting ──

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const inSkateHours = (t) => { const h = new Date(t).getHours(); return h >= CONFIG.skateHours[0] && h < CONFIG.skateHours[1]; };
const hm = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const span = (w) => `${hm(w.start)}–${hm(w.end)}`;
const when = (t) => (dayName(t) === "Today" ? hm(t) : `${dayName(t)} ${hm(t)}`);
function dayName(t, now = Date.now()) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
}
const imp = CONFIG.units === "imperial";
const temp = (c) => `${Math.round(imp ? c * 9 / 5 + 32 : c)}°`;
const windStr = (ms) => (imp ? `${Math.round(ms * 2.23694)} mph` : `${Math.round(ms)} m/s`);
const groundStr = (w) => (w < 0.08 ? "Dry" : w < 0.25 ? "Damp" : "Wet");

// ──────────────────────────────────────────────────────── notifications ──

async function scheduleHeadsUp(a) {
  if (!CONFIG.notify) return;
  const state = readJSON("notify.json", {});
  const today = a.days[0] && a.days[0].t === startOfDay(a.now) ? a.days[0] : null;
  const w = today && today.window && today.window.level === LEVEL.GO ? today.window : null;
  const fireAt = w ? w.start - CONFIG.notifyMinutesBefore * 60000 : null;
  const key = w ? `${w.start}-${w.end}` : null;
  if (key === state.key) return;
  await Notification.removePending(["skate-window"]);
  if (w && fireAt > Date.now() && w.hours >= 1) {
    const n = new Notification();
    n.identifier = "skate-window";
    n.title = "🛹 Skate window coming up";
    n.body = `Dry ${span(w)}${a.place ? ` in ${a.place}` : ""}. Grab your board!`;
    n.openURL = scriptURL();
    n.setTriggerDate(new Date(fireAt));
    await n.schedule();
  }
  writeJSON("notify.json", { key });
}

// ──────────────────────────────────────────────────────────── widgets ──

const PALETTE = {
  go: ["#2FB45A", "#14833B"],
  later: ["#2E8FD8", "#1B5FA8"],
  maybe: ["#F2A516", "#C77A06"],
  no: ["#E5484D", "#A8262B"],
};
const LEVEL_COLORS = ["#4CD964", "#FFCC00", "#FF5A5F"];

function gradient(status) {
  const g = new LinearGradient();
  g.colors = PALETTE[status].map((c) => new Color(c));
  g.locations = [0, 1];
  return g;
}

function wText(stack, str, font, opacity = 1, lines = 1) {
  const t = stack.addText(String(str));
  t.font = font;
  t.textColor = Color.white();
  t.textOpacity = opacity;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.6;
  return t;
}

// Hour-by-hour strip: one coloured block per hour, labels every 3 hours.
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
    ctx.setFillColor(new Color(LEVEL_COLORS[s.level], i === 0 ? 1 : 0.85));
    ctx.fillPath();
    if (s.rain >= 0.1) { // rain marker
      ctx.setFillColor(new Color("#FFFFFF", 0.85));
      ctx.fillEllipse(new Rect(x + bw / 2 - 2, bh / 2 - 2, 4, 4));
    }
    if (i % 3 === 0) {
      ctx.setFont(Font.semiboldSystemFont(9));
      ctx.setTextColor(new Color("#FFFFFF", 0.8));
      ctx.drawText(i === 0 ? "Now" : new Date(s.t).toLocaleTimeString(undefined, { hour: "numeric" }), new Point(x, bh + 2));
    }
  });
  return ctx.getImage();
}

function buildWidget(a, family) {
  const v = a.verdict, cur = a.cur;
  const w = new ListWidget();
  w.url = scriptURL();
  w.refreshAfterDate = new Date(Date.now() + 30 * 60000);

  if (family === "accessoryInline") {
    wText(w, `${v.emoji} ${v.title} · ${v.sub}`, Font.systemFont(12));
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    wText(s, "🛹", Font.systemFont(16));
    wText(s, { go: "GO", later: "LATER", maybe: "MAYBE", no: "NO" }[v.status], Font.heavySystemFont(11));
    return w;
  }
  if (family === "accessoryRectangular") {
    wText(w, `${v.emoji} ${v.title}`, Font.boldSystemFont(14));
    wText(w, v.sub, Font.systemFont(12));
    wText(w, `${temp(cur.temp)} · ${windStr(cur.wind)} · ${groundStr(cur.wet)}`, Font.systemFont(11), 0.8);
    return w;
  }

  w.backgroundGradient = gradient(v.status);
  const small = family === "small";
  w.setPadding(14, 15, 14, 15);

  const top = w.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  wText(top, small ? "SKATE CHECK" : `SKATE CHECK${a.place ? " · " + a.place.toUpperCase() : ""}`, Font.heavySystemFont(10), 0.75);
  top.addSpacer();
  if (a.stale) wText(top, "offline", Font.semiboldSystemFont(9), 0.7);

  w.addSpacer(small ? 6 : 4);
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  head.spacing = 6;
  wText(head, v.emoji, Font.systemFont(small ? 26 : 28));
  wText(head, v.title, Font.heavyRoundedSystemFont(small ? 22 : 26));
  wText(w, v.sub, Font.semiboldSystemFont(small ? 13 : 15));

  w.addSpacer();
  if (!small) {
    const img = w.addImage(timeline(a.slots.slice(0, 15), 300, 34));
    img.imageSize = new Size(300, 34);
    w.addSpacer(6);
  }
  wText(w, `${temp(cur.temp)} · 💨 ${windStr(cur.wind)} · ${groundStr(cur.wet)}`, Font.semiboldSystemFont(11), 0.9);
  if (a.dryBy && !small) wText(w, `Ground dry around ${when(a.dryBy)}`, Font.mediumSystemFont(11), 0.8);

  if (family === "large" || family === "extraLarge") {
    w.addSpacer(10);
    wText(w, "NEXT DAYS", Font.heavySystemFont(10), 0.75);
    w.addSpacer(4);
    a.days.slice(1, 4).forEach((d) => {
      const row = w.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();
      const name = wText(row, dayName(d.t, a.now), Font.semiboldSystemFont(13));
      name.minimumScaleFactor = 1;
      row.addSpacer();
      const win = d.window;
      wText(row, win ? `${win.level === LEVEL.GO ? "✅" : "🤔"} ${span(win)}` : "❌ No window", Font.semiboldSystemFont(13));
      w.addSpacer(4);
    });
  }
  return w;
}

// ────────────────────────────────────────────────────────── in-app view ──

async function showDetail(a) {
  const wv = new WebView();
  wv.shouldAllowRequest = (req) => {
    const url = (req && req.url) || "";
    if (url === "skate://refresh") {
      getForecast(true).then((fc) => wv.loadHTML(detailHTML(analyse(fc)))).catch((e) => console.error(e));
      return false;
    }
    return !/^https?:/.test(url);
  };
  await wv.loadHTML(detailHTML(a));
  await wv.present(true);
}

function detailHTML(a) {
  const view = {
    a,
    labels: {
      now: `${temp(a.cur.temp)} (feels ${temp(a.cur.feels)}) · 💨 ${windStr(a.cur.wind)}, gusts ${windStr(a.cur.gust)} · Ground ${groundStr(a.cur.wet).toLowerCase()}`,
      dryBy: a.dryBy ? `Ground should be dry around ${when(a.dryBy)}` : "",
      sub: a.verdict.sub,
      slots: a.slots.map((s) => ({
        hour: new Date(s.t).toLocaleTimeString(undefined, { hour: "numeric" }),
        day: dayName(s.t, a.now), temp: temp(s.temp), wind: windStr(s.gust), level: s.level, why: s.why, rain: s.rain, pop: s.pop, isDay: s.isDay,
        newDay: new Date(s.t).getHours() === 0,
      })),
      days: a.days.map((d) => ({
        name: dayName(d.t, a.now), date: new Date(d.t).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        window: d.window ? span(d.window) : null, level: d.window ? d.window.level : 2, hours: d.window ? d.window.hours : 0,
        temps: `${temp(d.minTemp)} / ${temp(d.maxTemp)}`, rain: d.rain >= 0.1 ? `${d.rain.toFixed(1)} mm` : "Dry",
        gust: windStr(d.maxGust),
      })),
      updated: hm(a.now), stale: a.stale ? hm(a.stale) : null,
    },
    palette: PALETTE, levelColors: LEVEL_COLORS,
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><style>${DETAIL_CSS}</style></head>
<body><main id="app"></main><script>(${DETAIL_PAGE.toString()})(${JSON.stringify(view).replace(/</g, "\\u003c")});</script></body></html>`;
}

const DETAIL_CSS = `
:root{--bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--sub:#6e6e73;--sep:rgba(60,60,67,.13);--fill:rgba(118,118,128,.12)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--sub:#98989f;--sep:rgba(84,84,88,.5);--fill:rgba(118,118,128,.24)}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.35 -apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 32px)}
.hero{border-radius:24px;padding:20px;color:#fff;position:relative}
.hero .place{font-size:12px;font-weight:800;letter-spacing:.06em;opacity:.8;text-transform:uppercase}
.hero .big{display:flex;align-items:center;gap:10px;margin-top:8px}
.hero .emoji{font-size:44px}
.hero h1{margin:0;font-size:38px;font-weight:900;letter-spacing:-.02em}
.hero .sub{font-size:20px;font-weight:700;margin-top:2px}
.hero .now{font-size:14px;opacity:.9;margin-top:12px}
.hero .why{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.22)}
.refresh{position:absolute;top:16px;right:16px;border:0;background:rgba(255,255,255,.22);color:#fff;width:34px;height:34px;border-radius:50%;font-size:17px}
.card{background:var(--card);border-radius:20px;padding:16px;margin-top:14px}
.card h2{margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--sub)}
.strip{display:flex;gap:3px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.strip::-webkit-scrollbar{display:none}
.h{flex:0 0 40px;text-align:center;font-size:12px}
.h .blk{height:46px;border-radius:8px;display:grid;place-items:center;font-size:15px;color:#fff;font-weight:800}
.h .lbl{color:var(--sub);margin-top:4px;font-weight:600}
.h .t{font-weight:700;margin-top:2px}
.h.daybreak{margin-left:10px;position:relative}
.h.daybreak::before{content:attr(data-day);position:absolute;top:-16px;left:0;font-size:10px;font-weight:800;color:var(--sub);text-transform:uppercase;white-space:nowrap}
.strip-wrap{padding-top:16px}
.legend{display:flex;gap:14px;margin-top:10px;font-size:12px;color:var(--sub)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.day{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 0;border-bottom:1px solid var(--sep)}
.day:last-child{border-bottom:0}
.day .n{font-weight:700}
.day .n span{color:var(--sub);font-weight:500;margin-left:6px;font-size:14px}
.day .w{font-weight:700;text-align:right}
.day .m{grid-column:1/-1;font-size:13px;color:var(--sub)}
.detail{font-size:13px;color:var(--sub);margin-top:10px;min-height:18px}
.foot{text-align:center;color:var(--sub);font-size:12px;margin-top:14px;opacity:.7}
`;

function DETAIL_PAGE(V) {
  const { a, labels: L, palette, levelColors } = V;
  const v = a.verdict;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const marks = ["✓", "~", "✕"];
  const hero = `<section class="hero" style="background:linear-gradient(150deg,${palette[v.status][0]},${palette[v.status][1]})">
    <button class="refresh" onclick="location.href='skate://refresh'" aria-label="Refresh">↻</button>
    <div class="place">Skate check${a.place ? " · " + esc(a.place) : ""}</div>
    <div class="big"><span class="emoji">${v.emoji}</span><h1>${esc(v.title)}</h1></div>
    <div class="sub">${esc(L.sub)}</div>
    <div class="now">${esc(L.now)}${L.dryBy ? "<br>" + esc(L.dryBy) : ""}</div>
    ${a.cur.why.length ? `<div class="why">${a.cur.why.map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</div>` : ""}
  </section>`;

  const strip = L.slots.map((s, i) => `<div class="h ${s.newDay && i ? "daybreak" : ""}" data-day="${esc(s.day)}" data-i="${i}">
      <div class="blk" style="background:${levelColors[s.level]};opacity:${s.isDay ? 1 : 0.7}">${s.rain >= 0.1 ? "💧" : marks[s.level]}</div>
      <div class="lbl">${i ? esc(s.hour) : "Now"}</div><div class="t">${esc(s.temp)}</div></div>`).join("");

  const days = L.days.map((d) => `<div class="day"><div class="n">${esc(d.name)}<span>${esc(d.date)}</span></div>
      <div class="w" style="color:${d.window ? levelColors[d.level] : "var(--sub)"}">${d.window ? (d.level === 0 ? "✅ " : "🤔 ") + esc(d.window) : "❌ No window"}</div>
      <div class="m">${esc(d.temps)} · ${esc(d.rain)} · gusts ${esc(d.gust)}${d.window && d.level === 0 ? ` · ${d.hours}h dry` : ""}</div></div>`).join("");

  document.getElementById("app").innerHTML = hero +
    `<section class="card"><h2>Next 48 hours</h2><div class="strip-wrap"><div class="strip">${strip}</div></div>
      <div class="legend"><span><i style="background:${levelColors[0]}"></i>Go</span><span><i style="background:${levelColors[1]}"></i>Maybe</span><span><i style="background:${levelColors[2]}"></i>No</span><span>💧 rain</span></div>
      <div class="detail" id="detail">Tap an hour to see why.</div></section>` +
    `<section class="card"><h2>Best windows</h2>${days}</section>` +
    `<div class="foot">Updated ${esc(L.updated)}${L.stale ? ` · offline, forecast from ${esc(L.stale)}` : ""} · Weather by Open-Meteo</div>`;

  document.querySelectorAll(".h").forEach((el) => el.addEventListener("click", () => {
    const s = L.slots[Number(el.dataset.i)];
    const verdictText = ["Good to go", "Maybe", "No"][s.level];
    document.getElementById("detail").textContent =
      `${s.day} ${s.hour}: ${verdictText} — ${s.why.length ? s.why.join(", ") : "dry and calm"} · ${s.temp}, gusts ${s.wind}, rain ${s.pop}%`;
  }));
}

// ──────────────────────────────────────────────────────────────── main ──

async function main() {
  const fc = await getForecast(false);
  const a = analyse(fc);
  try {
    await scheduleHeadsUp(a);
  } catch (e) {
    console.warn(`Notification not scheduled: ${e}`);
  }
  if (config.runsInWidget || config.runsInAccessoryWidget) {
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
    w.addText("🛹 Skate Check").font = Font.boldSystemFont(14);
    const t = w.addText(String(e.message || e));
    t.font = Font.systemFont(11);
    t.textColor = Color.gray();
    Script.setWidget(w);
  } else if (config.runsInApp) {
    const al = new Alert();
    al.title = "Skate Check error";
    al.message = String(e.message || e);
    al.addAction("OK");
    await al.presentAlert();
  }
}
Script.complete();
