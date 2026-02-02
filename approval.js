// Approval Page Script
document.addEventListener('DOMContentLoaded', function() {
    // Get application data
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    
    if (!applicationData.loanAmount) {
        // If no data, use defaults or redirect
        console.warn('No application data found, using defaults');
    }
    
    // Get loan details
    const loanAmount = parseFloat(applicationData.loanAmount) || 5000000; // Default 5M TSh
    const loanTerm = parseInt(applicationData.loanTerm) || 12;
    const annualRate = 0.12; // 12% APR
    const monthlyRate = annualRate / 12;
    
    // Calculate monthly payment
    const monthlyPayment = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, loanTerm) / 
                          (Math.pow(1 + monthlyRate, loanTerm) - 1);
    
    const totalRepayment = monthlyPayment * loanTerm;
    
    // Update display with correct IDs and TSh currency
    const approvedAmountEl = document.getElementById('approvedAmount');
    const loanAmountDetailEl = document.getElementById('loanAmountDetail');
    const monthlyPaymentDetailEl = document.getElementById('monthlyPaymentDetail');
    const repaymentPeriodDetailEl = document.getElementById('repaymentPeriodDetail');
    const totalRepaymentDetailEl = document.getElementById('totalRepaymentDetail');
    
    if (approvedAmountEl) approvedAmountEl.textContent = 'TSh ' + loanAmount.toLocaleString();
    if (loanAmountDetailEl) loanAmountDetailEl.textContent = 'TSh ' + loanAmount.toLocaleString();
    if (monthlyPaymentDetailEl) monthlyPaymentDetailEl.textContent = 'TSh ' + Math.round(monthlyPayment).toLocaleString();
    if (repaymentPeriodDetailEl) repaymentPeriodDetailEl.textContent = loanTerm + ' miezi';
    if (totalRepaymentDetailEl) totalRepaymentDetailEl.textContent = 'TSh ' + Math.round(totalRepayment).toLocaleString();
    
    console.log('Approval page loaded with:', {
        loanAmount,
        loanTerm,
        monthlyPayment: Math.round(monthlyPayment),
        totalRepayment: Math.round(totalRepayment)
    });
    
    // Create confetti effect
    createConfetti();
});

// Global function for download agreement button
function downloadAgreement() {
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    const loanAmount = parseFloat(applicationData.loanAmount) || 5000000;
    const loanTerm = parseInt(applicationData.loanTerm) || 12;
    const annualRate = 0.12;
    const monthlyRate = annualRate / 12;
    
    const monthlyPayment = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, loanTerm) / 
                          (Math.pow(1 + monthlyRate, loanTerm) - 1);
    const totalRepayment = monthlyPayment * loanTerm;
    
    const agreementText = `
MKATABA WA MKOPO
==================

Nambari ya Ombi: ${applicationData.applicationId || 'Hakuna'}
Tarehe: ${new Date().toLocaleDateString('sw-TZ')}

TAARIFA ZA MKOPAJI:
Jina: ${applicationData.fullName || 'Hakuna'}
Barua pepe: ${applicationData.email || 'Hakuna'}

MAELEZO YA MKOPO:
Kiasi cha Mkopo: TSh ${loanAmount.toLocaleString()}
Kiwango cha Riba: ${(annualRate * 100)}% APR
Muda wa Mkopo: ${loanTerm} miezi
Malipo ya Kila Mwezi: TSh ${Math.round(monthlyPayment).toLocaleString()}
Jumla ya Malipo: TSh ${Math.round(totalRepayment).toLocaleString()}

KUSUDI: ${applicationData.loanPurpose || 'Hakuna'}

MASHARTI NA HALI:
1. Hii ni hati ya idhini ya awali ya mkopo.
2. Idhini ya mwisho inategemea uthibitishaji wa taarifa ulizotoa.
3. Malipo ya kila mwezi yanadaiwa siku moja kila mwezi.
4. Ada za ucheleweshaji zinaweza kutumika kulingana na masharti yetu ya huduma.
5. Malipo ya mapema yanaruhusiwa bila adhabu.

Hati hii ni kwa maelezo tu na haijakubaliana.

Imetengenezwa na Mkopo wa Tigo
    `;
    
    // Create downloadable file
    const blob = new Blob([agreementText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mkataba-mkopo-${applicationData.applicationId || 'rasimu'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Global function for view dashboard
function viewDashboard() {
    alert('Kipengele cha Dashibodi kinakuja hivi karibuni! Utaweza kufuatilia hali ya mkopo wako hapa.');
}

// Global function for social sharing
function shareOnSocial(platform) {
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    const loanAmount = parseFloat(applicationData.loanAmount) || 5000000;
    const text = `Nimeidhinishwa mkopo wa TSh ${loanAmount.toLocaleString()} na Mkopo wa Tigo! 🎉`;
    const url = window.location.origin;
    
    let shareUrl = '';
    
    switch(platform.toLowerCase()) {
        case 'twitter':
            shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
            break;
        case 'facebook':
            shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
            break;
        case 'linkedin':
            shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
            break;
        case 'whatsapp':
            shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
            break;
    }
    
    if (shareUrl) {
        window.open(shareUrl, '_blank', 'width=600,height=400');
    }
}

// Simple confetti effect - called on page load
function createConfetti() {
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    const confettiContainer = document.querySelector('.approval-card');
    
    if (!confettiContainer) return;
    
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.style.cssText = `
                position: fixed;
                width: 10px;
                height: 10px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${Math.random() * 100}%;
                top: -10px;
                opacity: ${Math.random()};
                transform: rotate(${Math.random() * 360}deg);
                pointer-events: none;
                z-index: 9999;
            `;
            document.body.appendChild(confetti);
            
            // Animate fall
            let top = -10;
            const speed = Math.random() * 3 + 2;
            const interval = setInterval(() => {
                top += speed;
                confetti.style.top = top + 'px';
                
                if (top > window.innerHeight) {
                    clearInterval(interval);
                    confetti.remove();
                }
            }, 20);
        }, i * 30);
    }
}
