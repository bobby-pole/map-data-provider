import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderRuntimeJob } from "../types/api";
import { pollRuntimeJob } from "./aoiStore";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const running = {
  job_id: "stuck-job",
  state: "running",
  completed_domains: 6,
  total_domains: 11,
  active_domain: "public",
} as ProviderRuntimeJob;

describe("runtime polling", () => {
  it("bounds requests and stops monitoring a permanently running job", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(running) });
    vi.stubGlobal("fetch", fetcher);
    const failure = expect(pollRuntimeJob(running, vi.fn(), vi.fn())).rejects.toThrow(
      "exceeded nine minutes",
    );
    await vi.advanceTimersByTimeAsync(550_000);
    await failure;
    expect(fetcher.mock.calls.length).toBeLessThan(115);
    expect(fetcher.mock.calls.length).toBeGreaterThan(100);
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });

  it("stops when the backend reports a worker timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...running, state: "failed", error: "worker_timeout" }),
    });
    vi.stubGlobal("fetch", fetcher);
    const result = expect(pollRuntimeJob(running, vi.fn(), vi.fn())).rejects.toThrow(
      "worker_timeout",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("publishes a partial result once and retains it when the server later times out", async () => {
  vi.useFakeTimers();
  const partial = { cached_at: "2026-11-02T12:00:00Z" } as NonNullable<
    ProviderRuntimeJob["partial_result"]
  >;
  const published = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...running, partial_result: partial }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...running, partial_result: partial }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          ...running,
          state: "failed",
          partial_result: partial,
          error: "worker_timeout",
        }),
    });
  vi.stubGlobal("fetch", fetcher);
  const result = expect(pollRuntimeJob(running, vi.fn(), vi.fn(), published)).rejects.toThrow(
    "worker_timeout",
  );
  await vi.advanceTimersByTimeAsync(5_000);
  await result;
  expect(published).toHaveBeenCalledExactlyOnceWith(partial);
});
