/**
 * Upsert the default subscription plans without deleting plans referenced by
 * existing subscriptions. Run with: node server/scripts/seedPlans.js
 */

const db = require('../config/db');
const Plan = require('../models/Plan');
const defaultPlans = require('../config/defaultPlans');

async function seedPlans() {
    try {
        const connected = await db.connect();
        if (!connected) throw new Error('MongoDB connection unavailable');

        // Keep old customer subscriptions readable, but remove legacy plans
        // from the public purchase list when they are no longer offered.
        await Plan.updateMany(
            { slug: { $in: ['quarterly'] } },
            { $set: { isActive: false, updatedAt: new Date() } }
        );

        for (const planData of defaultPlans) {
            await Plan.findOneAndUpdate(
                { slug: planData.slug },
                { $set: { ...planData, updatedAt: new Date() } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            console.log('✓ Upserted plan:', planData.name, '- ₹' + planData.price);
        }

        console.log('\n✅ Plan seeding complete!');
        const allPlans = await Plan.find({}).sort({ sortOrder: 1 });
        allPlans.forEach((plan) => {
            console.log(`  - ${plan.name}: ₹${plan.price} (${plan.durationDays} days, ${plan.isActive ? 'active' : 'inactive'})`);
        });
    } catch (error) {
        console.error('Plan seeding failed:', error.message);
        process.exitCode = 1;
    } finally {
        await db.mongoose.disconnect().catch(() => {});
    }
}

seedPlans();
