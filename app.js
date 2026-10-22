/* WO Sports - UI. All user data stays in this browser (localStorage). */
(function () {
  "use strict";

  var W = window.WO;
  var STORE_KEY = "wo.picked.v1";
  var HH = 84;       // pixels per hour in the grids (keep in step with --hh in styles.css)
  var LANE = 152;    // pixels per lane
  var SHORT = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MINUS = "\u2212";

  var state = {
    tab: "timetable",
    dayIdx: W.todayIndex(),
    weekStart: W.mondayOf(new Date()),
    calView: null,
    query: "",
    picked: [],
    sessions: [],
    byId: {},
    venues: {},
    weeks: 4,
    loadError: false,
    clearArmed: false
  };
  var searcher = null, toastTimer = null, clearTimer = null, refocus = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  /* ---------- storage ---------- */
  function loadPicked() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function savePicked() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.picked)); } catch (e) { /* private mode: keep in memory */ }
  }
  function isPicked(id) { return state.picked.indexOf(id) !== -1; }
  function pickedSessions() {
    return state.picked.map(function (id) { return state.byId[id]; }).filter(Boolean);
  }
  function clashingIds() {
    var set = {};
    W.findOverlaps(pickedSessions()).forEach(function (p) { set[p[0].id] = true; set[p[1].id] = true; });
    return set;
  }

  /* ---------- formatting ---------- */
  function fmtDate(d) { return d.getDate() + " " + MONTHS[d.getMonth()]; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function sportClass(s) { return "sport-" + slug(s.sport); }
  function plainWhen(s) {
    if (W.isPlaceable(s)) return s.day + " " + W.timeRange(s);
    var timesKnown = /^\d\d:\d\d$/.test(s.start_time) && /^\d\d:\d\d$/.test(s.end_time);
    var dayKnown = W.DAYS.indexOf(s.day) !== -1;
    if (timesKnown) return "Day to be confirmed, " + s.start_time + "\u2013" + s.end_time;
    if (dayKnown) return s.day + ", time to be confirmed";
    return "Day and time to be confirmed";
  }

  /* ---------- highlighting ---------- */
  function mergeRanges(ranges, len) {
    var r = ranges.filter(function (x) { return x[1] - x[0] + 1 >= 2; }).sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    r.forEach(function (x) {
      var last = out[out.length - 1];
      if (last && x[0] <= last[1] + 1) last[1] = Math.max(last[1], x[1]); else out.push([x[0], Math.min(x[1], len - 1)]);
    });
    return out;
  }
  function highlight(text, ranges) {
    text = String(text);
    if (!ranges || !ranges.length) return esc(text);
    var merged = mergeRanges(ranges, text.length), out = "", pos = 0;
    merged.forEach(function (r) {
      out += esc(text.slice(pos, r[0])) + "<mark>" + esc(text.slice(r[0], r[1] + 1)) + "</mark>";
      pos = r[1] + 1;
    });
    return out + esc(text.slice(pos));
  }
  var FIELD_FOR_KEY = { session_name: "name", sport: "sport", _keywords: "sport", venue: "venue", area: "area", day: "day", provider: "provider", borough: "borough", _times: "time" };
  function rangesByField(result) {
    var map = {};
    (result.matches || []).forEach(function (m) {
      var field = FIELD_FOR_KEY[m.key];
      if (!field) return;
      if (m.key === "_keywords" || m.key === "_times") {
        map[field] = "all"; // alias or time matched: mark the whole visible label
        return;
      }
      map[field] = (map[field] === "all") ? "all" : (map[field] || []).concat((m.indices || []).map(function (i) { return [i[0], i[1]]; }));
    });
    if (result.timeMatched) map.time = "all";
    return map;
  }
  function hl(map, field, text) {
    var v = map && map[field];
    if (v === "all") return "<mark>" + esc(text) + "</mark>";
    return highlight(text, v);
  }

  /* ---------- toggle button ---------- */
  function toggleBtn(s, wide) {
    if (!W.isPlaceable(s)) return "";
    var on = isPicked(s.id);
    var label = (on ? "Remove from My Calendar: " : "Add to My Calendar: ") + s.session_name + ", " + s.venue + ", " + s.day + " " + W.timeRange(s);
    var sign = on ? MINUS : "+";
    if (wide) {
      return '<button type="button" class="toggle wide' + (on ? " on" : "") + '" data-toggle="' + esc(s.id) + '" aria-label="' + esc(label) + '">' +
        '<span class="sign" aria-hidden="true">' + sign + "</span><span>" + (on ? "Remove from My Calendar" : "Add to My Calendar") + "</span></button>";
    }
    return '<button type="button" class="toggle' + (on ? " on" : "") + '" data-toggle="' + esc(s.id) + '" aria-label="' + esc(label) + '"><span aria-hidden="true">' + sign + "</span></button>";
  }

  /* ---------- session card (lists + search results) ---------- */
  function cardHTML(s, result, clash, showDay) {
    var map = result ? rangesByField(result) : null;
    var when = W.isPlaceable(s) ? (showDay === false ? W.timeRange(s) : s.day + " " + W.timeRange(s)) : plainWhen(s);
    var whenHtml;
    if (map && map.time === "all" && W.isPlaceable(s)) whenHtml = hl(map, "day", s.day + " ") + "<mark>" + esc(W.timeRange(s)) + "</mark>";
    else if (W.isPlaceable(s) && showDay !== false) whenHtml = hl(map, "day", s.day) + " " + esc(W.timeRange(s));
    else whenHtml = esc(when);
    var check = s.confidence && s.confidence.toLowerCase() !== "high" ? '<span class="pill check">Check first</span>' : "";
    return '<li class="card ' + sportClass(s) + (clash ? " has-clash" : "") + '">' +
      '<div class="body"><button type="button" class="open" data-open="' + esc(s.id) + '">' +
      '<span class="name">' + hl(map, "name", s.session_name) + "</span>" +
      '<span class="meta"><span class="pill ' + sportClass(s) + '">' + hl(map, "sport", s.sport) + "</span>" + check + '<span class="when">' + whenHtml + "</span></span>" +
      '<span class="meta">' + hl(map, "venue", s.venue) + ", " + hl(map, "area", s.area) + " &middot; " + hl(map, "provider", s.provider) + "</span>" +
      (clash ? '<span class="meta"><strong>Clashes with another pick</strong></span>' : "") +
      "</button></div>" +
      (W.isPlaceable(s) ? toggleBtn(s) : '<span class="tbc">Time to confirm</span>') +
      "</li>";
  }

  /* ---------- grid builder ---------- */
  function buildGrid(cols, range, label) {
    var startH = Math.floor(range.min / 60), endH = Math.ceil(range.max / 60);
    if (endH <= startH) endH = startH + 1;
    var height = (endH - startH) * HH;
    var clash = clashingIds();
    var head = '<div class="corner"></div>', body = "", hours = "";
    for (var h = startH; h <= endH; h++) {
      hours += '<div class="hour" style="top:' + ((h - startH) * HH) + 'px">' + (h < 10 ? "0" : "") + h + ":00</div>";
    }
    cols.forEach(function (c) {
      var lay = W.layoutLanes(c.sessions), width = Math.max(LANE, lay.lanes * LANE);
      var style = "flex:1 0 " + width + "px;min-width:" + width + "px";
      head += '<div class="colhead' + (c.today ? " today" : "") + '" style="' + style + '">' + c.head + "</div>";
      var lines = "";
      for (var hh = startH; hh <= endH; hh++) lines += '<div class="hourline" style="top:' + ((hh - startH) * HH) + 'px"></div>';
      var blocks = lay.items.map(function (it) {
        var s = it.s, top = (W.toMin(s.start_time) - startH * 60) / 60 * HH, h2 = (W.toMin(s.end_time) - W.toMin(s.start_time)) / 60 * HH - 3;
        var left = (it.lane / lay.lanes * 100), w = 100 / lay.lanes;
        var cls = "block " + sportClass(s) + (isPicked(s.id) ? " is-picked" : "") + (clash[s.id] ? " has-clash" : "");
        var aria = s.session_name + ", " + s.sport + ", " + s.venue + ", " + s.day + " " + W.timeRange(s) + ". Open details";
        return '<div class="' + cls + '" style="top:' + top + "px;height:" + h2 + "px;left:calc(" + left + "% + 2px);width:calc(" + w + '% - 4px)">' +
          '<button type="button" class="main" data-open="' + esc(s.id) + '" aria-label="' + esc(aria) + '">' +
          '<span class="t">' + esc(W.timeRange(s)) + '</span><span class="n">' + esc(s.session_name) + '</span><span class="w">' + esc(c.showVenue ? s.venue : s.sport) + "</span></button>" +
          toggleBtn(s) + "</div>";
      }).join("");
      body += '<div class="col' + (c.today ? " today" : "") + '" style="' + style + ";height:" + height + 'px">' + lines + blocks + "</div>";
    });
    return '<div class="grid-wrap"><div class="grid-scroll" tabindex="0" role="region" aria-label="' + esc(label) + '">' +
      '<div class="grid"><div class="grid-head">' + head + '</div><div class="grid-body"><div class="timecol" style="height:' + height + 'px">' + hours + "</div>" + body + "</div></div></div></div>";
  }
  function rangeOf(list) {
    var min = 24 * 60, max = 0;
    list.forEach(function (s) {
      if (!W.isPlaceable(s)) return;
      min = Math.min(min, W.toMin(s.start_time)); max = Math.max(max, W.toMin(s.end_time));
    });
    if (min > max) { min = 9 * 60; max = 21 * 60; }
    return { min: min, max: max };
  }
  function placeable() { return state.sessions.filter(W.isPlaceable); }

  /* ---------- search ---------- */
  function getSearcher() {
    var wantFuse = !!window.Fuse;
    if (!searcher || searcher.usingFuse !== wantFuse) searcher = W.createSearcher(state.sessions, window.Fuse);
    return searcher;
  }
  function resultsHTML() {
    var q = state.query.trim();
    var res = getSearcher().search(q);
    var status = res.length ? res.length + (res.length === 1 ? " result" : " results") : "No results";
    $("#q-status").textContent = status;
    var clash = clashingIds();
    if (!res.length) {
      var hockey = /hock/i.test(q) ? "<p>No women\u2019s-only hockey sessions have been found yet in Hackney or Tower Hamlets.</p>" : "";
      return '<div class="empty-state"><h2>Nothing matched \u201C' + esc(q) + "\u201D</h2>" + hockey +
        "<p>Check the spelling, or try a sport, venue, day or time such as \u201Cswim\u201D, \u201CPoplar\u201D, \u201CTuesday\u201D or \u201C7pm\u201D.</p></div>";
    }
    return '<ul class="cards">' + res.map(function (r) { return cardHTML(r.session, r, clash[r.session.id]); }).join("") + "</ul>" +
      (res[0].usingFuse ? "" : '<p class="source-note">Using the built-in matcher (Fuse.js could not load). Search still works.</p>');
  }
  function searchLanding() {
    var sports = [];
    state.sessions.forEach(function (s) { if (sports.indexOf(s.sport) === -1) sports.push(s.sport); });
    $("#q-status").textContent = "";
    return '<div class="empty-state"><h2>Find a session</h2>' +
      "<p>Search by sport, venue, area, day or time. Typos are fine, and so are times like \u201C2pm\u201D or \u201C18:30\u201D.</p>" +
      '<div class="chips">' + sports.map(function (s) { return '<button type="button" class="chip" data-chip="' + esc(s) + '">' + esc(s) + "</button>"; }).join("") + "</div></div>";
  }

  /* ---------- timetable view ---------- */
  function renderTimetable() {
    var days = $("#tt-days"), pane = $("#tt-body"), q = state.query.trim();
    days.hidden = !!q;
    if (q) {
      pane.innerHTML = '<div class="scroll-y">' + '<p class="note">Results for \u201C' + esc(q) + "\u201D. <button type=\"button\" class=\"chip\" data-chip=\"\" style=\"min-height:44px\">Back to timetable</button></p>" + resultsHTML() + "</div>";
      return;
    }
    $("#q-status").textContent = "";
    var counts = W.DAYS.map(function (d) { return placeable().filter(function (s) { return s.day === d; }).length; });
    var now = new Date(), monday = W.mondayOf(now);
    days.innerHTML = W.DAYS.map(function (d, i) {
      var sel = i === state.dayIdx;
      return '<button type="button" role="tab" id="day-' + i + '" aria-selected="' + sel + '" aria-controls="tt-body" tabindex="' + (sel ? 0 : -1) + '" data-day="' + i + '" class="' + (counts[i] ? "" : "empty") + (i === W.todayIndex() ? " today" : "") + '" aria-label="' + d + ", " + counts[i] + (counts[i] === 1 ? " session" : " sessions") + (i === W.todayIndex() ? ", today" : "") + '">' +
        "<span>" + SHORT[d] + "</span><small>" + fmtDate(W.addDays(monday, i)).split(" ")[0] + "</small></button>";
    }).join("");

    var day = W.DAYS[state.dayIdx], list = placeable().filter(function (s) { return s.day === day; });
    var html;
    if (!list.length) {
      var nextIdx = -1;
      for (var k = 1; k <= 7; k++) { var j = (state.dayIdx + k) % 7; if (counts[j]) { nextIdx = j; break; } }
      html = '<div class="scroll-y"><div class="empty-state"><h2>No confirmed sessions on ' + day + "</h2><p>Nothing women\u2019s-only has been found for this day yet.</p>" +
        (nextIdx > -1 ? '<div class="chips"><button type="button" class="chip" data-day="' + nextIdx + '">Go to ' + W.DAYS[nextIdx] + "</button></div>" : "") + "</div></div>";
    } else {
      var byVenue = {};
      list.forEach(function (s) { (byVenue[s.venue] = byVenue[s.venue] || []).push(s); });
      var venues = Object.keys(byVenue).sort(function (a, b) {
        var A = byVenue[a][0], B = byVenue[b][0];
        return A.borough.localeCompare(B.borough) || a.localeCompare(b);
      });
      var cols = venues.map(function (v) {
        var s0 = byVenue[v][0];
        return { head: esc(v) + "<small>" + esc(s0.area) + "</small>", sessions: byVenue[v], showVenue: false };
      });
      html = buildGrid(cols, rangeOf(list), day + " timetable, venues across the top, times down the side");
    }
    var tbc = state.sessions.filter(function (s) { return !W.isPlaceable(s); });
    if (tbc.length) {
      html += '<details class="tbc-panel"><summary>' + tbc.length + " sessions with no confirmed day or time</summary>" +
        '<p class="note">These are women\u2019s-only sessions the source confirms exist, but the day or time could not be verified, so they cannot go on the calendar yet. Open one to check the source.</p>' +
        '<ul class="cards">' + tbc.map(function (s) { return cardHTML(s, null, false); }).join("") + "</ul></details>";
    }
    pane.innerHTML = html;
  }

  /* ---------- search view ---------- */
  function renderSearch() {
    var body = $("#search-body");
    body.innerHTML = state.query.trim() ? resultsHTML() : searchLanding();
  }

  /* ---------- calendar view ---------- */
  function renderCalendar() {
    var top = $("#cal-top"), pane = $("#cal-body");
    var picks = pickedSessions(), clash = clashingIds(), overlaps = W.findOverlaps(picks);
    if (state.calView === null) state.calView = picks.length ? "list" : "grid";
    var warn = "";
    if (overlaps.length) {
      warn = '<div class="warn" role="alert"><strong>Heads up: ' + overlaps.length + (overlaps.length === 1 ? " clash" : " clashes") + " in your picks.</strong><ul>" +
        overlaps.map(function (p) {
          return "<li>" + esc(p[0].day) + ": " + esc(p[0].session_name) + " at " + esc(p[0].venue) + " (" + W.timeRange(p[0]) + ") overlaps " + esc(p[1].session_name) + " at " + esc(p[1].venue) + " (" + W.timeRange(p[1]) + ")</li>";
        }).join("") + "</ul></div>";
    }
    var weekEnd = W.addDays(state.weekStart, 6);
    var weeknav = state.calView === "grid" ?
      '<div class="weeknav"><button type="button" data-week="-1" aria-label="Previous week">&lsaquo;</button><div class="label" aria-live="polite">' +
      fmtDate(state.weekStart) + " \u2013 " + fmtDate(weekEnd) + " " + weekEnd.getFullYear() + '</div><button type="button" data-week="1" aria-label="Next week">&rsaquo;</button></div>' : "";
    var none = !picks.length;
    var miniWarn = overlaps.length && state.calView === "grid" ?
      '<button type="button" class="warn mini" data-cv="list" role="alert">\u26A0 ' + overlaps.length + (overlaps.length === 1 ? " clash" : " clashes") + " in your picks. Tap for details</button>" : "";
    top.innerHTML = (state.calView === "grid" ? miniWarn : "") + weeknav +
      '<div class="cal-actions">' +
      '<button type="button" class="btn" data-act="dip">Lucky dip</button>' +
      '<button type="button" class="btn primary" data-act="export" aria-disabled="' + none + '">Export to phone calendar</button>' +
      '<button type="button" class="btn danger" data-act="clear" aria-disabled="' + none + '">' + (state.clearArmed ? "Tap again" : "Clear") + "</button></div>" +
      '<div class="segment" role="group" aria-label="Calendar view">' +
      '<button type="button" data-cv="list" aria-pressed="' + (state.calView === "list") + '">My sessions (' + picks.length + ")</button>" +
      '<button type="button" data-cv="grid" aria-pressed="' + (state.calView === "grid") + '">Week grid</button></div>';

    if (state.calView === "list") {
      if (!picks.length) {
        pane.innerHTML = '<div class="scroll-y"><div class="empty-state"><h2>Nothing in your calendar yet</h2><p>Tap the + on any session to add it, or let a lucky dip fill your week.</p>' +
          '<div class="chips"><button type="button" class="chip" data-act="dip">Lucky dip</button><button type="button" class="chip" data-cv="grid">Browse the week grid</button></div></div></div>';
        return;
      }
      var html = "";
      W.DAYS.forEach(function (d) {
        var list = W.sortByWeekTime(picks.filter(function (s) { return s.day === d; }));
        if (!list.length) return;
        html += '<section class="daygroup"><h3>' + d + '</h3><ul class="cards">' + list.map(function (s) { return cardHTML(s, null, clash[s.id], false); }).join("") + "</ul></section>";
      });
      pane.innerHTML = '<div class="scroll-y">' + warn + html + '<p class="source-note">Sessions repeat weekly in the data. Check each source before you travel.</p></div>';
      return;
    }

    var today = new Date();
    var cols = W.DAYS.map(function (d, i) {
      var date = W.addDays(state.weekStart, i);
      return {
        head: SHORT[d] + "<small>" + fmtDate(date) + "</small>", today: sameDay(date, today),
        sessions: placeable().filter(function (s) { return s.day === d; }), showVenue: true
      };
    });
    pane.innerHTML = buildGrid(cols, rangeOf(placeable()), "Week calendar, dates across the top, times down the side");
  }

  /* ---------- dialogs ---------- */
  function mapsLink(s) {
    var v = state.venues[s.venue] || {};
    var q = v.maps_query || [s.venue, s.area, "London"].join(", ");
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }
  function detailHTML(s) {
    var v = state.venues[s.venue] || {};
    var row = function (k, val) { return val ? "<dt>" + k + "</dt><dd>" + val + "</dd>" : ""; };
    var url = /^https?:\/\//.test(s.source_url) ? '<a href="' + esc(s.source_url) + '" target="_blank" rel="noopener noreferrer">Open source page</a>' : "";
    var dayShown = W.DAYS.indexOf(s.day) !== -1 ? esc(s.day) : esc(s.day) + " (to be confirmed)";
    var start = /^\d\d:\d\d$/.test(s.start_time) ? esc(s.start_time) : esc(s.start_time) + " (to be confirmed)";
    var end = /^\d\d:\d\d$/.test(s.end_time) ? esc(s.end_time) : esc(s.end_time) + " (to be confirmed)";
    var note = s.notes ? '<p class="callout"><strong>Good to know:</strong> ' + esc(s.notes) + "</p>" : "";
    var conf = s.confidence && s.confidence.toLowerCase() !== "high" ?
      '<p class="callout"><strong>Check before you go.</strong> Source confidence is ' + esc(s.confidence.toLowerCase()) + ". Confirm the day and time on the source page or with the venue.</p>" : "";
    return '<div class="dlg"><div class="dlg-head"><h2 id="detail-title">' + esc(s.session_name) + '</h2><button type="button" class="dlg-close" data-close="detail" aria-label="Close details">&times;</button></div>' +
      '<div class="dlg-body"><dl class="facts">' +
      row("Sport", esc(s.sport)) + row("Session", esc(s.session_name)) + row("Provider", esc(s.provider)) +
      row("Venue", esc(s.venue)) + row("Area", esc(s.area)) + row("Borough", esc(s.borough)) +
      row("Repeats", esc(s.date_or_recurrence)) + row("Day", dayShown) + row("Start", start) + row("End", end) +
      row("Source", url) + "</dl>" + conf + note +
      (v.directions ? '<p class="callout"><strong>Getting there:</strong> ' + esc(v.directions) + "</p>" : "") + "</div>" +
      '<div class="dlg-foot">' + (W.isPlaceable(s) ? toggleBtn(s, true) : '<span class="tbc">Add to My Calendar once the time is confirmed</span>') +
      '<a class="btn" href="' + esc(mapsLink(s)) + '" target="_blank" rel="noopener noreferrer">Open in Maps</a></div></div>';
  }
  function openDetail(id) {
    var s = state.byId[id]; if (!s) return;
    var dlg = $("#detail");
    dlg.dataset.id = id;
    dlg.innerHTML = detailHTML(s);
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  }
  function refreshDetail() {
    var dlg = $("#detail");
    if (dlg.open && dlg.dataset.id) dlg.innerHTML = detailHTML(state.byId[dlg.dataset.id]);
  }
  function showAction(html) {
    var dlg = $("#action");
    dlg.innerHTML = html;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
    var first = $("select, button.btn", dlg); if (first) first.focus();
  }
  function closeDialog(id) { var d = $("#" + id); if (d.open) d.close(); }

  function sportsList() {
    var out = [];
    state.sessions.forEach(function (s) { if (W.isPlaceable(s) && out.indexOf(s.sport) === -1) out.push(s.sport); });
    return out;
  }
  function dipDialog() {
    showAction('<div class="dlg"><div class="dlg-head"><h2 id="action-title">Lucky dip</h2><button type="button" class="dlg-close" data-close="action" aria-label="Close">&times;</button></div>' +
      '<div class="dlg-body"><p>Picks one random session for each day that has one, so nothing clashes.</p>' +
      '<div class="field"><label for="dip-sport">Sport</label><select id="dip-sport"><option value="">Any sport</option>' +
      sportsList().map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("") + "</select></div>" +
      '<div class="check-row"><input type="checkbox" id="dip-keep" checked><label for="dip-keep">Keep the sessions I have already picked</label></div></div>' +
      '<div class="dlg-foot"><button type="button" class="btn primary" data-act="dip-go">Pick for me</button><button type="button" class="btn" data-close="action">Cancel</button></div></div>');
  }
  function exportDialog() {
    var picks = pickedSessions().filter(W.isPlaceable);
    showAction('<div class="dlg"><div class="dlg-head"><h2 id="action-title">Export to phone calendar</h2><button type="button" class="dlg-close" data-close="action" aria-label="Close">&times;</button></div>' +
      '<div class="dlg-body"><p>Downloads an .ics file with your ' + picks.length + (picks.length === 1 ? " session" : " sessions") + ". Open it on your phone to add them to your calendar app.</p>" +
      '<div class="field"><label for="exp-weeks">Repeat weekly for</label><select id="exp-weeks">' +
      [1, 4, 8, 12].map(function (n) { return '<option value="' + n + '"' + (n === state.weeks ? " selected" : "") + ">" + (n === 1 ? "This week only" : n + " weeks") + "</option>"; }).join("") + "</select></div>" +
      '<p class="source-note">Times come from standing timetables and can change. Check each source before you travel.</p></div>' +
      '<div class="dlg-foot"><button type="button" class="btn primary" data-act="export-go">Download .ics</button><button type="button" class="btn" data-close="action">Cancel</button></div></div>');
  }

  /* ---------- actions ---------- */
  function toast(msg, warn) {
    var t = $("#toast");
    t.hidden = false; t.className = "toast" + (warn ? " warn-toast" : "");
    t.textContent = "";
    setTimeout(function () { t.textContent = msg; }, 20);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, warn ? 6000 : 3500);
  }

  function toggle(id, fromDialog) {
    var s = state.byId[id]; if (!s || !W.isPlaceable(s)) return;
    if (isPicked(id)) {
      state.picked = state.picked.filter(function (x) { return x !== id; });
      toast("Removed from My Calendar");
    } else {
      var clash = pickedSessions().filter(function (p) { return W.overlaps(p, s); });
      state.picked.push(id);
      if (clash.length) toast("Added, but it clashes with " + clash[0].session_name + " at " + clash[0].venue + " (" + W.timeRange(clash[0]) + ")", true);
      else toast("Added to My Calendar");
    }
    savePicked();
    refocus = { id: id, dialog: !!fromDialog };
    render();
  }

  function doExport() {
    var picks = pickedSessions().filter(W.isPlaceable);
    if (!picks.length) return;
    var weeks = parseInt($("#exp-weeks").value, 10) || 1;
    state.weeks = weeks;
    var ics = W.buildICS(picks, { weeks: weeks, venues: state.venues });
    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "wo-sports-sessions.ics";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    closeDialog("action");
    toast("Calendar file downloaded. Open it to add your sessions.");
  }

  function doDip() {
    var sport = $("#dip-sport").value, keep = $("#dip-keep").checked;
    var out = W.luckyDip(state.sessions, state.picked, { sport: sport, keep: keep });
    state.picked = out.ids; savePicked();
    state.calView = "list";
    closeDialog("action");
    render();
    toast(out.added ? "Picked " + out.added + (out.added === 1 ? " session" : " sessions") + ", one per day" : "Nothing new to add. Every day already has a pick or no sessions match.");
  }

  /* ---------- render orchestration ---------- */
  function render() {
    var scroll = {};
    $$(".grid-scroll, .scroll-y").forEach(function (el) {
      var view = el.closest(".view"); if (view) scroll[view.id + (el.classList.contains("grid-scroll") ? "g" : "s")] = [el.scrollLeft, el.scrollTop];
    });
    $$(".view").forEach(function (v) { v.hidden = v.id !== "view-" + state.tab; });
    $("#searchbar").hidden = state.tab === "calendar";
    $$(".tabs button").forEach(function (b) {
      if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    var badge = $("#badge"); badge.hidden = !state.picked.length; badge.textContent = state.picked.length;
    badge.setAttribute("aria-label", state.picked.length + " picked");

    // only the active view keeps DOM, so ids/buttons are never duplicated in hidden views
    if (state.tab !== "timetable") { $("#tt-days").innerHTML = ""; $("#tt-body").innerHTML = ""; }
    if (state.tab !== "calendar") { $("#cal-top").innerHTML = ""; $("#cal-body").innerHTML = ""; }
    if (state.tab !== "search") $("#search-body").innerHTML = "";
    if (state.loadError) {
      $("#tt-body").innerHTML = '<div class="empty-state"><h2>Could not load the timetable</h2><p>Check your connection and try again.</p><div class="chips"><button class="chip" data-act="reload">Try again</button></div></div>';
    } else {
      if (state.tab === "timetable") renderTimetable();
      if (state.tab === "calendar") renderCalendar();
      if (state.tab === "search") renderSearch();
    }
    $$(".grid-scroll, .scroll-y").forEach(function (el) {
      var view = el.closest(".view"); if (!view) return;
      var pos = scroll[view.id + (el.classList.contains("grid-scroll") ? "g" : "s")];
      if (pos) { el.scrollLeft = pos[0]; el.scrollTop = pos[1]; }
    });
    refreshDetail();
    if (refocus) {
      var target = $((refocus.dialog ? "#detail " : "#main ") + '[data-toggle="' + refocus.id + '"]');
      if (target) target.focus({ preventScroll: true });
      refocus = null;
    }
    $("#q-clear").hidden = !state.query;
  }

  function setTab(tab) {
    state.tab = tab;
    render();
    var main = $("#main"); main.scrollTop = 0;
  }

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-toggle],[data-open],[data-tab],[data-day],[data-week],[data-cv],[data-act],[data-chip],[data-close]");
    if (!t) return;
    if (t.dataset.toggle) { toggle(t.dataset.toggle, !!t.closest("#detail")); return; }
    if (t.dataset.open) { openDetail(t.dataset.open); return; }
    if (t.dataset.close) { closeDialog(t.dataset.close); return; }
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.day !== undefined) { state.dayIdx = parseInt(t.dataset.day, 10); render(); var tab = $("#day-" + state.dayIdx); if (tab) tab.focus(); return; }
    if (t.dataset.week) { state.weekStart = W.addDays(state.weekStart, 7 * parseInt(t.dataset.week, 10)); render(); return; }
    if (t.dataset.cv) { state.calView = t.dataset.cv; render(); return; }
    if (t.dataset.chip !== undefined) {
      state.query = t.dataset.chip; $("#q").value = state.query;
      if (state.tab === "calendar") state.tab = "search";
      render(); return;
    }
    var act = t.dataset.act;
    if (act === "dip") dipDialog();
    else if (act === "dip-go") doDip();
    else if (act === "export") { if (state.picked.length) exportDialog(); else toast("Add a session first, then export."); }
    else if (act === "export-go") doExport();
    else if (act === "reload") location.reload();
    else if (act === "clear") {
      if (!state.picked.length) { toast("Nothing to clear."); return; }
      if (!state.clearArmed) {
        state.clearArmed = true; render();
        clearTimeout(clearTimer); clearTimer = setTimeout(function () { state.clearArmed = false; render(); }, 4000);
      } else {
        clearTimeout(clearTimer); state.clearArmed = false; state.picked = []; savePicked(); state.calView = "grid"; render(); toast("My Calendar cleared");
      }
    }
  });

  $("#q").addEventListener("input", function (e) {
    state.query = e.target.value;
    render();
  });
  $("#q").addEventListener("keydown", function (e) { if (e.key === "Enter") e.target.blur(); });
  $("#q-clear").addEventListener("click", function () { state.query = ""; $("#q").value = ""; render(); $("#q").focus(); });

  // arrow keys inside the day tabs
  $("#tt-days").addEventListener("keydown", function (e) {
    var map = { ArrowRight: 1, ArrowLeft: -1 };
    if (e.key === "Home") state.dayIdx = 0;
    else if (e.key === "End") state.dayIdx = 6;
    else if (map[e.key]) state.dayIdx = (state.dayIdx + map[e.key] + 7) % 7;
    else return;
    e.preventDefault(); render(); var t = $("#day-" + state.dayIdx); if (t) t.focus();
  });

  // close dialogs when the backdrop is tapped
  ["detail", "action"].forEach(function (id) {
    $("#" + id).addEventListener("click", function (e) { if (e.target === e.currentTarget) closeDialog(id); });
  });

  /* ---------- start ---------- */
  function load() {
    return Promise.all([
      fetch("timetable.json").then(function (r) { if (!r.ok) throw new Error("timetable"); return r.json(); }),
      fetch("venues.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    ]).then(function (res) {
      state.sessions = W.resolveNotes(res[0]);
      state.byId = {}; state.sessions.forEach(function (s) { state.byId[s.id] = s; });
      state.venues = res[1] || {};
      state.picked = loadPicked().filter(function (id) { return !!state.byId[id] && W.isPlaceable(state.byId[id]); });
      savePicked();
      state.loadError = false;
    }).catch(function () { state.loadError = true; });
  }

  load().then(function () { render(); });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
