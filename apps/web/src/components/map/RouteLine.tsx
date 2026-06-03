import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Polyline } from "react-leaflet";
import { fetchRouteShape } from "../../api";
import { decodePolyline } from "../../lib/polyline";

const LINE_STYLE = { color: "#0ea5e9", weight: 5, opacity: 0.85 };

export function RouteLine({ routeId }: { routeId: string }) {
  const { data: shape } = useQuery({
    queryKey: ["routeShape", routeId],
    queryFn: () => fetchRouteShape(routeId),
    staleTime: 60 * 60_000,
  });

  const lines = useMemo(() => shape?.polylines.map(decodePolyline) ?? [], [shape]);

  return <Polyline positions={lines} pathOptions={LINE_STYLE} interactive={false} />;
}
