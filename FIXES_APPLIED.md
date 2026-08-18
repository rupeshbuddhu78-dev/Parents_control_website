# ParentControl V3 — Fixes Applied

## Dashboard and speed

The **Websites** control has been moved to the right-side dashboard page beside **Snapshot**. The WhatsApp, Instagram, Snapchat, app-list, and recording pages now avoid overlapping polling requests and use the correct Socket.IO device room join. The WhatsApp viewer now loads the complete chat history through one batched API request instead of requesting every contact one by one.

## Chat storage

HTTP fallback chat uploads are now written into the same per-app files used by the chat APIs. This fixes the case where chat reading worked only over a live socket but not after reconnecting or refreshing the page.

## App list and installation

The Android child app now uploads one complete installed-app snapshot instead of several concurrent 50-item batches. The server stores that snapshot without replacing it with a partial batch. Installed packages without a launcher activity are included, so sideloaded APKs are not omitted from App List. The accessibility service no longer hijacks Android's package installer, so a legitimate APK shared through WhatsApp can be installed normally.

## Recording labels

Live microphone sessions are now saved with a `Live_Audio` name and shown as **Live Audio Recording**, rather than inheriting a previous call/contact name. The browser preview now decodes the child app's mono 16-bit PCM stream at 16 kHz with Web Audio instead of assigning raw PCM bytes to an invalid MediaStream.

## Security flow

The dashboard's security buttons now send the command names the Android client actually handles. Lock opens a visible **LOCKED — Locked by parents** screen with a parent PIN unlock flow, disables Back bypass, stops active audio/screen capture, and attempts Android lock-task mode where the device is configured to allow it. Unlock clears the lock state. Wipe remains behind two explicit confirmations and still requires active Android Device Admin on the child device.

## Privacy and consent boundaries

Automatic approval of Android screen-recording consent, typed-text keylogging, and hidden Snapchat/Instagram screenshots were removed. Website blocking remains silent on the child device without a per-page toast, while the parent dashboard remains the source of the block record. Chat data is limited to supported notification-based data paths.

## Verification

The backend passed `node --check server.js`. All modified inline browser scripts passed Node syntax checks. Local API smoke tests confirmed app inventory persistence, WhatsApp/Instagram/Snapchat chat persistence, and lock command routing. The Android Gradle build could not be completed in this sandbox because the original `local.properties` points to a Windows SDK path and no Android SDK is installed here; build it on the Android development machine after updating `local.properties`.

## Second-round fixes

Screen sharing now handles the explicit `START_SCREEN` command in `MainActivity`, keeps Socket.IO signaling alive before creating the WebRTC offer, queues offers and ICE candidates until the socket is connected, and rejoins the screen room after reconnects. Clearing Recents no longer reopens the MediaProjection popup automatically, and repeated ICE failures cannot launch duplicate permission activities.

Normal and special permissions now advance one at a time. If a permission dialog is dismissed or denied, the next permission is requested instead of reopening the same dialog in a loop. A later explicit Screen Share button press can request MediaProjection again.

The dashboard now avoids overlapping status requests, no longer polls the removed keylog stream, loads external CSS asynchronously, and uses slower bounded polling. App List now has Socket.IO-triggered refresh plus a ten-second fallback refresh, while retaining the complete inventory snapshot.

Location now requests both GPS and network providers, selects the best available fix, includes accuracy/speed/altitude metadata, waits for a fresh fix after a location command, and the web view selects the newest record rather than the oldest record. WhatsApp and Instagram accessibility readers now send visible chat text through the unified `chat_logs` format used by the chat pages; typed-text capture and key-event filtering remain disabled.
