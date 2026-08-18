# Live Activity → MongoDB Persistent History (Final-only)

## What changed
- Live typing (H → He → Hello) = **live UI only**, NOT saved to DB
- After ~5s no change / send / composer clear → **one FINAL row** in Mongo `activity_events`
- History page loads from server DB (not localStorage)
- Socket events: `live_status_update` + `activity_update`

## Files modified
1. `server.js` — parse live text, finalize timer, save final only, API, emits
2. `mongo.js` — `activity_events` collection + helpers
3. `liveactivity.html` — history from `/api/activity-events`, ignore liveOnly
4. `index.html` — optional socket for instant live card text

## API
- `GET /api/activity-events?deviceId=XXX&limit=200`
- `POST /api/clear-data` { device_id, type: "live_status" } also clears Mongo

## Deploy
1. Upload these 4 files over your existing Render/server deploy
2. Ensure `MONGODB_URI` is set (already was)
3. Restart server
4. No Android APK rebuild required

## DEVICE TEST REQUIRED
Type in WhatsApp → wait 5s or send → open Live Activity history → refresh page → entry should remain.
