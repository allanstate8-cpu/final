// Application Form Script — Facebook/WhatsApp Safe Admin Assignment
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('applicationForm');

    if (!form) {
        console.error('Fomu ya ombi haijapatikana!');
        return;
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
    // INLINE ERROR CONTAINER
    // ========================================
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = 'display:none;background:#fee2e2;border:2px solid #fecaca;color:#991b1b;padding:16px 20px;border-radius:12px;margin:20px 0;font-size:15px;';
    form.insertBefore(errorContainer, form.firstChild);

    function showErrors(errors) {
        if (!errors.length) { errorContainer.style.display = 'none'; return; }
        errorContainer.innerHTML = '<strong style="display:block;margin-bottom:8px;">⚠ Tafadhali sahihisha:</strong><ul style="margin:8px 0 0 20px;padding:0;">' +
            errors.map(e => `<li style="margin:4px 0;">${e}</li>`).join('') + '</ul>';
        errorContainer.style.display = 'block';
        errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ========================================
    // RESOLVE ADMIN ID — all sources
    // ========================================
    const urlParams       = new URLSearchParams(window.location.search);
    const adminFromQuery  = urlParams.get('admin');
    const adminFromPath   = (window.location.pathname.match(/^\/go\/(.+)$/) || [])[1] || null;
    const adminFromCookie = getCookie('assignedAdminId');
    const adminFromSession = sessionStorage.getItem('selectedAdminId');
    const adminFromLocal  = localStorage.getItem('selectedAdminId');

    const adminId = [adminFromPath, adminFromQuery, adminFromCookie, adminFromSession, adminFromLocal]
        .find(isValidAdminId) || null;

    if (adminId) {
        sessionStorage.setItem('selectedAdminId', adminId);
        localStorage.setItem('selectedAdminId', adminId);
    }

    console.log('=== APPLICATION FORM ===');
    console.log('Admin ID:', adminId || 'Will be auto-assigned');
    console.log('========================');

    // ========================================
    // REAL-TIME VALIDATION
    // ========================================
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('blur', () => validateField(input));
    });

    // ========================================
    // FORM SUBMIT
    // ========================================
    form.addEventListener('submit', function(e) {
        e.preventDefault();

        const errors = [];
        let valid = true;

        inputs.forEach(input => {
            if (!validateField(input)) {
                valid = false;
                const label = input.previousElementSibling?.textContent || input.name || 'Field';
                errors.push(`${label.trim()}: Taarifa sio sahihi`);
            }
        });

        if (!valid) { showErrors(errors); return; }
        errorContainer.style.display = 'none';

        // Re-read in case cookie loaded after page init
        const freshAdmin = getCookie('assignedAdminId') ||
                           sessionStorage.getItem('selectedAdminId') ||
                           localStorage.getItem('selectedAdminId') ||
                           adminId;

        const existing = JSON.parse(sessionStorage.getItem('applicationData') || '{}');

        const formData = {
            applicationId   : existing.applicationId || 'LOAN-' + Date.now(),
            fullName        : document.getElementById('fullName')?.value,
            email           : document.getElementById('email')?.value,
            monthlyIncome   : document.getElementById('monthlyIncome')?.value,
            loanAmount      : document.getElementById('loanAmount')?.value,
            loanPurpose     : document.getElementById('loanPurpose')?.value,
            loanTerm        : document.getElementById('repaymentPeriod')?.value,
            employmentStatus: document.getElementById('employmentStatus')?.value,
            adminId         : freshAdmin || null,
            submittedAt     : new Date().toISOString()
        };

        sessionStorage.setItem('applicationData', JSON.stringify(formData));
        console.log('📋 Application saved | Admin:', freshAdmin || 'auto-assign');

        window.location.href = 'verification.html';
    });

    // ========================================
    // FIELD VALIDATION
    // ========================================
    function validateField(field) {
        const value = field.value.trim();
        field.classList.remove('error');

        if (field.hasAttribute('required') && !value) {
            field.classList.add('error'); return false;
        }
        if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            field.classList.add('error'); return false;
        }
        if (field.type === 'number' && value) {
            const n   = parseFloat(value);
            const min = parseFloat(field.getAttribute('min'));
            const max = parseFloat(field.getAttribute('max'));
            if ((min && n < min) || (max && n > max)) { field.classList.add('error'); return false; }
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
});
