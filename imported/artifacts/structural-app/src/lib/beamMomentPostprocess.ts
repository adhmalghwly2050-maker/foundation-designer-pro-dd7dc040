import type { Column } from '@/lib/structuralEngine';

interface BeamFaceSamplingInput {
  span: number;
  stations?: number[];
  momentLeft: number;
  momentRight: number;
  halfColLeft: number;
  halfColRight: number;
  releaseLeft?: boolean;
  releaseRight?: boolean;
}

interface BeamFaceSamplingResult {
  Mleft: number;
  Mright: number;
  stations?: number[];
}

export function getEndpointColumnHalfWidth(
  columns: Column[],
  x: number,
  y: number,
  isHoriz: boolean,
  tolerance = 0.05,
): number {
  const matchedColumn = columns.find((column) =>
    !column.isRemoved &&
    Math.abs(column.x - x) <= tolerance &&
    Math.abs(column.y - y) <= tolerance,
  );

  if (!matchedColumn) return 0;
  // Account for column orientAngle (ACI 318-19 §6.3.2.1 rigid end offset).
  // orientAngle=0°: b along X, h along Y.
  // orientAngle=90°: b along Y, h along X.
  // General case: bounding-box half-extent in beam direction.
  const θ = ((matchedColumn.orientAngle ?? 0) * Math.PI) / 180;
  const bHalf = matchedColumn.b / 2000;
  const hHalf = matchedColumn.h / 2000;
  return isHoriz
    ? Math.abs(bHalf * Math.cos(θ)) + Math.abs(hHalf * Math.sin(θ))
    : Math.abs(bHalf * Math.sin(θ)) + Math.abs(hHalf * Math.cos(θ));
}

export function sampleBeamEndMomentsAtPhysicalFaces({
  span,
  stations,
  momentLeft,
  momentRight,
  halfColLeft,
  halfColRight,
  releaseLeft = false,
  releaseRight = false,
}: BeamFaceSamplingInput): BeamFaceSamplingResult {
  const normalizeSupportMoment = (
    sampledMoment: number,
    fallbackMoment: number,
    hasColumn: boolean,
    isReleased: boolean,
  ) => {
    if (isReleased) return 0;
    const moment = Number.isFinite(sampledMoment) ? sampledMoment : fallbackMoment;
    if (hasColumn && moment > 0) return 0;
    return moment;
  };

  if (!stations || stations.length < 2 || span <= 1e-9) {
    return {
      Mleft: normalizeSupportMoment(momentLeft, momentLeft, halfColLeft > 1e-6, releaseLeft),
      Mright: normalizeSupportMoment(momentRight, momentRight, halfColRight > 1e-6, releaseRight),
      stations,
    };
  }

  const nSeg = stations.length - 1;
  const sampleAt = (xCC: number) => {
    const xc = Math.max(0, Math.min(span, xCC));
    const t = (xc / span) * nSeg;
    const i0 = Math.max(0, Math.min(nSeg - 1, Math.floor(t)));
    const frac = t - i0;
    return stations[i0] * (1 - frac) + stations[i0 + 1] * frac;
  };

  const hasLeftCol = halfColLeft > 1e-6;
  const hasRightCol = halfColRight > 1e-6;

  const faceLeftRaw = hasLeftCol ? sampleAt(halfColLeft) : stations[0];
  const faceRightRaw = hasRightCol ? sampleAt(span - halfColRight) : stations[stations.length - 1];
  const faceLeft = normalizeSupportMoment(faceLeftRaw, momentLeft, hasLeftCol, releaseLeft);
  const faceRight = normalizeSupportMoment(faceRightRaw, momentRight, hasRightCol, releaseRight);

  const faceStations = [...stations];
  faceStations[0] = faceLeft;
  faceStations[faceStations.length - 1] = faceRight;

  return {
    Mleft: faceLeft,
    Mright: faceRight,
    stations: faceStations,
  };
}