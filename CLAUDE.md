# CLAUDE.md

@cm-tools.json

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Metro dev server
npx @react-native-community/cli start

# Run on connected Android device
npx react-native run-android

# ADB tunnels (required before running — do once per USB session)
adb reverse tcp:8081 tcp:8081   # Metro
adb reverse tcp:5050 tcp:5050   # Flask backend

# Flask backend
cd backend && python app.py     # Runs on port 5050

# Tests
npm test
npm test -- --testPathPattern="directions"  # Single test file

# Lint
npm run lint

# Release APK
cd android && gradlew.bat assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

## Architecture

### Frontend (React Native 0.84.0 + TypeScript)

Feature-based folder structure under `src/features/`. The entire map experience lives in `src/features/navigation/`:

- **`screens/MapScreen.tsx`** — Central screen. Hosts Mapbox view, LocationPuck, route rendering, layer orchestration, voice pipeline, and FAB buttons. All state delegated to hooks.
- **`hooks/useNavigationState.ts`** — Route, waypoints, speed limit, ETA.
- **`hooks/useMapUIState.ts`** — Chat/options panel open/close toggle.
- **`hooks/useChat.ts`** — GPT-4o and Gemini chat history.
- **`hooks/useVoice.ts`** — Voice recording → Gemini transcription → intent routing.
- **`hooks/useTacho.ts`** — EU HOS 561/2006 driver time state.
- **`hooks/usePOI.ts`** — POI CRUD + TomTom geocoding.
- **`components/ChatPanel.tsx`** — Dual chat UI (two mutually exclusive panels).
- **`components/NavigationHUD.tsx`** — Bottom turn-by-turn guidance panel.
- **`components/MapLayers.tsx`** — All Mapbox layer declarations (routes, traffic, 3D buildings, POI markers, terrain).
- **`utils/mapUtils.tsx`** — Constants, pure helpers, `StableCamera` component.
- **`MapScreen.styles.ts`** — All StyleSheet definitions (extracted, ~2000 lines).

### Dual AI Architecture

Two chat assistants, mutually exclusive (opening one closes the other):
- **Bottom-right FAB (🤖)** → GPT-4o via `/api/chat` → navigation actions (route, waypoints, restrictions)
- **Bottom-left FAB (💬)** → Gemini 2.0 Flash via `/api/gemini/chat` → general trucking assistant + app control

Voice flow: User speaks → Gemini transcribes → if nav intent → forward to GPT-4o → returns `MapAction` JSON → executed on Mapbox.

### Backend (Flask 3.1, `backend/app.py`)

Single-file Flask app proxying AI APIs and managing per-user data:
- **SQLite** (`truckai.db`): tables `pois` (per user_email), `chat_history`, `tacho_sessions`
- **OpenAI SDK** → GPT-4o navigation
- **`google-genai` SDK** → Gemini 2.0 Flash (note: NOT the old `google.generativeai` package)
- **Deployed on Railway** — `Procfile` sets `web: python app.py`, port via `PORT` env var

### Maps Stack

- **`@rnmapbox/maps` v10.2.10** — Map display, layers, camera
- **`@pawan-pk/react-native-mapbox-navigation` v0.5.2** — Turn-by-turn UI overlay
- **LocationPuck**: bearing image = `nav-arrow` (registered via `<Mapbox.Images>`), `followPadding` must always pass all 4 fields or native crash occurs
- **Tilequery API** (`src/features/navigation/api/tilequery.ts`) — truck restrictions + parking near route

### State Management

- **Zustand v5** (`src/store/vehicleStore.ts`) — client state (vehicle profile)
- **TanStack Query v5** — server/async state
- **Local `useState`/`useRef`** — ephemeral UI state in hooks

### Key Config

`src/shared/constants/config.ts` — holds `MAPBOX_PUBLIC_TOKEN`, `TOMTOM_API_KEY`, `BACKEND_URL` (currently Railway: `https://web-production-86ee4.up.railway.app`), and `MAP_CENTER` (Bulgaria: lon 25.0, lat 42.7).

`src/shared/constants/theme.ts` — dark theme constants. Always use these instead of hardcoded colors.

### Native Android Bridge

`android/app/src/main/java/com/truckai/AccountManagerModule.kt` — exposes Google AccountManager to JS. Used for per-user POI ownership (email as key). JS side: `src/shared/services/accountManager.ts`.

## Security Notes

Mapbox secret token (`sk.eyJ1...`) is correctly stored in user-level `~/.gradle/gradle.properties` — it is **not** in the repository. The public token (`pk.eyJ1...`) in `config.ts` is safe to commit.

## Testing

Tests live in `__tests__/`. The project uses Jest with `@testing-library/react-native`. Backend has `backend/test_routes.py` (run with `python -m pytest backend/test_routes.py`).

## GEMINI.md

`GEMINI.md` in root contains rules for MapScreen layer stack ordering — read it before modifying `MapLayers.tsx` or the Mapbox layer declarations in `MapScreen.tsx`.
