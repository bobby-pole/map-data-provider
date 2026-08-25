# Measurement reports

`pnpm run measure:demo` writes dated, machine-readable delivery reports here.
Commit a report only after reviewing it against the verified local demo bundle
that produced it. Each report contains its timestamp, Git revision, endpoint
sample size, host characteristics, raw aggregate results and measurement
definitions.

The measurement command records the demo `bundle_id` and SHA-256 of its
manifest. The production API and preview panel serve a report only when both
match the currently prepared bundle; a stale report returns an unavailable
state rather than stale figures.

The directory does not contain a synthetic baseline. The local bundle currently
available to an operator is an external deployment artifact, so a report must
be generated from the exact bundle being presented rather than invented from a
test fixture.

See [the measurement procedure](../performance_baseline.md).
