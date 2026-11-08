# Omega Bootlegs logo update (V3)

This package is the complete GitHub-ready website, based on the Industrial Gothic V2 release. The site header now displays the supplied transparent **Omega Bootlegs** logo in `public/omega-bootlegs-logo.png`, with responsive sizing for desktop and mobile. No API routes, data formats, database storage, or `/data` configuration were changed.

**Deployment:** Back up your current archive first. Upload the *contents* of this ZIP to the root of the existing GitHub repository (not the enclosing folder), replace matching files, and commit. Railway should deploy the updated commit if GitHub automatic deployment is enabled. Otherwise use Railway's deploy-latest-commit workflow. Keep the attached volume and environment variables intact.

**Browser refresh:** If the old header persists after deployment, use Ctrl+Shift+R to bypass cached assets.

---

# MANSON ARCHIVE — Industrial Gothic — Three-Column Redesign (v2)

A full-stack, independent catalogue for Marilyn Manson live audio and video recordings. **No recordings are hosted, streamed, or made downloadable.**

## Features
- Dark, responsive Industrial Gothic design
- Public searchable collection, audio/video filters, year/tour/quality filters, selectable recordings with a details inspector
- Password-protected admin login; create, edit and delete entries
- Rich metadata: show date, venue, location, tour, format, duration, quality, recording source, resolution, size, notes
- Multi-image screenshot upload with gallery/lightbox
- setlist.fm API lookup by artist, venue and year; clicking a result fills concert data and setlist; every imported setlist links to its source
- JSON and CSV import/export; complete ZIP backup with images and ZIP restore
- PostgreSQL database when DATABASE_URL is available, otherwise local JSON persistent storage

## Run locally

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
```

Edit `.env` with `ADMIN_PASSWORD` and `SESSION_SECRET`. If you aren't using a shell that loads `.env` automatically, use Node 20's built-in env-file support:

```bash
node --env-file=.env server.js
```

Open http://localhost:3000. Without PostgreSQL, entries are saved in `.data/`.

## Deploy to Railway

1. Create a new project from this directory, typically by pushing the project files to a GitHub repository and choosing **Deploy from GitHub repo** in Railway.
2. Set the start command to `npm start` (Railway usually discovers it automatically).
3. Under **Variables**, set `ADMIN_PASSWORD` and `SESSION_SECRET` to two different, strong secret strings; set `SETLIST_FM_API_KEY` to your approved personal API key.
4. Add a Railway PostgreSQL service and expose its `DATABASE_URL` to the website service (recommended).
5. Attach a **persistent volume** to the website service at `/data` and set `DATA_DIR=/data`. PostgreSQL stores entries; the persistent volume stores screenshot images. If you skip PostgreSQL, the volume also stores the records JSON file.
6. Configure a Railway public domain. Always use HTTPS for the admin area.
7. Back up periodically using **Admin → Import / Export → Complete ZIP Backup**.

Do **not** store recordings or public download links in this app. Do not commit `.env`.

## setlist.fm integration

- Request a key: https://api.setlist.fm/docs/1.0/index.html
- API: `GET https://api.setlist.fm/rest/1.0/search/setlists` with `x-api-key`, `Accept: application/json`; search parameters: `artistName`, `venueName`, `year`, etc.
- setlist.fm allows free API use for non-commercial projects subject to its terms. Provide source attribution and comply with API restrictions: https://www.setlist.fm/help/terms
- Search requires an API key; the rest of the archive works without it.
- Some setlists have no tour information or incomplete songs. Review the imported form before saving.

## Notes and limitations for v2

- Search lookup shows the first page of matching concerts; narrower queries improve results.
- CSV exports metadata only. A complete ZIP contains the screenshot files. JSON export includes image paths but not binary data.
- Imports update by matching internal UUID. Rows without those IDs are new entries (duplicate detection based on concert metadata is not yet implemented).
- Screenshot files removed from an entry are not automatically deleted from the disk. You can remove unreferenced images as a future maintenance feature.
- API sign-in uses an HTTP-only signed cookie. For internet-facing deployments, set HTTPS and sufficiently strong secrets. For higher-security environments add CSRF protections, managed authentication and request audit logging.
- This is an original, independent fan-archive design with no third-party artwork bundled.

## Source structure

- `server.js` — Express API, storage, authentication, imports, uploads, setlist.fm lookup
- `public/index.html` — app entrypoint
- `public/style.css` — responsive Gothic interface
- `public/app.js` — browser-side collection UI

## Version 2 redesign — safe update instructions

This is a **frontend redesign** on top of the same server endpoints and recording data model as version 1. It does **not** reset your collection or replace the screenshot storage volume. The Statistics navigation, statistics dashboard and statistics panels have been removed. The archive now uses a three-column layout with filters, a table/grid of recordings, and a details/setlist/screenshots inspector.

### Before updating your existing Railway deployment

1. In the existing website, log in as admin and download **Import / Export → Complete ZIP Backup**. Save a copy somewhere outside Railway.
2. In Railway, confirm `DATA_DIR=/data` and that the existing persistent volume remains attached at `/data`. **Do not create a fresh volume or remove the original.**
3. Push these files to the **same GitHub repository** already linked to the existing Railway service. Let Railway redeploy. Do not create a different service unless you intentionally want a separate empty archive.
4. Confirm that your recordings and screenshot thumbnails are present. Test the admin login and setlist.fm lookup.
5. Keep the ZIP backup as a separate recovery copy.

No API keys or passwords are included in this package; your existing Railway Variables remain in Railway. If a PostgreSQL database is connected, leave `DATABASE_URL` unchanged.

### How to upload to GitHub

Open the ZIP, extract all files, and upload **the contents of the folder** into the root of your existing GitHub repository. Commit your changes, then watch Railway's Deployments screen. The project root should contain `server.js`, `package.json`, and `public/`.
