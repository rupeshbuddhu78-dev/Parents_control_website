# MIGRATION_GUIDE.md

## Migration from v2.x to v3.0

---

## Overview

Version 3.0 adds authentication, admin, subscription, and payment systems while preserving full backward compatibility with existing devices and data.

---

## Step 1: Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `MONGODB_URI` - Your MongoDB connection string
- `JWT_SECRET` - Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `JWT_REFRESH_SECRET` - Generate separately
- `ADMIN_EMAIL` - Admin account email
- `ADMIN_PASSWORD` - Admin account password (min 8 chars)

Optional but recommended:
- `SMTP_*` - For email verification and password reset
- `CASHFREE_*` - For payment processing
- `CORS_ORIGINS` - Restrict API access

---

## Step 2: Install Dependencies

```bash
npm install
```

New dependencies added:
- bcryptjs
- jsonwebtoken
- express-rate-limit
- helmet
- nodemailer
- uuid

---

## Step 3: Seed Admin Account

```bash
npm run seed:admin
```

This creates a single ADMIN account. Only one admin can exist. If an admin already exists, the script exits without creating a duplicate.

---

## Step 4: Seed Default Plans

```bash
npm run seed:plans
```

Creates four plans: Free, Weekly, Monthly, Yearly.

---

## Step 5: Start Server

```bash
npm start
```

---

## Existing Data Migration

### No data migration required

- All existing MongoDB collections remain unchanged
- All existing devices continue to work
- No device re-pairing needed
- Existing parent dashboard (index.html) works as before

### New Collections Created

When the server starts and seeds run:
- `users` - User accounts (admin, parents)
- `refresh_tokens` - JWT refresh tokens
- `audit_logs` - Security audit trail
- `plans` - Subscription plans
- `subscriptions` - User subscriptions
- `payments` - Payment records
- `device_credentials` - Device authentication (for future use)

---

## Android App Migration

### No immediate changes required

The existing Android app continues to work without modification.

### Recommended Updates (Future)

1. **Server URL**: Change `BASE_URL` in `MyBackgroundService.java` to your production URL
2. **HTTPS**: The app now requires HTTPS in production (network_security_config enforces this)
3. **Secure Storage**: Migrate device ID storage to EncryptedSharedPreferences
4. **Secret Code**: Move hardcoded "5654" to secure storage
5. **Build Config**: Move server URL to BuildConfig for build-time configuration

---

## Frontend Migration

### Login Required

The new system requires login. Existing users of the dashboard must:
1. Go to `/login.html`
2. Register a new account
3. Add their device IDs from the new dashboard

### Admin Access

Admin login is at `/login.html` using the ADMIN_EMAIL and ADMIN_PASSWORD from `.env`.

---

## Backward Compatibility

| Feature | Compatible | Notes |
|---------|-----------|-------|
| Existing devices | YES | No changes needed |
| Existing API endpoints | YES | All preserved |
| Socket.IO events | YES | All preserved |
| MongoDB data | YES | No schema changes to existing collections |
| Old dashboard (index.html) | YES | Still works with device ID |
| New dashboard (dashboard.html) | NEW | Requires login |
| Admin dashboard | NEW | Requires admin login |
