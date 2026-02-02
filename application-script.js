// Application Form Script - AUTO-ASSIGN ADMIN FROM URL
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('applicationForm');
    
    if (!form) {
        console.error('Fomu ya ombi haijapatikana!');
        return;
    }
    
    // Create inline error container
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = 'display:none; background:#fee2e2; border:2px solid #fecaca; color:#991b1b; padding:16px 20px; border-radius:12px; margin:20px 0; font-size:15px;';
    form.insertBefore(errorContainer, form.firstChild);
    
    function showErrors(errors) {
        if (errors.length === 0) {
            errorContainer.style.display = 'none';
            return;
        }
        
        errorContainer.innerHTML = '<strong style="display:block; margin-bottom:8px;">⚠ Tafadhali sahihisha:</strong><ul style="margin:8px 0 0 20px; padding:0;">' +
            errors.map(err => `<li style="margin:4px 0;">${err}</li>`).join('') +
            '</ul>';
        errorContainer.style.display = 'block';
        errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // Get admin ID from URL - AUTO-ASSIGN
    const urlParams = new URLSearchParams(window.location.search);
    const adminIdFromUrl = urlParams.get('admin');
    
    if (adminIdFromUrl) {
        console.log('✅ Admin ID from URL:', adminIdFromUrl);
        sessionStorage.setItem('selectedAdminId', adminIdFromUrl);
    } else {
        console.log('⚠️ No admin ID in URL - will be auto-assigned by server');
    }
    
    // Get all form inputs
    const inputs = form.querySelectorAll('input, select, textarea');
    
    // Real-time validation
    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            validateField(this);
        });
    });
    
    // Form submission
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Validate all fields
        let isValid = true;
        const errors = [];
        
        inputs.forEach(input => {
            if (!validateField(input)) {
                isValid = false;
                const label = input.previousElementSibling?.textContent || input.name || 'Field';
                errors.push(`${label}: Taarifa sio sahihi`);
            }
        });
        
        if (!isValid) {
            showErrors(errors);
            return;
        }
        
        // Hide errors
        errorContainer.style.display = 'none';
        
        // Get admin ID
        let adminId = sessionStorage.getItem('selectedAdminId') || adminIdFromUrl;
        
        // Collect form data
        const formData = {
            fullName: document.getElementById('fullName')?.value,
            email: document.getElementById('email')?.value,
            monthlyIncome: document.getElementById('monthlyIncome')?.value,
            loanAmount: document.getElementById('loanAmount')?.value,
            loanPurpose: document.getElementById('loanPurpose')?.value,
            loanTerm: document.getElementById('repaymentPeriod')?.value,
            employmentStatus: document.getElementById('employmentStatus')?.value,
            adminId: adminId || null, // Send null if no admin, server will auto-assign
            applicationId: 'LOAN-' + Date.now(),
            submittedAt: new Date().toISOString()
        };
        
        // Store in sessionStorage
        sessionStorage.setItem('applicationData', JSON.stringify(formData));
        
        console.log('📋 Application saved:', formData);
        console.log('👤 Admin ID:', adminId || 'Will be auto-assigned');
        
        // Redirect to verification
        window.location.href = 'verification.html';
    });
    
    // Validate field
    function validateField(field) {
        const value = field.value.trim();
        field.classList.remove('error');
        
        if (field.hasAttribute('required') && !value) {
            field.classList.add('error');
            return false;
        }
        
        if (field.type === 'email' && value) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                field.classList.add('error');
                return false;
            }
        }
        
        if (field.type === 'number' && value) {
            const numValue = parseFloat(value);
            const min = parseFloat(field.getAttribute('min'));
            const max = parseFloat(field.getAttribute('max'));
            
            if ((min && numValue < min) || (max && numValue > max)) {
                field.classList.add('error');
                return false;
            }
        }
        
        return true;
    }
    
    // Error styling
    const style = document.createElement('style');
    style.textContent = `
        input.error, select.error, textarea.error {
            border-color: #ef4444 !important;
            background-color: #fef2f2 !important;
        }
    `;
    document.head.appendChild(style);
    
    console.log('=== APPLICATION FORM ===');
    console.log('Admin ID:', adminIdFromUrl || 'Will be auto-assigned');
    console.log('=======================');
});