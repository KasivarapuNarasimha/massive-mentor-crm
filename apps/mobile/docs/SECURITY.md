# Mobile security notes (Phase 2B)

## Trust boundary
The Capacitor app is a WebView of `https://crm.massivementor.in` talking to `https://api.massivementor.in` over HTTPS.

## JWT handling
- Browser CRM: `localStorage` (unchanged).
- Native: dual-write to Capacitor **Preferences** + localStorage sync for AuthProvider.
- Tokens are **not** passed into custom Java/Kotlin code.
- Logout clears both Preferences and localStorage keys.
- Preferences is device-partitioned; Keystore-grade encryption is a Phase 3 upgrade option.

## WebView navigation
- `server.url` locked to production CRM.
- `allowNavigation` limited to `*.massivementor.in`.
- Cleartext HTTP disabled.
- `_blank` / external hosts open via Capacitor Browser when bridge is active.

## Deep links
- Custom scheme `massivementor://` ready.
- HTTPS App Links require production `assetlinks.json` (not deployed in 2B).
- Do not accept arbitrary javascript: URLs.

## Permissions
- INTERNET, NETWORK_STATE: required.
- CAMERA / READ_MEDIA_IMAGES: optional for Media Library capture (`required=false` camera feature).
- No contacts, SMS, microphone, or fine location in Phase 2B shell (Field Sales still uses browser Geolocation API inside WebView when user grants it).

## Team Activity / ACL
- Unchanged server enforcement: BA/CEO only for team_activity.
- Push design (Phase 3) must re-check `canViewTeamActivity` before sending.

## Recommendations for Phase 3
- Encrypted Preferences / Keystore plugin
- Certificate pinning (optional)
- Play Integrity / DeviceCheck (optional)
