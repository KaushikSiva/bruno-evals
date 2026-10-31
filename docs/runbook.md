# Running and operating Bruno

Created at Haunted Hacks on October 31, 2026. Download public robot runs, record a browser surface, and review visible outcomes during playback or in the background. Live sessions use **Terse Durable Actors** and two application agents communicating through **Agent Relay**. Live and saved-video evaluations default to the **OpenAI Decisions API with GPT-6 Luna**, batching criterion judgments and evidence-frame selection in each request. If Decisions is unavailable or returns malformed data, **GPT-6.1 Sol via Responses** provides a recorded fallback. `OPENAI_MODEL` controls the fallback; `BRUNO_EVALUATION_API=responses` selects the previous detailed evaluator explicitly.

## Run

Requires Node 22.16+ (Node 24 recommended) and FFmpeg/ffprobe on PATH.

```sh
npm install
cp .env.example .env.local
# Set OPENAI_API_KEY privately in .env.local. Never paste it into the browser.
chmod 600 .env.local
npm start
```

Open http://127.0.0.1:5190. `npm start` starts the real Terse development runtime on port 7100 and the Bruno server on port 5190. The project installs the Bun version needed by Terse. The first start may download Terse's native runtime. Use this as a local development app; public hosting needs authentication and a configured Terse deployment.

The backend automatically creates a private Agent Relay workspace and registers `bruno-observer` and `bruno-reviewer` on first use. Subsequent starts reconnect the same identities. No separate Relay login is required for this local flow. The header shows Ready when the evaluation services are connected. Agent Relay and OpenAI require network access.

Background evaluation continues after the browser closes, while the server is running and the Mac remains awake. SQLite retains saved-video jobs. Terse retains live-session state. Completed model results are checkpointed before Relay delivery; retries reuse those results and stable message keys. A process interrupted during a model request, before its result is saved, can still repeat that request and incur another charge.

## Live demo

1. Choose a run. **Best runs** is the default collection, using the 20 curated clips from Dream Labs’ dedicated Best runs gallery. **Other public clips** offers its separate 35-clip library. Adjust success criteria under **Options** if needed.
2. Click **Evaluate**. Bruno saves a local replay and plays it at normal video speed. For Best runs, it uses the same video shown on the source page, which can differ from the publisher’s separate download version.
3. The browser uploads about one JPEG per second. Only frames already received enter the analysis window; downloading the video does not let the evaluator see future frames.
4. The observer starts after four frames and keeps reporting visible progress while reviews are in flight. Its timestamped drafts are saved in the session actor. A review window is sent to the reviewer through a real Agent Relay direct message; the next review window starts when that review returns.
5. The reviewer separately examines the same evidence and replies through Relay. The actor commits its result with message and delivery IDs. Terse WebSocket updates stream into the UI; HTTP polling provides recovery.
6. After playback ends, the final review uses up to 16 received frames spread across the trajectory, retaining the last five frames. This preserves the transformation rather than showing only the opening and the last few seconds. The result appears beside the video. Open **Evidence & activity** for timestamped frames and agent messages, or **Review details** for criteria and limitations. **My reviews** keeps live sessions and full-video assessments together; reopening a session restores its durable evidence and reviews.

This is real-time **visual review of public replays or user-selected browser capture**, not a connection to a live physical robot and not a robot control loop. The observer can update within a few seconds; reviewed judgments lag behind capture. The October 31 Decisions replay check saw first observations around 6 seconds and reviewed windows taking 30–67 seconds including Agent Relay delivery, depending on network/service latency. The UI displays the reviewed-through timestamp and measured latency. It does not use the OpenAI Realtime API; it uses rolling image windows through Decisions, with Responses as a fallback.

Terse owns session state, exclusive evaluation leases, observation/reviewer checkpoints, and delivery records. Agent Relay is the actual observer-to-reviewer and reviewer-to-observer transport; there is no simulated local message bus. The durable inbox retries unacknowledged work. The Node worker stores video bytes and executes model calls.

## Direct Dream Labs live source

Open **Live camera** and choose **Watch & evaluate** for a ten-minute watch. This connects to the public station interfaces used by Dream Labs' own playground: station status, the current public run, and camera JPEGs. No Dream API key is needed for these public reads. The connector uses GET requests only; robot task submission remains on Dream Labs.

The watch waits for an available head camera and an active task. It samples around one image per second, preserves the task and upstream run ID, and creates a separate Terse evaluation session for each run. It checks run identity before and after each camera request and discards frames crossing a task boundary. Captures that begin late are marked as joining mid-run. Provider scores are excluded from model inputs.

The station view shows current snapshots and agent findings. **Open evidence & agent messages** opens the detailed live session; clicking evidence opens its saved JPEG. These are timestamped samples, not a continuous video recording. **Add video → Record a browser tab** remains available for a full video of a chosen browser surface.

The watch continues when the browser closes, stops after 10 minutes or **Stop watching**, and retains its deadline across server restarts in `data/dream-live-watch.json`. An unavailable camera starts no new evaluation. Existing reviews can finish after the source stops. These public website interfaces are not a guaranteed streaming API and can change independently of Bruno.

At verification on October 31, Dream Labs' Station 1 reported no running robot session, no cameras, and its frame endpoint returned HTTP 503. The actual waiting/start/stop UI and source status were verified; active ingestion and task changes were tested with controlled upstream fixtures. A real live-camera run still needs verification when Dream Labs restores its camera. See `artifacts/dream-live-verification.json` for the observed state.

## Public-run workflow

1. Choose a clip from either Dream Labs collection.
2. Open **Options** and set observable success criteria. The source task instruction is preserved.
3. Click **Evaluate the entire video**.
4. Bruno archives the original, produces a seekable MP4, hashes the source, and samples up to 24 timestamped frames.
5. A background worker sends only the task, criteria, capture type, and sampled frames to the OpenAI Decisions API, with Responses as a fallback. Publisher scores are withheld.
6. Review the provisional pass/fail/uncertain result, seek to evidence frames, and optionally save a human judgment. The original AI result remains intact.

Public clips are a selected gallery, not an unbiased sample. Do not report their pass rate as overall Dream-1 performance. Publisher scores may use different criteria from Bruno. Criteria entered for public footage are post hoc relative to the original experiment, although fixed before Bruno's evaluation.

Only public video/manifest GET requests are made to Dream Labs. This app does not submit tasks to physical robots, operate robot controls, use private endpoints, or claim an official partnership. The public gallery manifest and media locations are website interfaces and may change. Existing downloaded runs continue to work offline; new AI assessments require network access and a valid API key.

## Recording and import

**Add video → Upload a video** accepts an existing video or a public Dream Labs media URL. HTML files are rendered before recording; HTML source itself is not a video.

**Add video → Record a browser tab** uses the browser's standard tab/window chooser and MediaRecorder. Chrome/Edge on localhost are recommended. The user selects the surface to capture. Audio is disabled. Live review runs during capture. Stopping saves the full recording, links it to the live session, and queues a separate full-clip assessment. Keep the recording page open until it finishes saving. Recording is capped at 10 minutes, with up to two live sessions active on the server. If upload fails, the browser downloads a recovery copy. Closing the page stops capture; received frames remain saved and the worker seals a disconnected session after 45 seconds without new frames.

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

The queue and events live in `data/bruno.sqlite`. Live evidence lives in `data/live/<session-id>/` (`replay.mp4` for public clips, `frames/*.jpg`, and `session.json`). Terse's authoritative actor storage is in `integrations/terse/.durable-actors/`; preserve it along with `data/` when backing up this demo. `session.json` is an export, not a substitute for the actor store.

Relay credentials are saved privately with mode 600 in `data/integrations/relay.json`; the OpenAI key stays in `.env.local`. These files, media, runtime storage, and local artifacts are gitignored. No API keys or Relay tokens are sent to the frontend. Public task text and agent findings travel through Relay; selected evidence images and criteria travel to OpenAI. JSON and original-video downloads are available in the UI.

## Evaluation limits

The shared `practical-completion-v2` rubric judges the ordinary task goal and explicit success criteria. It accepts cosmetic imperfections and successful retries when they do not violate the task. It does not add unrequested requirements such as perfect folding symmetry, wrinkle removal, or a specific technique. A pass still needs visible completion, a fail needs evidence of an unmet requested condition, and missing decisive evidence remains uncertain. Reports record the model, requested model, prompt version, and rubric version. Previous reports retain their original judgments.

This is visual review, not physical ground truth. Sampled frames can miss brief events, and camera views can hide outcomes. Saved-video timestamps are not verified robot execution time; public clips may be accelerated or edited. Do not infer contact force, continuous collision avoidance, or safety certification. Unsupported evidence references are rejected; an unsupported pass/fail without frame evidence becomes uncertain. AI-generated follow-up tests are suggestions, not automatically executed commands.

Decisions returns fixed-choice judgments and frame pointers; the short explanations are templates, not model-written descriptions of the scene. Each criterion retains its probabilities and confidence in exported JSON. These are model estimates, not calibrated accuracy. Refusals and absent evidence become uncertain; malformed answers trigger the Responses fallback. The API is capped at 15 seconds before fallback, with no automatic SDK retries. Existing completed reviews are preserved. Model latency is recorded separately from total live handoff latency: Agent Relay delivery can still dominate the latter. See the [Decisions API guide](https://developers.openai.com/api/docs/guides/decisions).

The observer and reviewer make separate vision requests. Agreement is not independent ground truth: both can make the same visual mistake. Live-window and full-clip assessments can disagree. Inspect the cited frames and retain human review; no accuracy claim is made from the demo clips.

## Verification

```sh
npm test
# Requires the local Terse runtime; no model/API spend:
node scripts/verify-actors.js
# Optional end-to-end checks; these spend OpenAI credits and use Agent Relay:
node scripts/verify-live.js
node scripts/verify-live.js --capture
# Also restart the app and Terse during an in-flight review:
node scripts/verify-live.js --restart
```

Unit tests cover separate Best/public collection identities, replay cache isolation, durable job history, allowed media hosts, frame selection, evidence validation, stable-key recovery, duplicate completion, preservation of criteria, and uncertain verdicts for unsupported claims. The actor integration check exercises serialized claims and persisted checkpoints against real Terse. The browser checks exercise public replay and a controlled synthetic canvas stream (never the user's desktop), real Relay receipts, Terse WebSocket updates, recording upload, and desktop/mobile rendering. Proof JSON and screenshots are written to `artifacts/`.

To regenerate actor clients after changing `integrations/terse/src/actors.ts`:

```sh
PATH="$PWD/node_modules/.bin:$PATH" node_modules/.bin/bun node_modules/durable-actors/bin/durable-actors.js generate integrations/terse/src/actors.ts --config integrations/terse/tsconfig.json --out-dir integrations/generated
```

Restart `npm start` after actor changes. Generated clients include their upstream runtime license. The current Terse compiler dependency chain has npm moderate advisories in glob/minimatch; the local compiler reads this trusted project. Do not use this development setup to compile untrusted projects or expose it publicly.

## References

- [Dream Labs playground](https://dreamlabs.ai/playground/)
- [OpenAI vision inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Browser screen capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Playwright video recording](https://playwright.dev/docs/videos)
- [Terse quickstart](https://docs.useterse.ai/quickstart)
- [Terse Durable Actors source](https://github.com/TerseAI/durable-actors)
- [Agent Relay SDK](https://www.npmjs.com/package/@agent-relay/sdk)
