// Landing Page Calculator Script with Enhanced Admin ID Capture
document.addEventListener('DOMContentLoaded', function() {
    // ========================================
    // ✅ CRITICAL: CAPTURE ADMIN ID FROM URL
    // ========================================
    const urlParams = new URLSearchParams(window.location.search);
    const adminId = urlParams.get('admin');
    
    // Enhanced admin ID validation and storage
    if (adminId && adminId !== '' && adminId !== 'undefined' && adminId !== 'null') {
        // Store admin ID in both sessionStorage and localStorage for redundancy
        sessionStorage.setItem('selectedAdminId', adminId);
        localStorage.setItem('selectedAdminId', adminId);
        console.log('✅ Admin ID captured from URL:', adminId);
        console.log('✅ Stored in sessionStorage and localStorage');
        
        // Visual confirmation (optional - you can remove this)
        console.log('%c🎯 ADMIN ASSIGNED: ' + adminId, 'background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
    } else {
        console.log('⚠️ No admin ID in URL - will use auto-assignment');
        // Don't clear existing admin ID - user might be navigating within the app
        // Only clear if explicitly no admin parameter
        if (window.location.search && !adminId) {
            console.log('🔄 Clearing previous admin assignment');
            sessionStorage.removeItem('selectedAdminId');
            localStorage.removeItem('selectedAdminId');
        }
    }
    
    // ========================================
    // LOAN CALCULATOR
    // ========================================
    const calcSlider = document.getElementById('calcSlider');
    const calcAmount = document.getElementById('calcAmount');
    const calcTerm = document.getElementById('calcTerm');
    const monthlyPaymentDisplay = document.getElementById('monthlyPayment');
    const totalRepaymentDisplay = document.getElementById('totalRepayment');
    
    // Annual interest rate
    const annualRate = 0.12; // 12% APR
    
    // Function to calculate loan
    function calculateLoan() {
        const amount = parseFloat(calcAmount.value) || 5000000;
        const term = parseInt(calcTerm.value) || 12;
        const monthlyRate = annualRate / 12;
        
        // Calculate monthly payment using loan formula
        const monthlyPayment = amount * monthlyRate * Math.pow(1 + monthlyRate, term) / 
                              (Math.pow(1 + monthlyRate, term) - 1);
        
        const totalRepayment = monthlyPayment * term;
        
        // Update displays
        if (monthlyPaymentDisplay) {
            monthlyPaymentDisplay.textContent = 'TSh ' + Math.round(monthlyPayment).toLocaleString();
        }
        
        if (totalRepaymentDisplay) {
            totalRepaymentDisplay.textContent = 'TSh ' + Math.round(totalRepayment).toLocaleString();
        }
    }
    
    // Sync slider and input
    if (calcSlider && calcAmount) {
        calcSlider.addEventListener('input', function() {
            calcAmount.value = this.value;
            calculateLoan();
        });
        
        calcAmount.addEventListener('input', function() {
            const value = Math.max(500000, Math.min(50000000, this.value || 500000));
            this.value = value;
            calcSlider.value = value;
            calculateLoan();
        });
    }
    
    // Term change
    if (calcTerm) {
        calcTerm.addEventListener('change', calculateLoan);
    }
    
    // Initial calculation
    calculateLoan();
    
    // ========================================
    // SMOOTH SCROLL FOR NAVIGATION
    // ========================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // ========================================
    // ✅ APPLY NOW BUTTON HANDLER
    // ========================================
    const applyButtons = document.querySelectorAll('.apply-btn, .cta-button, [href="application.html"]');
    
    applyButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            // Get the stored admin ID (check both storages)
            const storedAdminId = sessionStorage.getItem('selectedAdminId') || 
                                 localStorage.getItem('selectedAdminId');
            
            // Generate application ID
            const applicationId = 'APP-' + Date.now();
            
            // Store comprehensive application data
            const applicationData = {
                applicationId: applicationId,
                timestamp: new Date().toISOString(),
                adminId: storedAdminId,
                createdAt: new Date().toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam' })
            };
            
            // Store in sessionStorage
            sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
            
            // Also backup in localStorage
            localStorage.setItem('lastApplicationData', JSON.stringify(applicationData));
            
            // Enhanced logging
            console.log('📋 Application created:', applicationId);
            console.log('📅 Timestamp:', applicationData.timestamp);
            
            if (storedAdminId) {
                console.log('👤 Assigned to admin:', storedAdminId);
                console.log('%c✅ ADMIN ASSIGNMENT CONFIRMED', 'background: #2196F3; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
            } else {
                console.log('👤 Will be auto-assigned by server');
                console.log('%c⚠️ AUTO-ASSIGNMENT MODE', 'background: #FF9800; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
            }
        });
    });
    
    // ========================================
    // DEBUG INFO ON PAGE LOAD
    // ========================================
    const currentAdminId = sessionStorage.getItem('selectedAdminId') || 
                          localStorage.getItem('selectedAdminId');
    
    console.log('═══════════════════════════════════════');
    console.log('🏦 LANDING PAGE INITIALIZED');
    console.log('═══════════════════════════════════════');
    console.log('📍 Current URL:', window.location.href);
    console.log('🔗 Query String:', window.location.search);
    console.log('👤 Admin ID from URL:', adminId || 'NONE');
    console.log('💾 Stored Admin ID:', currentAdminId || 'NONE');
    
    if (currentAdminId) {
        console.log('%c🎯 ACTIVE ASSIGNMENT: ' + currentAdminId, 'background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
    } else {
        console.log('%c⚠️ NO ASSIGNMENT - WILL AUTO-ASSIGN', 'background: #FF9800; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;');
    }
    console.log('═══════════════════════════════════════');
    
    // ========================================
    // ADMIN LINK VERIFICATION
    // ========================================
    // This helps you verify the links are working correctly
    if (adminId) {
        // Create a small visual indicator (optional - can be removed)
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            animation: fadeIn 0.3s ease-in;
        `;
        indicator.textContent = '✅ Admin: ' + adminId;
        
        // Add to page
        document.body.appendChild(indicator);
        
        // Remove after 5 seconds
        setTimeout(() => {
            indicator.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => indicator.remove(), 300);
        }, 5000);
        
        // Add simple CSS animations
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes fadeOut {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(20px); }
            }
        `;
        document.head.appendChild(style);
    }
});