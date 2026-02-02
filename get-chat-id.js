// Quick script to find your Telegram Chat ID
// Run this temporarily to get your chat ID

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// Put your bot token here (from @BotFather)
const BOT_TOKEN = process.env.SUPER_ADMIN_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('\n🔍 CHAT ID FINDER');
console.log('==================');
console.log('Bot is running...');
console.log('Send ANY message to your bot in Telegram');
console.log('Your chat ID will appear below:\n');

// Listen for any message
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    const username = msg.from.username || 'N/A';
    
    console.log('\n✅ MESSAGE RECEIVED!');
    console.log('===================');
    console.log(`👤 Name: ${firstName}`);
    console.log(`📝 Username: @${username}`);
    console.log(`💬 CHAT ID: ${chatId}`);
    console.log('\n👆 Copy the CHAT ID number above!');
    console.log('\nPaste it in your .env file as:');
    console.log(`SUPER_ADMIN_CHAT_ID=${chatId}`);
    console.log('\nPress Ctrl+C to stop this script\n');
    
    // Send confirmation back
    bot.sendMessage(chatId, `✅ Got it!\n\nYour Chat ID is: ${chatId}\n\nAdd this to your .env file:\nSUPER_ADMIN_CHAT_ID=${chatId}`);
});

bot.on('polling_error', (error) => {
    console.error('❌ Error:', error.message);
    console.log('\nMake sure:');
    console.log('1. Your bot token is correct in .env');
    console.log('2. You have started the bot in Telegram');
    console.log('3. The token is valid\n');
});
