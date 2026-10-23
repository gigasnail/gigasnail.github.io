# iPhone Dashboard (Scriptable)

A personal dashboard that runs on your iPhone inside the free [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) app:

- **Weather**: now, the next 24 hours and the next 7 days (Open-Meteo, no account needed)
- **Calendar**: today and the coming week, from every calendar on your phone
- **Reminders**: open reminders. Tap one to tick it off (with Undo).
- **Weight journey**: current weight, how much you've lost, progress to your goal, weekly trend, a chart, and an estimated goal date
- **Last workout**: your latest Strava activity with a route map, this week's totals and recent activities
- **Widgets**: small, medium, large and lock-screen sizes

All data stays on your phone. Your Strava login is stored in the iOS Keychain.

---

## 1. Install (2 minutes)

1. Install **Scriptable** from the App Store.
2. Get `Dashboard.js` into Scriptable. Either:
   - save the file to **Files → iCloud Drive → Scriptable**, or
   - open Scriptable, tap **+**, paste the whole contents of `Dashboard.js`, tap the title at the top and rename it to **Dashboard**.
3. Tap **Dashboard** in Scriptable to run it. It asks for your units, name and goal weight, and offers to connect Strava (you can skip this and do it later from ⚙︎).
4. Allow **Location**, **Calendars** and **Reminders** when iOS asks.

You can change your name, goal weight, units and Strava from the **⚙︎** button in the top right of the dashboard. The ↻ button refreshes everything.

## 2. Connect Strava (3 minutes)

From ⚙︎ → **Connect Strava**:

1. Tap **Open Strava API page** and sign in. Create an app with:
   - Application Name: anything, e.g. *My Dashboard*
   - Category: anything
   - Website: `http://localhost`
   - **Authorization Callback Domain: `localhost`** ← this one matters
2. Copy the **Client ID** and **Client Secret** into the two fields, then tap **Continue**.
3. Choose **Sign in here** and approve.
   - If you normally sign in to Strava with **Google or Apple**, choose **Sign in with Safari** instead. After you approve, Safari shows a "can't connect to localhost" page. That's expected. Tap the share button → **Copy**, close Safari, and paste the link into the box.

## 3. Send your weight from Apple Health (5 minutes, one-time)

Scriptable can't read Apple Health directly, so a Shortcut hands your weight over. Build it once:

1. Open **Shortcuts** → **+** → name it **Send weight to Dashboard**.
2. Add **Find Health Samples**:
   - Type: **Weight**
   - Filter: **Start Date** is in the last **365 days**
   - Sort by **Start Date**, Order **Oldest First**, Limit **off**
3. Add **Repeat with Each** (it picks up the Health Samples automatically).
4. Inside the repeat, add a **Text** action and build exactly this, with no spaces:

   `weight;`**`Start Date`**`;`**`Value`**

   - For **Start Date**: insert the *Repeat Item* variable, tap it, pick **Start Date**, then set **Date Format → ISO 8601**.
   - For **Value**: insert *Repeat Item* again, tap it and pick **Value**.
5. After **End Repeat**, add **Combine Text**: *Repeat Results*, separator **New Lines**.
6. Add Scriptable's **Run Script** action: Script **Dashboard**, Parameter **Combined Text**. Tap the arrow to show more options and turn **Run In App** off.
7. Run it once. You should see: *"Dashboard saved 123 weight entries. Latest: 84.2 kg."*

**Make it automatic:** Shortcuts → **Automation** → **+** → **Time of Day** (e.g. daily 09:00) → **Run Immediately** → pick *Send weight to Dashboard*. You could also use **App → Health → Is Closed**, so it runs whenever you've just logged a weight.
> iOS blocks Health data while the phone is locked, so pick a time when you're usually using your phone.

Your scale app (Withings, Renpho, etc.) or manual entries in Health all work, as long as they end up in Apple Health.

## 4. Add widgets

Long-press the home screen → **Edit → Add Widget** → **Scriptable** → pick a size. Then long-press the new widget → **Edit Widget**:

- **Script:** Dashboard
- **When Interacting:** Run Script (tapping the widget opens the full dashboard)
- **Parameter** (small widgets only):

| Parameter | Small widget shows |
|---|---|
| *(empty)* or `weather` | Weather and your next event |
| `weight` | Weight, change since you started, and a 30-entry trend line |
| `workout` | Last Strava workout |
| `agenda` | Your next 4 events |

The medium widget shows weather, weight, your next 2 events and your last workout. The large one adds a weight trend line, more events and reminders. On the lock screen, rectangular, inline and circular widgets are supported too.

You can see how each widget looks from ⚙︎ → **Preview widgets**.

**Want an app icon?** Shortcuts → **+** → Scriptable **Run Script** → *Dashboard* (leave **Run In App** on) → share button → **Add to Home Screen**.

## Optional tweaks

At the top of `Dashboard.js` there's a `CONFIG` block where you can:

- set a fixed `location` instead of GPS
- show only certain `calendars` or `reminderLists` (by name)
- change the order of the cards (`sections`)
- change how many days of calendar to show and the default chart range

## Troubleshooting

- **"N line(s) couldn't be read"** after running the Shortcut: the Start Date in the Text action isn't set to **ISO 8601** (step 3.4).
- **Weather says location unavailable:** allow location for Scriptable in Settings → Privacy → Location Services, or set `CONFIG.location`.
- **Strava stopped working:** use ⚙︎ → Strava → Continue to sign in again. Your Client ID and Secret are remembered.
- **Widget looks out of date:** iOS decides how often widgets refresh (roughly every 15–60 minutes). Opening the dashboard always fetches fresh data.
