// Landing Page Script - Facebook/WhatsApp Safe Admin Assignment
// ================================================================
// PRIORITY ORDER for reading admin ID:
//   1. URL path  e.g. /go/ADMIN-123     ← best, FB can't strip this
//   2. URL query e.g. ?admin=ADMIN-123  ← fallback for old links
//   3. Cookie    set by server           ← survives navigation
//   4. sessionStorage                   ← within-session fallback
//   5. localStorage                     ← cross-session fallback
// ================================================================

document.addEventListener('DOMContentLoaded', function() {

    // ========================================
    // UTILITY: Cookie reader
    // ========================================
    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    // ========================================
    // UTILITY: Validate admin ID format
    // ========================================
    function isValidAdminId(id) {
        if (!id) return false;
        if (id === 'undefined' || id === 'null' || id === '') return false;
        return true;
    }

    // ========================================
    // STEP 1: Read admin ID from all sources
    // ========================================
    const urlParams = new URLSearchParams(window.location.search);
    const adminFromQuery = urlParams.get('admin');

    // Check if we came via /go/:adminId  — server already set the cookie,
    // but we also read the path in case the cookie hasn't fired yet.
    const pathMatch = window.location.pathname.match(/^\/go\/(.+)$/);
    const adminFromPath = pathMatch ? pathMatch[1] : null;

    const adminFromCookie   = getCookie('assignedAdminId');
    const adminFromSession  = sessionStorage.getItem('selectedAdminId');
    const adminFromLocal    = localStorage.getItem('selectedAdminId');

    // Choose best available source
    const adminId = [adminFromPath, adminFromQuery, adminFromCookie, adminFromSession, adminFromLocal]
        .find(isValidAdminId) || null;

    // ========================================
    // STEP 2: Persist wherever we found it
    // ========================================
    if (adminId) {
        sessionStorage.setItem('selectedAdminId', adminId);
        localStorage.setItem('selectedAdminId', adminId);

        // Debug
        const source = adminFromPath    ? 'PATH (/go/)'  :
                       adminFromQuery   ? 'QUERY (?admin)' :
                       adminFromCookie  ? 'COOKIE'         :
                       adminFromSession ? 'SESSION'         : 'LOCALSTORAGE';

        console.log(`%c✅ Admin ID: ${adminId} (source: ${source})`,
            'background:#4CAF50;color:white;padding:4px 10px;border-radius:3px;font-weight:bold');

        // Small on-screen badge (auto-hides)
        showAdminBadge(adminId, source);
    } else {
        console.log('%c⚠️ No admin ID found — server will auto-assign',
            'background:#FF9800;color:white;padding:4px 10px;border-radius:3px;font-weight:bold');
    }

    // ========================================
    // LOAN CALCULATOR
    // ========================================
    const calcSlider  = document.getElementById('calcSlider');
    const calcAmount  = document.getElementById('calcAmount');
    const calcTerm    = document.getElementById('calcTerm');
    const monthlyDisp = document.getElementById('monthlyPayment');
    const totalDisp   = document.getElementById('totalRepayment');

    const annualRate = 0.12; // 12% APR

    function calculateLoan() {
        const amount = parseFloat(calcAmount ? calcAmount.value : 5000000) || 5000000;
        const term   = parseInt(calcTerm ? calcTerm.value : 12) || 12;
        const mRate  = annualRate / 12;

        const monthly = amount * mRate * Math.pow(1 + mRate, term) /
                        (Math.pow(1 + mRate, term) - 1);
        const total   = monthly * term;

        if (monthlyDisp) monthlyDisp.textContent = 'TSh ' + Math.round(monthly).toLocaleString();
        if (totalDisp)   totalDisp.textContent   = 'TSh ' + Math.round(total).toLocaleString();
    }

    if (calcSlider && calcAmount) {
        calcSlider.addEventListener('input', () => {
            calcAmount.value = calcSlider.value;
            calculateLoan();
        });
        calcAmount.addEventListener('input', () => {
            const v = Math.max(500000, Math.min(50000000, parseFloat(calcAmount.value) || 500000));
            calcAmount.value = v;
            if (calcSlider) calcSlider.value = v;
            calculateLoan();
        });
    }
    if (calcTerm) calcTerm.addEventListener('change', calculateLoan);
    calculateLoan();

    // ========================================
    // SMOOTH SCROLL
    // ========================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // ========================================
    // APPLY NOW — preserve admin in sessionStorage
    // ========================================
    document.querySelectorAll('.apply-btn, .cta-button, [href="application.html"]').forEach(btn => {
        btn.addEventListener('click', function() {
            const stored = sessionStorage.getItem('selectedAdminId') ||
                           localStorage.getItem('selectedAdminId') ||
                           getCookie('assignedAdminId');

            const appData = {
                applicationId : 'APP-' + Date.now(),
                timestamp     : new Date().toISOString(),
                adminId       : stored || null,
                createdAt     : new Date().toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam' })
            };

            sessionStorage.setItem('applicationData', JSON.stringify(appData));
            localStorage.setItem('lastApplicationData', JSON.stringify(appData));

            console.log('📋 Application started:', appData.applicationId, '| Admin:', stored || 'auto-assign');
        });
    });

    // ========================================
    // DEBUG SUMMARY
    // ========================================
    console.log('═══════════════════════════════════════════');
    console.log('🏦 LANDING PAGE — Admin Assignment Debug');
    console.log('═══════════════════════════════════════════');
    console.log('  Path   :', adminFromPath    || 'none');
    console.log('  Query  :', adminFromQuery   || 'none');
    console.log('  Cookie :', adminFromCookie  || 'none');
    console.log('  Session:', adminFromSession || 'none');
    console.log('  Local  :', adminFromLocal   || 'none');
    console.log('  ➜ USING:', adminId          || 'AUTO-ASSIGN');
    console.log('═══════════════════════════════════════════');

    // ========================================
    // ADMIN BADGE UI
    // ========================================
    function showAdminBadge(id, source) {
        const badge = document.createElement('div');
        badge.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px',
            'background:#4CAF50', 'color:white',
            'padding:8px 16px', 'border-radius:20px',
            'font-size:11px', 'font-weight:bold',
            'z-index:9999', 'box-shadow:0 2px 8px rgba(0,0,0,.2)',
            'animation:lsBadgeIn .3s ease-out', 'pointer-events:none'
        ].join(';');
        badge.textContent = `✅ ${id} (${source})`;
        document.body.appendChild(badge);

        if (!document.getElementById('ls-badge-style')) {
            const s = document.createElement('style');
            s.id = 'ls-badge-style';
            s.textContent = `
                @keyframes lsBadgeIn  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
                @keyframes lsBadgeOut { from{opacity:1;transform:none} to{opacity:0;transform:translateY(20px)} }
            `;
            document.head.appendChild(s);
        }

        setTimeout(() => {
            badge.style.animation = 'lsBadgeOut .3s ease-in forwards';
            setTimeout(() => badge.remove(), 320);
        }, 5000);
    }
});
