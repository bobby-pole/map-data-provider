import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";

describe("security headers middleware", () => {
  it("sets hardened HTTP headers and hides X-Powered-By without breaking map tile origins", async () => {
    const app = createApp();
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["strict-transport-security"]).toBeUndefined();

    const csp = response.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("https://tile.openstreetmap.org");
    expect(csp).toContain("https://integracja.gugik.gov.pl");
    expect(csp).toContain("https://mapy.geoportal.gov.pl");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
