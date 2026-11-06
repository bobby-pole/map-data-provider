export function toSafeRasterUrl(url: string): string {
  return url.replace(/^https?:\/\//, "safe-raster://");
}

export async function safeRasterProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: ArrayBuffer }> {
  const httpUrl = params.url.replace(/^safe-raster:\/\//, "https://");
  try {
    const response = await fetch(httpUrl, { signal: abortController.signal, mode: "cors" });
    if (!response.ok) {
      return { data: new ArrayBuffer(0) };
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (
      contentType.includes("xml") ||
      contentType.includes("html") ||
      contentType.includes("text")
    ) {
      return { data: new ArrayBuffer(0) };
    }
    const data = await response.arrayBuffer();
    if (data.byteLength < 4) {
      return { data: new ArrayBuffer(0) };
    }
    const bytes = new Uint8Array(data, 0, 4);
    // PNG starts with 0x89 0x50 0x4e 0x47, JPEG starts with 0xff 0xd8
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) {
      return { data: new ArrayBuffer(0) };
    }
    return { data };
  } catch (error) {
    if (abortController.signal.aborted) {
      throw error;
    }
    return { data: new ArrayBuffer(0) };
  }
}
