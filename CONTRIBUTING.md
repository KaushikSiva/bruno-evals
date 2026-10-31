# Contributing to Bruno

The most useful report is a run Bruno misunderstood. Include the task, the expected outcome, the actual judgment, and the timestamp that explains the difference. Share only footage you are allowed to publish.

For code changes, open a small pull request describing the user-visible problem and how you checked the fix. Preserve the task criteria, evidence timestamps, original judgments, and source provenance. A faster path should still make uncertainty visible.

```sh
npm ci
npm test
```

Unit tests use local fixtures and do not need API keys. Browser/actor integration checks are documented in [the runbook](docs/runbook.md); live checks require a running app and spend API credits.

Never commit `.env.local`, `data/`, `artifacts/`, private recordings, or Relay credentials. Do not paste keys into an issue. Changes to actor definitions require regenerating the client and restarting the local runtime.

The [roadmap](docs/roadmap.md) lists the current priorities. Please distinguish measured behavior from a planned feature when changing the documentation.
