# OneBusOnline — Refactoring Guide (for an AI agent)

You (the agent) are refactoring this repo to **reduce disorganization and "AI-generated" code smells** without changing behavior. Read this whole file first, then work in small, verifiable steps.

## 0. Prime directives (read before editing)

1. **Behavior must not change.** This is a pure refactor. No new features, no UX changes, no dependency additions unless a step explicitly calls for it.
2. **Work in small commits.** One concern per change. After each change, run the gates in §6 and stop if anything breaks.
3. **Verify, don't assume.** Read the file before editing it. Grep for every call site before renaming or moving anything.
4. **Prefer deleting over adding.** The biggest win here is consolidation. If you find yourself adding a lot of new code, reconsider.
5. **Don't add narration comments.** Remove comments that restate the code; keep only comments that explain non-obvious intent (e.g. the OBA seconds-vs-ms quirk).
6. **If a step is ambiguous or risky, stop and ask** rather than guessing.

## 1. What this app is (context)

A mobile-first PWA for viewing live transit (OneBusAway / Puget Sound) on a map.

- **`apps/web`** — React + Vite + TypeScript, Leaflet map, TanStack Query, Tailwind. PWA via `vite-plugin-pwa`.
- **`apps/server`** — Express BFF wrapping the `onebusaway-sdk`, with Redis caching, rate limiting, and response normalization.
- **`packages/shared`** — Shared TypeScript types + bbox helpers used by both sides.

## 2. Current state & known smells (the targets)

Verify each of these is still true before acting on it (line counts drift).

| File | Lines | Problem |
|------|-------|---------|
| `apps/web/src/components/ArrivalsDrawer.tsx` | ~1107 | God component: drag/collapse sheet gestures, route-filter UI, live arrivals query, preview chips + expanded rows, inline ETA/age formatting. |
| `apps/web/src/components/TransitMap.tsx` | ~1041 | God component: Leaflet gesture helpers, polyline decode, stop/vehicle icon builders, stop/route/vehicle layers, stops cache/merge, `FlyTo`. |
| `apps/web/src/App.tsx` | ~350 | Shell mixes geolocation/permission/locate logic with view layout. |
| `apps/server/src/obaService.ts` | ~396 | Multiple OBA methods + caching + bbox math in one class. |

**Recurring patterns to fix:**

- **Cross-file coupling via component files.** `headsignKey` and `rowMatchesFilter` (and the `RouteFilter` type) are defined in and exported from `ArrivalsDrawer.tsx`, then imported by `TransitMap.tsx` and `App.tsx`. Shared helpers should live in `lib/`, not in a component.
- **Business logic embedded in components** (polyline decoding, icon HTML builders, stops cache/merge orchestration, sheet-drag math) that belongs in `lib/` or `hooks/`.
- **Duplicated formatting / wording.** ETA labels are copied between `PreviewChip` and `ExpandedRow` (with a `<1 min` vs `< 1 min` inconsistency); deviation→minutes punctuality wording appears in both the map vehicle popup and the drawer rows; `coerceRealtimeEpochMs` (web) mirrors `wallClockUnixMs` (server `normalize.ts`). Note these but only de-dupe within scope (§8).
- **`*Seq` re-trigger counters** (`flyToSeq` / `userLocateSeq`, `collapseSeq`) force `useEffect` to re-run. Document *why* each exists; preserve their exact semantics (including the falsy-`0` guard on `collapseSeq`). **Do not silently change camera/scroll behavior.**
- **No automated tests.** Out of scope for this pass (see §8).

## 3. Target structure

Introduce these folders in `apps/web/src/` (create only when you have something to put in them):

```
apps/web/src/
  components/
    map/             # Leaflet helper components + layers (ViewportReporter, FlyTo, *Layer, ...)
    arrivals/        # PreviewChip, ExpandedRow
  hooks/             # useStopsMapCache, useArrivalsQuery, useDragSheet, useTouchPrimaryTap
  lib/               # pure helpers: routeFilter, polyline, mapIcons, relativeTime
```

**Do not impose a hard line-count rule.** Aim for cohesive modules; split when a file does several unrelated jobs, not to hit a number.

## 4. Phased plan (do in order, smallest risk first)

Each phase is independently shippable. Run §6 gates after every phase.

### Phase 1 — Shared route-filter helpers (fixes the coupling)
- [ ] Create `lib/routeFilter.ts` with `RouteFilter`, `headsignKey`, `rowMatchesFilter` (verbatim from `ArrivalsDrawer.tsx`).
- [ ] Update imports in `ArrivalsDrawer.tsx`, `TransitMap.tsx`, and `App.tsx`; remove the originals from the drawer.

### Phase 2 — Extract TransitMap pure helpers to `lib/`
- [ ] `lib/polyline.ts`: `decodePolyline`.
- [ ] `lib/mapIcons.ts`: `directionToDegrees`, `stopIcon` (+cache), `vehicleIcon` (+cache), `vehicleKey`, `USER_LOCATION_ICON`.
- [ ] `lib/relativeTime.ts`: `formatRelativeAge`.

### Phase 3 — Decompose `TransitMap.tsx`
- [ ] Move Leaflet helper components (`ViewportReporter`, `ZoomControlFix`, `SmoothWheelZoom`, `PinchToPan`, `FlyTo`) into `components/map/`.
- [ ] Move layers (`StopMarkersLayer`, `RoutePolylineLayer`, `RouteVehiclesLayer` + `VehiclePopupContent`) into `components/map/`.
- [ ] Move stops persistence/merge/fetch into `hooks/useStopsMapCache.ts`. `TransitMap.tsx` becomes mostly composition (`<MapContainer>` + layers).

### Phase 4 — Decompose `ArrivalsDrawer.tsx`
- [ ] Move `useTouchPrimaryTap` into `hooks/`; extract the arrivals query + cache + extend-window + banners into `hooks/useArrivalsQuery.ts`.
- [ ] Extract the drag/collapse sheet mechanics into `hooks/useDragSheet.ts`, preserving every threshold and the `collapseSeq` contract exactly.
- [ ] Move `PreviewChip` and `ExpandedRow` into `components/arrivals/`. `ArrivalsDrawer.tsx` becomes composition + layout JSX.

## 5. Refactoring rules (how to make each change)

- **Move, then dedupe, then delete.** Create the new home, point one caller at it, verify, then migrate the rest, then delete originals.
- **Keep public component props stable.** Internal extraction shouldn't ripple into `App.tsx` prop changes (an import-path change for the relocated `RouteFilter` type is fine).
- **No logic rewrites disguised as moves.** When relocating a function, copy it verbatim; refactor its internals in a *separate* follow-up step so diffs stay reviewable.
- **Preserve exact UI strings** (including the `<1 min` vs `< 1 min` difference) and the OBA quirk comments in `normalize.ts`.

## 6. Verification gates (run after every change)

```bash
npm run build      # builds @onebus/shared + @onebus/server + @onebus/web
```

- [ ] Build passes with **no new** TypeScript errors.
- [ ] No new linter errors (check edited files).
- [ ] Grep confirms no dangling imports/exports after a move.
- [ ] Manual smoke: map loads, locate + search fly the camera, stop tap opens drawer, route filter highlights the map + filters the list, live buses render; drawer drag/collapse/flick-to-close behave identically.

## 7. Definition of done

- The two ~1k-line components are decomposed; no file does several unrelated jobs.
- Shared helpers (route filter, polyline, icons) live in `lib/`, not inside a component file.
- `*Seq` semantics are preserved (and documented with a one-line intent comment where non-obvious).
- Behavior is identical to before the refactor.

## 8. Out of scope (do not do unless asked)

- Adding tests / test infrastructure.
- Changing `App.tsx` geolocation logic or anything in `apps/server` / `packages/shared`.
- Cross-component formatting de-dup (e.g. unifying `coerceRealtimeEpochMs` with the server, or merging map vs drawer punctuality wording).
- New features, redesigns, dependency upgrades, BFF contract / cache TTL changes, or PWA/service-worker rework.
