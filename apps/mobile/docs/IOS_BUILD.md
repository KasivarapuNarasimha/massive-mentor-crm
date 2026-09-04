# iOS project status (Phase 2B)

## What was generated on this Windows machine

- Capacitor iOS platform at `apps/mobile/ios`
- Bundle identifier: **`in.massivementor.crm`** (matches Android `applicationId`)
- Display name: **Massive Mentor CRM**
- Camera / Photo Library usage strings in `Info.plist`
- Plugins synced into the Xcode project metadata

## What this machine CANNOT do

- **No Xcode / macOS** → cannot run `xcodebuild`, `pod install` fully, Simulator, Archive, or IPA export.
- CocoaPods was skipped with: `Skipping pod install because CocoaPods is not installed`

## What requires a Mac later

```bash
cd apps/mobile
npm install
npx cap sync ios
cd ios/App
pod install
open App.xcodeproj   # or App.xcworkspace after pods
```

Then in Xcode:
1. Select Team / signing certificate
2. Confirm Bundle ID `in.massivementor.crm`
3. Add Associated Domains for Universal Links (`applinks:crm.massivementor.in`) when AASA is live
4. Run on Simulator / device → Archive → TestFlight

## Honest status

| Item | Status |
|------|--------|
| iOS project files present | Yes |
| CocoaPods installed | No (Windows) |
| Xcode build | **Not possible here** |
| IPA produced | **No** |
