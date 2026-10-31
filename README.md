# Bruno — public robot video evaluations

Created at Haunted Hacks on October 31, 2026. Local application for downloading Dream Labs public robot clips, retaining the original footage, and evaluating visible outcomes in the background.

## Run

Requires Node 22.16+ (Node 24 recommended) and FFmpeg/ffprobe on PATH.

```sh
npm install
cp .env.example .env.local
# Set OPENAI_API_KEY privately in .env.local. Never paste it into the browser.
chmod 600 .env.local
npm start
```

Open http://127.0.0.1:5190. The server only listens on localhost. It continues processing after the browser page closes, while the server is running and the Mac remains awake. SQLite retains job state across server restarts. Interrupted work resumes from completed local artifacts; a request interrupted during AI evaluation may be repeated and billed again.

## Public-run workflow

1. Choose a clip from the public Dream Labs gallery.
2. Set observable success criteria. The source task instruction is preserved.
3. Click **Download & evaluate**.
4. Bruno archives the original, produces a seekable MP4, hashes the source, and samples up to 24 timestamped frames.
5. A background worker sends only the task, criteria, capture type, and sampled frames to the OpenAI Responses API. Publisher scores are withheld.
6. Review the provisional pass/fail/uncertain result, seek to evidence frames, and optionally save a human judgment. The original AI result remains intact.

Public clips are a selected gallery, not an unbiased sample. Do not report their pass rate as overall Dream-1 performance. Publisher scores may use different criteria from Bruno. Criteria entered for public footage are post hoc relative to the original experiment, although fixed before Bruno's evaluation.

Only public video/manifest GET requests are made to Dream Labs. This app does not submit tasks to physical robots, operate robot controls, use private endpoints, or claim an official partnership. The public gallery manifest and media locations are website interfaces and may change. Existing downloaded runs continue to work offline; new AI assessments require network access and a valid API key.

## Recording and import

**Import video** accepts an existing video or a public Dream Labs media URL. HTML files are rendered before recording; HTML source itself is not a video.

**Record browser** uses the browser's standard tab/window chooser and MediaRecorder. Chrome/Edge on localhost are recommended. The user selects the surface to capture. Audio is disabled. Stop the recording to upload and queue it automatically. Keep the recording page open until it finishes saving. Recording is capped at 10 minutes. If upload fails, the browser downloads a recovery copy.

To render and record a trusted local HTML file or a public page with Playwright:

```sh
npx playwright install chromium
npm run record -- --file /absolute/path/scene.html --seconds 30 --task "Original task instruction"
npm run record -- --url https://dreamlabs.ai/playground/ --seconds 30 --headful --task "Original task instruction"
```

The command captures the rendered page, including loading time; it does not automatically start a robot task or select a replay. Use `--headful` to interact with the page during recording. Use `--save-only` to capture without queuing an evaluation. For an existing public clip, direct download gives better evidence than recording the entire page.

## Saved artifacts

Each run is stored in `data/runs/<run-id>/`:

- `original.mp4` / `original.webm` / `original.mov`: unchanged imported bytes.
- `video.mp4`: normalized, silent, seekable review copy.
- `frames/*.jpg`: timestamped evidence samples.
- `media.json`: sampling, duration, dimensions, and original SHA-256.
- `run.json`: task, criteria, provenance, events, AI result, human reviews.
- `evaluation.json`: evaluator model, prompt version, token usage, result, and cited evidence.

The queue and events live in `data/bruno.sqlite`. `.env.local`, media, and local artifacts are gitignored. No secrets are sent to the frontend. JSON and original-video downloads are available in the UI.

## Evaluation limits

This is visual review, not physical ground truth. Sampled frames can miss brief events, and camera views can hide outcomes. Saved-video timestamps are not verified robot execution time; public clips may be accelerated or edited. Do not infer contact force, continuous collision avoidance, or safety certification. Unsupported evidence references are rejected; an unsupported pass/fail without frame evidence becomes uncertain. AI-generated follow-up tests are suggestions, not automatically executed commands.

The first implementation uses a local SQLite queue. Terse Durable Actors and Agent Relay are not yet integrated; do not claim their tracks for this build as it stands.

## Verification

```sh
npm test
```

Tests cover durable job history, allowed media hosts, final-frame sampling, evidence index validation, preservation of criteria, and uncertain verdicts for unsupported claims. An end-to-end public clip and browser recording are also checked during development.

## References

- [Dream Labs playground](https://dreamlabs.ai/playground/)
- [OpenAI vision inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Browser screen capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Playwright video recording](https://playwright.dev/docs/videos)
