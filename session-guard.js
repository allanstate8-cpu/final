// ✅ SESSION GUARD — included at the top of every protected page
// Blocks any user who did not arrive through a valid short code link
(function () {
    var adminId = sessionStorage.getItem('selectedAdminId');
    var validLink = sessionStorage.getItem('validLink');

    if (!adminId || !validLink || adminId === 'null' || adminId === 'undefined' || adminId === '') {
        window.location.replace('/invalid-link.html');
    }
})();
