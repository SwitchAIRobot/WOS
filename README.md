# WO Sports – Women’s only sports sessions

A free, installable web app (PWA) listing women’s-only swimming, badminton and basketball sessions in Hackney and Tower Hamlets.
No backend, no login, no paid services. Your picks are saved only on your own device (localStorage).

## What is in this folder

All files sit in the root, with no subfolders, so you can drop them straight into a GitHub repository.

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js`, `logic.js` | The app |
| `timetable.json` | The session data the app reads |
| `venues.json` | Map search text and optional directions per venue |
| `parse_csv.py` | Turns the CSV into `timetable.json` and writes `parse_report.txt` |
| `Womens_only_sports_session_data.csv` | The source data |
| `parse_report.txt` | Rows the parser could not read with full confidence |
| `sw.js`, `manifest.webmanifest`, `icon*.png/svg`, `apple-touch-icon.png` | Offline mode and install-to-home-screen |

## How to update the timetable data

1. Edit the CSV (or replace it with a new export). Keep these columns in this order:
   `week_commencing, sport, session_name, provider, venue, area, borough, date_or_recurrence, day, start_time, end_time, source_url, date_checked, confidence, notes`
2. Use full day names (`Monday`), 24-hour times (`18:30`), and the exact same spelling for a venue every time it appears.
3. Run the parser (Python 3, nothing to install):
   ```
   python3 parse_csv.py Womens_only_sports_session_data.csv timetable.json
   ```
4. Open `parse_report.txt`. Every row listed under "CHECK" needs a human look. Rows with no valid day or time appear in the app under "sessions with no confirmed day or time" and cannot be added to a calendar until you fix them.
5. Commit and push `timetable.json`. The app picks up the new data the next time it is opened online (it may take one extra reload because of offline caching).

Session IDs are built from sport, venue, day and start time, so a person’s saved picks survive an update as long as those four things do not change. If a session moves, their old pick quietly drops off.

## How to edit venue directions

Open `venues.json`. Each venue has two fields:

```json
"Poplar Baths Leisure Centre": {
  "maps_query": "Poplar Baths Leisure Centre, Poplar, London",
  "directions": "Five minutes’ walk from Poplar DLR. Entrance on the main road."
}
```

- `maps_query` is the text used for the “Open in Maps” button. Make it as exact as you can (add the postcode if you like).
- `directions` is optional. If it is not empty, it shows in the session details under “Getting there”. It is empty to begin with, so add your own tips.
- The venue name must match the `venue` column in the CSV exactly. Add a new block for each new venue.

## Free deployment on GitHub Pages

1. Create a free GitHub account at github.com if you do not have one.
2. Click **New repository**. Name it (for example `wo-sports`), choose **Public**, and click **Create repository**.
3. Click **uploading an existing file**, drag in every file from this folder, and click **Commit changes**.
4. Go to **Settings → Pages**.
5. Under **Build and deployment**, set **Source** to **Deploy from a branch**, **Branch** to `main`, folder to `/ (root)`, and click **Save**.
6. Wait one to two minutes. The page then shows your address: `https://YOUR-USERNAME.github.io/wo-sports/`.
7. Open that address on your phone.
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** menu → **Install app** (or **Add to Home screen**).

To update later, upload the changed files to the same repository (**Add file → Upload files**) and commit.

## Offline mode

After the first visit the app works without a connection. If you add or rename a file, change `CACHE_VERSION` in `sw.js` (for example `wo-sports-v2`) and add the new file to the `ASSETS` list so devices refresh their copy.

## About Fuse.js (search)

Search uses Fuse.js 7.0.0, loaded from the jsDelivr CDN and then saved for offline use. For a copy that does not depend on a CDN:

1. Download `fuse.min.js` from the Fuse.js 7.0.0 release and put it in this folder.
2. Add `"fuse.min.js"` to the `ASSETS` list in `sw.js` and bump `CACHE_VERSION`.

The app already tries `fuse.min.js` if the CDN fails. If neither loads, a small built-in matcher keeps search working (typos and times included), just a little less refined.

Time searches such as `2pm`, `14:00`, `7.30pm` or `1830` are handled separately from the fuzzy matching, so they are exact: a session matches if it is running at that time or starts within that hour.

## Good to know

- The data is only as good as its sources. Rows marked **Check first** have medium confidence. Always confirm on the source page or with the venue.
- Calendar export creates standard `.ics` events in your phone’s local time, repeating weekly for the number of weeks you choose.
- Tower Hamlets centres are run by Be Well (council), not Better. Hackney centres are run by Better.
