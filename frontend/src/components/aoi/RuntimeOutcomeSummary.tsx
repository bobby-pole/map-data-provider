import type { ProviderRuntimeJob, ProviderRuntimeResponse } from "../../types/api";

export function RuntimeOutcomeSummary({ result }: { result: ProviderRuntimeResponse }) {
  const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
  const pending = result.outcomes.filter((outcome) => outcome.status === "pending_qualification");
  if (pending.length) {
    return (
      <p className="muted runtimeOutcomeSummary">
        Partial snapshot: completed domains are available on the map. {pending.length} domains are
        still pending.
      </p>
    );
  }
  if (!failed.length) {
    return (
      <p className="muted runtimeOutcomeSummary">
        All selected domains have a published provider outcome.
      </p>
    );
  }
  return (
    <section className="runtimeOutcomeSummary partialSnapshot" aria-live="polite">
      <strong>Partial snapshot published</strong>
      <p>
        The completed domains are available on the map. Retry only the domains below; their
        completed neighbours will stay in this snapshot.
      </p>
      <ul>
        {failed.map((outcome) => (
          <li key={outcome.domain}>
            <strong>{outcome.domain}</strong>
            <span>
              {outcome.failure_reason === "timeout" ? "Timed out" : "Acquisition failed"}:{" "}
              {outcome.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RuntimeProgress({ job }: { job: ProviderRuntimeJob }) {
  const percent = job.total_domains
    ? Math.round((job.completed_domains / job.total_domains) * 100)
    : 0;
  const active = runtimeProgressMessage(job);
  return (
    <section className="runtimeProgress" aria-live="polite">
      <div>
        <strong>{active}</strong>
        <span>
          {job.completed_domains} / {job.total_domains} domains
        </span>
      </div>
      <div
        className="runtimeProgressTrack"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total_domains}
        aria-valuenow={job.completed_domains}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <p>
        {job.queried_feature_count.toLocaleString()} received ·{" "}
        {job.accepted_feature_count.toLocaleString()} accepted
      </p>
    </section>
  );
}

function runtimeProgressMessage(job: ProviderRuntimeJob): string {
  switch (job.event) {
    case "queued":
      return "Waiting for worker…";
    case "cache_hit":
      return "Found a verified local snapshot…";
    case "started":
      return "Preparing the selected AOI…";
    case "domain_started":
      return job.active_domain ? `Preparing ${job.active_domain}…` : "Preparing a provider domain…";
    case "domain_building":
      return job.active_domain
        ? `Building ${job.active_domain} map…`
        : "Building map presentation…";
    case "domain_completed":
      return job.active_domain
        ? `Preparing ${job.active_domain}…`
        : `Completed ${job.completed_domains} of ${job.total_domains} domains…`;
    case "published":
      return "Published the AOI snapshot.";
    case "failed":
      return "AOI preparation failed.";
  }
}
