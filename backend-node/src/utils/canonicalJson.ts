import { createHash } from "node:crypto";

/**
 * Deterministic JSON serialization preserving array order, matching the
 * Python `json.dumps(..., sort_keys=True, separators=(",", ":"))` contract
 * used for manifest checksums.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Deterministic JSON serialization that also lexicographically sorts arrays.
 * Used exclusively for AOI runtime request identity coalescing where requested
 * profile ordering must not create distinct cache/job keys.
 */
export function canonicalJsonSortedArrays(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonSortedArrays).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonSortedArrays(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compute lowercase hexadecimal SHA-256 digest of a UTF-8 string or Buffer.
 */
export function sha256Hex(payload: string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}
