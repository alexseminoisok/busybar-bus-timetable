# BUSY Bar — Bus Timetable (North Greenwich)

An on-device JavaScript app for the [BUSY Bar](https://busy.app) that shows live
bus departures from **North Greenwich bus station, London**, styled like a UK
bus-stop countdown sign: coloured text on a dark grey background, two buses at
a time, paging through the next ten. It runs **on the bar** (JerryScript) and
fetches TfL data **itself** over HTTPS — no companion app or API key.

> **Made specifically for North Greenwich.** The stop codes for North Greenwich
> bus station (stands A–D) are built in. It works for any London bus stop if
> you change two lines — see [Another stop](#another-stop).

```
SL11 Abbey Wood      5m
180  Erith Fraser   due
```

- **Stop:** North Greenwich bus station, departure stands A–D. Stand E is the
  arrivals stand, where every bus terminates as "North Greenwich", so it's
  skipped.
- **Source:** TfL Countdown feed (`countdown.api.tfl.gov.uk`, the data behind
  the street signs) — one ~2 KB request every 30 s, no API key needed.
- **Rows:** route · destination (scrolls if it doesn't fit) · minutes (`due`
  under a minute). Minutes count down live between refreshes using TfL's own
  clock.
- **Paging:** each pair stays up until both destinations have scrolled once
  (min 5 s), then a quick 0.4 s fade brings in the next pair (or a pixel
  dissolve — set `TRANSITION` in `main.js`).
- **Colours:** amber, green, cyan, pink, red — press **Start** to switch; the
  bar remembers your pick.
- **Background:** a dim, slow orange glow drifting behind the text, played
  natively by the bar (set `BG_ANIM = false` in `main.js` for plain grey).

Companion to [busybar-boat-timetable](https://github.com/alexseminoisok/busybar-boat-timetable)
(same display engine, Uber Boat departures from North Greenwich Pier).

## Controls

| Input | Action |
|-------|--------|
| **Encoder** | Previous / next pair of buses |
| **Start** | Next text colour: amber → green → cyan → pink → red |
| **OK** | Refresh now |
| **Back** | Exit |

## Requirements

A BUSY Bar running firmware that includes the **on-device JS runner** — i.e. the
runtime that provides the global `listen("input", …)` and `fetch()` APIs and
lists JS apps in the **Apps** menu. (On official *release* firmware the JS SDK is
still "coming soon"; this app targets the dev/JS-runner firmware.) The bar needs
internet access (Wi-Fi) to reach TfL.

## Install

USB (default address `10.0.4.20`):

```bash
./install_bus_countdown.sh 10.0.4.20
```

Wi-Fi (set your HTTP-API password):

```bash
BAR_TOKEN=<http-access-password> ./install_bus_countdown.sh <bar-ip>
```

The script uploads the app to `/ext/user_assets/community.bus_countdown/` and
writes the `js_apps_enabled` flag. Then on the bar: **mode switch → Apps →
Bus Timetable → Start**. To update after changing files, run the installer
again and reopen the app.

## Another stop

Edit `STOP_NAME` and `STOPS` at the top of `scripts/main.js`. Stop codes
(NaPTAN, e.g. `490010374A`) come from
`https://api.tfl.gov.uk/StopPoint/Search/<name>?modes=bus` →
`https://api.tfl.gov.uk/StopPoint/<hub id>` (the `children` list). Leave out
any arrivals-only stand.

## Layout

```
community.bus_countdown/
├── anims/     bg_glow.anim (animated background)
├── appmeta/   manifest.json, icon_front_8x8.png, icon_back_11x11.png
└── scripts/   main.js
build_bg_anim.py           # regenerates anims/bg_glow.anim (AMP = strength)
build_icons.py             # regenerates the Apps-menu icons
install_bus_countdown.sh   # curl installer
```

## How it works

- **Data:** the feed returns newline-separated JSON arrays — a
  `[4, "1.0", serverMs]` header, then `[1, stand, route, destination,
  vehicleId, estimatedMs]` per bus. Buses are sorted by arrival and tracked by
  vehicle ID across refreshes. If the network drops, the last data keeps
  counting down; after 3 minutes without an update the screen shows
  "No signal".
- **Font:** `small` (busy_regular_5) for everything: 5 px caps, 3 px digits.
  Text widths are computed in JS from the font's advance table so columns
  line up. Each line is centred in its half of the screen.
- **Transitions:** an `xpmbitmap` overlay in the background colour sits on
  top. The fade ramps a solid overlay's `opacity` 0→100→0; the dissolve
  covers random pixels instead. The next pair is swapped in underneath while
  fully covered, then the overlay is removed. ~15–20 ms per frame on the bar.
- **Background:** a looping `animation` element (`bg_glow.anim`, 10 s at
  12 fps, "bicycle1" format via the firmware's `scripts/seq2anim.py`) under
  the text. The bar plays it itself, so it costs no draw requests — measured
  17 → 19 ms per draw with it running.
- **Draw:** `POST http://127.0.0.1/api/display/draw` (loopback skips auth),
  sending only changed elements. Destinations/routes change only on page
  turns — re-sending a text element restarts its scroll — while the minutes
  column ticks every second.
- **Scroll timing:** the firmware's marquee runs at `scroll_rate` px/min over
  `text width + 3 spaces` per cycle, so each page is held until just after the
  longest destination finishes one loop.

## Attribution

Powered by TfL Open Data. Live bus arrival data is provided by
[Transport for London](https://tfl.gov.uk/info-for/open-data-users/) under the
[TfL transport data terms](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service).
This project is not affiliated with or endorsed by TfL.

## Credits

Built for the BUSY Bar.
