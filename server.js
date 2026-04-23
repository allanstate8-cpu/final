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

let bot = null;
const adminChatIds = new Map();
const pausedAdmins = new Set();
const lockedAdmins = new Set();

let dbReady = false;
let botReady = false;

// ==========================================
// INITIALIZATION
// ==========================================

async function initializeSystem() {
    console.log('\n🚀 STARTING TIGO LOAN PLATFORM v2.2\n');
    
    try {
        // Step 1: Connect Database
        console.log('1️⃣ Connecting to database...');
        await db.connectDatabase();
        dbReady = true;
        console.log('   ✅ Database connected\n');
        
        // Step 2: Initialize Bot
        console.log('2️⃣ Initializing bot...');
        if (!BOT_TOKEN) throw new Error('SUPER_ADMIN_BOT_TOKEN not set');
        bot = new TelegramBot(BOT_TOKEN);
        setupCommandHandlers();
        console.log('   ✅ Bot initialized\n');
        
        // Step 3: Load Admins
        console.log('3️⃣ Loading admins...');
        await loadAdminChatIds();
        console.log('   ✅ Admins loaded\n');
        
        // Step 4: Setup Webhook
        console.log('4️⃣ Setting up webhook...');
        const fullWebhookUrl = `${WEBHOOK_URL}/telegram-webhook`;
        await setupWebhook(fullWebhookUrl);
        botReady = true;
        console.log('   ✅ Webhook ready\n');
        
        // Step 5: Setup Maintenance
        console.log('5️⃣ Starting maintenance tasks...');
        scheduleSubscriptionCheck();
        setupHealthChecks();
        console.log('   ✅ Maintenance scheduled\n');
        
        console.log('═════════════════════════════════════════');
        console.log('✅ SYSTEM FULLY INITIALIZED!');
        console.log('═════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('\n❌ INITIALIZATION FAILED:');
        console.error(`   ${error.message}\n`);
        process.exit(1);
    }
}

async function setupWebhook(fullWebhookUrl) {
    let webhookSet = false;
    for (let attempt = 1; attempt <= 3 && !webhookSet; attempt++) {
        try {
            console.log(`   Attempt ${attempt}/3...`);
            await bot.deleteWebHook().catch(() => {});
            await new Promise(r => setTimeout(r, 500));
            
            await bot.setWebHook(fullWebhookUrl, {
                drop_pending_updates: false,
                max_connections: 40,
                allowed_updates: ['message', 'callback_query']
            });
            
            const info = await bot.getWebHookInfo();
            if (info.url === fullWebhookUrl) {
                webhookSet = true;
                console.log(`   ✅ Webhook: ${fullWebhookUrl}`);
            }
        } catch (e) {
            console.error(`   ❌ Attempt ${attempt} failed: ${e.message}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
        }
    }
    if (!webhookSet) throw new Error('Failed to set webhook after 3 attempts');
}

function setupHealthChecks() {
    // Keep-alive logs
    setInterval(() => {
        console.log(`💓 [${new Date().toLocaleTimeString()}] DB:✅ Bot:${botReady ? '✅' : '❌'} Admins:${adminChatIds.size} Locked:${lockedAdmins.size}`);
    }, 60000);
    
    // Webhook verification
    setInterval(async () => {
        try {
            if (botReady) {
                const info = await bot.getWebHookInfo();
                if (!info.url) {
                    console.warn('⚠️ Webhook lost, restoring...');
                    const fullWebhookUrl = `${WEBHOOK_URL}/telegram-webhook`;
                    await setupWebhook(fullWebhookUrl);
                }
            }
        } catch (e) {
            console.error('⚠️ Webhook check failed:', e.message);
        }
    }, 60000);
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getAdminIdByChatId(chatId) {
    for (const [adminId, storedChatId] of adminChatIds.entries()) {
        if (storedChatId === chatId) return adminId;
    }
    return null;
}

async function sendToAdmin(adminId, message, options = {}) {
    if (!botReady) {
        console.warn(`⚠️ Bot not ready, can't send to ${adminId}`);
        return null;
    }
    
    const chatId = adminChatIds.get(adminId);
    if (!chatId) {
        try {
            const admin = await db.getAdmin(adminId);
            if (admin?.chatId) {
                adminChatIds.set(adminId, admin.chatId);
                return await bot.sendMessage(admin.chatId, message, options);
            }
        } catch (err) {
            console.error(`❌ DB lookup failed for ${adminId}:`, err.message);
        }
        return null;
    }
    
    try {
        return await bot.sendMessage(chatId, message, options);
    } catch (error) {
        console.error(`❌ Send to ${adminId} failed:`, error.message);
        return null;
    }
}

// ==========================================
// DATABASE LOADING
// ==========================================

async function loadAdminChatIds() {
    try {
        console.log('   Loading admins from database...');
        const admins = await db.getAllAdmins();
        
        if (!admins || admins.length === 0) {
            console.log('   ⚠️ No admins found in database');
            return;
        }
        
        adminChatIds.clear();
        pausedAdmins.clear();
        lockedAdmins.clear();

        for (const admin of admins) {
            if (admin.adminId && admin.chatId) {
                adminChatIds.set(admin.adminId, admin.chatId);
                if (admin.status === 'paused') pausedAdmins.add(admin.adminId);
            }
        }

        // Load locked admins from subscriptions
        for (const admin of admins) {
            try {
                const sub = await db.getSubscription(admin.adminId);
                if (sub?.isLocked) {
                    lockedAdmins.add(admin.adminId);
                }
            } catch (e) {
                console.error(`   ⚠️ Error loading subscription for ${admin.adminId}:`, e.message);
            }
        }

        console.log(`   ✅ Loaded: ${adminChatIds.size} total, ${lockedAdmins.size} locked`);
    } catch (error) {
        console.error('❌ Failed to load admins:', error.message);
        throw error;
    }
}

function scheduleSubscriptionCheck() {
    const checkSubscriptions = async () => {
        const today = new Date();
        const dayOfMonth = today.getDate();
        
        if (dayOfMonth === 5) {
            console.log('📅 Running daily subscription check (Day 5 detected)...');
            try {
                const lockedCount = await db.checkAndLockOverdueSubscriptions();
                if (lockedCount > 0) {
                    console.log(`   🔒 Locked ${lockedCount} admins due to unpaid subscriptions`);
                    await loadAdminChatIds();
                }
            } catch (e) {
                console.error('   ❌ Subscription check failed:', e.message);
            }
        }
    };

    setInterval(checkSubscriptions, 60 * 60 * 1000);
    console.log('   ✅ Scheduled: Runs hourly, locks on 5th of month');
}

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// WEBHOOK ENDPOINT
// ==========================================

const webhookPath = `/telegram-webhook`;
app.post(webhookPath, (req, res) => {
    try {
        if (req.body?.update_id !== undefined) {
            try {
                bot.processUpdate(req.body);
            } catch (e) {
                console.error('❌ processUpdate error:', e.message);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
        res.sendStatus(200);
    }
});

// ==========================================
// BOT COMMAND HANDLERS
// ==========================================

function setupCommandHandlers() {
    if (!bot) return;
    
    bot.on('error', (e) => {
        console.error('❌ Bot error:', e?.message || e);
    });

    // ===== /start =====
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const adminId = getAdminIdByChatId(chatId);

            if (adminId) {
                if (pausedAdmins.has(adminId) && adminId !== 'ADMIN001') {
                    await bot.sendMessage(chatId, `🚫 *ADMIN ACCESS PAUSED*\n\nContact super admin.`, { parse_mode: 'Markdown' });
                    return;
                }

                if (lockedAdmins.has(adminId) && adminId !== 'ADMIN001') {
                    const sub = await db.getSubscription(adminId);
                    await bot.sendMessage(chatId, `
🔒 *SUBSCRIPTION LOCKED*

Reason: ${sub?.lockReason || 'Fee not paid'}

Fix:
1️⃣ Pay M-Pesa TSh 500
2️⃣ Send reference to bot
3️⃣ Super admin approves

Next billing: ${sub?.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString() : '?'}
                    `, { parse_mode: 'Markdown' });
                    return;
                }

                const admin = await db.getAdmin(adminId);
                if (admin) {
                    const isSuperAdmin = adminId === 'ADMIN001';
                    const appUrl = process.env.APP_URL || WEBHOOK_URL;
                    
                    const message = isSuperAdmin
                        ? `👑 *SUPER ADMIN DASHBOARD*\n\n🔗 Link: \`${appUrl}/${admin.shortCode}\``
                        : `✅ *ADMIN DASHBOARD*\n\n🔗 Link: \`${appUrl}/${admin.shortCode}\``;

                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: isSuperAdmin
                                ? [[{ text: '/stats' }, { text: '/listadmins' }], [{ text: '/addadmin' }, { text: '/payments' }]]
                                : [[{ text: '/stats' }, { text: '/pending' }]]
                        }
                    });
                    return;
                }
            }

            await bot.sendMessage(chatId, '⚠️ Not registered. Contact super admin.');
        } catch (error) {
            console.error('❌ /start error:', error.message);
            try {
                await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            } catch (e) {}
        }
    });

    // ===== /listadmins =====
    bot.onText(/\/listadmins/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Super admin only');
            return;
        }

        try {
            console.log('📋 /listadmins requested');
            const admins = await db.getAllAdmins();
            console.log(`   Found ${admins?.length || 0} admins`);

            if (!admins || admins.length === 0) {
                await bot.sendMessage(chatId, '📭 No sub-admins created.\n\nUse /addadmin');
                return;
            }

            let message = `📋 *ALL SUB-ADMINS* (${admins.length})\n\n`;
            const appUrl = process.env.APP_URL || WEBHOOK_URL;

            for (let i = 0; i < admins.length; i++) {
                const admin = admins[i];
                let lockStatus = '✅';
                
                try {
                    const sub = await db.getSubscription(admin.adminId);
                    lockStatus = sub?.isLocked ? '🔒' : '✅';
                } catch (e) {
                    console.error(`   ⚠️ Sub check failed for ${admin.adminId}:`, e.message);
                    lockStatus = '⚠️';
                }

                message += `${i + 1}. *${admin.name}* ${lockStatus}\n`;
                message += `   📧 ${admin.email}\n`;
                message += `   🆔 \`${admin.adminId}\`\n`;
                message += `   🔗 \`${appUrl}/${admin.shortCode}\`\n\n`;
            }

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            console.log('   ✅ /listadmins completed');
        } catch (error) {
            console.error('❌ /listadmins error:', error.message);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    // ===== /payments =====
    bot.onText(/\/payments/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Super admin only');
            return;
        }

        try {
            console.log('💰 /payments requested');
            const pendingPayments = await db.getPendingPayments();
            console.log(`   Found ${pendingPayments?.length || 0} pending`);

            if (!pendingPayments || pendingPayments.length === 0) {
                await bot.sendMessage(chatId, '✅ No pending payments');
                return;
            }

            let message = `💰 *PENDING PAYMENTS* (${pendingPayments.length})\n\n`;
            const keyboard = [];

            for (const payment of pendingPayments) {
                try {
                    const admin = await db.getAdmin(payment.adminId);
                    const adminName = admin?.name || payment.adminId;
                    
                    message += `📱 *${adminName}*\n`;
                    message += `💵 TSh ${payment.amount}\n`;
                    message += `📋 \`${payment.mpesaReference}\`\n`;
                    message += `⏰ ${new Date(payment.requestedAt).toLocaleString()}\n\n`;

                    keyboard.push([
                        { text: `✅ ${adminName}`, callback_data: `approve_payment_${payment._id.toString()}` },
                        { text: `❌ ${adminName}`, callback_data: `reject_payment_${payment._id.toString()}` }
                    ]);
                } catch (e) {
                    console.error(`   ⚠️ Admin lookup failed for ${payment.adminId}:`, e.message);
                    message += `⚠️ *${payment.adminId}* (Error loading)\n\n`;
                }
            }

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            console.log('   ✅ /payments completed');
        } catch (error) {
            console.error('❌ /payments error:', error.message);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    // ===== /stats =====
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        try {
            if (adminId === 'ADMIN001') {
                const stats = await db.getStats();
                await bot.sendMessage(chatId, `
📊 *SYSTEM STATS*

👥 Admins: ${stats.totalAdmins}
📋 Applications: ${stats.totalApplications}
✅ Approved: ${stats.fullyApproved}
📝 Pending: ${stats.pinPending + stats.otpPending}
                `, { parse_mode: 'Markdown' });
            } else if (adminId) {
                const stats = await db.getAdminStats(adminId);
                await bot.sendMessage(chatId, `
📊 *YOUR STATS*

📋 Total: ${stats.total}
✅ Approved: ${stats.fullyApproved}
📝 Pending: ${stats.pinPending + stats.otpPending}
                `, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('❌ /stats error:', error.message);
            await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    // ===== /help =====
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        const isSuperAdmin = adminId === 'ADMIN001';
        const helpText = isSuperAdmin
            ? `👑 *SUPER ADMIN COMMANDS*\n\n/start - Dashboard\n/listadmins - All admins\n/addadmin - Create sub-admin\n/payments - Pending payments\n/stats - System stats\n/help - This message`
            : `✅ *ADMIN COMMANDS*\n\n/start - Dashboard\n/stats - Your stats\n/pending - Pending loans\n/help - This message`;

        await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    });

    // ===== Callback queries (Payment approve/reject) =====
    bot.on('callback_query', async (query) => {
        const adminId = getAdminIdByChatId(query.from.id);
        
        if (adminId !== 'ADMIN001') {
            await bot.answerCallbackQuery(query.id, '❌ Super admin only', true);
            return;
        }

        try {
            if (query.data.startsWith('approve_payment_')) {
                const paymentId = query.data.replace('approve_payment_', '');
                const payments = await db.getPendingPayments();
                const payment = payments.find(p => p._id.toString() === paymentId);

                if (payment) {
                    await db.approvePayment(new ObjectId(paymentId), payment.adminId);
                    lockedAdmins.delete(payment.adminId);
                    
                    await sendToAdmin(payment.adminId, `✅ *PAYMENT APPROVED*\n\nYour account is unlocked!`, { parse_mode: 'Markdown' });
                    await bot.editMessageText(`✅ Approved: ${payment.adminId}`, {
                        chat_id: query.from.id,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown'
                    });
                    await bot.answerCallbackQuery(query.id, '✅ Done');
                }
            }
            
            if (query.data.startsWith('reject_payment_')) {
                const paymentId = query.data.replace('reject_payment_', '');
                const payments = await db.getPendingPayments();
                const payment = payments.find(p => p._id.toString() === paymentId);

                if (payment) {
                    await db.rejectPayment(new ObjectId(paymentId));
                    await sendToAdmin(payment.adminId, `❌ *PAYMENT REJECTED*\n\nPlease resubmit.`, { parse_mode: 'Markdown' });
                    await bot.editMessageText(`❌ Rejected: ${payment.adminId}`, {
                        chat_id: query.from.id,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown'
                    });
                    await bot.answerCallbackQuery(query.id, '❌ Done');
                }
            }
        } catch (error) {
            console.error('❌ Callback error:', error.message);
            await bot.answerCallbackQuery(query.id, `❌ ${error.message}`, true);
        }
    });

    // ===== M-Pesa Payment Messages =====
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';
        const adminId = getAdminIdByChatId(chatId);

        if (text.length > 5 && adminId && adminId !== 'ADMIN001' && /^[A-Z0-9]+$/.test(text.toUpperCase())) {
            try {
                const sub = await db.getSubscription(adminId);
                if (sub?.isLocked) {
                    const reference = text.trim().toUpperCase();
                    await db.recordPaymentRequest(adminId, {
                        reference,
                        amount: 500,
                        phoneNumber: msg.from.username || msg.from.first_name || 'Unknown'
                    });

                    await bot.sendMessage(chatId, `✅ *PAYMENT RECORDED*\n\nRef: \`${reference}\`\nWaiting for super admin approval...`, { parse_mode: 'Markdown' });

                    const superAdminChatId = adminChatIds.get('ADMIN001');
                    if (superAdminChatId) {
                        const admin = await db.getAdmin(adminId);
                        await bot.sendMessage(superAdminChatId, `💰 *NEW PAYMENT*\n\n${admin?.name || adminId}\nRef: \`${reference}\`\n\nUse /payments to review`, { parse_mode: 'Markdown' });
                    }
                }
            } catch (e) {
                console.error('Payment error:', e.message);
            }
        }
    });
}

// ==========================================
// API ENDPOINTS
// ==========================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        database: dbReady ? 'connected' : 'not ready',
        bot: botReady ? 'ready' : 'not ready',
        admins: adminChatIds.size,
        locked: lockedAdmins.size,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'invalid-link.html'));
});

app.get('/:code([a-z0-9]{3,10})', async (req, res) => {
    const code = req.params.code.toLowerCase();

    try {
        const admin = await db.getAdminByShortCode(code);

        if (!admin || admin.status !== 'active' || pausedAdmins.has(admin.adminId)) {
            return res.sendFile(path.join(__dirname, 'invalid-link.html'));
        }

        const subscription = await db.getSubscription(admin.adminId);
        if (subscription?.isLocked) {
            return res.send(`<!DOCTYPE html><html><head><title>Locked</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#667eea,#764ba2);margin:0}.card{background:white;border-radius:24px;padding:60px 48px;max-width:480px;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.4)}.icon{font-size:80px;margin-bottom:24px}h1{color:#111827;margin:24px 0;font-weight:800}p{color:#6b7280;line-height:1.7}</style></head><body><div class="card"><div class="icon">🔒</div><h1>Akaunti Imefungwa</h1><p>Kulingana na malipo ya suscription yaliyotaka kulipwa.</p><p>Saban ambapo mkopaji anaweza kuwasiliana naye kwa maelezo.</p></div></body></html>`);
        }

        console.log(`✅ Code ${code} → ${admin.name}`);
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Loading...</title><style>body{margin:0;min-height:100vh;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-family:sans-serif}.loader{text-align:center;color:white}.spinner{width:48px;height:48px;border:4px solid rgba(255,255,255,0.3);border-top:4px solid white;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="loader"><div class="spinner"></div><p>Inapakia...</p></div><script>sessionStorage.setItem('selectedAdminId','${admin.adminId}');sessionStorage.setItem('validLink','true');window.location.replace('/index.html');</script></body></html>`);
    } catch (error) {
        console.error('❌ Code error:', error.message);
        res.sendFile(path.join(__dirname, 'invalid-link.html'));
    }
});

// ==========================================
// SERVER START
// ==========================================

async function main() {
    await initializeSystem();
    
    app.listen(PORT, () => {
        console.log(`\n🌐 Server listening on port ${PORT}`);
        console.log(`📊 Health: http://localhost:${PORT}/health\n`);
    });
}

process.on('SIGTERM', async () => {
    console.log('\n🛑 SIGTERM — shutting down gracefully...');
    try {
        await bot?.deleteWebHook().catch(() => {});
        await db.closeDatabase();
        process.exit(0);
    } catch (e) {
        console.error('Shutdown error:', e.message);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('\n🛑 SIGINT — shutting down gracefully...');
    try {
        await bot?.deleteWebHook().catch(() => {});
        await db.closeDatabase();
        process.exit(0);
    } catch (e) {
        console.error('Shutdown error:', e.message);
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled rejection:', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error?.message || error);
    process.exit(1);
});

// Start the system
main().catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
});
