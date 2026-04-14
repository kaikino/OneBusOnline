export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function bboxContainsPoint(bbox: Bbox, lat: number, lon: number): boolean {
  return (
    lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon
  );
}
