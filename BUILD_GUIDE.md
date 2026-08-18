# 📱 Debug APK Build Guide

## Prerequisites

Aapke paas ye hona chahiye:
- **Android Studio** (latest version recommended)
- **JDK 17** (Android Studio ke saath aata hai)
- **Android SDK** (Android Studio automatically install karta hai)

---

## Step-by-Step Build Instructions

### Option 1: Android Studio se Build (Recommended)

1. **Extract the ZIP file**
   ```bash
   # Downloaded file ko extract karo
   # Location: C:\Users\rupes\Downloads\parentcontrol_updated.zip
   ```

2. **Open Project in Android Studio**
   - Android Studio open karo
   - `File` → `Open` → Select `childApp` folder
   - Wait for Gradle sync to complete (pehli baar mein 5-10 minutes lag sakte hain)

3. **Sync Gradle**
   - Top right corner mein "Sync Now" click karo
   - Ya `File` → `Sync Project with Gradle Files`
   - Saari dependencies download hongi (ML Kit, Socket.IO, WebRTC, etc.)

4. **Build Debug APK**
   - Menu: `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`
   - Ya shortcut: `Ctrl + F9` (Windows) / `Cmd + F9` (Mac)
   - Bottom left corner mein "Build" tab check karo

5. **Locate APK**
   ```
   childApp/app/build/outputs/apk/debug/app-debug.apk
   ```

6. **Transfer to Phone**
   - USB cable se phone connect karo
   - File explorer se APK copy karo phone mein
   - Phone mein APK install karo (Unknown sources enable karna hoga)

---

### Option 2: Command Line se Build

Agar Android Studio nahi hai, command line se build karo:

#### Windows (Command Prompt/PowerShell):
```cmd
cd C:\Users\rupes\Downloads\parentcontrol_updated\childApp

# Gradle wrapper use karo
gradlew.bat assembleDebug

# APK yahan milega:
# app\build\outputs\apk\debug\app-debug.apk
```

#### Linux/Mac (Terminal):
```bash
cd /path/to/childApp

# Make gradlew executable
chmod +x gradlew

# Build debug APK
./gradlew assembleDebug

# APK location:
# app/build/outputs/apk/debug/app-debug.apk
```

---

## Common Issues & Solutions

### Issue 1: Gradle Sync Fails
**Error:** `Could not resolve all dependencies`

**Solution:**
- Internet connection check karo
- `File` → `Invalidate Caches / Restart` → `Invalidate and Restart`
- Ya manually delete `.gradle` folder aur sync again

### Issue 2: SDK Not Found
**Error:** `SDK location not found`

**Solution:**
- `File` → `Project Structure` → `SDK Location`
- Android SDK path set karo (usually: `C:\Users\<username>\AppData\Local\Android\Sdk`)

### Issue 3: Build Tools Version Mismatch
**Error:** `The specified Android SDK Build-Tools version is not installed`

**Solution:**
- `Tools` → `SDK Manager` → `SDK Tools` tab
- Required build tools version install karo (project requires: 34.0.0)

### Issue 4: Java Version Issue
**Error:** `Unsupported class file major version`

**Solution:**
- `File` → `Project Structure` → `SDK Location` → `JDK location`
- JDK 17 select karo (Android Studio bundled JDK use karo)

### Issue 5: ML Kit Dependency Error
**Error:** `Could not find com.google.mlkit:text-recognition`

**Solution:**
```gradle
// build.gradle (Project level) mein check karo:
repositories {
    google()
    mavenCentral()
}
```

---

## Testing the APK

### Install on Phone
1. Phone mein `Settings` → `Security` → `Unknown Sources` enable karo
2. APK file phone mein transfer karo (USB/Email/Cloud)
3. File manager se APK tap karo → `Install`

### First Time Setup
1. App open karo
2. Device ID note karo (6-digit number)
3. Permissions grant karo:
   - Accessibility Service
   - Notification Listener
   - Device Admin
   - All runtime permissions (Camera, Mic, Storage, etc.)

### Connect to Server
1. Parent dashboard open karo (https://child-v9no.onrender.com)
2. Device ID enter karo
3. Connection status check karo (should show "Online")

---

## Debug Logging

Agar issues aate hain, logs check karo:

### Android Studio se:
1. Phone ko USB se connect karo
2. `View` → `Tool Windows` → `Logcat`
3. Filter: `SPY_NOTIFY` ya `Service` ya `Socket`

### ADB Command Line:
```bash
# Real-time logs
adb logcat | grep -E "SPY_NOTIFY|Service|Socket|Audio|Camera"

# Save logs to file
adb logcat > debug_logs.txt
```

---

## Quick Build Checklist

Before building, ensure:

- [ ] Android Studio installed (latest version)
- [ ] JDK 17 configured
- [ ] Android SDK installed (API 34)
- [ ] Internet connection stable
- [ ] Project extracted successfully
- [ ] `local.properties` file exists with SDK path
- [ ] Gradle sync successful (no red errors)
- [ ] All dependencies downloaded

---

## Troubleshooting Build Errors

### Error: `cannot find symbol`
```
MyAccessibilityService.java:417: error: cannot find symbol
```

**Fix:**
- File ko carefully check karo
- Missing methods add karo (`setBlockedWebsites`, `setWhitelistedWebsites`)
- Ya updated files use karo jo maine provide kiye hain

### Error: `Duplicate class`
```
Duplicate class com.google.xxx found in modules
```

**Fix:**
```gradle
// app/build.gradle mein:
configurations.all {
    exclude group: 'com.google.android.gms'
}
```

### Error: `Manifest merger failed`
**Fix:**
- AndroidManifest.xml check karo
- Conflicting permissions remove karo
- Ya `tools:replace="android:label"` add karo

---

## Build Successful Message

Agar sab sahi gaya, ye message dikhega:
```
BUILD SUCCESSFUL in Xs
X actionable tasks: X executed
```

APK location:
```
childApp\app\build\outputs\apk\debug\app-debug.apk
```

---

## File Size

Expected APK size: **15-25 MB**
- CameraX libraries
- WebRTC library
- Socket.IO client
- ML Kit text recognition
- All other dependencies

---

## Need Help?

Agar build mein problems aate hain:

1. **Build error logs share karo** (complete error message)
2. **Android Studio version bataye**
3. **SDK version check karo** (Tools → SDK Manager)
4. **Gradle version check karo** (File → Project Structure → Project)

Main aapki help karunga!

---

## Summary

**Build Command (Quick Reference):**

Windows:
```cmd
cd childApp
gradlew.bat assembleDebug
```

Mac/Linux:
```bash
cd childApp
./gradlew assembleDebug
```

**APK Location:**
```
childApp/app/build/outputs/apk/debug/app-debug.apk
```

**Build Time:** 2-5 minutes (first build), 30-60 seconds (subsequent builds)

Good luck! 🚀
