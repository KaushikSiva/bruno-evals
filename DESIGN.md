# Bruno evaluation workspace

Visual thesis: a quiet, ink-and-paper video review desk, with a large footage viewer and a single warm orange accent.

Content plan: a compact horizontal run picker above a large video and one result panel. Best runs is the default. Evaluate is the primary action. My reviews combines live and full-video results. Evidence, settings, and agent activity are expandable details.

Interaction thesis: recording state transitions make capture unmistakable; evidence clicks seek the video; new background job stages enter the event log without disrupting playback. Respect reduced motion.

Scope: capture a user-selected browser tab or import a video/run link, save and hash the original, extract timestamped frames, and asynchronously evaluate visible outcomes. AI assessments are provisional; no claims about hidden forces or physical safety. Download-only mode works without an API key. All application code created at the October 31 hackathon.

Live review shows the latest observation beside the video. Two agent lanes, evidence timestamps, and actual message receipts sit inside Evidence & activity. Observer drafts appear as frames arrive; reviewed findings show the last source timestamp assessed and their processing latency. Public footage is always labeled as a replay. Terse owns live session state and pushes updates; Agent Relay carries the two agents' handoffs. Saved footage remains seekable after capture, and full-clip assessment remains a separate durable background job.

The direct Dream Labs source is available in the Live camera tab. Its main surface is the public camera, with the source's actual availability shown when offline; agent findings occupy the existing evidence area. A single bounded watch action starts automatic evaluation of public runs. Live snapshots, recorded replays, and browser captures retain distinct provenance labels.
