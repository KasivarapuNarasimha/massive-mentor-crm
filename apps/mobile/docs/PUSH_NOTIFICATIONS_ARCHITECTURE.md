# Push Notifications Architecture (Phase 3 — implemented locally)

## Status
- **DevicePushToken** model migrated (additive only)
- Register / refresh / revoke APIs live at `/api/devices/push-token`
- PushDispatcher hooked from `notifyUser()` (fire-and-forget)
- Capacitor `@capacitor/push-notifications` installed (Android)
- FCM credentials **optional** — without them, registration works; send is a safe no-op
- **No production deploy / commit yet**

## Schema (recommended)

See `apps/api/prisma/schema.prisma` → `DevicePushToken`.

Critical uniqueness:
- `@@unique([appId, installId])` — stable install upsert
- `@@unique([appId, provider, token])` — token reclaim

`businessId` is a **hint only**. Authorization never reads it.

## Lifecycle

1. **Login (native, after dashboard ready):** Preferences `installId` → permission request → FCM token → `POST /api/devices/push-token`
2. **Token rotation:** same `installId` → upsert new `token` + `lastSeenAt`
3. **Logout:** `DELETE /api/devices/push-token` with current `installId` only
4. **Provider invalid:** `enabled=false`, `revokedReason=provider_invalid`, `lastError` set
5. **User disabled:** batch-disable tokens (`user_disabled`)
6. **Membership removed:** do **not** delete device token; Team Activity push fails ACL for that business; personal inbox still works

## Authorization

| Type | Recipient | Push ACL |
|------|-----------|----------|
| `team_activity` | Fan-out already BA/CEO via `canViewTeamActivity` | Re-check membership for **event `businessId`** + `canViewTeamActivity(role)`. No `platformRole` shortcut. |
| `lead_assigned` / personal | Existing `notifyUser(userId)` | Enabled tokens for that user only |

## Realtime relationship

| App state | Primary | Complement |
|-----------|---------|------------|
| Foreground | SSE + 8s notification poll | Push ignored for toast storms |
| Background / killed | OS push | SSE may disconnect |

Do **not** add another polling loop.

## Credentials (never commit)

API:
- `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_PROJECT_ID` (optional override)

Android:
- `apps/mobile/android/app/google-services.json` (from Firebase Console; see `google-services.json.example`)

## iOS remaining
- APNs key / FCM iOS app in Firebase
- Xcode capabilities: Push Notifications + Background Modes
- Same `/api/devices/push-token` with `platform: "ios"`
