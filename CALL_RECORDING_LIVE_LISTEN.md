# Call Recording + Live Listen Fix

## Android changes
- `AudioRecorderHelper.java` — MODE_IN_COMMUNICATION + source chain:
  VOICE_COMMUNICATION → VOICE_RECOGNITION → MIC → CAMCORDER
- `LiveAudioManager.java` — callMode uses VOICE_COMMUNICATION + communication audio mode
- `MyBackgroundService.java` — start_call_listen / stop_call_listen commands
- `CallReceiver.java` — communication mode; speaker only if AppPrefs call_force_speaker=true

## Website
- `liveactivity.html` — during active call shows **Listen / Stop** buttons
- Uses existing Socket.IO `audio-stream` PCM path (same as recording.html)

## Parent flow
1. Child phone call starts → auto file recording starts
2. Live Activity shows "📞 Call chal rahi hai → Name"
3. Parent taps **Listen** → device streams near-live PCM
4. Parent taps **Stop** → stream stops; file recording continues until call ends
5. Call ends → recording uploads to server (view on recording.html)

## Vivo / OEM notes
- Enable Autostart + Unrestricted battery
- RECORD_AUDIO + READ_PHONE_STATE granted
- Some Vivo builds still mute downlink without speaker — set call_force_speaker only if needed
- True both-side capture is best-effort without root (Android restriction)

## Rebuild
Android Studio → rebuild APK and reinstall. Server deploy updated liveactivity.html + previous Mongo files.
