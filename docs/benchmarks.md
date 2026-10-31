# What we measured

These are small development checks from October 31, 2026. They help verify the demo and compare latency. They are not a broad robotics accuracy benchmark.

## Matched model-call check

We used 16 received frames spanning the same public dress-folding replay, including its last five frames. Task, criteria, frame selection, and the practical-completion rubric were held constant. Historical summaries were removed so earlier judgments could not leak into the test.

Each route made an observer request followed by a reviewer request. The roles use the same policy and evidence, but the Decisions route asks fixed-choice questions while Responses generates a structured prose report. The model also differs. This compares the usable routes, not the endpoint in isolation.

| Route | Observer | Reviewer | Combined | Reviewed verdict |
| --- | ---: | ---: | ---: | --- |
| Responses / GPT-6.1 Sol | 4,985 ms | 2,876 ms | 7,861 ms | Pass |
| Decisions / GPT-6 Luna | 290 ms | 332 ms | 622 ms | Pass |

The ratio is 12.64× for this one matched check. Requests were made from the same Mac using the same account. Cache state and service conditions were not controlled. One sample per case does not establish p50/p95 latency or a general speed guarantee.

## Outcome controls

| Supplied evidence | Capture context | Observer | Reviewer |
| --- | --- | --- | --- |
| Full 16-frame trajectory | Final window | Success observed | Pass |
| Opening frame only, garment unfolded | Final supplied window | Failure observed | Fail |
| First four frames | Still capturing | In progress | In progress |

The unfinished control checks a deliberately unmet visible end state. It is not a claim that every truncated recording should fail: a missing or hidden outcome should remain uncertain.

A separate saved-video check evaluated 24 frames in 1,021 ms and returned Pass with evidence at 45.017 seconds.

## Full browser flow

The end-to-end run captured 47 frames, saved 12 observer drafts, and completed three reviewed windows. Every observer and reviewer call used Decisions. The final verdict was Pass, with six real Relay messages recorded. Terse WebSocket updates, saved-state restoration, evidence rendering, and the mobile layout passed the browser check; no browser errors were observed.

Observer API calls ranged from 220 to 706 ms. Reviewed-window latency, including message handoff and queueing, was 37,262 ms, 30,118 ms, and 66,543 ms. The final review was visible about 113 seconds after the replay began. **Agent Relay delivery remains a bottleneck.**

The UI keeps these two timings separate. A subsecond API call is not a subsecond end-to-end review.

## Reproduce it

Start the local app with your own key, then run:

```sh
# Actual browser capture, Terse, OpenAI, and Agent Relay. Uses API credits.
node scripts/verify-live.js --clip=dream-best-154

# Use the session ID printed by the browser check / shown in the URL.
npm run benchmark -- --session YOUR_SESSION_ID
```

The benchmark writes its full results to the gitignored `artifacts/` directory. It removes historical reviews from model context, uses only saved received frames, and retains model, usage, timing, and evidence metadata. Network conditions and model outputs can change.

The [published measurement file](benchmarks.json) contains the small, shareable result summary. Source footage is available from the [Dream Labs public playground](https://dreamlabs.ai/playground/?clip=best154); video files are not redistributed in this repository.
