import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { armRuntimeWorkerTimeout } from "./runtimeWorkerTimeout.js";

afterEach(() => vi.useRealTimers());

describe("runtime worker deadline", () => {
  it("reports failure without close and kills descendants even after the parent exits", () => {
    vi.useFakeTimers();
    const worker = Object.assign(new EventEmitter(), {
      pid: 1234,
      kill: vi.fn(),
      stdout: { destroy: vi.fn() },
      stderr: { destroy: vi.fn() },
    });
    const killGroup = vi.fn();
    const onTimeout = vi.fn();
    const clear = armRuntimeWorkerTimeout(worker as unknown as ChildProcess, onTimeout, {
      timeoutMs: 100,
      killGraceMs: 20,
      killGroup,
    });
    vi.advanceTimersByTime(100);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(killGroup).toHaveBeenCalledWith(1234, "SIGTERM");
    worker.emit("exit", null, "SIGTERM");
    clear();
    vi.advanceTimersByTime(20);
    expect(killGroup).toHaveBeenCalledWith(1234, "SIGKILL");
    expect(worker.stdout.destroy).toHaveBeenCalledOnce();
    expect(worker.stderr.destroy).toHaveBeenCalledOnce();
  });

  it("does not kill a successfully completed worker", () => {
    vi.useFakeTimers();
    const killGroup = vi.fn();
    const onTimeout = vi.fn();
    const clear = armRuntimeWorkerTimeout({ pid: 1234 } as ChildProcess, onTimeout, {
      timeoutMs: 100,
      killGroup,
    });
    clear();
    vi.advanceTimersByTime(200);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(killGroup).not.toHaveBeenCalled();
  });
});
