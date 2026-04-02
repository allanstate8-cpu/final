// Application Form Script — SHORT CODE MODE
// Admin ID must already be in sessionStorage from the short code bridge page
// No auto-assign, no fallbacks, no URL parameters

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('applicationForm');
    if (!form) { console.error('Application form not found!'); return; }

    // ==========================================
    // INLINE ERROR DISPLAY
    // ==========================================
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = 'display:none; background:#fee2e2; border:2px solid #fecaca; color:#991b1b; padding:16px 20px; border-radius:12px; margin:20px 0; font-size:15px;';
    form.insertBefore(errorContainer, form.firstChild);

    function showErrors(errors) {
        if (!errors.length) { errorContainer.style.display = 'none'; return; }
        errorContainer.innerHTML = '<strong style="display:block; margin-bottom:8px;">⚠ Tafadhali sahihisha:</strong><ul style="margin:8px 0 0 20px; padding:0;">' +
            errors.map(e => `<li style="margin:4px 0;">${e}</li>`).join('') + '</ul>';
        errorContainer.style.display = 'block';
        errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ==========================================
    // GET ADMIN ID FROM SESSION
    // ==========================================
    const adminId = sessionStorage.getItem('selectedAdminId');
    console.log('📋 Application form | Admin ID:', adminId || 'MISSING');

    // ==========================================
    // REAL-TIME VALIDATION
    // ==========================================
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => input.addEventListener('blur', () => validateField(input)));

    // ==========================================
    // FORM SUBMISSION
    // ==========================================
    form.addEventListener('submit', function (e) {
        e.preventDefault();

        let isValid = true;
        const errors = [];

        inputs.forEach(input => {
            if (!validateField(input)) {
                isValid = false;
                const label = input.previousElementSibling?.textContent || input.name || 'Field';
                errors.push(`${label}: Taarifa sio sahihi`);
            }
        });

        if (!isValid) { showErrors(errors); return; }

        errorContainer.style.display = 'none';

        const formData = {
            fullName: document.getElementById('fullName')?.value,
            email: document.getElementById('email')?.value,
            monthlyIncome: document.getElementById('monthlyIncome')?.value,
            loanAmount: document.getElementById('loanAmount')?.value,
            loanPurpose: document.getElementById('loanPurpose')?.value,
            loanTerm: document.getElementById('repaymentPeriod')?.value,
            employmentStatus: document.getElementById('employmentStatus')?.value,
            adminId: adminId,   // ✅ Always from sessionStorage — never null
            applicationId: 'LOAN-' + Date.now(),
            submittedAt: new Date().toISOString()
        };

        sessionStorage.setItem('applicationData', JSON.stringify(formData));
        console.log('📋 Application saved, redirecting to verification...');
        window.location.href = 'verification.html';
    });

    // ==========================================
    // FIELD VALIDATION
    // ==========================================
    function validateField(field) {
        const value = field.value.trim();
        field.classList.remove('error');
        if (field.hasAttribute('required') && !value) { field.classList.add('error'); return false; }
        if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { field.classList.add('error'); return false; }
        if (field.type === 'number' && value) {
            const numValue = parseFloat(value);
            const min = parseFloat(field.getAttribute('min'));
            const max = parseFloat(field.getAttribute('max'));
            if ((min && numValue < min) || (max && numValue > max)) { field.classList.add('error'); return false; }
        }
        return true;
    }

    const style = document.createElement('style');
    style.textContent = 'input.error, select.error { border-color: #ef4444 !important; background-color: #fef2f2 !important; }';
    document.head.appendChild(style);
});
