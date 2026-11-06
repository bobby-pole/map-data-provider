import { afterEach, describe, expect, it, vi } from "vitest";

import { safeRasterProtocol, toSafeRasterUrl } from "./safeRasterProtocol";

describe("safeRasterProtocol", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts http/https URLs to safe-raster://", () => {
    expect(toSafeRasterUrl("https://example.com/tiles/{z}/{x}/{y}")).toBe(
      "safe-raster://example.com/tiles/{z}/{x}/{y}",
    );
    expect(toSafeRasterUrl("http://example.com/tiles")).toBe("safe-raster://example.com/tiles");
  });

  it("returns image data when response is a valid PNG", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const abortController = new AbortController();
    const result = await safeRasterProtocol(
      { url: "safe-raster://example.com/tile.png" },
      abortController,
    );
    expect(new Uint8Array(result.data)).toEqual(pngBytes);
  });

  it("returns image data when response is a valid JPEG", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(jpegBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const abortController = new AbortController();
    const result = await safeRasterProtocol(
      { url: "safe-raster://example.com/tile.jpeg" },
      abortController,
    );
    expect(new Uint8Array(result.data)).toEqual(jpegBytes);
  });

  it("returns empty buffer when response is text/xml (e.g. ServiceExceptionReport)", async () => {
    const xml =
      "<ServiceExceptionReport><ServiceException>proj error</ServiceException></ServiceExceptionReport>";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(xml, {
        status: 200,
        headers: { "content-type": "text/xml; charset=UTF-8" },
      }),
    );

    const abortController = new AbortController();
    const result = await safeRasterProtocol(
      { url: "safe-raster://example.com/tile.png" },
      abortController,
    );
    expect(result.data.byteLength).toBe(0);
  });

  it("returns empty buffer on HTTP errors (404, 500)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", {
        status: 404,
      }),
    );

    const abortController = new AbortController();
    const result = await safeRasterProtocol(
      { url: "safe-raster://example.com/tile.png" },
      abortController,
    );
    expect(result.data.byteLength).toBe(0);
  });

  it("returns empty buffer when payload lacks valid image magic bytes", async () => {
    const corruptBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(corruptBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const abortController = new AbortController();
    const result = await safeRasterProtocol(
      { url: "safe-raster://example.com/tile.png" },
      abortController,
    );
    expect(result.data.byteLength).toBe(0);
  });

  it("re-throws when aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(
      safeRasterProtocol({ url: "safe-raster://example.com/tile.png" }, abortController),
    ).rejects.toThrow();
  });
});
