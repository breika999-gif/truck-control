export interface GradeProfile {
  points: Array<{ fraction: number; gradePercent: number }>;
  steepSections: Array<{ start: number; end: number; grade: number }>;
}

type Coords = [number, number];

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distanceMeters(a: Coords, b: Coords): number {
  const midLatRad = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111320 * Math.cos(midLatRad);
  const dy = (b[1] - a[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

function cumulativeDistances(coords: Coords[]): number[] {
  const distances = [0];
  for (let i = 1; i < coords.length; i += 1) {
    distances.push(distances[i - 1] + distanceMeters(coords[i - 1], coords[i]));
  }
  return distances;
}

function coordinateAtFraction(coords: Coords[], fractions: number[], fraction: number): Coords {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];

  const target = clampFraction(fraction);
  for (let i = 1; i < fractions.length; i += 1) {
    if (target <= fractions[i] || i === fractions.length - 1) {
      const span = fractions[i] - fractions[i - 1];
      const t = span > 0 ? (target - fractions[i - 1]) / span : 0;
      const start = coords[i - 1];
      const end = coords[i];
      return [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
    }
  }
  return coords[coords.length - 1];
}

export function sampleRouteFractions(coords: Coords[], maxSamples = 80): number[] {
  if (coords.length === 0 || maxSamples <= 0) return [];
  if (coords.length === 1 || maxSamples === 1) return [0];

  const count = Math.min(maxSamples, Math.max(2, coords.length));
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

export function sampleRouteCoords(coords: Coords[], maxSamples = 80): Coords[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [coords[0]];

  const distances = cumulativeDistances(coords);
  const total = distances[distances.length - 1];
  if (total <= 0) return coords.slice(0, Math.min(coords.length, maxSamples));

  const sourceFractions = distances.map(distance => distance / total);
  return sampleRouteFractions(coords, maxSamples)
    .map(fraction => coordinateAtFraction(coords, sourceFractions, fraction));
}

export function buildGradeProfile(
  coords: Coords[],
  elevations: number[],
  fractions: number[],
): GradeProfile {
  const points: GradeProfile['points'] = [];
  const steepSections: GradeProfile['steepSections'] = [];
  const count = Math.min(coords.length, elevations.length, fractions.length);

  for (let i = 1; i < count; i += 1) {
    const start = coords[i - 1];
    const end = coords[i];
    const startElev = Number(elevations[i - 1]);
    const endElev = Number(elevations[i]);
    const horizDist = distanceMeters(start, end);
    if (!Number.isFinite(startElev) || !Number.isFinite(endElev) || horizDist <= 0) continue;

    const gradePercent = ((endElev - startElev) / horizDist) * 100;
    const sectionStart = clampFraction(fractions[i - 1]);
    const sectionEnd = clampFraction(fractions[i]);
    const pointFraction = (sectionStart + sectionEnd) / 2;
    points.push({ fraction: pointFraction, gradePercent });

    if (Math.abs(gradePercent) > 6) {
      const previous = steepSections[steepSections.length - 1];
      if (previous && sectionStart <= previous.end + 0.0001) {
        const previousSpan = Math.max(0.0001, previous.end - previous.start);
        const currentSpan = Math.max(0.0001, sectionEnd - sectionStart);
        previous.grade = (
          (previous.grade * previousSpan) + (gradePercent * currentSpan)
        ) / (previousSpan + currentSpan);
        previous.end = Math.max(previous.end, sectionEnd);
      } else {
        steepSections.push({ start: sectionStart, end: sectionEnd, grade: gradePercent });
      }
    }
  }

  return { points, steepSections };
}

export function gradeMultiplier(gradePct: number, isLoaded: boolean): number {
  if (!Number.isFinite(gradePct) || gradePct <= 0) return 1.0;

  if (gradePct <= 4) return 1.0;
  if (gradePct <= 6) return isLoaded ? 1.15 : 1.05;
  if (gradePct <= 8) return isLoaded ? 1.35 : 1.10;
  if (gradePct <= 12) return isLoaded ? 1.6 : 1.2;
  return isLoaded ? 2.0 : 1.4;
}
