import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProviderRuntimeResponse } from "../types/api";
import { RuntimeOutcomeSummary } from "./AoiSettings";

describe("incremental AOI outcome summary", () => {
  it("does not claim completion while published domains have pending neighbours", () => {
    const result = {
      outcomes: [
        { domain: "emergency", status: "ready" },
        { domain: "public", status: "pending_qualification" },
      ],
    } as ProviderRuntimeResponse;
    const markup = renderToStaticMarkup(<RuntimeOutcomeSummary result={result} />);
    expect(markup).toContain("Partial snapshot");
    expect(markup).toContain("completed domains are available on the map");
    expect(markup).toContain("domains are still pending");
    expect(markup).not.toContain("All selected domains");
  });
});
