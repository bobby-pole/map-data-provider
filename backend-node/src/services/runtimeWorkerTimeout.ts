import type { ChildProcess } from "node:child_process";

/** A worker's descendants inherit stdout/stderr: never wait for close to report a timeout. */
export function armRuntimeWorkerTimeout(
  worker: ChildProcess,
  onTimeout: () => void,
  options: {
    timeoutMs: number;
    killGraceMs?: number;
    killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  },
): () => void {
  const killGroup = options.killGroup ?? ((pid, signal) => process.kill(-pid, signal));
  const terminate = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && worker.pid) {
        killGroup(worker.pid, signal);
      } else {
        worker.kill(signal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        // Still try the direct child if group signalling is unavailable.
        worker.kill(signal);
      }
    }
  };
  const timeout = setTimeout(() => {
    terminate("SIGTERM");
    const forceKill = setTimeout(() => {
      terminate("SIGKILL");
      worker.stdout?.destroy();
      worker.stderr?.destroy();
    }, options.killGraceMs ?? 2_000);
    forceKill.unref();
    onTimeout();
  }, options.timeoutMs);
  return () => {
    clearTimeout(timeout);
    // Even if the parent closes, descendants may ignore SIGTERM.
  };
}
