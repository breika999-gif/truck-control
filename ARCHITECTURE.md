# TruckExpoAI — Архитектурен план

**Версия**: 1.0
**Дата**: 2026-02-23
**Статус**: Одобрен

---

## Съдържание

1. [Текущо състояние](#1-текущо-състояние)
2. [Структура на мобилното приложение](#2-структура-на-мобилното-приложение)
3. [Backend архитектура](#3-backend-архитектура)
4. [AI интеграция](#4-ai-интеграция)
5. [Mapbox стратегия](#5-mapbox-стратегия)
6. [Данни и модели](#6-данни-и-модели)
7. [Сигурност и GDPR](#7-сигурност-и-gdpr)
8. [Мащабируемост](#8-мащабируемост)
9. [Финален технологичен стек](#9-финален-технологичен-стек)
10. [Фази на изпълнение](#10-фази-на-изпълнение)

---

## 1. Текущо състояние

### Какво съществува

- **Платформа**: React Native 0.84.0 + TypeScript (New Architecture / Fabric)
- **Навигация**: `@pawan-pk/react-native-mapbox-navigation` v0.5.2
- **Демо**: Хардкодиран маршрут София → Пловдив
- **UI**: Тъмна тема (`#1a1a2e`), български език, метрична система
- **State**: само `useState` — без глобален state
- **Backend**: няма — изцяло клиентско приложение
- **AI**: няма — само в името

### Технически дълг

| Проблем | Приоритет | Описание |
|---------|-----------|---------|
| Secret token в git | **КРИТИЧНО** | Mapbox `sk.` token в `android/gradle.properties` |
| Няма folder структура | Висок | Цялата логика е в `App.tsx` |
| Няма навигация (screens) | Висок | Невъзможно добавяне на функции |
| Няма state management | Среден | `useState` не се мащабира |
| Няма API слой | Среден | Без backend комуникация |
| Хардкодирани координати | Нисък | Само за демо |

### ⚠️ КРИТИЧНО: Ротирай Mapbox токена

Файлът `android/gradle.properties` съдържа Mapbox secret key (`sk.` prefix) staged в git.

**Стъпки**:
1. Влез в Mapbox Dashboard → ротирай токена
2. Премахни го от `gradle.properties`
3. Добави го в `~/.gradle/gradle.properties` (user-level, не в проекта)
4. Или използвай environment variable: `MAPBOX_DOWNLOADS_TOKEN`
5. Провери `.gitignore` — добави `*.local.properties`

---

## 2. Структура на мобилното приложение

### Folder структура

```
src/
├── app/
│   ├── App.tsx                    # Root component (providers)
│   ├── RootNavigator.tsx          # Auth vs Main navigator
│   └── providers/
│       ├── AuthProvider.tsx
│       ├── ThemeProvider.tsx
│       └── QueryProvider.tsx
│
├── features/
│   ├── auth/
│   │   ├── screens/
│   │   │   ├── LoginScreen.tsx
│   │   │   ├── PinScreen.tsx
│   │   │   └── BiometricScreen.tsx
│   │   ├── hooks/useAuth.ts
│   │   ├── api/authApi.ts
│   │   └── types.ts
│   │
│   ├── navigation/                # Картата и навигацията
│   │   ├── screens/
│   │   │   ├── MapScreen.tsx
│   │   │   ├── NavigationScreen.tsx
│   │   │   ├── RouteSearchScreen.tsx
│   │   │   └── RoutePreviewScreen.tsx
│   │   ├── components/
│   │   │   ├── TruckMapView.tsx
│   │   │   ├── RouteInfoBar.tsx
│   │   │   └── TruckRestrictionBadge.tsx
│   │   ├── hooks/
│   │   │   ├── useNavigation.ts
│   │   │   ├── useTruckRoute.ts
│   │   │   └── useLocationTracking.ts
│   │   ├── api/routingApi.ts
│   │   └── types.ts
│   │
│   ├── ai-assistant/              # Чат + гласов асистент
│   │   ├── screens/AssistantScreen.tsx
│   │   ├── components/
│   │   │   ├── ChatBubble.tsx
│   │   │   ├── VoiceButton.tsx
│   │   │   └── SuggestionChip.tsx
│   │   ├── hooks/
│   │   │   ├── useAIChat.ts
│   │   │   ├── useVoiceInput.ts
│   │   │   └── useVoiceOutput.ts
│   │   ├── api/aiApi.ts
│   │   └── types.ts
│   │
│   ├── hos/                       # Hours of Service (EU 561/2006)
│   │   ├── screens/
│   │   │   ├── HOSDashboardScreen.tsx
│   │   │   ├── HOSLogScreen.tsx
│   │   │   └── HOSEditScreen.tsx
│   │   ├── components/
│   │   │   ├── HOSClock.tsx
│   │   │   ├── DutyStatusBar.tsx
│   │   │   └── HOSViolationAlert.tsx
│   │   ├── hooks/useHOS.ts
│   │   ├── api/hosApi.ts
│   │   └── types.ts
│   │
│   ├── fleet/                     # Fleet tracking (dispatcher)
│   │   ├── screens/
│   │   │   ├── FleetMapScreen.tsx
│   │   │   ├── VehicleDetailScreen.tsx
│   │   │   └── FleetDashboardScreen.tsx
│   │   ├── components/
│   │   │   ├── VehicleMarker.tsx
│   │   │   └── FleetStatusCard.tsx
│   │   ├── hooks/
│   │   │   ├── useFleetTracking.ts
│   │   │   └── useWebSocket.ts
│   │   ├── api/fleetApi.ts
│   │   └── types.ts
│   │
│   ├── cargo/
│   │   ├── screens/
│   │   │   ├── CargoListScreen.tsx
│   │   │   ├── CargoDetailScreen.tsx
│   │   │   └── CargoScanScreen.tsx
│   │   ├── hooks/useCargo.ts
│   │   ├── api/cargoApi.ts
│   │   └── types.ts
│   │
│   ├── fuel/
│   │   ├── screens/
│   │   │   ├── FuelDashboardScreen.tsx
│   │   │   └── FuelStationScreen.tsx
│   │   ├── hooks/useFuelOptimization.ts
│   │   ├── api/fuelApi.ts
│   │   └── types.ts
│   │
│   └── poi/
│       ├── screens/POIListScreen.tsx
│       ├── components/
│       │   ├── POICard.tsx
│       │   └── POIMarker.tsx
│       ├── hooks/usePOI.ts
│       ├── api/poiApi.ts
│       └── types.ts
│
├── shared/
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── LoadingSpinner.tsx
│   │   └── ErrorBoundary.tsx
│   ├── hooks/
│   │   ├── usePermissions.ts
│   │   ├── useNetwork.ts
│   │   └── useSecureStorage.ts
│   ├── services/
│   │   ├── apiClient.ts
│   │   ├── secureStorage.ts
│   │   ├── locationService.ts
│   │   └── notificationService.ts
│   ├── constants/
│   │   ├── config.ts
│   │   ├── theme.ts
│   │   └── truckProfiles.ts
│   ├── types/
│   │   ├── api.ts
│   │   ├── navigation.ts
│   │   └── models.ts
│   └── utils/
│       ├── formatting.ts
│       ├── geo.ts
│       └── validation.ts
│
├── store/
│   ├── index.ts
│   ├── authStore.ts
│   ├── navigationStore.ts
│   ├── vehicleStore.ts
│   └── settingsStore.ts
│
└── i18n/
    ├── index.ts
    ├── bg.json
    ├── en.json
    ├── de.json
    └── ro.json
```

### Навигационна йерархия (React Navigation v7)

```
RootNavigator (Stack)
├── AuthStack
│   ├── LoginScreen
│   ├── PinScreen
│   └── BiometricScreen
│
└── MainStack
    ├── MainTabs (Bottom Tab)
    │   ├── NavigationTab
    │   │   ├── MapScreen
    │   │   ├── RouteSearchScreen
    │   │   ├── RoutePreviewScreen
    │   │   └── NavigationScreen (full-screen, скрива tabs)
    │   ├── AssistantTab → AssistantScreen
    │   ├── HOSTab
    │   │   ├── HOSDashboardScreen
    │   │   ├── HOSLogScreen
    │   │   └── HOSEditScreen
    │   ├── FleetTab (само за диспечери)
    │   │   ├── FleetMapScreen
    │   │   ├── FleetDashboardScreen
    │   │   └── VehicleDetailScreen
    │   └── ProfileTab
    │       ├── ProfileScreen
    │       ├── VehicleSettingsScreen
    │       └── AppSettingsScreen
    │
    ├── CargoDetailScreen (modal)
    ├── FuelStationScreen (modal)
    └── POIListScreen (modal)
```

### State Management: Zustand

**Избор: Zustand v5** пред Redux Toolkit и Jotai.

| Критерий | Redux Toolkit | Zustand | Jotai |
|----------|--------------|---------|-------|
| Bundle | ~11KB | ~1KB | ~3KB |
| Boilerplate | Среден | Минимален | Минимален |
| TypeScript DX | Добър | Отличен | Добър |
| Offline persist | Добър | Добър | Труден |

- **Zustand** — клиентски state (auth, vehicle profile, settings)
- **TanStack Query v5** — сървърски state (fetch, cache, mutations)

---

## 3. Backend архитектура

### Framework: NestJS 11 (Node.js/TypeScript)

- TypeScript end-to-end (споделени Zod схеми с mobile)
- NestJS модули = domain граници = бъдещи microservices
- Built-in WebSocket gateway за fleet tracking
- Автоматично OpenAPI генериране

### API: REST + OpenAPI 3.1

REST пред GraphQL:
- HTTP кеширане (критично за offline-first)
- Прост file upload (cargo документи)
- По-бързо onboarding на екип

### Модули (Modular Monolith)

```
backend/src/modules/
├── auth/           # JWT, PIN, biometric challenge
├── routing/        # Truck-safe route calculation + Mapbox proxy
├── ai/             # Claude orchestration, tool execution
├── fleet/          # GPS ingestion, WebSocket, dispatch
├── hos/            # EU 561/2006 compliance engine
├── cargo/          # Load management
├── fuel/           # Fuel optimization
├── poi/            # Truck POI database
└── notifications/  # FCM/APNs push
```

### Основни API Endpoints

```
# Auth
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/pin
DELETE /api/v1/auth/logout

# Routing
POST   /api/v1/routes/calculate
GET    /api/v1/routes/:id
GET    /api/v1/routes

# AI
POST   /api/v1/ai/chat
POST   /api/v1/ai/voice
GET    /api/v1/ai/history

# Fleet
GET    /api/v1/fleet/vehicles
POST   /api/v1/fleet/positions
WS     /api/v1/fleet/live

# HOS
GET    /api/v1/hos/current
POST   /api/v1/hos/status
GET    /api/v1/hos/logs
GET    /api/v1/hos/violations

# Cargo
GET    /api/v1/cargo
POST   /api/v1/cargo
PATCH  /api/v1/cargo/:id

# Fuel
GET    /api/v1/fuel/stations
GET    /api/v1/fuel/optimize

# POI
GET    /api/v1/poi
GET    /api/v1/poi/along-route/:id
```

### Database: PostgreSQL 16 + PostGIS

PostGIS е задължителен за:
- `ST_DWithin` — близки бензиностанции, POI
- `ST_LineString` — маршрут геометрия
- `ST_Intersects` — детекция на ограничения
- Spatial indexing (GiST) за бързи geo заявки

### Real-time Fleet Tracking

```
Шофьор (GPS на 5с)
    │
    ▼  POST /fleet/positions (batch на 30с)
┌──────────┐
│ REST API │
└──────┬───┘
       ├──► Redis (latest pos + Pub/Sub)
       └──► PostgreSQL (batch write, partition by month)
              │
              ▼
       WebSocket Gateway ──► Dispatcher App
```

---

## 4. AI интеграция

### Модел по задача

| Задача | Модел | Причина |
|--------|-------|---------|
| Route reasoning, logistics | Claude Sonnet 4 | Сложно мислене, tool use |
| Чат асистент | Claude Sonnet 4 | Качество |
| Voice intent parsing | Claude Haiku 3.5 | <500мс латентност |
| HOS violation analysis | Claude Sonnet 4 | Правна точност |
| Document extraction (BOL) | Claude Sonnet 4 + vision | Снимки на товарителници |

### AI Tool Use

Claude може да извиква:

```typescript
calculate_route(origin, destination, vehicle_profile)
find_fuel_stations(location, radius, fuel_type)
check_hos_remaining()
find_rest_stops(location, radius, amenities)
get_weather_along_route(route_id)
update_cargo_status(cargo_id, status)
optimize_fuel_stops(route_id, tank_capacity)
report_road_hazard(location, hazard_type, description)
```

### Гласов Pipeline

```
Шофьор говори
    │
    ▼  STT (on-device / Whisper за BG)
    │
    ▼  POST /ai/chat { text, is_voice: true }
    │
    ▼  Haiku: intent parsing (<500мс)
    │
    ▼  Sonnet: execute tools, compose response
    │
    ▼  { text, voice_response, actions }
    │
    ▼  TTS → Шофьорът чува
```

### Структуриран изход за маршрутни решения

```typescript
interface RouteDecision {
  recommended_route: {
    waypoints: Array<{ lat: number; lng: number; name: string }>;
    total_distance_km: number;
    estimated_duration_minutes: number;
    fuel_cost_estimate_bgn: number;
    restrictions_avoided: Array<{
      type: 'low_bridge' | 'weight_limit' | 'hazmat_zone' | 'narrow_road';
      location: string;
      details: string;
    }>;
  };
  hos_impact: {
    driving_time_required_minutes: number;
    breaks_needed: number;
    suggested_break_locations: Array<{ lat: number; lng: number; name: string }>;
    will_exceed_daily_limit: boolean;
  };
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}
```

---

## 5. Mapbox стратегия

### Интеграция

- **`@pawan-pk/react-native-mapbox-navigation`** — запазваме за turn-by-turn UI
- **`@rnmapbox/maps`** (официален) — добавяме за fleet map, POI, route preview

### Truck Routing (чрез Backend)

```
Mobile → POST /routes/calculate
    │
    ▼ Backend:
    1. Mapbox Directions API (truck profile)
    2. Cross-reference local restriction DB
    3. AI оптимизация с HOS awareness
    4. Return enriched GeoJSON + warnings
    │
    ▼
Mobile: подава на MapboxNavigation component
```

**Защо proxy**: Secret token не достига устройството. Кеширане. Обогатяване с local данни.

### Offline стратегия

| Фаза | Подход |
|------|--------|
| MVP | Mapbox SDK tile cache за активния маршрут |
| Малки флоти | Регионални пакети (BG ~250MB, RO ~300MB) |
| Enterprise | Auto pre-download по планирани рейсове |

---

## 6. Данни и модели

### Core Entities

```
Company ──< Driver ──< HOSLog
    │           │
    │           └──< Route ──< Cargo
    │
    └──< Vehicle ──< VehiclePosition (time-series)
                 └──< FuelTransaction

POI          (независим, PostGIS POINT)
Restriction  (независим, PostGIS POLYGON/POINT)
```

### HOS модел (EU Regulation 561/2006)

```typescript
enum DutyStatus {
  DRIVING = 'driving',
  ON_DUTY = 'on_duty',
  SLEEPER_BERTH = 'sleeper',
  OFF_DUTY = 'off_duty',
  BREAK = 'break',
}

interface HOSState {
  current_status: DutyStatus;
  // Оставащо шофиране (минути)
  continuous_driving_remaining: number;   // max 270 (4.5ч)
  daily_driving_remaining: number;        // max 540 (9ч) или 600 ×2/седм.
  weekly_driving_remaining: number;       // max 3360 (56ч)
  biweekly_driving_remaining: number;     // max 5400 (90ч)
  daily_rest_taken: number;              // нужни 660 мин (11ч)
  weekly_rest_due_by: DateTime;
  active_violations: HOSViolation[];
}
```

> **Важно**: Приложението НЕ замества дигиталния тахограф (задължителен по закон). Нужен е ясен disclaimer в UI.

---

## 7. Сигурност и GDPR

### Автентикация

```
1. Initial Login (веднъж на устройство)
   Email/Password → JWT (access 15мин + refresh 30дни)
   Refresh token → Keychain (iOS) / Keystore (Android)

2. Quick Unlock
   Биометрично / PIN → декриптира refresh token → нов access token

3. PIN сигурност
   5 грешни опита → lockout 30мин + alert към fleet admin
```

### API сигурност

- TLS 1.3 + certificate pinning (production)
- Rate limiting: 100 req/мин per user
- Zod validation на всеки endpoint
- Third-party API keys само на backend (никога на устройството)

### GDPR

| Данни | Правно основание | Срок |
|-------|-----------------|------|
| GPS позиции | Legitimate interest + Consent | 90 дни → 2 г. архив |
| HOS логове | Законово задължение (561/2006) | 2 години (задължителни) |
| Driver profile | Договор | Заетост + 1 г. |
| AI чат | Consent | 30 дни |
| Биометрия | Explicit consent | On-device only, до отказ |

**Данните за EU шофьори трябва да са в EU data center** (GCP `europe-west3` или AWS `eu-central-1`).

---

## 8. Мащабируемост

### Фаза 1 — MVP (1 шофьор, ~$0–25/мес)

```
Mobile ↔ NestJS (Cloud Run, 1 instance)
       ↔ PostgreSQL + PostGIS (Supabase/Neon free)
       ↔ Redis (Upstash free)
```

### Фаза 2 — Малки флоти 10–50 (~$100–300/мес)

```
Mobile Apps ↔ NestJS (Cloud Run, 2–10 auto-scale)
            ↔ PostgreSQL (managed, 2vCPU/8GB)
            ↔ Redis (Upstash Pro)
Dispatcher Dashboard (Next.js / Vercel)
```

### Фаза 3 — Enterprise 500+ (~$2,000–5,000/мес)

- Микросервиси (Routing, AI, Fleet, HOS независими)
- TimescaleDB за time-series позиции
- Redis Cluster (3 nodes)
- NATS/RabbitMQ за async messaging
- Multi-region EU deployment

---

## 9. Финален технологичен стек

### Mobile

| Слой | Технология |
|------|-----------|
| Framework | React Native 0.84 (New Architecture) |
| Език | TypeScript 5.8 strict |
| Screen routing | React Navigation v7 |
| Maps display | `@rnmapbox/maps` v10 |
| Maps navigation | `@pawan-pk/react-native-mapbox-navigation` |
| Client state | Zustand v5 |
| Server state | TanStack Query v5 |
| Secure storage | `react-native-keychain` |
| Fast storage | `react-native-mmkv` |
| Offline DB | WatermelonDB |
| Voice input | `@react-native-voice/voice` |
| Voice output | `react-native-tts` |
| Background GPS | `react-native-background-geolocation` |
| i18n | `i18next` + `react-i18next` |
| Forms | `react-hook-form` + `zod` |
| Tests | Jest + RNTL + Detox |

### Backend

| Слой | Технология |
|------|-----------|
| Framework | NestJS 11 |
| Език | TypeScript 5.8 strict |
| ORM | Prisma 6 + PostGIS |
| Validation | Zod (shared с mobile) |
| Auth | Passport.js (JWT) |
| WebSocket | NestJS Gateway (Socket.IO) |
| Task queue | BullMQ (Redis-backed) |
| Logging | Pino |

### Infrastructure

| Слой | Технология |
|------|-----------|
| Primary DB | PostgreSQL 16 + PostGIS 3.4 |
| Managed DB | Supabase (MVP) → Cloud SQL (Scale) |
| Cache | Redis 7 (Upstash) |
| Backend hosting | Google Cloud Run |
| Admin frontend | Next.js на Vercel |
| CI/CD | GitHub Actions + EAS Build |
| Error tracking | Sentry |
| Analytics | PostHog (GDPR-compliant) |

### AI и трети страни

| Услуга | Доставчик |
|--------|-----------|
| LLM | Anthropic Claude (Sonnet 4 + Haiku 3.5) |
| Maps | Mapbox (Navigation SDK + Directions API) |
| STT | On-device / OpenAI Whisper (BG fallback) |
| Push | Firebase FCM / APNs |
| Времето | Open-Meteo (безплатен) |

---

## 10. Фази на изпълнение

### Фаза 1 — Foundation (Седмици 1–6)

| Седмица | Задачи |
|---------|--------|
| 1–2 | ⚠️ Ротирай Mapbox token. Създай `src/` структура. React Navigation + Zustand + TanStack Query + MMKV. |
| 3 | Auth screens. NestJS scaffold + Prisma + PostgreSQL. JWT flow. |
| 4 | Vehicle profile screen. Route search. Backend routing proxy (Mapbox). |
| 5 | Navigation refactor (truck profile → маршрут). Route preview. Базов HOS таймер. |
| 6 | Базов AI чат (Claude Sonnet). Offline storage. Unit tests за HOS engine. |

### Фаза 2 — Core Features (Седмици 7–14)

| Седмица | Задачи |
|---------|--------|
| 7–8 | Full EU HOS compliance engine. HOS Dashboard + Log + Edit screens. |
| 9–10 | Fleet tracking: background GPS, batch upload, WebSocket, Redis Pub/Sub. |
| 11–12 | Voice pipeline (STT + Haiku + Sonnet + TTS). Driving mode (само глас). |
| 13–14 | Cargo management. POI интеграция. Fuel tracking + оптимизация. Push notifications. |

### Фаза 3 — Polish & Launch (Седмици 15–20)

| Седмица | Задачи |
|---------|--------|
| 15–16 | Offline maps (региони). i18n (bg, en, de, ro). |
| 17–18 | Dispatcher web dashboard (Next.js). GDPR consent flows. Data export/deletion. |
| 19 | E2E тестове (Detox). Performance. Security audit. |
| 20 | App Store / Play Store. Production deploy. Monitoring. |

---

## Приложение А: Architecture Decision Records

### ADR-001: Zustand вместо Redux Toolkit
1KB bundle, zero boilerplate, selector rendering спира излишни re-renders на map screens.

### ADR-002: REST вместо GraphQL
HTTP кеширане за offline. Прост file upload. По-бързо onboarding.

### ADR-003: Modular Monolith (не microservices от старт)
Чисти domain граници → лесна екстракция по-късно. Без distributed complexity при MVP.

### ADR-004: Claude Sonnet 4 + Haiku 3.5
Sonnet за reasoning/chat. Haiku за voice intent parsing (<500мс).

### ADR-005: PostgreSQL + PostGIS
Geospatial операции са core. PostGIS е индустриален стандарт.

### ADR-006: Google Cloud Run
Scale-to-zero при MVP. Без cluster management. WebSocket поддръжка.

---

## Приложение Б: Risk Register

| Риск | Вероятност | Въздействие | Митигация |
|------|-----------|-------------|-----------|
| Community Mapbox wrapper счупва при RN update | Висока | Висока | Pin versions. Backup: custom nav UI с `@rnmapbox/maps`. |
| Claude API латентност при driving | Средна | Средна | Haiku за time-critical. Pre-compute преди тръгване. |
| HOS compliance грешки | Висока | Критична | Extensive unit tests. Domain expert. Disclaimer в UI. |
| Battery drain от GPS | Средна | Висока | Motion detection. Намалена точност при престой. |
| GDPR нарушение | Ниска | Критична | Privacy-by-design. Data minimization. Ежегоден audit. |

---

*Документът е генериран на 2026-02-23 с Claude Sonnet 4 Architect agent.*
