# StickForge Studio

A local-first, CapCut-style web editor for **YouTube Shorts**, **Facebook Reels** and regular
**YouTube / Facebook videos** (9:16, 16:9, 1:1 and 4:5, up to 4K) — built for
educational, history, mystery and documentary stick-figure videos — with **free, offline AI narration**
(Piper TTS, male and female voices), automatic captions and 1080×1920 export.

- No account, no API keys, no subscriptions, no telemetry.
- Narration, editing, captions and export run on your computer. Internet is needed only to download
  a voice model (once) or refresh the voice list — and only when you click it.
- The app listens on `127.0.0.1` only and rejects requests from other websites.

---

## Quick start (Windows)

```powershell
cd "C:\Users\admin\Desktop\StickForge Studio\stickforge-studio"
.\setup.cmd        # one time: checks Node.js + FFmpeg, installs packages, builds
.\start.cmd        # starts http://127.0.0.1:3210 and opens your browser
```

Then:

1. **Voice Manager** → install a voice. Recommended, commercial-use friendly per their model cards:
   `en_US-joe-medium` (male, CC0, ~60 MB) and `en_US-kristin-medium` (female, public domain, ~61 MB).
2. **Dashboard → New project.**
3. **AI Voice Studio** → paste your script → *Generate* → *Use in video editor* (creates captions too).
4. **Video Editor** → upload/link photos and clips, arrange them, add music → **Export**.

Other launch options:

| Command | What it does |
| --- | --- |
| `start.cmd -Dev` | Development server with hot reload (`next dev`) on 127.0.0.1:3210 |
| `start.cmd -Port 4000` | Use another port |
| `start.cmd -NoBrowser` | Don't open a browser |
| `npm run dev` / `npm run build` / `npm start` | Same as above via npm (all bound to 127.0.0.1:3210) |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |

## Prerequisites

| Requirement | Why | How to get it |
| --- | --- | --- |
| **Windows 10/11** | Tested on Windows 11 | — |
| **Node.js 22.13+** (24 LTS recommended) | Runs the app; uses the built-in `node:sqlite` | `winget install OpenJS.NodeJS.LTS` or nodejs.org — `setup.cmd` offers this |
| **FFmpeg** (full build with libx264 + libass) | Media probing, thumbnails, MP3, video export, burned-in captions | `winget install --id Gyan.FFmpeg -e` — `setup.cmd` offers this. Or set the path in **Settings** |
| A modern browser (Edge/Chrome) | The UI | — |
| ~1–2 GB free disk | App + a few voices + exports | — |

Python, Rust, GPUs and cloud services are **not** needed.

## How it works

```
Browser (Next.js UI)  ──fetch──▶  Next.js server on 127.0.0.1 (route handlers, Node runtime)
                                   ├─ SQLite (node:sqlite)        projects, media refs, narrations, exports, settings
                                   ├─ Piper TTS                   espeak-ng phonemizer (WASM) + voice model on onnxruntime-node (CPU)
                                   └─ FFmpeg / FFprobe            spawned with argument arrays (never a shell)
```

- **Data folder:** `%LOCALAPPDATA%\StickForgeStudio` (database, default voices folder, temp files).
  Override with the `STICKFORGE_HOME` environment variable.
- **Projects:** `Documents\StickForge Projects\<project>` by default (choose another folder per project
  or in Settings). Each project folder contains `media\` (uploaded copies), `audio\` (saved narration),
  `narration\` (generated paragraphs), `exports\`, and `project.stickforge.json` — a portable copy of the
  project used for recovery (**Dashboard → Open project folder**).
- **Media:** *Upload* copies a file into the project folder. *Link* references a file in place (no
  copy) from a folder you approved in **Settings → Media folders**. Original files are never modified.

## Accounts, landing page and sign-in

- `http://127.0.0.1:3210/` is the **landing page**; the app lives at `/dashboard`, `/templates`,
  `/voice`, `/editor`, `/voices`, `/exports`, `/settings` and needs a **local account**.
- **Register / Log in** (`/register`, `/login`). The **first account is the owner** (can change shared
  Settings, remove voices, and switch *Allow new accounts* on/off in Settings → Account). Each account
  sees only its own projects, narrations, exports and background jobs — **new accounts start empty**.
  Projects created before accounts existed aren't shown to anyone; the owner can add them to their
  account (or remove them from StickForge, keeping the files) in Settings → Account.
- Accounts are stored **only in this computer's database** — no cloud, no email. Passwords are hashed
  with scrypt; sessions are random tokens in an HttpOnly, SameSite=Strict cookie (30 days with *Keep me
  signed in*, otherwise 12 h); 5 wrong passwords lock that email for 30 s+.
- Change your password in Settings → Account. **Forgot it?** On this computer run
  `npm run reset-password -- you@example.com` in the app folder.

## Features — status

Everything below was exercised by automated tests and/or a scripted run of the real UI in Microsoft Edge.

### Working

- **Templates** (sidebar → Templates)
  - **7 original StickForge templates** (free to use, including monetized videos): Did You Know?
    history Short, Top 3 Unsolved Mysteries, Myth vs Fact, Unsolved Mystery Story (9:16), YouTube
    Documentary Explainer (16:9), Then vs Now (1:1), Quick History Fact (4:5). *Use template* creates a
    project with title cards rendered locally by FFmpeg (gradient + text + stick figure), an example
    script ready in Voice Studio, a matching voice preset and caption style. Any ratio can be chosen.
  - **Free stock footage**: search **Wikimedia Commons** (no key; public-domain and Creative Commons
    history photos and footage) and **Pexels** (free API key from pexels.com/api, pasted once; free for
    commercial use) for videos or photos, filter by orientation, hover to preview (Pexels), and add to a
    project. Downloads go into the project's media folder with the author and license saved; old Ogg
    videos are converted to MP4. Non-commercial files can't be added. Also available as a **Stock** tab
    inside the editor (added files go straight onto the timeline).
  - **Credits**: Media panel → *Credits for stock files* gives copy-ready credits for your video
    description (required for CC BY / BY-SA files).
  - **Other template sites**: Mixkit, Canva, CapCut and Motion Array with an honest note on each —
    their templates only work in their own apps (and Motion Array is paid), so the workflow is to
    export an MP4 there and upload it here.
- **Dashboard** — create / open recent / rename / delete projects (optionally delete the folder), open a
  project from its folder, setup warnings, quick links.
- **AI Voice Studio**
  - Script editor with word, character, paragraph/sentence counts and estimated duration.
  - *Clean up* (spacing/punctuation) and *Split sentences* show a preview; the script only changes when
    you click **Apply** (with **Undo**).
  - Local Piper TTS generation per paragraph with progress and **cancel**; **regenerate one paragraph**
    without redoing the rest (unchanged paragraphs keep their audio).
  - Play each paragraph and the full narration; save **WAV**, and **MP3** when FFmpeg has libmp3lame.
  - Real engine controls only: **speed** (Piper `length_scale`, default 1.05×), intonation variation
    (`noise_scale`), rhythm variation (`noise_w`), sentence and paragraph pauses, speaker (multi-speaker
    models). Presets just set those values — Piper cannot act out emotions, and the UI says so.
  - **Use in video editor** puts the narration on the timeline, builds captions and can fit scene lengths.
- **Record my voice** (AI Voice Studio → *Record my voice*)
  - Record from any microphone with a live level meter while your script shows as a teleprompter.
    Takes are saved in the project's `recordings` folder (the original is kept untouched).
  - Clean up locally with FFmpeg: background-noise removal, rumble removal, even volume (-16 LUFS),
    silence trimming, and an optional voice effect (slightly deeper / deeper narrator / higher) — with
    before/after playback. Save to the project or **use as narration** (captions from your script,
    timing estimated).
  - **AI voices that sound like you**: compares the pitch and brightness of your recording with each
    voice's official Piper sample and ranks them (% match), filtered by **American / British accent**
    and commercial-use license. *Use for my script* (installs the voice if needed) switches back to the
    AI voice tab with that voice selected. The first search downloads the samples (~90 KB each) once.
  - Honest limit: StickForge can't convert *your own* recording to another accent (that needs
    voice-cloning AI that isn't free to run offline); pick the closest voice in the accent you want instead.
- **Voice Manager** — English (US/UK) catalog with size, quality, type and license (from each official
  model card), commercial-use filter, confirm dialog showing size/source/license/free space before any
  download, download progress + cancel, **size + MD5 verification**, preview, model card viewer, remove.
  Custom Piper voices dropped into the voices folder are detected too.
- **Video Editor (CapCut-style)**
  - **Ratio** per project (chosen when you create it, changeable in the editor): 9:16 phone, 16:9
    landscape, 1:1 square, 4:5 portrait feed. Preview, fit modes and caption layout follow the ratio.
  - New uploads/links appear instantly (no page reload), upload 3 at a time, and are **placed
    automatically**: photos/clips go onto the timeline; audio named like *voice / narration / vo / tts*
    becomes narration, other audio becomes music if the music track is empty (switch off in the Media
    panel; Ctrl+Z undoes). Media saved in Voice Studio or another tab shows up when you return.
  - Media library (upload by button or drag-and-drop, or link in place), thumbnails, missing-file
    warnings with **relink**.
  - 9:16 live preview with play/pause, seeking, video playback, image zoom motion, captions overlay,
    narration and music playback.
  - Timeline: video, voice, music and caption tracks; drag to reorder scenes; drag edges to change
    duration / trim the start of videos; drop media onto the track; zoom (buttons, slider, Ctrl+wheel).
  - Inspector: duration, trim, fit (*Fill*, *Blur* background, *Fit* with bars — never stretched), Ken
    Burns zoom in/out for images, clip audio on/off + volume; narration volume/offset/mute; music
    volume/mute/loop/fade-out/auto-duck; *Fit scenes to narration*.
  - Captions panel: build from narration, add at playhead, edit text and start/end times, delete, import
    and export **SRT**; style — font, size, vertical position, side safe margin, outline or box, colours,
    UPPERCASE, keyword highlighting, number highlighting, words per caption.
  - Undo/redo, autosave (with a two-window conflict guard), local crash-recovery drafts, save on leaving.
  - Shortcuts: Space, ←/→ (Shift = 1 s), Home/End, Ctrl+B split, Ctrl+D duplicate, Del, Ctrl+Z /
    Ctrl+Shift+Z / Ctrl+Y, Ctrl+S, Ctrl+E.
- **Export** — MP4, H.264 (libx264; falls back to Windows `h264_mf`), AAC 48 kHz, 30 fps, BT.709
  limited range; presets *YouTube Shorts* / *Facebook Reels* (9:16), *YouTube video* (16:9), *Square
  post* (1:1), *Portrait feed* (4:5) and *Custom* (any size + fps); sizes **1080p, 1440p (2K) and
  2160p (4K)**, e.g. 9:16 → 1080×1920 / 1440×2560 / 2160×3840, 16:9 → 1920×1080 / 2560×1440 / 3840×2160; quality
  High/Standard/Small; burned-in captions (ASS via libass, same layout as the preview); optional SRT;
  narration + music mix with sidechain ducking and fade-out; progress, cancel (partial file removed),
  clear errors listing missing media; one export at a time; never overwrites any file.
- **Export Queue** — live progress, cancel, play in the app, download, download SRT, show in Explorer,
  remove from history (optionally delete the file). Exports interrupted by closing the app are marked.
- **Settings** — projects/voices/export folders, approved media folders, FFmpeg/FFprobe paths, privacy
  summary, **system check** (Node, SQLite, FFmpeg capabilities, ONNX Runtime, phonemizer, voices, folder
  write access and free space) with fix instructions.

### Honest limitations / not done yet

- **Pexels** search/import was tested against the real API only up to the key check (a fake key is
  correctly rejected). With a real free key it should work the same way as Wikimedia Commons, which
  was tested live (search, photo + video download, credits).
- **Canva / CapCut / Motion Array / Mixkit templates can't be imported** — they're proprietary formats
  tied to those apps, and their terms don't allow copying them into another editor.

- **Caption timing:** sentence start/end times are measured from the generated audio; word groups
  *inside* a sentence are estimated from text length. There is no word-level speech recognition yet.
  For narration you import (not generated here), timing is estimated from the script.
- **Preview vs export:** the preview is a close approximation. Music ducking is applied on export only;
  volumes above 100% play at 100% in the preview; *Blur* fit on video uses a still frame as the preview
  background. The exported MP4 is the reference.
- **Export speed** depends on your CPU: measured ~60–85 s for a 12–16 s video with zoom motion and blur
  on a 4-core PC (*Small/fast* is quickest, *High* slowest).
- **Preview codecs:** the browser must be able to play a clip for the preview (HEVC `.mov` from iPhones
  may not preview in Edge/Chrome); FFmpeg export still works.
- Not implemented: text/sticker overlays, transitions between scenes, multiple video layers, per-word
  "karaoke" highlighting, a packaged installer (.exe/.msi) — the app runs from this folder via
  `start.cmd`.
- Voices are English (US/UK) only in the catalog; other Piper languages can be dropped into the voices
  folder manually but aren't tested.

## Security & privacy design

- Server bound to `127.0.0.1`; every API route is wrapped by a guard (`lib/server/security.ts`) that
  requires a loopback `Host` (blocks DNS rebinding), rejects cross-site `Sec-Fetch-Site`, and for any
  write requires a same-origin `Origin` **and** the custom `x-stickforge` header (forces a CORS preflight
  that the app never approves). A test (`tests/api-guard.test.ts`) fails if any route skips the guard.
- File access is limited to project folders, approved media folders, the voices folder and the export
  folder; paths are validated (absolute, no UNC/device paths, symlink-resolved containment checks).
  The folder picker lists folder names only, never file contents.
- FFmpeg and other tools are run with argument arrays (`shell: false`); user paths are passed only as
  `file:` arguments, never inside filter strings.
- Exports and generated files never overwrite existing files; deleting an *uploaded* asset removes only
  the project's copy; linked originals are never touched.
- Pages send `X-Frame-Options: DENY` / `frame-ancestors 'none'`.
- Downloads come only from the official `huggingface.co/rhasspy/piper-voices` repository and are
  verified against its `voices.json` (size + MD5).
- Stock downloads are looked up by item id on the provider's official API (the browser never supplies
  a download URL), only from allow-listed hosts (pexels.com / wikimedia.org media hosts, https), capped at
  600 MB. Thumbnails are fetched by the local server and cached. The Pexels key is stored in the local
  database and never sent to the browser.

## Voice licenses — read before monetizing

Piper's code is open source, but **each voice is trained on a dataset with its own license**. The Voice
Manager shows the license stated in each voice's official MODEL_CARD (as of 2026-10-18):

| Allowed commercially (per model card) | Needs credit / share-alike | **Non-commercial — don't monetize** | Unclear — check source |
| --- | --- | --- | --- |
| joe, mike, reza_ibrahim, kathleen (CC0); john, norman, bryce, kristin, ljspeech, cori (public domain) | libritts, libritts_r, alba, vctk, aru (CC BY 4.0); sam (Apache-2.0); northern_english_male, southern_english_female (CC BY-SA) | ryan, hfc_male, hfc_female (CC BY-NC-SA), l2arctic (CC BY-NC), semaine, lessac | amy, danny, kusal, alan, jenny_dioco, arctic |

This is a summary, not legal advice. Open the model card (Voice Manager → *Model card*) and the linked
dataset license and confirm before using a voice in monetized videos. Also make sure you have rights to
any music and footage you use.

## Third-party components

| Component | License | Notes |
| --- | --- | --- |
| Next.js, React | MIT | UI framework |
| shadcn/ui, Radix UI, lucide-react, sonner, dnd-kit, Tailwind CSS | MIT | UI components |
| zod | MIT | Validation |
| onnxruntime-node | MIT | Runs voice models on CPU |
| @diffusionstudio/piper-wasm | MIT wrapper; contains **espeak-ng (GPL-3.0)** compiled to WebAssembly | Phonemizer. If you redistribute this app, comply with GPL-3.0 for espeak-ng |
| Geist font (`geist`) | SIL OFL 1.1 | Bundled locally (no Google Fonts at build) |
| FFmpeg | LGPL/GPL (build dependent) | Installed separately; not bundled |
| Piper voices | Per voice (see above) | Downloaded on demand; not bundled |
| Pexels media | Pexels License (free, commercial OK; don't resell unaltered copies) | Downloaded on demand via the official API; credit appreciated |
| Wikimedia Commons media | Per file (public domain, CC0, CC BY, CC BY-SA…) | Credits saved per file; follow each license |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| *FFmpeg not found* | `winget install --id Gyan.FFmpeg -e`, restart StickForge, or set the full path to `ffmpeg.exe` / `ffprobe.exe` in Settings. |
| Captions are not burned in | Your FFmpeg build lacks libass (`subtitles` filter). Install the Gyan *full* build. Settings → System check shows capabilities. |
| *No voice installed* / voice dropdown empty | Voice Manager → Install. Needs internet once. |
| *Verification failed* during voice download | The voice was updated upstream. Click **Refresh voice list** (internet) and install again. |
| First narration takes ~10–15 s | Loading the voice model the first time; later generations reuse it (a paragraph takes ~1–3 s). |
| *Some media is missing* when exporting | A linked file was moved/renamed or its folder was removed from Settings → Media folders. Relink it in the editor's Media panel. |
| *This project was changed in another window* | The project is open twice. Choose *Reload theirs* or *Keep mine (overwrite)*. |
| *Unsaved changes … were found* | The app/browser closed before autosave. Click **Restore them** or *Discard*. |
| Port 3210 is in use | `start.cmd -Port 4000`. |
| A clip shows black in the preview | The browser can't decode it (often HEVC). Export still works, or convert the clip to H.264 MP4. |
| `Another next dev server is already running` | Only one `next dev` can run per folder. Stop the other one, or use `start.cmd` (production build). |

## Development

```
app/                 Next.js App Router pages and API route handlers (app/api/**/route.ts)
components/          UI (components/editor/* is the video editor; components/ui/* is shadcn/ui)
lib/shared/          Pure logic shared by UI and server: types/schemas, script tools, captions, timeline
lib/server/          Server-only: db, settings, paths/security, projects, assets, narrations, exporter,
                     tts/ (Piper engine, voices, catalog, wav), ffmpeg/ (locate, run, probe, ASS, filter graph)
tests/               Vitest unit + integration tests (real FFmpeg; real Piper when a voice is installed)
scripts/             setup.ps1, start.ps1
```

- `npm test` runs everything. Integration tests use a throwaway data folder. The Piper test runs when
  `en_US-joe-medium` is installed (default voices folder) or `STICKFORGE_TEST_VOICES_DIR` points to one.
- This project uses Next.js 16 with Cache Components; see `AGENTS.md` and `node_modules/next/dist/docs/`.
  API handlers call `connection()` (via `withApi`) so SQLite reads are never prerendered.
