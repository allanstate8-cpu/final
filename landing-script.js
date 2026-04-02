// Landing Page Script — SHORT CODE MODE
// Admin ID comes from sessionStorage (set by server bridge page via short code)
// No auto-assign, no URL parameters, no fallbacks

document.addEventListener('DOMContentLoaded', function () {

    // ==========================================
    // LOAN CALCULATOR
    // ==========================================
    const calcSlider = document.getElementById('calcSlider');
    const calcAmount = document.getElementById('calcAmount');
    const calcTerm = document.getElementById('calcTerm');
    const monthlyPaymentDisplay = document.getElementById('monthlyPayment');
    const totalRepaymentDisplay = document.getElementById('totalRepayment');
    const annualRate = 0.12;

    function calculateLoan() {
        const amount = parseFloat(calcAmount?.value) || 5000000;
        const term = parseInt(calcTerm?.value) || 12;
        const monthlyRate = annualRate / 12;
        const monthlyPayment = amount * monthlyRate * Math.pow(1 + monthlyRate, term) /
                              (Math.pow(1 + monthlyRate, term) - 1);
        const totalRepayment = monthlyPayment * term;
        if (monthlyPaymentDisplay) monthlyPaymentDisplay.textContent = 'TSh ' + Math.round(monthlyPayment).toLocaleString();
        if (totalRepaymentDisplay) totalRepaymentDisplay.textContent = 'TSh ' + Math.round(totalRepayment).toLocaleString();
    }

    if (calcSlider && calcAmount) {
        calcSlider.addEventListener('input', function () { calcAmount.value = this.value; calculateLoan(); });
        calcAmount.addEventListener('input', function () {
            const value = Math.max(500000, Math.min(50000000, this.value || 500000));
            this.value = value;
            calcSlider.value = value;
            calculateLoan();
        });
    }
    if (calcTerm) calcTerm.addEventListener('change', calculateLoan);
    calculateLoan();

    // ==========================================
    // SMOOTH SCROLL
    // ==========================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // ==========================================
    // DEBUG LOG (can be removed in production)
    // ==========================================
    const adminId = sessionStorage.getItem('selectedAdminId');
    console.log('✅ Landing page loaded | Admin ID:', adminId || 'MISSING');
});
