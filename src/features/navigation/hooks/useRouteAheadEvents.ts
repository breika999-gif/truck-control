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
      // Stringify coords for stable comparison
      input.userCoords?.[0],
      input.userCoords?.[1],
      input.steps,
      input.restrictions,
      input.remainingTachoSec,
    ],
  );
}
