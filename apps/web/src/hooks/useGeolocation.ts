import type { LatLon } from "@onebus/shared";
import { useCallback, useEffect, useState } from "react";

const HIGH_ACCURACY: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 30_000,
  timeout: 12_000,
};
const LOW_ACCURACY: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 300_000,
  timeout: 20_000,
};
const WATCH: PositionOptions = { enableHighAccuracy: true, maximumAge: 10_000 };

const ERROR_VISIBLE_MS = 3000;

const toLatLon = ({ coords }: GeolocationPosition): LatLon => ({
  lat: coords.latitude,
  lon: coords.longitude,
});

function getPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, options),
  );
}

/** Tries GPS first, then settles for a coarse fix unless the user denied access. */
async function getBestPosition(): Promise<GeolocationPosition> {
  try {
    return await getPosition(HIGH_ACCURACY);
  } catch (err) {
    if ((err as GeolocationPositionError).code === GeolocationPositionError.PERMISSION_DENIED) {
      throw err;
    }
    return getPosition(LOW_ACCURACY);
  }
}

function errorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case GeolocationPositionError.PERMISSION_DENIED:
      return "Location access is blocked. Allow it for this site in your browser settings, then try again.";
    case GeolocationPositionError.TIMEOUT:
      return "Location timed out. Check GPS/Wi-Fi and try again.";
    default:
      return "Could not get your location. Try again.";
  }
}

/**
 * Tracks the user's position. `onLocated` fires for explicit locate requests
 * (and once on load, if permitted) but not for background position updates.
 */
export function useGeolocation(onLocated: (position: LatLon) => void) {
  const [position, setPosition] = useState<LatLon>();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string>();

  const request = useCallback(
    async (reportErrors: boolean) => {
      setLocating(true);
      try {
        const found = toLatLon(await getBestPosition());
        setPosition(found);
        onLocated(found);
      } catch (err) {
        if (reportErrors) setError(errorMessage(err as GeolocationPositionError));
      } finally {
        setLocating(false);
      }
    },
    [onLocated],
  );

  useEffect(() => {
    void request(false);
  }, [request]);

  const tracking = position !== undefined;
  useEffect(() => {
    if (!tracking) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setPosition(toLatLon(pos)),
      undefined,
      WATCH,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(undefined), ERROR_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [error]);

  const locate = () => {
    setError(undefined);
    if (position) onLocated(position);
    else void request(true);
  };

  return { position, locating, error, locate };
}
