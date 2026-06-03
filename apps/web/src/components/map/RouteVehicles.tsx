import { useQuery } from "@tanstack/react-query";
import { Marker, Popup } from "react-leaflet";
import { fetchRouteVehicles } from "../../api";
import { vehicleIcon } from "../../lib/mapIcons";
import type { RouteFilter } from "../../lib/routeFilter";
import { VehiclePopup } from "./VehiclePopup";

export function RouteVehicles({ route }: { route: RouteFilter }) {
  const { data: vehicles = [] } = useQuery({
    queryKey: ["routeVehicles", route.routeId],
    queryFn: () => fetchRouteVehicles(route.routeId),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  return (
    <>
      {vehicles
        .filter((vehicle) => vehicle.headsign === route.headsign)
        .map((vehicle) => (
          <Marker
            key={vehicle.vehicleId ?? vehicle.tripId}
            position={[vehicle.lat, vehicle.lon]}
            icon={vehicleIcon(vehicle.heading, vehicle.hasGps)}
            zIndexOffset={500}
          >
            <Popup className="vehicle-popup" closeButton={false} maxWidth={260}>
              <VehiclePopup vehicle={vehicle} />
            </Popup>
          </Marker>
        ))}
    </>
  );
}
