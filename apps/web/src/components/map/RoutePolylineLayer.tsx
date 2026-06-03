import { useQuery } from "@tanstack/react-query";
import { memo, useMemo } from "react";
import { Polyline } from "react-leaflet";
import { fetchRouteShape } from "../../api";
import { decodePolyline } from "../../lib/polyline";

export const RoutePolylineLayer = memo(
  function RoutePolylineLayer({ routeId }: { routeId: string }) {
    const shapeQuery = useQuery({
      queryKey: ["routeShape", routeId],
      queryFn: () => fetchRouteShape(routeId),
      staleTime: 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

    const lines = useMemo(() => {
      const polys = shapeQuery.data?.polylines ?? [];
      const out: [number, number][][] = [];
      for (const p of polys) {
        if (!p) continue;
        const pts = decodePolyline(p);
        if (pts.length >= 2) out.push(pts);
      }
      return out;
    }, [shapeQuery.data]);

    if (lines.length === 0) return null;
    return (
      <>
        {lines.map((pts, i) => (
          <Polyline
            key={i}
            positions={pts}
            pathOptions={{
              color: "#0ea5e9",
              weight: 5,
              opacity: 0.85,
              lineJoin: "round",
              lineCap: "round",
            }}
            interactive={false}
          />
        ))}
      </>
    );
  }
);
