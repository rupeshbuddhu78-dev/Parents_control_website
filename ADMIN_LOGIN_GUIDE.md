# ADMIN LOGIN GUIDE

## Admin Account Setup

### Step 1: Configure Admin Credentials in .env

Open your `.env` file and add these lines:

```env
# Admin Account (Single Admin Only)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourSecurePassword123!
ADMIN_NAME=Administrator
```

**Important:**
- Use a strong password (min 8 characters, mix of letters, numbers, symbols)
- This email will be the admin login email
- Only ONE admin account can exist in the system

### Step 2: Seed the Admin Account

Run this command in your terminal:

```bash
npm run seed:admin
```

**Expected Output:**
```
Admin account created successfully: admin@yourdomain.com
```

If admin already exists:
```
Admin account already exists: admin@yourdomain.com
```

### Step 3: Login as Admin

1. Go to: `https://parents-control-website1.onrender.com/login.html`

2. Enter admin credentials:
   - **Email:** admin@yourdomain.com (from .env)
   - **Password:** YourSecurePassword123! (from .env)

3. Click **Login**

4. You will be automatically redirected to **Admin Dashboard**

---

## Admin Dashboard Features

Once logged in, you can access:

### 1. Dashboard Overview
- Total parents registered
- Active parents count
- Suspended parents count
- Total devices in system
- Active subscriptions count

### 2. Parent Management
- **View all parents** with search functionality
- **Suspend parent** - temporarily block access
- **Unsuspend parent** - restore access
- **Force logout** - immediately log out parent from all devices
- **Disable/Enable** - permanently disable or re-enable account
- **View parent details** - devices, subscription, last login

### 3. Device Management
- View all devices in the system
- See which parent owns each device
- Device status and last seen time
- Search by device ID or model

### 4. Subscription Management
- View all subscriptions
- See plan details (Free, Weekly, Monthly, Yearly)
- Subscription status (active, expired, cancelled)
- Expiry dates

### 5. Payment History
- All payment records
- Order IDs
- Payment status (success, failed, pending)
- Amount and currency
- Payment dates

### 6. Audit Logs
- All security events
- Login attempts (parent & admin)
- Suspensions/unsuspensions
- Password changes
- Device pairing/unpairing
- Subscription activations

---

## Admin Routes (API)

All admin routes are protected and require:
- Valid JWT token
- ADMIN role
- Active account status

### Available Endpoints:

```
GET  /api/admin/dashboard          - Get dashboard stats
GET  /api/admin/parents            - List all parents
GET  /api/admin/parents/:id        - Get parent details
POST /api/admin/parents/:id/suspend      - Suspend parent
POST /api/admin/parents/:id/unsuspend    - Unsuspend parent
POST /api/admin/parents/:id/force-logout - Force logout parent
POST /api/admin/parents/:id/disable      - Disable parent account
POST /api/admin/parents/:id/enable       - Enable parent account
GET  /api/admin/devices-managed    - List all devices
GET  /api/admin/audit-logs         - Get audit logs
GET  /api/admin/subscriptions      - Get all subscriptions
GET  /api/admin/payments           - Get all payments
```

---

## Security Notes

### Admin Account Protection

1. **Single Admin Only** - System prevents creating multiple admin accounts
2. **Cannot Register as Admin** - Public registration only creates PARENT accounts
3. **Server-Side Protection** - All admin routes verify ADMIN role
4. **Audit Logging** - All admin actions are logged
5. **JWT Authentication** - Short-lived access tokens (15 minutes)
6. **Refresh Token Rotation** - Old tokens invalidated on refresh

### Best Practices

1. **Use Strong Password** - Min 12 characters, mixed case, numbers, symbols
2. **Keep ADMIN_EMAIL Secret** - Don't share admin credentials
3. **Regular Backup** - Backup MongoDB database regularly
4. **Monitor Audit Logs** - Check for suspicious activity
5. **Enable 2FA** - Consider adding 2FA for admin (future enhancement)
6. **HTTPS Only** - Never use HTTP in production
7. **Rate Limiting** - Already enabled on auth endpoints

---

## Forgot Admin Password?

If you forget the admin password:

### Option 1: Reset via Email (if SMTP configured)

1. Go to `/login.html`
2. Click "Forgot password?"
3. Enter admin email
4. Check email for reset link
5. Click link and set new password

### Option 2: Manual Database Reset

If SMTP not configured, reset directly in MongoDB:

```javascript
// Connect to MongoDB
use childtracking

// Generate new password hash
const bcrypt = require('bcryptjs');
const salt = bcrypt.genSaltSync(12);
const hash = bcrypt.hashSync('NewPassword123!', salt);

// Update admin password
db.users.updateOne(
  { email: 'admin@yourdomain.com' },
  { $set: { password: hash } }
)
```

### Option 3: Delete and Re-seed

```bash
# Delete admin from database
mongo childtracking --eval "db.users.deleteOne({role: 'ADMIN'})"

# Re-seed admin
npm run seed:admin
```

---

## Troubleshooting

### "Admin account already exists"

This is normal. The seed script prevents duplicate admins. Just login with existing credentials.

### "Invalid email or password"

- Check .env file for correct ADMIN_EMAIL and ADMIN_PASSWORD
- Ensure you ran `npm run seed:admin`
- Check MongoDB connection is working

### "Account suspended"

- Another admin suspended this account (if multiple admins existed before)
- Reset directly in database:
  ```javascript
  db.users.updateOne({email: 'admin@...'}, {$set: {status: 'active'}})
  ```

### Redirected to login page

- JWT token expired - login again
- Token invalidated - login again
- Check browser console for errors

---

## Admin vs Parent

| Feature | Admin | Parent |
|---------|-------|--------|
| Login | ✅ | ✅ |
| Register | ❌ (seed only) | ✅ |
| View own devices | ❌ | ✅ |
| View all parents | ✅ | ❌ |
| View all devices | ✅ | ❌ |
| Suspend parents | ✅ | ❌ |
| View audit logs | ✅ | ❌ |
| Manage plans | ✅ | ❌ |
| View payments | ✅ | ❌ |
| Add devices | ❌ | ✅ |
| Subscribe to plans | ❌ | ✅ |

---

## Quick Start Checklist

- [ ] Set ADMIN_EMAIL in .env
- [ ] Set ADMIN_PASSWORD in .env (strong password)
- [ ] Run `npm run seed:admin`
- [ ] Verify "Admin account created" message
- [ ] Go to `/login.html`
- [ ] Login with admin email and password
- [ ] Verify redirect to admin dashboard
- [ ] Check dashboard stats load correctly
- [ ] Test parent management features
- [ ] Check audit logs

---

## Support

If you encounter issues:

1. Check server logs: `npm start` output
2. Check MongoDB connection
3. Verify .env variables are set
4. Check audit logs for errors
5. Review browser console for frontend errors

---

**Remember:** Admin account is the most privileged account. Keep credentials secure!
