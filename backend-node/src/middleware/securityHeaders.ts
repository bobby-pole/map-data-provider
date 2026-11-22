import helmet from "helmet";

export function createSecurityHeadersMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://tile.openstreetmap.org",
          "https://integracja.gugik.gov.pl",
          "https://mapy.geoportal.gov.pl",
        ],
        connectSrc: [
          "'self'",
          "blob:",
          "data:",
          "https://tile.openstreetmap.org",
          "https://integracja.gugik.gov.pl",
          "https://mapy.geoportal.gov.pl",
        ],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    // Edge reverse proxy / CDN terminates TLS and manages HSTS.
    strictTransportSecurity: false,
  });
}
