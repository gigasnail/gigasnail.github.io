// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: heartbeat;

/*
 * Dashboard — a personal iPhone dashboard for Scriptable.
 *
 *   Run it in Scriptable      → full-screen dashboard
 *   Add it as a widget        → home-screen / lock-screen overview
 *   Run it from a Shortcut    → saves Apple Health weight data (see README)
 *
 * Shows: weather, calendar, reminders, weight-loss progress, last Strava workout.
 * Everything stays on your phone. Strava login is kept in the iOS Keychain.
 *
 * Name, goal weight and Strava can be changed from the ⚙︎ button in the
 * dashboard, so you shouldn't need to edit this file. The options below are
 * optional extras.
 */

const CONFIG = {
  // Fixed location instead of GPS, e.g. { latitude: 55.676, longitude: 12.568, name: "Copenhagen" }
  location: null,
  // Only show these calendars / reminder lists (by name). Empty = all of them.
  calendars: [],
  reminderLists: [],
  calendarDays: 7,
  maxEvents: 14,
  maxReminders: 12,
  // Order of cards in the full dashboard.
  sections: ["weather", "calendar", "reminders", "weight", "workout"],
  // Default range of the weight chart in days (30, 90, 365 or 0 for all).
  chartDays: 90,
};

// ───────────────────────────────────────────────────────────── storage ──

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "dashboard-data");
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

const DEFAULT_SETTINGS = {
  name: "",
  weightUnit: "kg",
  goalWeight: null,
  startWeight: null, // null = first weight found in Health data
  units: "metric", // "metric" or "imperial"
  setupDone: false,
};
const settings = Object.assign({}, DEFAULT_SETTINGS, readJSON("settings.json", {}));
const saveSettings = () => writeJSON("settings.json", settings);

const STRAVA_KEY = "dashboard.strava";
function stravaCreds() {
  try {
    return Keychain.contains(STRAVA_KEY) ? JSON.parse(Keychain.get(STRAVA_KEY)) : null;
  } catch (e) {
    return null;
  }
}
const saveStravaCreds = (c) => Keychain.set(STRAVA_KEY, JSON.stringify(c));

// ─────────────────────────────────────────────────────── shared helpers ──
// Used by both the widget (here) and the dashboard page (injected into the
// web view as source), so keep this function self-contained.

function SHARED() {
  const WX = {
    0: ["Clear", "☀️", "🌙", "sun.max.fill", "moon.stars.fill"],
    1: ["Mostly clear", "🌤️", "🌙", "sun.max.fill", "moon.fill"],
    2: ["Partly cloudy", "⛅️", "☁️", "cloud.sun.fill", "cloud.moon.fill"],
    3: ["Overcast", "☁️", "☁️", "cloud.fill", "cloud.fill"],
    45: ["Fog", "🌫️", "🌫️", "cloud.fog.fill", "cloud.fog.fill"],
    48: ["Freezing fog", "🌫️", "🌫️", "cloud.fog.fill", "cloud.fog.fill"],
    51: ["Light drizzle", "🌦️", "🌧️", "cloud.drizzle.fill", "cloud.drizzle.fill"],
    53: ["Drizzle", "🌦️", "🌧️", "cloud.drizzle.fill", "cloud.drizzle.fill"],
    55: ["Heavy drizzle", "🌧️", "🌧️", "cloud.drizzle.fill", "cloud.drizzle.fill"],
    56: ["Freezing drizzle", "🌧️", "🌧️", "cloud.sleet.fill", "cloud.sleet.fill"],
    57: ["Freezing drizzle", "🌧️", "🌧️", "cloud.sleet.fill", "cloud.sleet.fill"],
    61: ["Light rain", "🌦️", "🌧️", "cloud.rain.fill", "cloud.moon.rain.fill"],
    63: ["Rain", "🌧️", "🌧️", "cloud.rain.fill", "cloud.rain.fill"],
    65: ["Heavy rain", "🌧️", "🌧️", "cloud.heavyrain.fill", "cloud.heavyrain.fill"],
    66: ["Freezing rain", "🌧️", "🌧️", "cloud.sleet.fill", "cloud.sleet.fill"],
    67: ["Freezing rain", "🌧️", "🌧️", "cloud.sleet.fill", "cloud.sleet.fill"],
    71: ["Light snow", "🌨️", "🌨️", "cloud.snow.fill", "cloud.snow.fill"],
    73: ["Snow", "🌨️", "🌨️", "cloud.snow.fill", "cloud.snow.fill"],
    75: ["Heavy snow", "❄️", "❄️", "snowflake", "snowflake"],
    77: ["Snow grains", "🌨️", "🌨️", "cloud.snow.fill", "cloud.snow.fill"],
    80: ["Light showers", "🌦️", "🌧️", "cloud.sun.rain.fill", "cloud.moon.rain.fill"],
    81: ["Showers", "🌧️", "🌧️", "cloud.rain.fill", "cloud.rain.fill"],
    82: ["Heavy showers", "🌧️", "🌧️", "cloud.heavyrain.fill", "cloud.heavyrain.fill"],
    85: ["Snow showers", "🌨️", "🌨️", "cloud.snow.fill", "cloud.snow.fill"],
    86: ["Heavy snow showers", "❄️", "❄️", "cloud.snow.fill", "cloud.snow.fill"],
    95: ["Thunderstorm", "⛈️", "⛈️", "cloud.bolt.rain.fill", "cloud.bolt.rain.fill"],
    96: ["Thunderstorm, hail", "⛈️", "⛈️", "cloud.bolt.rain.fill", "cloud.bolt.rain.fill"],
    99: ["Thunderstorm, hail", "⛈️", "⛈️", "cloud.bolt.rain.fill", "cloud.bolt.rain.fill"],
  };
  function wx(code, isDay = true) {
    const w = WX[code] || ["—", "🌡️", "🌡️", "thermometer.medium", "thermometer.medium"];
    return { label: w[0], emoji: isDay ? w[1] : w[2], symbol: isDay ? w[3] : w[4] };
  }

  // kind: how to show speed — "pace" (run/walk), "speed" (ride/ski), "swim", or null
  const SPORTS = [
    [/Run$/, "🏃", "figure.run", "pace"],
    [/Ride$/, "🚴", "bicycle", "speed"],
    [/Swim/, "🏊", "figure.pool.swim", "swim"],
    [/^Walk$/, "🚶", "figure.walk", "pace"],
    [/^Hike$/, "🥾", "figure.hiking", "pace"],
    [/WeightTraining|Crossfit/, "🏋️", "dumbbell.fill", null],
    [/Yoga|Pilates/, "🧘", "figure.yoga", null],
    [/Rowing|Kayak|Canoe/, "🚣", "figure.rower", "speed"],
    [/Ski|Snowboard/, "⛷️", "figure.skiing.downhill", "speed"],
    [/Elliptical|StairStepper/, "🏃", "figure.elliptical", null],
    [/Soccer|Football/, "⚽️", "soccerball", null],
    [/Tennis|Squash|Badminton|Padel|Pickleball/, "🎾", "tennis.racket", null],
    [/Climb/, "🧗", "figure.climbing", null],
  ];
  function sport(type) {
    const s = SPORTS.find(([re]) => re.test(type || ""));
    const label = (type || "Workout").replace(/([a-z])([A-Z])/g, "$1 $2");
    return s ? { emoji: s[1], symbol: s[2], kind: s[3], label } : { emoji: "💪", symbol: "figure.mixed.cardio", kind: null, label };
  }

  const pad = (n) => String(n).padStart(2, "0");
  const DAY = 86400000;

  function dist(m, units) {
    if (m == null) return "—";
    if (units === "imperial") {
      const mi = m / 1609.344;
      return mi >= 0.1 ? `${mi.toFixed(mi < 10 ? 2 : 1)} mi` : `${Math.round(m * 3.28084)} ft`;
    }
    return m >= 1000 ? `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km` : `${Math.round(m)} m`;
  }
  function elev(m, units) {
    return units === "imperial" ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
  }
  // 1:02:33 / 42:10
  function dur(s) {
    s = Math.round(s || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  // 2h 05m / 42m
  function durShort(s) {
    const h = Math.floor((s || 0) / 3600), m = Math.round(((s || 0) % 3600) / 60);
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
  }
  function speed(mps, kind, units) {
    if (!mps || !kind) return null;
    const imp = units === "imperial";
    const mmss = (sec) => { sec = Math.round(sec); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
    if (kind === "pace") return { value: mmss((imp ? 1609.344 : 1000) / mps), unit: imp ? "/mi" : "/km", label: "Pace" };
    if (kind === "swim") return { value: mmss((imp ? 91.44 : 100) / mps), unit: imp ? "/100yd" : "/100m", label: "Pace" };
    return { value: (mps * (imp ? 2.23694 : 3.6)).toFixed(1), unit: imp ? "mph" : "km/h", label: "Speed" };
  }

  function weight(v, unit, digits = 1) {
    return v == null || isNaN(v) ? "—" : `${Number(v).toFixed(digits)} ${unit}`;
  }
  function signed(v, digits = 1) {
    if (v == null || isNaN(v)) return "—";
    const r = Number(v).toFixed(digits);
    return v > 0 ? `+${r}` : Number(r) === 0 ? r.replace("-", "") : r.replace("-", "−");
  }

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  function relDay(d, now = Date.now()) {
    const diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff > 1 && diff < 7) return new Date(d).toLocaleDateString(undefined, { weekday: "long" });
    return new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }
  const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  function ago(d, now = Date.now()) {
    const mins = Math.round((now - new Date(d)) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)} min ago`;
    if (mins < 60 * 18) return `${Math.round(mins / 60)}h ago`;
    const rd = relDay(d, now);
    return rd === "Yesterday" ? rd : `${Math.round((startOfDay(now) - startOfDay(d)) / DAY)} days ago`;
  }
  function greeting(now = new Date()) {
    const h = new Date(now).getHours();
    return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  // entries: [{ d: "YYYY-MM-DD", v: number, t: ms }] sorted oldest first
  function weightStats(entries, s) {
    if (!entries || !entries.length) return null;
    const latest = entries[entries.length - 1];
    const start = s.startWeight != null ? { v: Number(s.startWeight), t: entries[0].t } : entries[0];
    const goal = s.goalWeight != null ? Number(s.goalWeight) : null;
    const change = latest.v - start.v;
    const dir = goal != null && goal > start.v ? 1 : -1; // -1 = losing weight
    let progress = null, remaining = null, reached = false;
    if (goal != null && goal !== start.v) {
      progress = Math.max(0, Math.min(1, (latest.v - start.v) / (goal - start.v)));
      remaining = (goal - latest.v) * dir; // > 0 means still to go
      reached = remaining <= 0;
    }
    // Trend: least-squares slope over the last 28 days of entries.
    const recent = entries.filter((e) => e.t >= latest.t - 28 * DAY);
    let perWeek = null;
    if (recent.length >= 3 && latest.t - recent[0].t >= 5 * DAY) {
      const xs = recent.map((e) => (e.t - recent[0].t) / DAY), ys = recent.map((e) => e.v);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, den = 0;
      xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
      perWeek = den ? (num / den) * 7 : null;
    }
    let eta = null;
    if (remaining > 0 && perWeek && perWeek * dir > 0.01) {
      const days = remaining / (Math.abs(perWeek) / 7);
      if (days < 3 * 365) eta = latest.t + days * DAY;
    }
    const weekAgo = [...entries].reverse().find((e) => e.t <= latest.t - 6.5 * DAY);
    return {
      latest, start, goal, change, dir, progress, remaining, reached, perWeek, eta,
      weekChange: weekAgo ? latest.v - weekAgo.v : null,
      good: change * dir > 0, // moving toward the goal
    };
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  return { wx, sport, dist, elev, dur, durShort, speed, weight, signed, startOfDay, dayKey, relDay, time, ago, greeting, weightStats, esc, DAY };
}

const H = SHARED();

// ──────────────────────────────────────────────────────────────── utils ──

function withTimeout(promise, ms, what = "Request") {
  return new Promise((resolve, reject) => {
    const timer = Timer.schedule(ms, false, () => reject(new Error(`${what} timed out`)));
    promise.then(
      (v) => { timer.invalidate(); resolve(v); },
      (e) => { timer.invalidate(); reject(e); }
    );
  });
}

// Returns cached data when fresh; otherwise fetches and caches. Falls back to
// stale cache if the fetch fails (no signal, etc).
async function cached(name, ttlMinutes, force, fetcher) {
  const c = readJSON(name, null);
  if (!force && c && Date.now() - c.at < ttlMinutes * 60000) return c.data;
  try {
    const data = await fetcher();
    writeJSON(name, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (c) {
      console.warn(`${name}: using cached copy (${e.message || e})`);
      return Object.assign({}, c.data, { stale: c.at });
    }
    throw e;
  }
}

const scriptURL = () => `scriptable:///run/${encodeURIComponent(Script.name())}`;

// ────────────────────────────────────────────────────────────── weather ──

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

async function getWeather(force, widget) {
  return cached("weather.json", widget ? 25 : 10, force, async () => {
    const loc = await getLocation();
    const imp = settings.units === "imperial";
    const url = "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${loc.latitude.toFixed(3)}&longitude=${loc.longitude.toFixed(3)}` +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day,precipitation" +
      "&hourly=temperature_2m,weather_code,precipitation_probability,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      `&timezone=auto&timeformat=unixtime&forecast_days=7&wind_speed_unit=${imp ? "mph" : "ms"}` +
      `&temperature_unit=${imp ? "fahrenheit" : "celsius"}`;
    const j = await new Request(url).loadJSON();
    if (!j.current) throw new Error(j.reason || "Weather service error");
    const now = Date.now() / 1000;
    const hourly = [];
    j.hourly.time.forEach((t, i) => {
      if (t >= now - 3600 && hourly.length < 24) {
        hourly.push({
          t: t * 1000, temp: j.hourly.temperature_2m[i], code: j.hourly.weather_code[i],
          pop: j.hourly.precipitation_probability[i], isDay: !!j.hourly.is_day[i],
        });
      }
    });
    return {
      place: loc.name,
      wind: imp ? "mph" : "m/s",
      current: {
        temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code,
        wind: j.current.wind_speed_10m, humidity: j.current.relative_humidity_2m, isDay: !!j.current.is_day,
      },
      hourly,
      daily: j.daily.time.map((t, i) => ({
        t: t * 1000, code: j.daily.weather_code[i], max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i],
        pop: j.daily.precipitation_probability_max[i], sunrise: j.daily.sunrise[i] * 1000, sunset: j.daily.sunset[i] * 1000,
      })),
      fetchedAt: Date.now(),
    };
  });
}

// ─────────────────────────────────────────────────── calendar/reminders ──

async function getEvents() {
  let cals = [];
  if (CONFIG.calendars.length) {
    cals = (await Calendar.forEvents()).filter((c) => CONFIG.calendars.includes(c.title));
  }
  const start = H.startOfDay(new Date());
  const end = new Date(start.getTime() + CONFIG.calendarDays * H.DAY);
  const events = await CalendarEvent.between(start, end, cals);
  return events
    .map((e) => ({
      id: e.identifier,
      title: e.title || "(No title)",
      start: e.startDate.getTime(),
      end: e.endDate.getTime(),
      allDay: e.isAllDay,
      location: e.location || "",
      cal: e.calendar ? e.calendar.title : "",
      color: e.calendar && e.calendar.color ? `#${e.calendar.color.hex}` : "#8e8e93",
    }))
    .filter((e) => e.end > start.getTime())
    .sort((a, b) => a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0))
    .slice(0, CONFIG.maxEvents);
}

const REMINDERS = new Map(); // identifier → Reminder, so the dashboard can tick them off

async function getReminders() {
  let all = await Reminder.allIncomplete();
  if (CONFIG.reminderLists.length) all = all.filter((r) => r.calendar && CONFIG.reminderLists.includes(r.calendar.title));
  const far = 8640000000000000;
  all.sort((a, b) =>
    (a.dueDate ? a.dueDate.getTime() : far) - (b.dueDate ? b.dueDate.getTime() : far) ||
    (b.priority || 0) - (a.priority || 0)
  );
  REMINDERS.clear();
  all.forEach((r) => REMINDERS.set(r.identifier, r));
  const startToday = H.startOfDay(new Date()).getTime();
  return {
    total: all.length,
    items: all.slice(0, CONFIG.maxReminders).map((r) => {
      const due = r.dueDate ? r.dueDate.getTime() : null;
      return {
        id: r.identifier,
        title: r.title || "(No title)",
        due,
        dueHasTime: !!r.dueDateIncludesTime,
        overdue: due != null && (r.dueDateIncludesTime ? due < Date.now() : due < startToday),
        list: r.calendar ? r.calendar.title : "",
        color: r.calendar && r.calendar.color ? `#${r.calendar.color.hex}` : "#007aff",
        flagged: (r.priority || 0) > 0 && r.priority <= 4,
      };
    }),
  };
}

// ──────────────────────────────────────────────────────────── weight ──

function loadWeight() {
  const map = readJSON("health.json", {}).weight || {};
  return Object.keys(map).sort().map((d) => ({ d, v: map[d].v, t: map[d].t }));
}

// Called from the Shortcut. Expects lines like:  weight;2026-10-23T07:12:00+02:00;82.4
function ingestFromShortcut(param) {
  const text = Array.isArray(param) ? param.join("\n") : typeof param === "string" ? param : JSON.stringify(param);
  const health = readJSON("health.json", {});
  health.weight = health.weight || {};
  let saved = 0, bad = 0, latest = null;
  for (const raw of text.split(/\r?\n|\|\|/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(";").map((s) => s.trim());
    const kind = parts.length >= 3 ? parts.shift().toLowerCase() : "weight";
    if (kind !== "weight") continue;
    const date = new Date(parts[0].replace(" ", "T"));
    const value = parseFloat(String(parts[1]).replace(",", ".").replace(/[^0-9.\-]/g, ""));
    if (isNaN(date.getTime()) || isNaN(value)) { bad++; continue; }
    const key = H.dayKey(date), t = date.getTime();
    const prev = health.weight[key];
    if (!prev || t >= prev.t) health.weight[key] = { v: Math.round(value * 100) / 100, t };
    saved++;
    if (!latest || t > latest.t) latest = { v: value, t };
  }
  health.updated = Date.now();
  writeJSON("health.json", health);
  let msg = saved
    ? `Dashboard saved ${saved} weight ${saved === 1 ? "entry" : "entries"}. Latest: ${H.weight(latest.v, settings.weightUnit)}.`
    : "Dashboard didn't find any weight entries.";
  if (bad) msg += ` ${bad} line(s) couldn't be read — make sure the date is formatted as ISO 8601 in the Text action.`;
  console.log(msg);
  Script.setShortcutOutput(msg);
}

// ──────────────────────────────────────────────────────────── strava ──

async function stravaTokenRequest(params) {
  const r = new Request("https://www.strava.com/oauth/token");
  r.method = "POST";
  r.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  r.body = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const j = await r.loadJSON();
  if (!j.access_token) throw new Error(`Strava: ${j.message || "sign-in failed"}`);
  return j;
}

async function stravaAccessToken() {
  const c = stravaCreds();
  if (!c || !c.refreshToken) return null;
  if (c.expiresAt * 1000 - 120000 > Date.now()) return c.accessToken;
  const j = await stravaTokenRequest({
    client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token", refresh_token: c.refreshToken,
  });
  Object.assign(c, { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at });
  saveStravaCreds(c);
  return c.accessToken;
}

async function getStrava(force, widget) {
  if (!stravaCreds()) return { connected: false };
  return cached("strava.json", widget ? 20 : 5, force, async () => {
    const token = await stravaAccessToken();
    const r = new Request("https://www.strava.com/api/v3/athlete/activities?per_page=30");
    r.headers = { Authorization: `Bearer ${token}` };
    const list = await r.loadJSON();
    if (r.response.statusCode === 401) throw new Error("Strava access expired — reconnect Strava in ⚙︎ Settings.");
    if (!Array.isArray(list)) throw new Error(`Strava: ${list.message || "unexpected response"}`);
    const acts = list.map((a) => ({
      id: a.id, name: a.name, type: a.sport_type || a.type, start: new Date(a.start_date).getTime(),
      distance: a.distance, moving: a.moving_time, elapsed: a.elapsed_time, elev: a.total_elevation_gain,
      avgSpeed: a.average_speed, avgHr: a.average_heartrate || null, maxHr: a.max_heartrate || null,
      watts: a.average_watts || null, kj: a.kilojoules || null, kudos: a.kudos_count || 0,
      polyline: a.map ? a.map.summary_polyline : null,
    }));
    // This week = since Monday 00:00
    const monday = H.startOfDay(new Date());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const week = acts.filter((a) => a.start >= monday.getTime());
    return {
      connected: true,
      athlete: (stravaCreds() || {}).athlete || null,
      activities: acts.slice(0, 6),
      week: {
        count: week.length,
        distance: week.reduce((s, a) => s + (a.distance || 0), 0),
        time: week.reduce((s, a) => s + (a.moving || 0), 0),
      },
      fetchedAt: Date.now(),
    };
  });
}

function extractStravaCode(text) {
  const t = String(text || "").trim();
  const m = t.match(/[?&]code=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return /^[a-f0-9]{20,}$/i.test(t) ? t : null;
}

async function stravaSignInWebView(authURL) {
  let code = null;
  const wv = new WebView();
  wv.shouldAllowRequest = (req) => {
    const url = req.url || "";
    if (url.startsWith("http://localhost")) {
      code = extractStravaCode(url);
      wv.loadHTML(messageHTML(code ? "✅ Strava connected" : "Strava wasn't connected", code
        ? "Tap <b>Close</b> to finish."
        : "Access was denied. Tap Close and try again."));
      return false;
    }
    return true;
  };
  await wv.loadURL(authURL);
  await wv.present(false);
  return code;
}

async function stravaSignInSafari(authURL) {
  await Safari.openInApp(authURL, true);
  const a = new Alert();
  a.title = "Paste the link";
  a.message = "After you tap Authorize, Safari shows a “can't connect to localhost” page — that's expected.\n\nTap the share button on that page → Copy, then paste it here.";
  const clip = Pasteboard.pasteString() || "";
  a.addTextField("http://localhost/…?code=…", clip.includes("code=") ? clip : "");
  a.addAction("Connect");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return null;
  return extractStravaCode(a.textFieldValue(0));
}

async function stravaSetup() {
  const existing = stravaCreds() || {};
  const a = new Alert();
  a.title = existing.refreshToken ? "Strava is connected" : "Connect Strava";
  a.message =
    "1. Tap “Open Strava API page”, sign in and create an app (any name; website can be http://localhost).\n" +
    "2. Set “Authorization Callback Domain” to:  localhost\n" +
    "3. Copy the Client ID and Client Secret into the fields below.";
  a.addTextField("Client ID", existing.clientId || "").setNumberPadKeyboard();
  a.addTextField("Client Secret", existing.clientSecret || "");
  a.addAction("Continue");
  a.addAction("Open Strava API page");
  if (existing.refreshToken) a.addDestructiveAction("Disconnect Strava");
  a.addCancelAction("Cancel");
  const choice = await a.presentAlert();
  if (choice === -1) return false;
  if (choice === 1) {
    await Safari.openInApp("https://www.strava.com/settings/api", false);
    return stravaSetup();
  }
  if (choice === 2) {
    Keychain.remove(STRAVA_KEY);
    if (fm.fileExists(filePath("strava.json"))) fm.remove(filePath("strava.json"));
    return true;
  }
  const clientId = a.textFieldValue(0).trim(), clientSecret = a.textFieldValue(1).trim();
  if (!clientId || !clientSecret) {
    await notify("Missing details", "Both the Client ID and Client Secret are needed.");
    return stravaSetup();
  }
  const authURL = "https://www.strava.com/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}&response_type=code&approval_prompt=auto` +
    `&redirect_uri=${encodeURIComponent("http://localhost/exchange_token")}&scope=read,activity:read_all`;

  const how = new Alert();
  how.title = "Sign in to Strava";
  how.message = "If you sign in to Strava with Google or Apple, choose Safari.";
  how.addAction("Sign in here");
  how.addAction("Sign in with Safari");
  how.addCancelAction("Cancel");
  const h = await how.presentAlert();
  if (h === -1) return false;
  const code = h === 0 ? await stravaSignInWebView(authURL) : await stravaSignInSafari(authURL);
  if (!code) {
    await notify("Strava not connected", "No authorization code was received. You can try again from ⚙︎ Settings.");
    return false;
  }
  try {
    const j = await stravaTokenRequest({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" });
    saveStravaCreds({
      clientId, clientSecret, accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at,
      athlete: j.athlete ? { name: j.athlete.firstname } : null,
    });
    if (fm.fileExists(filePath("strava.json"))) fm.remove(filePath("strava.json"));
    await notify("Strava connected", j.athlete ? `Hi ${j.athlete.firstname}! Your workouts will show up on the dashboard.` : "");
    return true;
  } catch (e) {
    await notify("Strava error", String(e.message || e));
    return false;
  }
}

// ──────────────────────────────────────────────────── settings & setup ──

async function notify(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message || "";
  a.addAction("OK");
  await a.presentAlert();
}

const parseNum = (s) => {
  const n = parseFloat(String(s || "").replace(",", "."));
  return isNaN(n) ? null : n;
};

async function editProfile() {
  const a = new Alert();
  a.title = "You";
  a.message = `Weights are in ${settings.weightUnit}. Leave “Starting weight” empty to use your first weight in Apple Health.`;
  a.addTextField("Your first name", settings.name || "");
  a.addTextField(`Goal weight (${settings.weightUnit})`, settings.goalWeight != null ? String(settings.goalWeight) : "").setDecimalPadKeyboard();
  a.addTextField(`Starting weight (${settings.weightUnit})`, settings.startWeight != null ? String(settings.startWeight) : "").setDecimalPadKeyboard();
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return false;
  settings.name = a.textFieldValue(0).trim();
  settings.goalWeight = parseNum(a.textFieldValue(1));
  settings.startWeight = parseNum(a.textFieldValue(2));
  saveSettings();
  return true;
}

async function chooseUnits() {
  const a = new Alert();
  a.title = "Units";
  a.addAction("Metric · kg, km, °C");
  a.addAction("Imperial · lb, mi, °F");
  a.addAction("Metric, but weight in lb");
  a.addCancelAction("Cancel");
  const i = await a.presentAlert();
  if (i === -1) return false;
  settings.units = i === 1 ? "imperial" : "metric";
  settings.weightUnit = i === 0 ? "kg" : "lb";
  saveSettings();
  if (fm.fileExists(filePath("weather.json"))) fm.remove(filePath("weather.json"));
  return true;
}

async function firstRunSetup() {
  if (settings.setupDone) return;
  await notify("Welcome to your dashboard 👋", "A few quick questions and you're set. You can change these any time with the ⚙︎ button.");
  await chooseUnits();
  await editProfile();
  const a = new Alert();
  a.title = "Connect Strava?";
  a.message = "Shows your latest workout and weekly totals. Takes about 3 minutes.";
  a.addAction("Connect now");
  a.addCancelAction("Later");
  if ((await a.presentAlert()) === 0) await stravaSetup();
  settings.setupDone = true;
  saveSettings();
}

async function settingsMenu() {
  const a = new Alert();
  a.title = "Settings";
  const goal = settings.goalWeight != null ? H.weight(settings.goalWeight, settings.weightUnit) : "not set";
  a.addAction(`Name & goal weight (goal: ${goal})`);
  a.addAction(`Units (${settings.units}, ${settings.weightUnit})`);
  a.addAction(stravaCreds() ? "Strava: connected" : "Connect Strava");
  a.addAction("Preview widgets");
  a.addCancelAction("Done");
  const i = await a.presentAlert();
  if (i === 0) await editProfile();
  if (i === 1) await chooseUnits();
  if (i === 2) await stravaSetup();
  if (i === 3) await previewWidgets();
  return i !== -1;
}

async function previewWidgets() {
  const a = new Alert();
  a.title = "Preview widget";
  ["Small", "Small · weight", "Small · workout", "Small · agenda", "Medium", "Large"].forEach((s) => a.addAction(s));
  a.addCancelAction("Cancel");
  const i = await a.presentAlert();
  if (i === -1) return;
  const data = await loadAll({ widget: true });
  const fam = i < 4 ? "small" : i === 4 ? "medium" : "large";
  const w = buildWidget(data, fam, ["weather", "weight", "workout", "agenda"][i] || "");
  if (fam === "small") await w.presentSmall();
  else if (fam === "medium") await w.presentMedium();
  else await w.presentLarge();
}

// ───────────────────────────────────────────────────────── load data ──

async function loadAll({ force = false, widget = false } = {}) {
  const errors = {};
  const safe = async (key, fn) => {
    try {
      return await fn();
    } catch (e) {
      errors[key] = String((e && e.message) || e);
      console.error(`${key}: ${errors[key]}`);
      return null;
    }
  };
  const [weather, events, reminders, strava] = await Promise.all([
    safe("weather", () => getWeather(force, widget)),
    safe("calendar", getEvents),
    safe("reminders", getReminders),
    safe("workout", () => getStrava(force, widget)),
  ]);
  const health = readJSON("health.json", {});
  return {
    now: Date.now(),
    settings: { name: settings.name, weightUnit: settings.weightUnit, goalWeight: settings.goalWeight, startWeight: settings.startWeight, units: settings.units },
    config: { sections: CONFIG.sections, chartDays: CONFIG.chartDays },
    weather, events, reminders, strava,
    weight: safeWeight(errors),
    healthUpdated: health.updated || null,
    errors,
  };
}

function safeWeight(errors) {
  try {
    return loadWeight();
  } catch (e) {
    errors.weight = String(e.message || e);
    return [];
  }
}

// ───────────────────────────────────────────────────────── dashboard ──

async function showDashboard() {
  const data = await loadAll();
  const wv = new WebView();
  const render = async (d) => wv.loadHTML(dashboardHTML(d));

  async function handle(action) {
    const [cmd, ...rest] = action.split("/");
    const arg = decodeURIComponent(rest.join("/"));
    switch (cmd) {
      case "complete":
      case "undo": {
        const r = REMINDERS.get(arg);
        if (r) { r.isCompleted = cmd === "complete"; r.save(); }
        break;
      }
      case "open": Safari.open(arg); break;
      case "calendar": Safari.open(`calshow:${Math.round(Number(arg) / 1000 - 978307200)}`); break;
      case "reminders": Safari.open("x-apple-reminderkit://"); break;
      case "health": Safari.open("x-apple-health://"); break;
      case "refresh": await render(await loadAll({ force: true })); break;
      case "settings": if (await settingsMenu()) await render(await loadAll({ force: true })); break;
      case "strava": if (await stravaSetup()) await render(await loadAll({ force: true })); break;
      case "profile": if (await editProfile()) await render(await loadAll()); break;
    }
  }

  wv.shouldAllowRequest = (req) => {
    const url = (req && req.url) || "";
    if (url.startsWith("dash://")) {
      handle(url.slice(7)).catch((e) => console.error(e));
      return false;
    }
    if (/^https?:/.test(url)) { // never navigate the dashboard itself away
      Safari.open(url);
      return false;
    }
    return true;
  };

  await render(data);
  await wv.present(true);
}

function messageHTML(title, body) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:17px -apple-system,system-ui;display:grid;place-items:center;height:90vh;margin:0;text-align:center;color:#111;background:#f2f2f7}
@media(prefers-color-scheme:dark){body{color:#f5f5f7;background:#000}}h1{font-size:24px}</style>
<div><h1>${title}</h1><p>${body}</p></div>`;
}

function dashboardHTML(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<style>${DASHBOARD_CSS}</style></head>
<body><main id="app"></main>
<div id="toast" class="toast"></div>
<script>
window.DATA = ${json};
(${PAGE.toString()})(window.DATA, (${SHARED.toString()})());
</script></body></html>`;
}

const DASHBOARD_CSS = `
:root{
  --bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--sub:#6e6e73;--faint:#aeaeb2;--sep:rgba(60,60,67,.13);--fill:rgba(118,118,128,.12);
  --red:#ff3b30;--orange:#ff9500;--green:#34c759;--blue:#007aff;--purple:#af52de;--teal:#30b0c7;--strava:#fc4c02;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#000;--card:#1c1c1e;--text:#f5f5f7;--sub:#98989f;--faint:#636366;--sep:rgba(84,84,88,.5);--fill:rgba(118,118,128,.24);
  --red:#ff453a;--orange:#ff9f0a;--green:#30d158;--blue:#0a84ff;--purple:#bf5af2;--teal:#40c8e0;
}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 32px)}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.num{font-variant-numeric:tabular-nums}
header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:4px 4px 16px}
header.top .date{color:var(--sub);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
header.top h1{margin:2px 0 0;font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.02em}
.iconbtn{width:36px;height:36px;border-radius:50%;background:var(--card);display:grid;place-items:center;color:var(--blue)}
.iconbtn svg{width:19px;height:19px}
.actions{display:flex;gap:8px;flex-shrink:0}
.card{background:var(--card);border-radius:20px;padding:16px;margin-bottom:14px;overflow:hidden}
.card h2{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--sub)}
.card h2 .dot{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:13px;color:#fff}
.card h2 .more{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:600;color:var(--blue);font-size:14px}
.note{color:var(--sub);font-size:14px}
.err{margin-top:10px;font-size:12px;color:var(--orange)}
.empty{color:var(--sub);font-size:15px;padding:6px 0}
.cta{display:inline-block;margin-top:10px;padding:9px 14px;border-radius:12px;background:var(--fill);color:var(--blue);font-weight:600;font-size:15px}

/* weather */
.weather{color:#fff;background:linear-gradient(160deg,#4a90e2,#2a6fc9)}
.weather.night{background:linear-gradient(160deg,#1d2b53,#0b1430)}
.weather.cloudy{background:linear-gradient(160deg,#7d8ea3,#56677d)}
.weather.rain{background:linear-gradient(160deg,#5b6f86,#34465c)}
.weather.storm{background:linear-gradient(160deg,#4a4e69,#22223b)}
.weather.snow{background:linear-gradient(160deg,#9fb6cd,#6f8aa6)}
.weather h2{color:rgba(255,255,255,.8)}
.wx-now{display:flex;align-items:center;gap:14px}
.wx-emoji{font-size:54px;line-height:1}
.wx-temp{font-size:56px;font-weight:300;line-height:1;letter-spacing:-.03em}
.wx-cond{font-size:15px;font-weight:600;margin-top:4px}
.wx-meta{margin-left:auto;text-align:right;font-size:13px;opacity:.85;line-height:1.5}
.hourly{display:flex;gap:4px;overflow-x:auto;margin:16px -16px 0;padding:12px 16px 2px;border-top:1px solid rgba(255,255,255,.2);scrollbar-width:none}
.hourly::-webkit-scrollbar{display:none}
.hour{flex:0 0 46px;text-align:center;font-size:13px}
.hour .e{font-size:22px;margin:4px 0;height:26px}
.hour .p{font-size:11px;color:#bfe3ff;font-weight:600;height:14px}
.hour .t{font-weight:600}
.daily{margin-top:10px;border-top:1px solid rgba(255,255,255,.2);padding-top:6px}
.drow{display:grid;grid-template-columns:76px 30px 36px 34px 1fr 34px;align-items:center;gap:6px;padding:5px 0;font-size:15px}
.drow .e{font-size:20px;text-align:center}
.drow .p{font-size:11px;color:#bfe3ff;font-weight:700}
.drow .lo{opacity:.7;text-align:right}
.drow .hi{text-align:right}
.range{position:relative;height:5px;border-radius:3px;background:rgba(255,255,255,.22)}
.range i{position:absolute;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,#9fe0ff,#ffd36b,#ff9a4d)}

/* calendar */
.day{font-size:13px;font-weight:700;color:var(--sub);margin:12px 0 4px}
.day:first-of-type{margin-top:0}
.day.today{color:var(--red)}
.ev{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--sep);align-items:stretch}
.ev:last-child{border-bottom:0}
.ev .bar{width:4px;border-radius:2px;flex-shrink:0}
.ev .when{width:52px;flex-shrink:0;font-size:13px;color:var(--sub);line-height:1.3}
.ev .when b{display:block;color:var(--text);font-weight:600;font-size:14px}
.ev .what{flex:1;min-width:0}
.ev .title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev .loc{font-size:13px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev.past{opacity:.45}
.badge{display:inline-block;font-size:11px;font-weight:800;color:#fff;background:var(--red);border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:2px;letter-spacing:.02em}

/* reminders */
.rem{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--sep);transition:opacity .35s,max-height .35s .9s,padding .35s .9s;max-height:80px;overflow:hidden}
.rem:last-child{border-bottom:0}
.rem .chk{width:24px;height:24px;border-radius:50%;border:2px solid var(--faint);flex-shrink:0;display:grid;place-items:center;transition:all .2s}
.rem.done .chk{background:var(--c);border-color:var(--c)}
.rem.done .chk::after{content:"";width:7px;height:12px;border:solid #fff;border-width:0 2.5px 2.5px 0;transform:translateY(-1px) rotate(45deg)}
.rem.done .rt{text-decoration:line-through;color:var(--sub)}
.rem.gone{opacity:0;max-height:0;padding:0;border:0}
.rem .rt{font-weight:500}
.rem .rm{font-size:13px;color:var(--sub)}
.rem .rm.overdue{color:var(--red);font-weight:600}
.rem .flag{color:var(--orange);margin-left:auto}

/* weight */
.wt-top{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
.wt-big{font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1}
.wt-big small{font-size:18px;font-weight:600;color:var(--sub);margin-left:3px}
.wt-delta{font-size:15px;font-weight:700;padding:4px 10px;border-radius:10px}
.wt-delta.good{color:var(--green);background:color-mix(in srgb,var(--green) 15%,transparent)}
.wt-delta.bad{color:var(--orange);background:color-mix(in srgb,var(--orange) 15%,transparent)}
.wt-sub{color:var(--sub);font-size:13px;margin-top:6px}
.progress{margin:14px 0 4px;height:10px;border-radius:5px;background:var(--fill);overflow:hidden}
.progress i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,var(--teal),var(--green))}
.plabel{display:flex;justify-content:space-between;font-size:12px;color:var(--sub)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
.stat{background:var(--fill);border-radius:12px;padding:8px 10px}
.stat .k{font-size:11px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.stat .v{font-size:15px;font-weight:700;margin-top:2px;white-space:nowrap}
.seg{display:flex;background:var(--fill);border-radius:9px;padding:2px;margin:16px 0 8px}
.seg button{flex:1;padding:5px 0;font-size:13px;font-weight:600;border-radius:7px;color:var(--sub)}
.seg button.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.chart svg{display:block;width:100%;overflow:visible}
.chart text{font-size:10px;fill:var(--sub)}
.eta{margin-top:10px;font-size:14px;color:var(--sub)}
.eta b{color:var(--text)}

/* workout */
.wo-head{display:flex;gap:12px;align-items:center}
.wo-icon{width:46px;height:46px;border-radius:14px;background:var(--strava);display:grid;place-items:center;font-size:24px;flex-shrink:0}
.wo-name{font-size:18px;font-weight:700;line-height:1.2}
.wo-when{font-size:13px;color:var(--sub)}
.wo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 8px;margin-top:14px}
.wo-grid .k{font-size:12px;color:var(--sub)}
.wo-grid .v{font-size:22px;font-weight:700;letter-spacing:-.01em}
.wo-grid .v small{font-size:13px;color:var(--sub);font-weight:600;margin-left:2px}
.route{margin-top:14px;border-radius:14px;background:var(--fill);padding:10px}
.route svg{display:block;width:100%;height:150px}
.week{display:flex;justify-content:space-between;margin-top:14px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--strava) 10%,transparent);font-size:14px}
.week b{display:block;font-size:17px}
.recent{margin-top:10px}
.ra{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--sep);font-size:14px}
.ra:last-child{border-bottom:0}
.ra .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.ra .d{color:var(--sub);white-space:nowrap}
.foot{text-align:center;color:var(--faint);font-size:12px;margin-top:8px}

.toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 20px);transform:translate(-50%,120px);background:rgba(30,30,32,.94);color:#fff;padding:10px 12px 10px 16px;border-radius:14px;font-size:15px;display:flex;gap:14px;align-items:center;transition:transform .3s,opacity .3s;opacity:0;pointer-events:none;max-width:calc(100% - 32px);box-shadow:0 8px 30px rgba(0,0,0,.25)}
.toast.show{transform:translate(-50%,0);opacity:1;pointer-events:auto}
.toast button{color:#64d2ff;font-weight:700}
`;

// The dashboard page itself. Runs inside the web view, not in Scriptable.
function PAGE(D, H) {
  const S = D.settings, units = S.units;
  const $ = (sel) => document.querySelector(sel);
  const esc = H.esc;
  const send = (p) => { location.href = "dash://" + p; };
  window.send = send;

  const ICON = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  const err = (k) => (D.errors[k] ? `<div class="err">⚠︎ ${esc(D.errors[k])}</div>` : "");
  const head = (title, color, glyph, more) =>
    `<h2><span class="dot" style="background:${color}">${glyph}</span>${title}${more || ""}</h2>`;

  // ── header
  function header() {
    const date = new Date(D.now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    const hi = H.greeting(D.now) + (S.name ? `, ${esc(S.name)}` : "");
    return `<header class="top"><div><div class="date">${esc(date)}</div><h1>${hi}</h1></div>
      <div class="actions"><button class="iconbtn" onclick="send('refresh')" aria-label="Refresh">${ICON.refresh}</button>
      <button class="iconbtn" onclick="send('settings')" aria-label="Settings">${ICON.gear}</button></div></header>`;
  }

  // ── weather
  function weather() {
    const w = D.weather;
    if (!w) return `<section class="card">${head("Weather", "var(--blue)", "☀")}<div class="empty">Weather unavailable.</div>${err("weather")}</section>`;
    const c = w.current, now = H.wx(c.code, c.isDay), today = w.daily[0] || {};
    const mood = !c.isDay ? "night" : c.code >= 95 ? "storm" : c.code >= 71 && c.code <= 86 && ![80, 81, 82].includes(c.code) ? "snow" : c.code >= 51 ? "rain" : c.code >= 3 ? "cloudy" : "";
    const hours = w.hourly.map((h, i) => {
      const x = H.wx(h.code, h.isDay);
      const label = i === 0 ? "Now" : new Date(h.t).toLocaleTimeString(undefined, { hour: "numeric" });
      return `<div class="hour"><div class="t">${esc(label)}</div><div class="p">${h.pop >= 20 ? h.pop + "%" : ""}</div><div class="e">${x.emoji}</div><div class="num">${Math.round(h.temp)}°</div></div>`;
    }).join("");
    const lo = Math.min(...w.daily.map((d) => d.min)), hi = Math.max(...w.daily.map((d) => d.max)), span = hi - lo || 1;
    const days = w.daily.map((d, i) => {
      const x = H.wx(d.code, true);
      const name = i === 0 ? "Today" : new Date(d.t).toLocaleDateString(undefined, { weekday: "short" });
      const left = ((d.min - lo) / span) * 100, width = ((d.max - d.min) / span) * 100;
      return `<div class="drow"><div style="font-weight:600">${esc(name)}</div><div class="e">${x.emoji}</div><div class="p">${d.pop >= 20 ? d.pop + "%" : ""}</div>
        <div class="lo num">${Math.round(d.min)}°</div><div class="range"><i style="left:${left}%;width:${Math.max(width, 4)}%"></i></div><div class="hi num">${Math.round(d.max)}°</div></div>`;
    }).join("");
    return `<section class="card weather ${mood}">
      <h2>${w.place ? "📍 " + esc(w.place) : "Weather"}${w.stale ? `<span class="more" style="color:#fff;opacity:.7">offline · ${H.time(w.stale)}</span>` : ""}</h2>
      <div class="wx-now"><div class="wx-emoji">${now.emoji}</div>
        <div><div class="wx-temp num">${Math.round(c.temp)}°</div><div class="wx-cond">${esc(now.label)}</div></div>
        <div class="wx-meta num">H ${Math.round(today.max)}° · L ${Math.round(today.min)}°<br>Feels ${Math.round(c.feels)}°<br>Wind ${Math.round(c.wind)} ${w.wind}</div></div>
      <div class="hourly">${hours}</div>
      <div class="daily">${days}</div>
      ${err("weather")}</section>`;
  }

  // ── calendar
  function calendar() {
    const evs = D.events;
    const more = `<button class="more" onclick="send('calendar/${D.now}')">Open</button>`;
    let body;
    if (!evs) body = `<div class="empty">Calendar unavailable.</div>`;
    else if (!evs.length) body = `<div class="empty">Nothing scheduled this week. 🌿</div>`;
    else {
      const today0 = H.startOfDay(D.now).getTime();
      let lastDay = null;
      body = evs.map((e) => {
        const shown = Math.max(e.start, today0);
        const key = H.dayKey(shown);
        let out = "";
        if (key !== lastDay) {
          lastDay = key;
          const label = H.relDay(shown, D.now);
          const sub = label === "Today" || label === "Tomorrow" ? " · " + new Date(shown).toLocaleDateString(undefined, { weekday: "long" }) : "";
          out += `<div class="day ${label === "Today" ? "today" : ""}">${esc(label + sub)}</div>`;
        }
        const now = D.now >= e.start && D.now < e.end && !e.allDay;
        const past = e.end <= D.now;
        const when = e.allDay ? `<b>All day</b>` : `<b class="num">${H.time(e.start)}</b><span class="num">${H.time(e.end)}</span>`;
        out += `<div class="ev ${past ? "past" : ""}" onclick="send('calendar/${e.start}')">
          <div class="when">${when}</div><div class="bar" style="background:${esc(e.color)}"></div>
          <div class="what"><div class="title">${esc(e.title)}${now ? '<span class="badge">NOW</span>' : ""}</div>
          <div class="loc">${esc(e.location || e.cal)}</div></div></div>`;
        return out;
      }).join("");
    }
    return `<section class="card">${head("Calendar", "var(--red)", "▦", more)}${body}${err("calendar")}</section>`;
  }

  // ── reminders
  function reminders() {
    const R = D.reminders;
    const more = `<button class="more" onclick="send('reminders')">${R && R.total > R.items.length ? `All ${R.total}` : "Open"}</button>`;
    let body;
    if (!R) body = `<div class="empty">Reminders unavailable.</div>`;
    else if (!R.items.length) body = `<div class="empty">All done. Nice. ✨</div>`;
    else body = R.items.map((r) => {
      let due = "";
      if (r.due) due = H.relDay(r.due, D.now) + (r.dueHasTime ? " " + H.time(r.due) : "");
      const meta = [due, r.list].filter(Boolean).map(esc).join(" · ");
      return `<div class="rem" style="--c:${esc(r.color)}" data-id="${esc(r.id)}">
        <button class="chk" aria-label="Complete"></button>
        <div><div class="rt">${esc(r.title)}</div><div class="rm ${r.overdue ? "overdue" : ""}">${meta}</div></div>
        ${r.flagged ? '<span class="flag">!</span>' : ""}</div>`;
    }).join("");
    return `<section class="card" id="reminders">${head("Reminders", "var(--blue)", "✓", more)}${body}${err("reminders")}</section>`;
  }

  // ── weight
  function weight() {
    const E = D.weight || [], u = S.weightUnit;
    const st = H.weightStats(E, S);
    if (!st) {
      return `<section class="card">${head("Weight", "var(--green)", "⚖")}
        <div class="empty">No weight data yet. Set up the “Send weight to Dashboard” Shortcut (see the README) and run it once.</div>
        <button class="cta" onclick="send('health')">Open Health</button>${err("weight")}</section>`;
    }
    const L = st.latest;
    const verb = st.dir < 0 ? (st.change <= 0 ? "Lost" : "Gained") : (st.change >= 0 ? "Gained" : "Lost");
    const goalBlock = st.goal != null ? `
      <div class="progress"><i style="width:${Math.round(st.progress * 100)}%"></i></div>
      <div class="plabel num"><span>${H.weight(st.start.v, u)}</span><span>${st.reached ? "🎉 Goal reached!" : Math.round(st.progress * 100) + "% there"}</span><span>${H.weight(st.goal, u)}</span></div>`
      : `<button class="cta" onclick="send('profile')">Set a goal weight</button>`;
    const stats = [
      ["Start", H.weight(st.start.v, u)],
      ["Goal", st.goal != null ? H.weight(st.goal, u) : "—"],
      ["To go", st.remaining != null ? (st.reached ? "0" : H.weight(st.remaining, u)) : "—"],
      ["Trend", st.perWeek != null ? `${H.signed(st.perWeek, 2)}/wk` : "—"],
    ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v num">${v}</div></div>`).join("");
    let eta = "";
    if (st.eta) eta = `<div class="eta">At this pace you'll reach your goal around <b>${new Date(st.eta).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</b>.</div>`;
    else if (st.weekChange != null) eta = `<div class="eta">Past week: <b class="num">${H.signed(st.weekChange)} ${u}</b></div>`;
    const ranges = [[30, "1M"], [90, "3M"], [365, "1Y"], [0, "All"]];
    return `<section class="card">${head("Weight", "var(--green)", "⚖", `<button class="more" onclick="send('health')">Health</button>`)}
      <div class="wt-top"><div><div class="wt-big num">${Number(L.v).toFixed(1)}<small>${u}</small></div>
        <div class="wt-sub">${esc(H.relDay(L.t, D.now))} · ${H.time(L.t)}</div></div>
        <div class="wt-delta num ${st.good ? "good" : "bad"}">${verb} ${Math.abs(st.change).toFixed(1)} ${u}</div></div>
      ${goalBlock}
      <div class="stats">${stats}</div>
      <div class="seg" id="wrange">${ranges.map(([d, l]) => `<button data-d="${d}">${l}</button>`).join("")}</div>
      <div class="chart" id="wchart"></div>
      ${eta}${err("weight")}</section>`;
  }

  function drawWeightChart(days) {
    const el = $("#wchart");
    if (!el) return;
    document.querySelectorAll("#wrange button").forEach((b) => b.classList.toggle("on", Number(b.dataset.d) === days));
    const all = D.weight, last = all[all.length - 1].t;
    const pts = days ? all.filter((e) => e.t >= last - days * H.DAY) : all;
    const W = el.clientWidth || 320, Ht = 170, pl = 34, pr = 8, pt = 10, pb = 20;
    const goal = S.goalWeight != null ? Number(S.goalWeight) : null;
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    const spread = Math.max(hi - lo, 1);
    const showGoal = goal != null && goal >= lo - spread * 1.2 && goal <= hi + spread * 1.2;
    if (showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
    const padY = Math.max((hi - lo) * 0.12, 0.3);
    lo -= padY; hi += padY;
    const t0 = days ? Math.min(pts[0].t, last - days * H.DAY) : pts[0].t, t1 = last;
    const x = (t) => pl + ((t - t0) / Math.max(t1 - t0, 1)) * (W - pl - pr);
    const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (Ht - pt - pb);
    // 7-day trailing average
    const avg = pts.map((p) => {
      const win = pts.filter((q) => q.t > p.t - 7 * H.DAY && q.t <= p.t);
      return [p.t, win.reduce((s, q) => s + q.v, 0) / win.length];
    });
    const line = avg.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = line + `L${x(avg[avg.length - 1][0]).toFixed(1)},${Ht - pb}L${x(avg[0][0]).toFixed(1)},${Ht - pb}Z`;
    // y gridlines
    const step = niceStep((hi - lo) / 4);
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--sep)"/><text x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${+v.toFixed(1)}</text>`;
    }
    // x labels: first / middle / last
    const xl = [t0, (t0 + t1) / 2, t1].map((t, i) =>
      `<text x="${x(t)}" y="${Ht - 4}" text-anchor="${["start", "middle", "end"][i]}">${new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>`).join("");
    const dots = pts.length <= 120 ? pts.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.2" fill="var(--green)" opacity=".35"/>`).join("") : "";
    const goalLine = showGoal
      ? `<line x1="${pl}" x2="${W - pr}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--green)" stroke-dasharray="4 4" stroke-width="1.5"/><text x="${W - pr}" y="${y(goal) - 5}" text-anchor="end" style="fill:var(--green);font-weight:700">Goal</text>`
      : "";
    const lp = avg[avg.length - 1];
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}">
      <defs><linearGradient id="wg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--green)" stop-opacity=".28"/><stop offset="1" stop-color="var(--green)" stop-opacity="0"/></linearGradient></defs>
      ${grid}${goalLine}<path d="${area}" fill="url(#wg)"/>${dots}
      <path d="${line}" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(lp[0])}" cy="${y(lp[1])}" r="4.5" fill="var(--green)" stroke="var(--card)" stroke-width="2"/>${xl}</svg>`;
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw;
  }

  // ── workout
  function workout() {
    const s = D.strava;
    const title = (more) => head("Last workout", "var(--strava)", "▲", more);
    if (!s || !s.connected) {
      return `<section class="card">${title()}<div class="empty">Connect Strava to see your latest workout and weekly totals.</div>
        <button class="cta" onclick="send('strava')">Connect Strava</button>${err("workout")}</section>`;
    }
    const a = s.activities && s.activities[0];
    if (!a) return `<section class="card">${title()}<div class="empty">No activities on Strava yet.</div>${err("workout")}</section>`;
    const sp = H.sport(a.type), pace = H.speed(a.avgSpeed, sp.kind, units);
    const cells = [];
    if (a.distance > 0) { const [v, u] = H.dist(a.distance, units).split(" "); cells.push(["Distance", v, u]); }
    cells.push(["Time", H.dur(a.moving), ""]);
    if (pace && a.distance > 0) cells.push([pace.label, pace.value, pace.unit]);
    if (a.elev > 5) { const [v, u] = H.elev(a.elev, units).split(" "); cells.push(["Elevation", v, u]); }
    if (a.avgHr) cells.push(["Avg HR", Math.round(a.avgHr), "bpm"]);
    if (a.watts) cells.push(["Power", Math.round(a.watts), "W"]);
    if (a.kj && !a.avgHr) cells.push(["Energy", Math.round(a.kj), "kJ"]);
    const grid = cells.slice(0, 6).map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v num">${esc(v)}${u ? `<small>${esc(u)}</small>` : ""}</div></div>`).join("");
    const route = a.polyline ? routeSVG(a.polyline) : "";
    const wk = s.week;
    const week = `<div class="week"><div><span class="note">This week</span><b class="num">${wk.count} ${wk.count === 1 ? "activity" : "activities"}</b></div>
      <div style="text-align:center"><span class="note">Distance</span><b class="num">${H.dist(wk.distance, units)}</b></div>
      <div style="text-align:right"><span class="note">Time</span><b class="num">${H.durShort(wk.time)}</b></div></div>`;
    const recent = s.activities.slice(1, 5).map((r) => {
      const rs = H.sport(r.type);
      return `<div class="ra" onclick="send('open/' + encodeURIComponent('https://www.strava.com/activities/${r.id}'))"><span>${rs.emoji}</span><span class="n">${esc(r.name)}</span>
        <span class="d num">${r.distance > 0 ? H.dist(r.distance, units) + " · " : ""}${H.durShort(r.moving)} · ${esc(H.relDay(r.start, D.now))}</span></div>`;
    }).join("");
    const when = `${H.relDay(a.start, D.now)} · ${H.time(a.start)}`;
    return `<section class="card">${title(`<button class="more" style="color:var(--strava)" onclick="send('open/' + encodeURIComponent('https://www.strava.com/activities/${a.id}'))">Strava</button>`)}
      <div class="wo-head"><div class="wo-icon">${sp.emoji}</div><div><div class="wo-name">${esc(a.name)}</div><div class="wo-when">${esc(sp.label)} · ${esc(when)}${a.kudos ? ` · 👍 ${a.kudos}` : ""}</div></div></div>
      <div class="wo-grid">${grid}</div>${route}${week}
      ${recent ? `<div class="recent">${recent}</div>` : ""}
      ${s.stale ? `<div class="err">Offline — showing data from ${H.time(s.stale)}</div>` : ""}${err("workout")}</section>`;
  }

  function decodePolyline(str) {
    let i = 0, lat = 0, lng = 0;
    const out = [];
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, result = 0;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = result & 1 ? ~(result >> 1) : result >> 1;
        if (k === 0) lat += d; else lng += d;
      }
      out.push([lat / 1e5, lng / 1e5]);
    }
    return out;
  }
  function routeSVG(poly) {
    const p = decodePolyline(poly);
    if (p.length < 2) return "";
    const midLat = p.reduce((s, q) => s + q[0], 0) / p.length, k = Math.cos((midLat * Math.PI) / 180);
    const xs = p.map((q) => q[1] * k), ys = p.map((q) => -q[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 300, Ht = 150, pad = 10, s = Math.min((W - 2 * pad) / (maxX - minX || 1), (Ht - 2 * pad) / (maxY - minY || 1));
    const ox = (W - (maxX - minX) * s) / 2, oy = (Ht - (maxY - minY) * s) / 2;
    const P = xs.map((x, i) => [ox + (x - minX) * s, oy + (ys[i] - minY) * s]);
    const d = P.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const [sx, sy] = P[0], [ex, ey] = P[P.length - 1];
    return `<div class="route"><svg viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="xMidYMid meet">
      <path d="${d}" fill="none" stroke="var(--strava)" stroke-width="7" stroke-opacity=".18" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="var(--strava)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${sx}" cy="${sy}" r="5" fill="var(--green)" stroke="#fff" stroke-width="2"/>
      <circle cx="${ex}" cy="${ey}" r="5" fill="var(--red)" stroke="#fff" stroke-width="2"/></svg></div>`;
  }

  // ── assemble
  const SECTIONS = { weather, calendar, reminders, weight, workout };
  const foot = `<div class="foot">Updated ${H.time(D.now)}${D.healthUpdated ? ` · Health synced ${esc(H.ago(D.healthUpdated, D.now))}` : ""}</div>`;
  $("#app").innerHTML = header() + D.config.sections.filter((k) => SECTIONS[k]).map((k) => SECTIONS[k]()).join("") + foot;

  // weight chart + range switch
  if (D.weight && D.weight.length) {
    let range = [30, 90, 365, 0].includes(D.config.chartDays) ? D.config.chartDays : 90;
    try { range = Number(localStorage.getItem("wrange") ?? range); } catch (e) { /* storage may be unavailable */ }
    drawWeightChart(range);
    document.querySelectorAll("#wrange button").forEach((b) => b.addEventListener("click", () => {
      range = Number(b.dataset.d);
      try { localStorage.setItem("wrange", range); } catch (e) { /* ignore */ }
      drawWeightChart(range);
    }));
    window.addEventListener("resize", () => drawWeightChart(range));
  }

  // reminders: tap to complete, with undo
  const toast = $("#toast");
  let toastTimer;
  document.querySelectorAll(".rem").forEach((row) => {
    row.addEventListener("click", () => {
      if (row.classList.contains("done")) return;
      const id = row.dataset.id;
      row.classList.add("done");
      send("complete/" + encodeURIComponent(id));
      const hide = setTimeout(() => row.classList.add("gone"), 1200);
      toast.innerHTML = `<span>Completed “${esc(row.querySelector(".rt").textContent)}”</span><button>Undo</button>`;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
      toast.querySelector("button").onclick = (ev) => {
        ev.stopPropagation();
        clearTimeout(hide);
        row.classList.remove("done", "gone");
        send("undo/" + encodeURIComponent(id));
        toast.classList.remove("show");
      };
    });
  });
}

// ──────────────────────────────────────────────────────────── widgets ──

const C = {
  bg: Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E")),
  text: Color.dynamic(new Color("#1C1C1E"), new Color("#F5F5F7")),
  sub: Color.dynamic(new Color("#6E6E73"), new Color("#98989F")),
  fill: Color.dynamic(new Color("#767680", 0.14), new Color("#767680", 0.3)),
  blue: Color.dynamic(new Color("#007AFF"), new Color("#0A84FF")),
  red: Color.dynamic(new Color("#FF3B30"), new Color("#FF453A")),
  green: Color.dynamic(new Color("#34C759"), new Color("#30D158")),
  orange: Color.dynamic(new Color("#FF9500"), new Color("#FF9F0A")),
  strava: new Color("#FC4C02"),
};

function wText(stack, str, font, color = C.text, lines = 1) {
  const t = stack.addText(String(str));
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.7;
  return t;
}

function wSymbol(stack, name, size, color) {
  const s = SFSymbol.named(name) || SFSymbol.named("circle.fill");
  s.applyFont(Font.semiboldSystemFont(size));
  const img = stack.addImage(s.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color;
  return img;
}

function hStack(parent, spacing = 4) {
  const s = parent.addStack();
  s.layoutHorizontally();
  s.centerAlignContent();
  s.spacing = spacing;
  return s;
}

function vStack(parent, spacing = 2) {
  const s = parent.addStack();
  s.layoutVertically();
  s.spacing = spacing;
  return s;
}

function sparkline(entries, w, h, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const pts = entries.slice(-30);
  if (pts.length >= 2) {
    const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)), span = hi - lo || 1;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const P = pts.map((p) => new Point(3 + ((p.t - t0) / (t1 - t0 || 1)) * (w - 6), 3 + (1 - (p.v - lo) / span) * (h - 6)));
    const path = new Path();
    path.addLines(P);
    ctx.addPath(path);
    ctx.setStrokeColor(color);
    ctx.setLineWidth(2);
    ctx.strokePath();
    const last = P[P.length - 1];
    ctx.setFillColor(color);
    ctx.fillEllipse(new Rect(last.x - 3, last.y - 3, 6, 6));
  }
  return ctx.getImage();
}

function progressBar(fraction, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, w, h), h / 2, h / 2);
  ctx.addPath(bg);
  ctx.setFillColor(new Color("#8E8E93", 0.3));
  ctx.fillPath();
  if (fraction > 0) {
    const fg = new Path();
    fg.addRoundedRect(new Rect(0, 0, Math.max(h, w * Math.min(fraction, 1)), h), h / 2, h / 2);
    ctx.addPath(fg);
    ctx.setFillColor(new Color("#34C759"));
    ctx.fillPath();
  }
  return ctx.getImage();
}

function nextEvents(data, n) {
  const now = Date.now();
  const evs = (data.events || []).filter((e) => e.end > now);
  // Prefer timed events; all-day events only if they're today.
  return evs.filter((e) => !e.allDay || H.relDay(e.start) === "Today").slice(0, n);
}

function eventLabel(e) {
  const day = H.relDay(Math.max(e.start, H.startOfDay(new Date()).getTime()));
  if (e.allDay) return day === "Today" ? "All day" : day;
  if (Date.now() >= e.start) return "Now";
  return day === "Today" ? H.time(e.start) : `${day.slice(0, 3)} ${H.time(e.start)}`;
}

function addWeatherBlock(parent, data, big) {
  const w = data.weather;
  if (!w) { wText(parent, "Weather unavailable", Font.systemFont(12), C.sub); return; }
  const x = H.wx(w.current.code, w.current.isDay);
  const row = hStack(parent, 6);
  wSymbol(row, x.symbol, big ? 30 : 22, w.current.isDay && w.current.code <= 2 ? C.orange : C.blue);
  wText(row, `${Math.round(w.current.temp)}°`, big ? Font.lightRoundedSystemFont(34) : Font.semiboldRoundedSystemFont(22));
  const d = w.daily[0] || {};
  const sub = vStack(parent, 0);
  wText(sub, w.place ? `${x.label} · ${w.place}` : x.label, Font.mediumSystemFont(11), C.sub);
  wText(sub, `H ${Math.round(d.max)}°  L ${Math.round(d.min)}°`, Font.mediumSystemFont(11), C.sub);
}

function addWeightBlock(parent, data, withChart) {
  const st = H.weightStats(data.weight, data.settings);
  const u = data.settings.weightUnit;
  const row = hStack(parent, 4);
  wSymbol(row, "scalemass.fill", 13, C.green);
  wText(row, "WEIGHT", Font.boldSystemFont(10), C.sub);
  if (!st) { wText(parent, "No data yet", Font.systemFont(12), C.sub); return; }
  const top = hStack(parent, 4);
  top.bottomAlignContent();
  wText(top, st.latest.v.toFixed(1), Font.boldRoundedSystemFont(22));
  wText(top, u, Font.semiboldSystemFont(12), C.sub);
  const diff = `${H.signed(st.change)} ${u}`;
  wText(parent, st.goal != null ? `${diff} · ${st.reached ? "goal reached 🎉" : `${H.weight(st.remaining, u)} to go`}` : diff, Font.semiboldSystemFont(11), st.good ? C.green : C.orange);
  if (withChart && data.weight.length >= 2) {
    parent.addSpacer(4);
    const img = parent.addImage(sparkline(data.weight, 130, 28, new Color("#34C759")));
    img.imageSize = new Size(130, 28);
  } else if (st.progress != null) {
    parent.addSpacer(4);
    const img = parent.addImage(progressBar(st.progress, 120, 6));
    img.imageSize = new Size(120, 6);
  }
}

function addWorkoutRow(parent, data, size = 12) {
  const s = data.strava;
  const row = hStack(parent, 6);
  if (!s || !s.connected) {
    wSymbol(row, "figure.run", size + 2, C.strava);
    wText(row, "Connect Strava in the app", Font.systemFont(size), C.sub);
    return;
  }
  const a = s.activities && s.activities[0];
  if (!a) { wText(row, "No workouts yet", Font.systemFont(size), C.sub); return; }
  const sp = H.sport(a.type);
  wSymbol(row, sp.symbol, size + 3, C.strava);
  const bits = [a.distance > 0 ? H.dist(a.distance, data.settings.units) : null, H.durShort(a.moving), H.relDay(a.start)].filter(Boolean);
  wText(row, a.name, Font.semiboldSystemFont(size));
  row.addSpacer();
  wText(row, bits.join(" · "), Font.mediumSystemFont(size - 1), C.sub);
}

function addEventRow(parent, e, size = 12) {
  const row = hStack(parent, 6);
  const bar = row.addStack();
  bar.size = new Size(3, size + 4);
  bar.cornerRadius = 1.5;
  bar.backgroundColor = new Color(e.color);
  const t = wText(row, eventLabel(e), Font.semiboldRoundedSystemFont(size), Date.now() >= e.start && !e.allDay ? C.red : C.sub);
  t.minimumScaleFactor = 0.9;
  wText(row, e.title, Font.mediumSystemFont(size));
  row.addSpacer();
}

function addReminderRow(parent, r, size = 12) {
  const row = hStack(parent, 6);
  wSymbol(row, "circle", size, new Color(r.color));
  wText(row, r.title, Font.systemFont(size));
  row.addSpacer();
  if (r.due) wText(row, H.relDay(r.due) + (r.dueHasTime ? ` ${H.time(r.due)}` : ""), Font.mediumSystemFont(size - 2), r.overdue ? C.red : C.sub);
}

function sectionTitle(parent, symbol, title, color, extra) {
  const row = hStack(parent, 4);
  wSymbol(row, symbol, 11, color);
  wText(row, title, Font.boldSystemFont(10), C.sub);
  if (extra) { row.addSpacer(); wText(row, extra, Font.boldSystemFont(10), C.sub); }
}

function buildWidget(data, family, param) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = scriptURL();
  w.refreshAfterDate = new Date(Date.now() + 20 * 60000);

  if (family === "accessoryInline") {
    const st = H.weightStats(data.weight, data.settings), e = nextEvents(data, 1)[0];
    wText(w, e ? `${eventLabel(e)} ${e.title}` : st ? H.weight(st.latest.v, data.settings.weightUnit) : "Dashboard", Font.systemFont(12));
    return w;
  }
  if (family === "accessoryCircular") {
    const wx = data.weather;
    w.addAccessoryWidgetBackground = true;
    const s = vStack(w, 0);
    s.centerAlignContent();
    if (wx) {
      wSymbol(s, H.wx(wx.current.code, wx.current.isDay).symbol, 18, Color.white());
      wText(s, `${Math.round(wx.current.temp)}°`, Font.semiboldRoundedSystemFont(14), Color.white());
    }
    return w;
  }
  if (family === "accessoryRectangular") {
    const e = nextEvents(data, 1)[0];
    const st = H.weightStats(data.weight, data.settings);
    if (e) wText(w, `${eventLabel(e)} · ${e.title}`, Font.semiboldSystemFont(13), Color.white());
    if (data.weather) wText(w, `${Math.round(data.weather.current.temp)}° ${H.wx(data.weather.current.code).label}`, Font.systemFont(12), Color.white());
    if (st) wText(w, `${H.weight(st.latest.v, data.settings.weightUnit)} (${H.signed(st.change)})`, Font.systemFont(12), Color.white());
    return w;
  }

  if (family === "small") {
    w.setPadding(14, 14, 14, 14);
    if (param === "weight") {
      addWeightBlock(w, data, true);
    } else if (param === "workout") {
      const s = data.strava, a = s && s.activities && s.activities[0];
      sectionTitle(w, "flame.fill", "LAST WORKOUT", C.strava);
      w.addSpacer(6);
      if (!a) { wText(w, s && s.connected ? "No workouts yet" : "Connect Strava in the app", Font.systemFont(12), C.sub, 2); }
      else {
        const sp = H.sport(a.type);
        wSymbol(w, sp.symbol, 26, C.strava);
        w.addSpacer(4);
        wText(w, a.name, Font.semiboldSystemFont(13), C.text, 2);
        if (a.distance > 0) wText(w, H.dist(a.distance, data.settings.units), Font.boldRoundedSystemFont(20));
        wText(w, `${H.dur(a.moving)} · ${H.relDay(a.start)}`, Font.mediumSystemFont(11), C.sub);
      }
    } else if (param === "agenda") {
      sectionTitle(w, "calendar", new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric" }).toUpperCase(), C.red);
      w.addSpacer(6);
      const evs = nextEvents(data, 4);
      if (!evs.length) wText(w, "Nothing coming up 🌿", Font.systemFont(12), C.sub, 2);
      evs.forEach((e) => {
        const s = vStack(w, 0);
        wText(s, eventLabel(e), Font.semiboldSystemFont(10), C.sub);
        wText(s, e.title, Font.mediumSystemFont(12));
        w.addSpacer(3);
      });
    } else {
      addWeatherBlock(w, data, true);
      w.addSpacer();
      const e = nextEvents(data, 1)[0];
      if (e) {
        wText(w, eventLabel(e), Font.semiboldSystemFont(11), C.red);
        wText(w, e.title, Font.semiboldSystemFont(13), C.text, 2);
      } else {
        wText(w, "No more events today", Font.systemFont(11), C.sub, 2);
      }
    }
    w.addSpacer();
    return w;
  }

  // medium / large
  w.setPadding(14, 16, 14, 16);
  const top = hStack(w, 12);
  top.topAlignContent();
  const left = vStack(top, 2);
  addWeatherBlock(left, data, false);
  top.addSpacer();
  const right = vStack(top, 1);
  addWeightBlock(right, data, family !== "medium");
  w.addSpacer(family === "medium" ? 8 : 12);

  const evCount = family === "medium" ? 2 : 4;
  const evs = nextEvents(data, evCount);
  if (family !== "medium") { sectionTitle(w, "calendar", "UP NEXT", C.red); w.addSpacer(4); }
  if (!evs.length) wText(w, "Nothing else on the calendar", Font.systemFont(12), C.sub);
  evs.forEach((e) => { addEventRow(w, e); w.addSpacer(3); });

  if (family !== "medium") {
    w.addSpacer(8);
    const R = data.reminders;
    sectionTitle(w, "checklist", "REMINDERS", C.blue, R && R.total ? String(R.total) : "");
    w.addSpacer(4);
    const items = R ? R.items.slice(0, 4) : [];
    if (!items.length) wText(w, "All done ✨", Font.systemFont(12), C.sub);
    items.forEach((r) => { addReminderRow(w, r); w.addSpacer(3); });
    w.addSpacer(8);
    sectionTitle(w, "flame.fill", "LAST WORKOUT", C.strava);
    w.addSpacer(4);
  } else {
    w.addSpacer(2);
  }
  addWorkoutRow(w, data);
  w.addSpacer();
  return w;
}

// ──────────────────────────────────────────────────────────────── main ──

async function main() {
  if (args.shortcutParameter) {
    ingestFromShortcut(args.shortcutParameter);
    return;
  }
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    const data = await loadAll({ widget: true });
    Script.setWidget(buildWidget(data, config.widgetFamily || "medium", (args.widgetParameter || "").trim().toLowerCase()));
    return;
  }
  await firstRunSetup();
  await showDashboard();
}

try {
  await main();
} catch (e) {
  console.error(e);
  if (config.runsInApp) await notify("Dashboard error", String((e && e.message) || e));
}
Script.complete();
