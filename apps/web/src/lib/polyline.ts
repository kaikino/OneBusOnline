/** Decodes a Google-encoded polyline into [lat, lon] pairs. */
export function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const nextDelta = () => {
    let result = 0;
    let shift = 0;
    let chunk: number;
    do {
      chunk = encoded.charCodeAt(index++) - 63;
      result |= (chunk & 0x1f) << shift;
      shift += 5;
    } while (chunk >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += nextDelta();
    lon += nextDelta();
    coords.push([lat * 1e-5, lon * 1e-5]);
  }
  return coords;
}
