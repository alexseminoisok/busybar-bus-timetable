// Bus Timetable — on-device BUSY Bar app (front 72x16).
// UK bus-stop style live departures, amber on dark grey, two buses at a time,
// paging through the upcoming ones with a quick fade. Data comes straight
// from TfL's Countdown feed (the one the street signs use), fetched by the bar
// itself over HTTPS.
//
// Native dev-firmware runtime: draws via fetch -> /api/display/draw, input via
// listen("input").
//
// Controls: encoder = previous/next pair, START = next colour theme,
// OK = refresh now, BACK = exit.
//
// Layout (each row, all in the 5 px "small" font):
//   [route] [destination, scrolls if long] [mins]
//   row 1: caps rows 1-5, descender row 6
//   row 2: caps rows 9-13, descender row 14
//
// Page turns use an XPM overlay above everything, in the background colour.
// "fade": a solid overlay ramps its opacity up, the next pair is swapped in
// underneath while it's opaque, then it ramps back down. "dissolve": same, but
// the overlay covers random pixels instead of fading.

var APP = "community.bus_countdown";
var DRAW_URL = "http://127.0.0.1/api/display/draw";

// ── Stop ────────────────────────────────────────────────────
// North Greenwich bus station, departure stands A-D. Stand E is the arrivals
// stand (every bus there terminates as "North Greenwich"), so it is skipped.
var STOP_NAME = "North Greenwich";
var STOPS = ["490010374A", "490010374B", "490010374C", "490010374D"];
// Rows come back as [1, stand, route, destination, vehicleId, estimatedMs]
// after a [4, "1.0", serverMs] header — compact and timezone-free.
var FEED_URL =
  "https://countdown.api.tfl.gov.uk/interfaces/ura/instant_V1?StopCode2=" + STOPS.join(",") +
  "&ReturnList=StopPointIndicator,LineName,DestinationText,VehicleID,EstimatedTime";

// ── Timing (ms) ─────────────────────────────────────────────
var REFRESH_MS = 30000;      // TfL predictions update about every 30 s
var RETRY_MS = 10000;        // after a failed fetch
var STALE_MS = 180000;       // predictions older than this are dropped
var PAGE_MIN_MS = 5000;      // shortest time a pair of buses stays up
var PAGE_TAIL_MS = 1200;     // rest after the longest scroll finishes
var SCROLL_DELAY_MS = 1200;  // pause before a long destination scrolls
var SCROLL_PX_MIN = 1200;    // native marquee speed, px per minute (20 px/s)
var TRANSITION = "fade";     // page turns: "fade" or "dissolve" (random pixels)
var FADE_MS = 400;           // whole fade: half out to background, half in
var DISSOLVE_MS = 600;       // whole dissolve: half out, half in
var FX_STEPS = 10;           // levels per half (opacity or pixel coverage)
var FX_FRAME_MS = 20;        // pacing; an overlay frame costs ~15-20 ms on the bar
var FX_MS = TRANSITION === "fade" ? FADE_MS : DISSOLVE_MS;
var MAX_BUSES = 10;          // pages through the next N departures
var MAX_MINS = 99;

// ── Look ────────────────────────────────────────────────────
// START cycles the text colour. Per theme: route + minutes, destinations (a
// touch darker, sets them apart), dim status text. Remembered across launches.
var THEMES = [
  { name: "amber", main: "#FF8C00FF", dest: "#D46A00FF", dim: "#8C4D00FF" },
  { name: "green", main: "#3CFF5AFF", dest: "#28C83EFF", dim: "#187A26FF" },
  { name: "cyan",  main: "#2ED2FFFF", dest: "#1FA2D2FF", dim: "#13617DFF" },
  { name: "pink",  main: "#FF4FB4FF", dest: "#D03A8FFF", dim: "#7D2356FF" },
  { name: "red",   main: "#FF3A2EFF", dest: "#CC2A20FF", dim: "#7A1913FF" }
];
var BG_COLOR = "#1C1C1CFF";
// Animated background: a dim, slow orange glow (anims/bg_glow.anim, made by
// build_bg_anim.py). The firmware plays it natively in a loop, so it costs no
// draw requests. false = plain dark grey.
var BG_ANIM = true;

var themeIdx = 0;
try {
  var savedTheme = parseInt(localStorage.getItem("theme"), 10);
  if (savedTheme >= 0 && savedTheme < THEMES.length) themeIdx = savedTheme;
} catch (e) {}
function theme() { return THEMES[themeIdx]; }
var FONT = "small";          // busy_regular_5: 5 px caps, 3 px digits

var W = 72;
var H = 16;
var ROW_Y = [-1, 7];         // glyph top = y + 2  -> caps at rows 1 and 9
var COL_GAP = 3;             // route -> destination
var DEST_GAP = 2;            // destination -> mins

// Glyph advances (px, incl. 1 px spacing) for busy_regular_5px.ttf.
var ADV = {
  " ":2,"!":2,"\"":4,"#":6,"$":4,"%":5,"&":5,"'":2,"(":3,")":3,"*":4,"+":4,",":2,"-":3,
  ".":2,"/":3,"0":4,"1":3,"2":4,"3":4,"4":4,"5":4,"6":4,"7":4,"8":4,"9":4,":":2,";":3,"<":4,
  "=":4,">":4,"?":4,"@":5,"A":5,"B":5,"C":5,"D":5,"E":5,"F":5,"G":5,"H":5,"I":2,"J":4,"K":5,
  "L":4,"M":6,"N":5,"O":5,"P":5,"Q":5,"R":5,"S":5,"T":4,"U":5,"V":4,"W":6,"X":4,"Y":4,"Z":4,
  "[":3,"\\":3,"]":3,"^":4,"_":4,"`":5,"a":4,"b":4,"c":4,"d":4,"e":4,"f":3,"g":4,"h":4,
  "i":2,"j":3,"k":4,"l":2,"m":6,"n":4,"o":4,"p":4,"q":4,"r":3,"s":4,"t":3,"u":4,"v":4,"w":6,
  "x":4,"y":4,"z":4,"{":4,"|":2,"}":4,"~":5
};

function textWidth(s) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var a = ADV[s.charAt(i)];
    w += (a === undefined) ? 4 : a;
  }
  return w > 0 ? w - 1 : 0;   // drop trailing spacing column
}

var SCROLL_GAP = 3 * ADV[" "];        // firmware marquee gap: 3 spaces
var MINS_COL = textWidth("88m");      // fixed right column, fits "due" too

// Draw API accepts printable ASCII only.
function clean(s) {
  s = String(s === undefined || s === null ? "" : s).replace(/[^\x20-\x7E]/g, "").replace(/^\s+|\s+$/g, "");
  return s.length ? s : "?";
}

// ── Elements ────────────────────────────────────────────────
function text(id, s, x, y, color, width, scroll, repeat) {
  var el = { id: id, type: "text", display: "front", align: "top_left",
    x: x, y: y, text: s || " ", font: FONT, color: color || theme().main, z_index: 10 };
  if (width) el.width = width;
  if (scroll) {
    el.scroll_rate = SCROLL_PX_MIN;
    el.scroll_start_delay = SCROLL_DELAY_MS;
    el.scroll_repeat_delay = repeat;
  }
  return el;
}

var BG = { id: "bg", type: "rectangle", display: "front", align: "top_left",
  x: 0, y: 0, width: W, height: H, fill: "solid", fill_colors: [BG_COLOR],
  border_width: 0, z_index: 0 };
var BG_GLOW = { id: "bganim", type: "animation", display: "front", align: "top_left",
  x: 0, y: 0, path: "anims/bg_glow.anim", loop: true, z_index: 1 };

// Deletes an element on the device: same id/type/payload, with display_until
// in the past (the canvas service destroys it; type changes are rejected).
function deleteEl(el) {
  var d = {};
  for (var k in el) d[k] = el[k];
  d.display_until = "1";
  return d;
}

// ── Transition overlays ─────────────────────────────────────
// FULL_MASK is a solid background-coloured frame (faded via opacity).
// MASKS[k] covers k/FX_STEPS of the pixels (random order, fixed per run).
// Built once at start so a transition frame is just a string lookup.
// The bar's JerryScript has no Annex B (no String#substr etc.) — stick to
// standard methods. If building ever fails, pages just switch instantly.
var FULL_MASK = null;
var MASKS = null;
try {
  FULL_MASK = buildFullMask();
  if (TRANSITION === "dissolve") MASKS = buildMasks();
} catch (e) { FULL_MASK = null; MASKS = null; }

function xpmHead(ncolors) {
  return "! XPM2\n" + W + " " + H + " " + ncolors + " 1\n";
}

function buildFullMask() {
  var line = "", rows = [];
  for (var x = 0; x < W; x++) line += "#";
  for (var y = 0; y < H; y++) rows.push(line);
  return xpmHead(1) + "# c " + BG_COLOR.slice(0, 7) + "\n" + rows.join("\n") + "\n";
}

function buildMasks() {
  var n = W * H, order = [], rank = [], i;
  for (i = 0; i < n; i++) { order.push(i); rank.push(0); }
  for (i = n - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (i = 0; i < n; i++) rank[order[i]] = Math.floor(i * FX_STEPS / n) + 1;
  var head = xpmHead(2) + ". c none\n# c " + BG_COLOR.slice(0, 7) + "\n";
  var masks = [null];
  for (var k = 1; k <= FX_STEPS; k++) {
    var rows = [];
    for (var y = 0; y < H; y++) {
      var row = [];
      for (var x = 0; x < W; x++) row.push(rank[y * W + x] <= k ? "#" : ".");
      rows.push(row.join(""));
    }
    masks.push(head + rows.join("\n") + "\n");
  }
  return masks;
}

// ── State ───────────────────────────────────────────────────
var buses = [];          // [{key, stand, line, dest, est}] sorted by est
var serverMs = 0;        // TfL clock at last fetch ...
var fetchedAt = 0;       // ... and our Date.now() at that moment
var status = "Loading...";
var page = null;         // snapshot of what is on screen
var pageIdx = 0;
var pageTimer = null;
var refreshTimer = null;
var fx = null;           // running transition: {t0, apply, swapped, pending}
var fxLevel = 0;         // overlay level 0..FX_STEPS, 0 = no overlay
var running = true;

function tflNow() { return serverMs + (Date.now() - fetchedAt); }

function fmtMins(est) {
  var m = Math.floor((est - tflNow()) / 60000);
  if (m < 1) return "due";
  return (m > MAX_MINS ? MAX_MINS : m) + "m";
}

function pageCount() { return Math.max(1, Math.ceil(Math.min(buses.length, MAX_BUSES) / 2)); }

// Freeze the buses for one page. Destinations/routes only change on page
// turns (re-sending a text element restarts its marquee); minutes tick live.
function makePage(idx) {
  var rows = [buses[idx * 2] || null, buses[idx * 2 + 1] || null];
  var routeW = 0;
  for (var i = 0; i < 2; i++) if (rows[i]) routeW = Math.max(routeW, textWidth(rows[i].line));
  var destX = routeW + COL_GAP;
  var destW = W - MINS_COL - DEST_GAP - destX;
  var multi = pageCount() > 1;

  var longest = 0, scroll = [false, false];
  for (var r = 0; r < 2; r++) {
    if (!rows[r]) continue;
    var tw = textWidth(rows[r].dest);
    if (tw > destW) {
      scroll[r] = true;
      longest = Math.max(longest, SCROLL_DELAY_MS + (tw + 1 + SCROLL_GAP) * 60000 / SCROLL_PX_MIN);
    }
  }
  var hold = Math.max(PAGE_MIN_MS, longest + PAGE_TAIL_MS);
  // One scroll per page when paging; a lone page keeps scrolling.
  var repeat = multi ? 60000 : 3000;
  return { rows: rows, destX: destX, destW: destW, scroll: scroll, hold: hold, repeat: repeat };
}

// Keep shown buses' countdowns fresh after a refresh (match by vehicle).
function rebindPage() {
  if (!page) return;
  for (var r = 0; r < 2; r++) {
    var b = page.rows[r];
    if (!b) continue;
    for (var i = 0; i < buses.length; i++) {
      if (buses[i].key === b.key) { b.est = buses[i].est; break; }
    }
  }
}

function buildFrame() {
  var els = BG_ANIM ? [BG, BG_GLOW] : [BG];
  if (!page || buses.length === 0) {
    var nw = textWidth(STOP_NAME);
    els.push(text("r0", " ", 0, ROW_Y[0]));
    els.push(nw > W
      ? text("d0", STOP_NAME, 0, ROW_Y[0], null, W, true, 3000)
      : text("d0", STOP_NAME, (W - nw) >> 1, ROW_Y[0], null, W));
    els.push(text("m0", " ", W - 1, ROW_Y[0]));
    els.push(text("r1", " ", 0, ROW_Y[1]));
    els.push(text("d1", status, (W - textWidth(status)) >> 1, ROW_Y[1], theme().dim, W));
    els.push(text("m1", " ", W - 1, ROW_Y[1]));
  } else {
    for (var r = 0; r < 2; r++) {
      var b = page.rows[r], y = ROW_Y[r];
      if (!b) {
        els.push(text("r" + r, " ", 0, y));
        els.push(text("d" + r, " ", page.destX, y, null, page.destW));
        els.push(text("m" + r, " ", W - 1, y));
        continue;
      }
      var mins = fmtMins(b.est);
      els.push(text("r" + r, b.line, 0, y));
      els.push(text("d" + r, b.dest, page.destX, y, theme().dest, page.destW, page.scroll[r], page.repeat));
      els.push(text("m" + r, mins, W - textWidth(mins), y));
    }
  }
  if (fxLevel > 0) {
    var ov = { id: "fx", type: "xpmbitmap", display: "front", align: "top_left",
      x: 0, y: 0, z_index: 50 };
    if (MASKS) ov.data = MASKS[fxLevel];
    else { ov.data = FULL_MASK; ov.opacity = Math.round(fxLevel * 100 / FX_STEPS); }
    els.push(ov);
  }
  return els;
}

// ── Drawing: send only what changed, one request at a time ──
var sent = {};           // id -> {json, el} as last accepted by the device
var inFlight = false;
var dirty = false;
var pendingLed = null;   // "#RRGGBBAA" status-LED blink sent with the next draw

function post(body) {
  return fetch(new Request(DRAW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function render() {
  if (!running) return;
  if (inFlight) { dirty = true; return; }
  var els = buildFrame();
  var changed = [], commit = [], seen = {};
  for (var i = 0; i < els.length; i++) {
    var el = els[i], js = JSON.stringify(el);
    seen[el.id] = true;
    if (!sent[el.id] || sent[el.id].json !== js) { changed.push(el); commit.push([el.id, js, el]); }
  }
  for (var id in sent) {
    if (!seen[id]) { changed.push(deleteEl(sent[id].el)); commit.push([id, null, null]); }
  }
  if (changed.length === 0 && pendingLed === null) return;
  if (changed.length === 0) changed.push(BG);
  var body = { application_name: APP, elements: changed };
  var led = pendingLed;
  if (led !== null) { body.led_notification_color = led; pendingLed = null; }
  inFlight = true;
  function done(ok) {
    if (!ok && led !== null && pendingLed === null) pendingLed = led;   // retry
    if (ok) {
      for (var k = 0; k < commit.length; k++) {
        var c = commit[k];
        if (c[1] === null) delete sent[c[0]];
        else sent[c[0]] = { json: c[1], el: c[2] };
      }
    }
    inFlight = false;
    if (dirty) { dirty = false; render(); }
  }
  post(body)
    .then(function (r) { done(!r || r.ok !== false); }, function () { done(false); });
}

// ── Transition ──────────────────────────────────────────────
// apply() swaps the content; it runs at the midpoint, under a full overlay.
function transition(apply) {
  if (!FULL_MASK) { apply(); render(); return; }
  if (fx) {
    // Ride along with the running transition (or queue one right after);
    // chain so neither a page turn nor a theme change is lost.
    var key = fx.swapped ? "pending" : "apply";
    var prev = fx[key];
    fx[key] = prev ? function () { prev(); apply(); } : apply;
    return;
  }
  fx = { t0: Date.now(), apply: apply, swapped: false, pending: null };
  fxStep();
}

function fxStep() {
  if (!fx || !running) return;
  var p = (Date.now() - fx.t0) / FX_MS;
  if (p < 0.5) {
    fxLevel = Math.max(1, Math.ceil(p * 2 * FX_STEPS));
  } else if (!fx.swapped) {
    fx.swapped = true;
    fxLevel = FX_STEPS;                   // fully covered while swapping
    fx.apply();
  } else if (p < 1) {
    fxLevel = Math.max(1, Math.ceil((1 - p) * 2 * FX_STEPS));
  } else {
    fxLevel = 0;
    var next = fx.pending;
    fx = null;
    render();
    if (next) transition(next);
    return;
  }
  render();
  setTimeout(fxStep, FX_FRAME_MS);
}

// ── Paging ──────────────────────────────────────────────────
function showPage(idx, fade) {
  if (pageTimer !== null) { clearTimeout(pageTimer); pageTimer = null; }
  function apply() {
    if (pageTimer !== null) { clearTimeout(pageTimer); pageTimer = null; }
    if (buses.length === 0) { page = null; return; }
    var n = pageCount();
    pageIdx = ((idx % n) + n) % n;
    page = makePage(pageIdx);
    // Re-send destinations even if unchanged, so their marquee restarts.
    if (fade) { delete sent.d0; delete sent.d1; }
    if (n > 1) {
      pageTimer = setTimeout(function () { showPage(pageIdx + 1, true); },
        page.hold + (fade ? FX_MS / 2 : 0));
    }
  }
  if (fade) transition(apply);
  else { apply(); render(); }
}

// A lone page has no turns to pick up new data, so it's rebuilt in place —
// unchanged elements aren't re-sent, so that doesn't flicker.
function isLonePage() { return !fx && pageTimer === null; }

// ── Data ────────────────────────────────────────────────────
function parseFeed(body) {
  var lines = String(body).split("\n");
  var now = 0, list = [];
  for (var i = 0; i < lines.length; i++) {
    var row;
    try { row = JSON.parse(lines[i]); } catch (e) { continue; }
    if (!row || !row.length) continue;
    if (row[0] === 4) now = Number(row[2]);
    else if (row[0] === 1 && row.length >= 6) {
      list.push({ key: String(row[4]) + "/" + row[2], stand: clean(row[1]),
        line: clean(row[2]), dest: clean(row[3]), est: Number(row[5]) });
    }
  }
  return { now: now, list: list };
}

function scheduleRefresh(ms) {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, ms);
}

function refresh() {
  if (!running) return;
  refreshTimer = null;
  fetch(new Request(FEED_URL, { headers: { accept: "application/json" } }))
    .then(function (r) { return r.text(); })
    .then(function (body) {
      var feed = parseFeed(body);
      if (!(feed.now > 0)) throw new Error("bad feed");
      serverMs = feed.now;
      fetchedAt = Date.now();
      var cutoff = feed.now - 30000;
      var list = [];
      for (var i = 0; i < feed.list.length; i++) {
        var b = feed.list[i];
        if (b.est === b.est && b.est >= cutoff && b.est - feed.now < (MAX_MINS + 1) * 60000) list.push(b);
      }
      list.sort(function (a, b) { return a.est - b.est; });
      var had = buses.length > 0;
      buses = list;
      status = list.length ? "" : "No buses";
      if (!had || !page) showPage(0, true);
      else if (isLonePage()) showPage(pageIdx);
      else { rebindPage(); render(); }
      scheduleRefresh(REFRESH_MS);
    })
    .catch(function () {
      if (buses.length && Date.now() - fetchedAt > STALE_MS) { buses = []; showPage(0, true); }
      if (!buses.length) { status = "No signal"; render(); }
      scheduleRefresh(RETRY_MS);
    });
}

// Drop buses that have left since the last fetch (keeps "due" honest offline).
function prune() {
  if (!buses.length) return;
  var cutoff = tflNow() - 60000, kept = [];
  for (var i = 0; i < buses.length; i++) if (buses[i].est >= cutoff) kept.push(buses[i]);
  if (kept.length !== buses.length) {
    buses = kept;
    if (!buses.length) { status = "No buses"; showPage(0, true); }
    else if (isLonePage()) showPage(pageIdx);
  }
}

// ── Input ───────────────────────────────────────────────────
var unbind = listen("input", function (e) {
  if (e.key === "encoder") {
    if (buses.length) showPage(pageIdx + (e.delta > 0 ? 1 : -1), true);
  } else if (e.key === "start" && e.action === "press") {
    transition(function () {
      themeIdx = (themeIdx + 1) % THEMES.length;
      try { localStorage.setItem("theme", String(themeIdx)); } catch (err) {}
      pendingLed = theme().main;
    });
  } else if (e.key === "ok" && e.action === "press") {
    refresh();
  } else if (e.key === "back" && e.action === "press") {
    running = false;
    clearInterval(tickTimer);
    if (pageTimer !== null) clearTimeout(pageTimer);
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    if (unbind) unbind();
  }
});

// ── Go ──────────────────────────────────────────────────────
var tickTimer = setInterval(function () { prune(); render(); }, 1000);
render();
refresh();
