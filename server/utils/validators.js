'use strict';

const SUPPORTED_CHAT_APPS = ['whatsapp', 'instagram', 'snapchat'];

function resolveChatAppKey(pkg) {
    if (!pkg) return null;
    const p = String(pkg).toLowerCase().trim();
    if (p === 'com.whatsapp' || p === 'com.whatsapp.w4b' || p === 'whatsapp') return 'whatsapp';
    if (p === 'com.instagram.android' || p === 'instagram') return 'instagram';
    if (p === 'com.snapchat.android' || p === 'snapchat') return 'snapchat';
    return null;
}

function isStrictChatRecordForApp(row, appKey) {
    if (!row || !appKey) return false;
    const app = String(row.app || '').toLowerCase().trim();
    const pkg = String(row.packageName || row.package || '').toLowerCase().trim();
    const expected = String(appKey).toLowerCase().trim();
    if (app && app !== expected) return false;
    return resolveChatAppKey(pkg) === expected;
}

function isBadChatConversation(c) {
    if (!c) return true;
    const l = String(c).trim().toLowerCase();
    return !l || l === 'you' || l === 'whatsapp' || l === 'instagram' || l === 'snapchat'
        || l === 'unknown' || l === 'unknown_chat' || l === 'archived';
}

function isBadChatText(txt) {
    if (!txt) return true;
    const l = String(txt).trim().toLowerCase();
    return !l || l === 'photo' || l === 'video' || l === 'gif' || l === 'audio'
        || l === 'archived' || l === 'sticker' || l.startsWith('online updates');
}

function notificationApp(row) {
    const pkg = String((row && (row.packageName || row.package || row.pkg)) || '').toLowerCase();
    if (pkg === 'com.instagram.android' || pkg === 'instagram') return 'instagram';
    if (pkg === 'com.whatsapp' || pkg === 'com.whatsapp.w4b' || pkg === 'whatsapp') return 'whatsapp';
    if (pkg === 'com.snapchat.android' || pkg === 'snapchat') return 'snapchat';
    return '';
}

module.exports = {
    resolveChatAppKey,
    isStrictChatRecordForApp,
    isBadChatConversation,
    isBadChatText,
    notificationApp,
    SUPPORTED_CHAT_APPS
};
