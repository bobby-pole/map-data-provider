import path from "node:path";

/**
 * Resolve the interpreter created during image build. Runtime code must not
 * invoke `uv run`: as a non-root container user uv would re-resolve the Python
 * version instead of executing this already prepared virtual environment.
 */
export function runtimePythonExecutable(backendDirectory: string): string {
  return process.env.MDQ_RUNTIME_PYTHON ?? path.join(backendDirectory, ".venv", "bin", "python");
}
