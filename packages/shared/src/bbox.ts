export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

const GRID = 1e4;

/** Snaps edges to a 0.0001° grid so client requests and server cache keys agree. */
export function quantizeBbox(bbox: Bbox): Bbox {
  const snap = (x: number) => Math.round(x * GRID) / GRID;
  return {
    minLat: snap(bbox.minLat),
    minLon: snap(bbox.minLon),
    maxLat: snap(bbox.maxLat),
    maxLon: snap(bbox.maxLon),
  };
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat &&
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon
  );
}

export function bboxContainsPoint(bbox: Bbox, lat: number, lon: number): boolean {
  return (
    lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon
  );
}
