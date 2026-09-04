# Deep Links & App Links — Massive Mentor CRM

## Android (prepared in Phase 2B)

### Custom scheme (works now)
- Scheme: `massivementor://`
- Example: `massivementor://dashboard/leads`
- Intent-filter is in `android/app/src/main/AndroidManifest.xml`

### HTTPS App Links (requires production deploy later)
Intent-filter (already in Manifest, `autoVerify="false"` until assetlinks is live):

```
https://crm.massivementor.in/dashboard/*
```

### Production deploy required later (NOT done in Phase 2B)

1. Host Digital Asset Links at:
   `https://crm.massivementor.in/.well-known/assetlinks.json`

2. Example contents (replace SHA-256 with Play App Signing cert fingerprint):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "in.massivementor.crm",
      "sha256_cert_fingerprints": ["YOUR_PLAY_APP_SIGNING_SHA256"]
    }
  }
]
```

3. Serve with `Content-Type: application/json` and HTTPS.
4. Set Manifest intent-filter `android:autoVerify="true"`.
5. Verify with:
   `adb shell pm get-app-links in.massivementor.crm`

### Routing strategy
- Capacitor WebView loads `https://crm.massivementor.in` — deep links should resolve to the same path the SPA already understands (`/dashboard/...`, hash `#member-activity-heading`).
- Push payloads (future) should use absolute CRM paths, e.g. `/dashboard/leads?id=...`.

## iOS Universal Links (prepare on macOS)

1. Associated Domains entitlement: `applinks:crm.massivementor.in`
2. Host `https://crm.massivementor.in/.well-known/apple-app-site-association` (no `.json` extension; `application/json`).
3. Example:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.in.massivementor.crm",
        "paths": ["/dashboard/*", "/login"]
      }
    ]
  }
}
```

4. Bundle ID (planned): `in.massivementor.crm` (matches Android applicationId).

## What Phase 2B does NOT do
- Does not upload `assetlinks.json` / AASA to production.
- Does not change DNS or nginx.
- Does not enable `autoVerify=true` until the file is live.
