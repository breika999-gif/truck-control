/**
 * useRouteAheadEvents — maintains a sorted list of upcoming guidance events.
 *
 * Recomputes whenever: current step changes, user position updates, or route changes.
 * Returns the top (highest priority + closest) event for NavigationTopPanel to render.
 */
import { useMemo } from 'react';
import {
  buildRouteAheadEvents,
  type RouteAheadEvent,
  type BuildEventsInput,
} from '../utils/routeAheadEvents';

export function useRouteAheadEvents(input: BuildEventsInput): RouteAheadEvent[] {
  const userLng = input.userCoords?.[0];
  const userLat = input.userCoords?.[1];

  return useMemo(
    () => {
      if (!input.steps.length) return [];
      return buildRouteAheadEvents(input);
    },
    // Recompute when position, step, or route changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      input.currentStepIdx,
      input.distToTurn,
      userLng,
      userLat,
      input.steps,
      input.restrictions,
      input.remainingTachoSec,
    ],
  );
}
