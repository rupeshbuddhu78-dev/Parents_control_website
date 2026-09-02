'use strict';

/**
 * Basic static/structural tests for the server codebase.
 * Run: node server/tests/basic.test.js
 *
 * These tests check syntax, module loading, and structural correctness
 * WITHOUT requiring MongoDB, external services, or real credentials.
 */

const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}: ${e.message}`);
    }
}

function skip(name, reason) {
    skipped++;
    console.log(`  ○ ${name} (SKIPPED: ${reason})`);
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

console.log('\n=== BASIC STRUCTURAL TESTS ===\n');

// Test 1: Config modules load
console.log('Config Modules:');
test('env.js loads without error', () => {
    const env = require('../config/env');
    assert(env.PORT !== undefined, 'PORT should be defined');
    assert(typeof env.JWT_SECRET === 'string', 'JWT_SECRET should be string');
});

test('constants.js loads without error', () => {
    const constants = require('../config/constants');
    assert(Array.isArray(constants.CONTROL_COMMANDS), 'CONTROL_COMMANDS should be array');
    assert(constants.MAX_BODY_SIZE === '120mb', 'MAX_BODY_SIZE should be 120mb');
});

test('db.js loads without error', () => {
    const db = require('../config/db');
    assert(typeof db.connect === 'function', 'connect should be function');
    assert(typeof db.isReady === 'function', 'isReady should be function');
});

// Test 2: Models load
console.log('\nModel Modules:');
const modelNames = ['DeviceMeta', 'History', 'ActivityEvent', 'ChatMessage', 'BootStatus', 'User', 'RefreshToken', 'AuditLog', 'Plan', 'Subscription', 'Payment', 'DeviceCredential'];
for (const name of modelNames) {
    test(`${name} model loads`, () => {
        const model = require(`../models/${name}`);
        assert(model !== null && model !== undefined, `${name} should not be null`);
    });
}

// Test 3: Middleware loads
console.log('\nMiddleware Modules:');
test('auth middleware loads', () => {
    const auth = require('../middleware/auth');
    assert(typeof auth.authenticateUser === 'function', 'authenticateUser should be function');
    assert(typeof auth.requireAdmin === 'function', 'requireAdmin should be function');
    assert(typeof auth.requireParent === 'function', 'requireParent should be function');
    assert(typeof auth.checkAccountStatus === 'function', 'checkAccountStatus should be function');
});

test('deviceOwnership middleware loads', () => {
    const ownership = require('../middleware/deviceOwnership');
    assert(typeof ownership.verifyDeviceOwnership === 'function', 'verifyDeviceOwnership should be function');
    assert(typeof ownership.verifyDeviceOwnershipSync === 'function', 'verifyDeviceOwnershipSync should be function');
});

test('rateLimiter middleware loads', () => {
    const limiter = require('../middleware/rateLimiter');
    assert(typeof limiter.apiLimiter === 'function', 'apiLimiter should be function');
    assert(typeof limiter.authLimiter === 'function', 'authLimiter should be function');
});

test('errorHandler loads', () => {
    const handler = require('../middleware/errorHandler');
    assert(typeof handler === 'function', 'errorHandler should be function');
});

// Test 4: Services load
console.log('\nService Modules:');
const services = ['device.service', 'database.service', 'activity.service', 'chat.service', 'screen.service', 'auth.service', 'audit.service', 'email.service'];
for (const svc of services) {
    test(`${svc} loads`, () => {
        const mod = require(`../services/${svc}`);
        assert(mod !== null, `${svc} should not be null`);
    });
}

// Test 5: Controllers load
console.log('\nController Modules:');
const controllers = ['device.controller', 'command.controller', 'upload.controller', 'chat.controller', 'website.controller', 'security.controller', 'boot.controller', 'gallery.controller', 'auth.controller', 'admin.controller', 'subscription.controller'];
for (const ctrl of controllers) {
    test(`${ctrl} loads`, () => {
        const mod = require(`../controllers/${ctrl}`);
        assert(mod !== null, `${ctrl} should not be null`);
    });
}

// Test 6: Routes load
console.log('\nRoute Modules:');
test('routes/index.js loads', () => {
    const routes = require('../routes/index');
    assert(typeof routes === 'function', 'routes should export a function');
});

test('auth.routes.js loads', () => {
    const router = require('../routes/auth.routes');
    assert(router !== null, 'auth routes should not be null');
});

test('admin.routes.js loads', () => {
    const router = require('../routes/admin.routes');
    assert(router !== null, 'admin routes should not be null');
});

test('subscription.routes.js loads', () => {
    const router = require('../routes/subscription.routes');
    assert(router !== null, 'subscription routes should not be null');
});

// Test 7: Socket handlers load
console.log('\nSocket Modules:');
const sockets = ['connection.socket', 'device.socket', 'screen.socket', 'gallery.socket', 'control.socket', 'camera.socket', 'chat.socket'];
for (const sock of sockets) {
    test(`${sock} loads`, () => {
        const mod = require(`../sockets/${sock}`);
        assert(typeof mod === 'function', `${sock} should export a function`);
    });
}

// Test 8: App creation
console.log('\nApp Structure:');
test('createApp returns express app', () => {
    const createApp = require('../app');
    assert(typeof createApp === 'function', 'createApp should be function');
    const app = createApp();
    assert(typeof app.use === 'function', 'app should have use method');
    assert(typeof app.get === 'function', 'app should have get method');
});

// Test 9: Security checks
console.log('\nSecurity Checks:');
test('env.js does not hardcode secrets', () => {
    const envContent = fs.readFileSync(path.join(__dirname, '../config/env.js'), 'utf8');
    assert(!envContent.includes('sk_live_'), 'Should not contain live secret keys');
    assert(!envContent.includes('password123'), 'Should not contain hardcoded passwords');
});

test('.env.example exists', () => {
    const envExample = path.join(__dirname, '../../.env.example');
    assert(fs.existsSync(envExample), '.env.example should exist');
});

test('.env.example does not contain real secrets', () => {
    const content = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');
    assert(!content.includes('sk_live_'), 'Should not contain live keys');
    assert(content.includes('your-super-secret'), 'Should contain placeholder values');
});

test('seedAdmin.js exists', () => {
    const seedPath = path.join(__dirname, '../scripts/seedAdmin.js');
    assert(fs.existsSync(seedPath), 'seedAdmin.js should exist');
});

test('seedPlans.js exists', () => {
    const seedPath = path.join(__dirname, '../scripts/seedPlans.js');
    assert(fs.existsSync(seedPath), 'seedPlans.js should exist');
});

// Test 10: Frontend files exist
console.log('\nFrontend Files:');
const frontendFiles = ['login.html', 'dashboard.html', 'admin-dashboard.html', 'plans.html', 'index.html'];
for (const file of frontendFiles) {
    test(`${file} exists`, () => {
        const filePath = path.join(__dirname, '../../parent', file);
        assert(fs.existsSync(filePath), `${file} should exist in parent/`);
    });
}

// Test 11: User model has password hashing
console.log('\nAuth System Checks:');
test('User model has comparePassword method', () => {
    const User = require('../models/User');
    assert(User.schema.methods.comparePassword, 'User should have comparePassword method');
});

test('User model has toSafeJSON method', () => {
    const User = require('../models/User');
    assert(User.schema.methods.toSafeJSON, 'User should have toSafeJSON method');
});

test('User model role enum has PARENT and ADMIN', () => {
    const User = require('../models/User');
    const rolePath = User.schema.path('role');
    assert(rolePath.enumValues.includes('PARENT'), 'Should have PARENT role');
    assert(rolePath.enumValues.includes('ADMIN'), 'Should have ADMIN role');
});

// Summary
console.log('\n=== TEST SUMMARY ===');
console.log(`  Passed:  ${passed}`);
console.log(`  Failed:  ${failed}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Total:   ${passed + failed + skipped}`);
console.log('');

if (failed > 0) {
    console.log('SOME TESTS FAILED');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED');
    process.exit(0);
}
