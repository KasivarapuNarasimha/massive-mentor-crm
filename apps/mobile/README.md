# Massive Mentor CRM — Mobile (Capacitor)

Phase 2A: **Android** shell that loads the hosted CRM at `https://crm.massivementor.in`.

## Application ID

`in.massivementor.crm`

## Prerequisites

- Node.js 20+
- **JDK 17** (Capacitor 6; Capacitor 7 needs JDK 21)
- Android SDK (`ANDROID_HOME` or `android/local.properties`)

## Commands

```bash
cd apps/mobile
npm install
npx cap sync android
npx cap open android
```

Debug APK (Windows example):

```bat
cd apps\mobile
npx cap sync android
cd android
set JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.16.8-hotspot
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
gradlew.bat assembleDebug
```

APK output:

`android/app/build/outputs/apk/debug/app-debug.apk`

## Architecture

- Single frontend: existing Next.js CRM (`apps/web`)
- Single backend: existing Express API
- This package is a **native WebView shell only**

## Phase 2B notes

- Brand icons/splash: `resources/` + Android mipmaps (MM mark on `#2563EB`)
- iOS project: `ios/` — **build requires macOS/Xcode** (`docs/IOS_BUILD.md`)
- Auth on native: Capacitor Preferences dual-write (`apps/web/lib/native-secure-storage.ts`); browsers stay on localStorage
- Camera: `@capacitor/camera` + Media Library “Camera / Photos” (native only)
- Deep links: `docs/DEEP_LINKS.md` + `docs/assetlinks.json.example`
- Push: architecture only — `docs/PUSH_NOTIFICATIONS_ARCHITECTURE.md` (**no DB migration**)
- Security: `docs/SECURITY.md`
- Native Android back button via `MainActivity`
