// Landing Page Calculator Script with Admin ID Capture
document.addEventListener('DOMContentLoaded', function() {
    // ========================================
    // ✅ CRITICAL: CAPTURE ADMIN ID FROM URL
    // ========================================
    const urlParams = new URLSearchParams(window.location.search);
    const adminId = urlParams.get('admin');
    
    if (adminId) {
        // Store admin ID in sessionStorage for use throughout the application
        sessionStorage.setItem('selectedAdminId', adminId);
        console.log('✅ Admin ID captured from URL:', adminId);
        console.log('✅ Stored in sessionStorage');
    } else {
        console.log('⚠️ No admin ID in URL - will use auto-assignment');
        // Clear any previous admin ID
        sessionStorage.removeItem('selectedAdminId');
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
    // If you have an "Apply Now" button, capture the click
    const applyButtons = document.querySelectorAll('.apply-btn, .cta-button, [href="application.html"]');
    
    applyButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            // Generate application ID
            const applicationId = 'APP-' + Date.now();
            
            // Store application data
            const applicationData = {
                applicationId: applicationId,
                timestamp: new Date().toISOString()
            };
            
            sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
            
            // Log for debugging
            console.log('📋 Application created:', applicationId);
            if (adminId) {
                console.log('👤 Will be assigned to admin:', adminId);
            } else {
                console.log('👤 Will be auto-assigned to available admin');
            }
        });
    });
});