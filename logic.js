/* WO Sports - pure logic (no DOM). Works in the browser (window.WO) and in Node for testing. */
(function (root) {
  "use strict";

  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ---------- time helpers ---------- */
  function toMin(t) {
    var p = t.split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fromMin(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }

  function isPlaceable(s) {
    return DAYS.indexOf(s.day) !== -1 && TIME_RE.test(s.start_time) && TIME_RE.test(s.end_time) &&
      toMin(s.end_time) > toMin(s.start_time);
  }
  function dayIndex(s) { return DAYS.indexOf(s.day); }

  /* "18:30" -> "6:30pm", "20:00" -> "8pm" */
  function prettyTime(t) {
    if (!TIME_RE.test(t)) return t;
    var h = parseInt(t.slice(0, 2), 10), m = t.slice(3);
    var suffix = h >= 12 ? "pm" : "am";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m === "00" ? "" : ":" + m) + suffix;
  }
  function timeRange(s) {
    if (!isPlaceable(s)) return "Time to be confirmed";
    return s.start_time + "\u2013" + s.end_time;
  }

  /* ---------- overlap detection ---------- */
  function overlaps(a, b) {
    return a.day === b.day && toMin(a.start_time) < toMin(b.end_time) && toMin(b.start_time) < toMin(a.end_time);
  }
  /* returns [[a,b], ...] for every clashing pair among the given sessions */
  function findOverlaps(sessions) {
    var list = sessions.filter(isPlaceable), out = [];
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (overlaps(list[i], list[j])) out.push([list[i], list[j]]);
      }
    }
    return out;
  }
  function sortByWeekTime(list) {
    return list.slice().sort(function (a, b) {
      return dayIndex(a) - dayIndex(b) || toMin(a.start_time) - toMin(b.start_time) || toMin(a.end_time) - toMin(b.end_time);
    });
  }

  /* ---------- lane layout for blocks that overlap in the same column ---------- */
  /* returns {items:[{s, lane}], lanes:n} */
  function layoutLanes(sessions) {
    var sorted = sessions.slice().sort(function (a, b) {
      return toMin(a.start_time) - toMin(b.start_time) || toMin(b.end_time) - toMin(a.end_time);
    });
    var laneEnds = [], items = [];
    sorted.forEach(function (s) {
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= toMin(s.start_time)) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = toMin(s.end_time);
      items.push({ s: s, lane: lane });
    });
    return { items: items, lanes: Math.max(1, laneEnds.length) };
  }

  /* ---------- dates ---------- */
  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var idx = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - idx);
    return d;
  }
  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }
  function todayIndex(now) { return ((now || new Date()).getDay() + 6) % 7; }

  /* ---------- search ---------- */
  var SPORT_ALIASES = {
    basketball: "bball basket ball hoops",
    badminton: "shuttle shuttlecock racket racquet bad",
    swimming: "swim pool lane dip",
    hockey: "hocky stick pitch"
  };
  var DAY_ALIASES = {
    Monday: "mon", Tuesday: "tue tues", Wednesday: "wed", Thursday: "thu thur thurs",
    Friday: "fri", Saturday: "sat", Sunday: "sun"
  };

  /* every way someone might type a time: 18:30, 18.30, 1830, 6:30pm, 6.30pm, 6pm */
  function timeVariants(t) {
    if (!TIME_RE.test(t)) return "";
    var h = parseInt(t.slice(0, 2), 10), m = t.slice(3);
    var h12 = h % 12 === 0 ? 12 : h % 12, suf = h >= 12 ? "pm" : "am";
    var v = [t, t.replace(":", "."), t.replace(":", ""), h12 + ":" + m + suf, h12 + "." + m + suf, h12 + ":" + m + " " + suf];
    if (m === "00") v.push(h12 + suf, h12 + " " + suf, h + ":00");
    return v.join(" ");
  }

  function decorate(s) {
    var sportKey = (s.sport || "").toLowerCase();
    var copy = {};
    for (var k in s) copy[k] = s[k];
    copy._times = timeVariants(s.start_time) + " " + timeVariants(s.end_time);
    copy._keywords = (SPORT_ALIASES[sportKey] || "") + " " + (DAY_ALIASES[s.day] || "") + " women womens only female ladies girls";
    return copy;
  }

  /* Parse a token like "2pm", "14:00", "7.30pm", "1830" into minutes after midnight, or null */
  function parseTimeToken(tok) {
    var m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(tok) || /^(\d{2})(\d{2})$/.exec(tok);
    if (!m) return null;
    var h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0, suf = m[3] ? m[3].toLowerCase() : "";
    if (min > 59) return null;
    // bare numbers (e.g. "7") are too ambiguous -> only accept if they have am/pm, minutes, or 4 digits
    if (!suf && m[2] === undefined) return null;
    if (suf) {
      if (h < 1 || h > 12) return null;
      if (suf === "pm" && h !== 12) h += 12;
      if (suf === "am" && h === 12) h = 0;
    } else if (h > 23) return null;
    return h * 60 + min;
  }

  /* Split "swim 7pm tue" into { text: "swim tue", times: [1140] }. Handles "7 pm" too. */
  function parseQuery(q) {
    var cleaned = q.trim().replace(/(\d)\s+(am|pm)\b/gi, "$1$2");
    var tokens = cleaned.split(/\s+/).filter(Boolean), words = [], times = [];
    tokens.forEach(function (t) {
      var mins = parseTimeToken(t);
      if (mins !== null) times.push({ mins: mins, raw: t }); else words.push(t);
    });
    return { text: words.join(" "), times: times };
  }

  function sessionCoversTime(s, mins) {
    if (!TIME_RE.test(s.start_time) || !TIME_RE.test(s.end_time)) return false;
    var st = toMin(s.start_time), en = toMin(s.end_time);
    // running at that time, or starting within the hour that was typed
    return (mins >= st && mins < en) || (st >= mins && st < mins + 60);
  }

  var FUSE_KEYS = [
    { name: "session_name", weight: 3 },
    { name: "sport", weight: 3 },
    { name: "_keywords", weight: 2 },
    { name: "venue", weight: 2 },
    { name: "area", weight: 1.5 },
    { name: "day", weight: 1.5 },
    { name: "provider", weight: 1 },
    { name: "borough", weight: 1 },
    { name: "_times", weight: 1 }
  ];

  /* Minimal stand-in used only if Fuse.js cannot be loaded (e.g. first visit while offline). */
  function MiniFuse(list, opts) {
    this.list = list;
    this.keys = opts.keys.map(function (k) { return typeof k === "string" ? { name: k, weight: 1 } : k; });
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  MiniFuse.prototype.search = function (query) {
    var qTokens = query.toLowerCase().split(/\s+/).filter(Boolean), results = [];
    this.list.forEach(function (item) {
      var total = 0, matches = [], ok = true;
      qTokens.forEach(function (qt) {
        var best = null;
        this.keys.forEach(function (k) {
          var value = String(item[k.name] || ""), lower = value.toLowerCase(), words = lower.split(/[^a-z0-9:.]+/);
          var idx = lower.indexOf(qt), score = null, indices = [];
          if (idx !== -1) { score = 0; indices = [[idx, idx + qt.length - 1]]; }
          else if (qt.length >= 3) {
            var max = qt.length >= 7 ? 2 : 1;
            for (var w = 0; w < words.length; w++) {
              if (words[w].length && lev(qt, words[w], max) <= max) {
                var at = lower.indexOf(words[w]);
                score = 0.3; indices = [[at, at + words[w].length - 1]]; break;
              }
            }
          }
          if (score !== null) {
            var weighted = score / k.weight;
            if (!best || weighted < best.score) best = { score: weighted, key: k.name, value: value, indices: indices };
          }
        });
        if (best) { total += best.score; matches.push({ key: best.key, value: best.value, indices: best.indices }); } else ok = false;
      }, this);
      if (ok) results.push({ item: item, score: total / Math.max(1, qTokens.length), matches: matches });
    }, this);
    results.sort(function (a, b) { return a.score - b.score; });
    return results;
  };

  /* Build a searcher. FuseCtor is window.Fuse when available. */
  function createSearcher(sessions, FuseCtor) {
    var docs = sessions.map(decorate);
    var Engine = FuseCtor || MiniFuse;
    var engine = new Engine(docs, {
      keys: FUSE_KEYS,
      includeMatches: true,
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.34,
      minMatchCharLength: 2,
      shouldSort: true
    });
    var usingFuse = !!FuseCtor;

    function search(query) {
      var q = parseQuery(query);
      var pool = docs, hits;
      if (q.times.length) {
        pool = docs.filter(function (s) {
          return q.times.every(function (t) { return sessionCoversTime(s, t.mins); });
        });
      }
      if (q.text) {
        var allowed = {};
        pool.forEach(function (s) { allowed[s.id] = true; });
        hits = engine.search(q.text).filter(function (r) { return allowed[r.item.id]; });
      } else {
        hits = pool.map(function (s) { return { item: s, score: 0, matches: [] }; });
      }
      return hits.map(function (r) {
        var original = null;
        for (var i = 0; i < sessions.length; i++) if (sessions[i].id === r.item.id) { original = sessions[i]; break; }
        return { session: original, matches: r.matches || [], timeMatched: q.times.length > 0, usingFuse: usingFuse };
      });
    }
    return { search: search, usingFuse: usingFuse };
  }

  /* ---------- lucky dip ---------- */
  function luckyDip(sessions, chosenIds, opts) {
    opts = opts || {};
    var rand = opts.random || Math.random;
    var keep = opts.keep !== false;
    var sport = opts.sport || "";
    var chosen = keep ? sessions.filter(function (s) { return chosenIds.indexOf(s.id) !== -1; }) : [];
    var picked = chosen.map(function (s) { return s.id; });
    var added = 0;
    DAYS.forEach(function (day) {
      var dayChosen = chosen.filter(function (s) { return s.day === day; });
      if (dayChosen.length) return; // that day already has a pick
      var candidates = sessions.filter(function (s) {
        return s.day === day && isPlaceable(s) && (!sport || s.sport === sport);
      });
      if (!candidates.length) return;
      var choice = candidates[Math.floor(rand() * candidates.length)];
      picked.push(choice.id);
      added++;
    });
    return { ids: picked, added: added };
  }

  /* ---------- calendar export (.ics) ---------- */
  function icsEscape(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function fold(line) {
    // RFC 5545: lines max 75 octets; fold with CRLF + space
    var out = [], bytes = 0, cur = "";
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], len = unescape(encodeURIComponent(ch)).length;
      if (bytes + len > 74) { out.push(cur); cur = " " + ch; bytes = 1 + len; } else { cur += ch; bytes += len; }
    }
    out.push(cur);
    return out.join("\r\n");
  }
  function icsDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function icsStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  /* next date (today or later) that falls on the session's weekday and hasn't finished yet */
  function nextOccurrence(s, now) {
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = (dayIndex(s) - ((base.getDay() + 6) % 7) + 7) % 7;
    var d = addDays(base, diff);
    if (diff === 0) {
      var end = toMin(s.end_time), nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= end) d = addDays(d, 7);
    }
    return d;
  }
  function buildICS(sessions, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var weeks = opts.weeks || 1;
    var venues = opts.venues || {};
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WO Sports//Womens only sports sessions//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Women\u2019s only sports sessions"
    ];
    sortByWeekTime(sessions.filter(isPlaceable)).forEach(function (s) {
      var date = nextOccurrence(s, now), ds = icsDate(date);
      var v = venues[s.venue] || {};
      var desc = [
        s.session_name, "Provider: " + s.provider,
        s.confidence ? "Source confidence: " + s.confidence : "",
        s.notes ? "Notes: " + s.notes : "",
        "Check the source before you travel: " + s.source_url
      ].filter(Boolean).join("\n");
      var location = [s.venue, s.area, s.borough].filter(Boolean).join(", ");
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + s.id + "-" + ds + "@wo-sports");
      lines.push("DTSTAMP:" + icsStamp(now));
      lines.push("DTSTART:" + ds + "T" + s.start_time.replace(":", "") + "00");
      lines.push("DTEND:" + ds + "T" + s.end_time.replace(":", "") + "00");
      if (weeks > 1) lines.push("RRULE:FREQ=WEEKLY;COUNT=" + weeks);
      lines.push(fold("SUMMARY:" + icsEscape(s.sport + ": " + s.session_name)));
      lines.push(fold("LOCATION:" + icsEscape(location)));
      lines.push(fold("DESCRIPTION:" + icsEscape(desc)));
      lines.push(fold("URL:" + s.source_url));
      lines.push("BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Starts in 1 hour", "END:VALARM");
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  /* Some notes in the source CSV just say "As above". Replace those with the first real note
     from a row that shares the same source_url, so the app never shows a meaningless note. */
  function resolveNotes(list) {
    var lastBySource = {};
    return list.map(function (s) {
      var copy = {};
      for (var k in s) copy[k] = s[k];
      var note = (s.notes || "").trim();
      if (/^as above\.?$/i.test(note)) copy.notes = lastBySource[s.source_url] || "";
      else if (note && !lastBySource[s.source_url]) lastBySource[s.source_url] = note;
      return copy;
    });
  }

  var api = {
    DAYS: DAYS, toMin: toMin, fromMin: fromMin, isPlaceable: isPlaceable, dayIndex: dayIndex,
    prettyTime: prettyTime, timeRange: timeRange, overlaps: overlaps, findOverlaps: findOverlaps,
    sortByWeekTime: sortByWeekTime, layoutLanes: layoutLanes, mondayOf: mondayOf, addDays: addDays,
    todayIndex: todayIndex, createSearcher: createSearcher, parseQuery: parseQuery, luckyDip: luckyDip,
    buildICS: buildICS, resolveNotes: resolveNotes, nextOccurrence: nextOccurrence, MiniFuse: MiniFuse
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WO = api;
})(typeof window !== "undefined" ? window : globalThis);
