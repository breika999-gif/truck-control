// GPX export/import utilities for TruckExpoAI

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a GPX 1.1 string from route coordinates + optional named waypoints.
 * Coordinates are [lng, lat] (Mapbox/GeoJSON order).
 */
export function buildGPX(
  coordinates: [number, number][],
  name: string,
  waypoints?: [number, number][],
  waypointNames?: string[],
): string {
  const now = new Date().toISOString();

  const wptXml = (waypoints ?? [])
    .map((coord, i) => {
      const label = waypointNames?.[i] ?? `Waypoint ${i + 1}`;
      return `  <wpt lat="${coord[1]}" lon="${coord[0]}">\n    <name>${escapeXml(label)}</name>\n  </wpt>`;
    })
    .join('\n');

  const trkptXml = coordinates
    .map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TruckExpoAI"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
${wptXml ? wptXml + '\n' : ''}  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkptXml}
    </trkseg>
  </trk>
</gpx>`;
}

export interface GpxWaypoint {
  lat: number;
  lon: number;
  name?: string;
}

/**
 * Parses a GPX XML string and returns all <wpt> entries.
 * Simple regex-based parser — no external dependencies needed.
 */
export function parseGPXWaypoints(gpxText: string): GpxWaypoint[] {
  const wpts: GpxWaypoint[] = [];
  const wptRegex = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;
  let match: RegExpExecArray | null;

  while ((match = wptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const inner = match[3] ?? '';
    const nameMatch = /<name>([^<]*)<\/name>/i.exec(inner);
    const name = nameMatch ? nameMatch[1].trim() : undefined;

    wpts.push({ lat, lon, name });
  }

  return wpts;
}
