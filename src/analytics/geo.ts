/**
 * Coarse location helpers for funder maps.
 * Never store street addresses. Round coords so dots are ~city/neighborhood scale.
 */

/** ~0.05° ≈ 3–4 miles — privacy floor for any stored point */
const COORD_PRECISION = 20; // 1/0.05

export function roundCoord(n: number): number {
  return Math.round(n * COORD_PRECISION) / COORD_PRECISION;
}

export interface CoarseLocation {
  lat: number | null;
  lng: number | null;
  label: string | null;
}

export function fromCampaignPin(pin: {
  lat: number | null;
  lng: number | null;
  label: string | null;
}): CoarseLocation {
  if (pin.lat == null || pin.lng == null) {
    return { lat: null, lng: null, label: pin.label };
  }
  return {
    lat: roundCoord(pin.lat),
    lng: roundCoord(pin.lng),
    label: pin.label,
  };
}

/** Best-effort city-level IP lookup. Fails soft — never blocks redirects. */
export async function coarseFromIp(ip: string | null): Promise<CoarseLocation> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return { lat: null, lng: null, label: null };
  }
  // Strip IPv6-mapped IPv4
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  try {
    const ctrl = AbortSignal.timeout(1500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,city,regionName,lat,lon`,
      { signal: ctrl },
    );
    if (!res.ok) return { lat: null, lng: null, label: null };
    const data = (await res.json()) as {
      status?: string;
      city?: string;
      regionName?: string;
      lat?: number;
      lon?: number;
    };
    if (data.status !== "success" || data.lat == null || data.lon == null) {
      return { lat: null, lng: null, label: null };
    }
    const parts = [data.city, data.regionName].filter(Boolean);
    return {
      lat: roundCoord(data.lat),
      lng: roundCoord(data.lon),
      label: parts.length ? parts.join(", ") : null,
    };
  } catch {
    return { lat: null, lng: null, label: null };
  }
}

export function clientIp(
  headers: { get?(name: string): string | null | undefined; [k: string]: unknown },
  remoteAddress?: string,
): string | null {
  const xf =
    (typeof headers.get === "function"
      ? headers.get("x-forwarded-for")
      : (headers["x-forwarded-for"] as string | undefined)) ?? undefined;
  if (typeof xf === "string" && xf.length) {
    return xf.split(",")[0]!.trim();
  }
  return remoteAddress ?? null;
}
