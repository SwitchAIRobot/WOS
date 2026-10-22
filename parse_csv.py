#!/usr/bin/env python3
"""
One-time (and repeatable) parser: Womens_only_sports_session_data.csv -> timetable.json

Usage:
    python3 parse_csv.py                       # uses the default file names
    python3 parse_csv.py my.csv timetable.json

It also writes parse_report.txt listing every row it could not parse with full
confidence, so you can check them by hand.

The source CSV has a quirk: every line is wrapped in one extra pair of quotes, so a
normal CSV reader sees ONE long field per row. This script detects that and re-parses
the inner text. Rows repaired this way are listed in the report as "info" only.
"""
import csv
import io
import json
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "Womens_only_sports_session_data.csv"
DST = sys.argv[2] if len(sys.argv) > 2 else "timetable.json"
REPORT = "parse_report.txt"

EXPECTED = [
    "week_commencing", "sport", "session_name", "provider", "venue", "area",
    "borough", "date_or_recurrence", "day", "start_time", "end_time",
    "source_url", "date_checked", "confidence", "notes",
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
BOROUGHS = {"Hackney", "Tower Hamlets"}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def read_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        raw = list(csv.reader(fh))
    rows = []
    for line_no, fields in enumerate(raw, start=1):
        if not fields or all(not f.strip() for f in fields):
            continue
        repaired = False
        if len(fields) == 1 and "," in fields[0]:
            # whole row was wrapped in one pair of quotes -> parse the inner text
            fields = next(csv.reader(io.StringIO(fields[0])))
            repaired = True
        rows.append((line_no, fields, repaired))
    return rows


def main():
    rows = read_rows(SRC)
    header_line, header, _ = rows[0]
    header = [h.strip() for h in header]
    if header != EXPECTED:
        print("WARNING: header differs from the expected columns:\n", header)

    sessions, flags, used_ids = [], [], set()
    repaired_count = 0

    for line_no, fields, repaired in rows[1:]:
        problems = []
        info = []
        if len(fields) != len(header):
            problems.append(f"expected {len(header)} columns, found {len(fields)}")
            fields = (fields + [""] * len(header))[: len(header)]
        rec = {k: v.strip() for k, v in zip(header, fields)}

        if repaired:
            repaired_count += 1

        day, start, end = rec["day"], rec["start_time"], rec["end_time"]
        if day not in DAYS:
            problems.append(f'day is "{day}" (cannot be placed on the grid)')
        if not TIME_RE.match(start):
            problems.append(f'start_time is "{start}" (cannot be placed on the grid)')
        if not TIME_RE.match(end):
            problems.append(f'end_time is "{end}" (cannot be placed on the grid)')
        if TIME_RE.match(start) and TIME_RE.match(end) and end <= start:
            problems.append("end_time is not after start_time")
        if rec["borough"] not in BOROUGHS:
            problems.append(f'borough "{rec["borough"]}" is not Hackney or Tower Hamlets')
        if not rec["source_url"].startswith("http"):
            problems.append("source_url is missing or not a link")
        for key in ("sport", "session_name", "provider", "venue"):
            if not rec[key]:
                problems.append(f"{key} is empty")
        if rec["confidence"] and rec["confidence"].lower() != "high":
            problems.append(f'source confidence is {rec["confidence"]} - verify before relying on it')

        placeable = day in DAYS and TIME_RE.match(start) and TIME_RE.match(end)
        if placeable:
            base = "-".join([slug(rec["sport"]), slug(rec["venue"]), slug(day), slug(start.replace(":", ""))])
        else:
            base = "-".join([slug(rec["sport"]), slug(rec["venue"]), slug(rec["session_name"]), "tbc"])
        uid, n = base, 2
        while uid in used_ids:
            uid = f"{base}-{n}"
            n += 1
        used_ids.add(uid)

        sessions.append({
            "id": uid,
            "week_commencing": rec["week_commencing"],
            "sport": rec["sport"],
            "session_name": rec["session_name"],
            "provider": rec["provider"],
            "venue": rec["venue"],
            "area": rec["area"],
            "borough": rec["borough"],
            "date_or_recurrence": rec["date_or_recurrence"],
            "day": day,
            "start_time": start,
            "end_time": end,
            "source_url": rec["source_url"],
            # extra fields, kept so the app can show caveats
            "confidence": rec["confidence"],
            "notes": rec["notes"],
        })
        if problems or info:
            flags.append((line_no, uid, rec["session_name"], rec["venue"], problems, info))

    with open(DST, "w", encoding="utf-8") as fh:
        json.dump(sessions, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    n_placeable = sum(1 for s in sessions if s["day"] in DAYS and TIME_RE.match(s["start_time"]) and TIME_RE.match(s["end_time"]))
    lines = [
        f"Parsed {len(sessions)} sessions from {SRC} -> {DST}",
        f"{n_placeable} can be placed on the grid; {len(sessions) - n_placeable} have no confirmed day/time.",
        f"{repaired_count} rows were wrapped in an extra pair of quotes in the CSV and were repaired automatically.",
        "",
        "ROWS TO CHECK (line numbers refer to the CSV file, line 1 = header):",
        "",
    ]
    for line_no, uid, name, venue, problems, info in flags:
        lines.append(f"Line {line_no}: {name} @ {venue}  [{uid}]")
        for p in problems:
            lines.append(f"   CHECK: {p}")
        for i in info:
            lines.append(f"   info:  {i}")
        lines.append("")
    with open(REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
