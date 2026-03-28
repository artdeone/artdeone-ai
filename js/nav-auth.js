import { supabase } from './supabase.js';

const PLAN_AVATARS = [
    'https://res.cloudinary.com/dy7vubtji/image/upload/v1774335033/freeplan-cutebird-profile_hiwpcm.svg',
    'https://res.cloudinary.com/dy7vubtji/image/upload/v1774335033/studentplan-cuteowl-profile_wwvkl7.svg',
    'https://res.cloudinary.com/dy7vubtji/image/upload/v1774335034/pro-cutedog-profile_bybo5i.svg',
    'https://res.cloudinary.com/dy7vubtji/image/upload/v1774335033/premium-cutebear-profile_hdcepg.svg',
    'https://res.cloudinary.com/dy7vubtji/image/upload/v1774335034/ultra-cutelion-profile_yaoj8k.svg',
];

// Check auth state on load
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    updateNavUI(session?.user);

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, session) => {
        updateNavUI(session?.user);
    });

    // Profile dropdown toggle
    document.addEventListener('click', (e) => {
        const btn = document.getElementById('navProfileBtn');
        const menu = document.getElementById('navProfileMenu');
        if (!btn || !menu) return;

        if (btn.contains(e.target)) {
            menu.classList.toggle('open');
        } else if (!menu.contains(e.target)) {
            menu.classList.remove('open');
        }
    });
});

function setAvatar(el, avatarUrl, initial) {
    if (!el) return;
    if (avatarUrl) {
        el.innerHTML = `<img src="${avatarUrl}" alt="Profile">`;
    } else {
        el.textContent = initial;
    }
}

async function getUserPlanLevel(userId) {
    try {
        const { data, error } = await supabase
            .from('subscriptions')
            .select('plan_level')
            .eq('user_id', userId)
            .maybeSingle();
        if (!error && data) return data.plan_level || 0;
    } catch (_) { }
    return 0;
}

async function updateNavUI(user) {
    const desktopAuth = document.getElementById('desktopAuth');
    const mobileAuth = document.getElementById('mobileAuth');

    if (!desktopAuth || !mobileAuth) return;

    const btnLoginDesktop = document.getElementById('btnLoginDesktop');
    const btnSignupDesktop = document.getElementById('btnSignupDesktop');
    const userInfoDesktop = document.getElementById('userInfoDesktop');
    const avatarDesktop = document.getElementById('avatarDesktop');

    const btnLoginMobile = document.getElementById('btnLoginMobile');
    const btnSignupMobile = document.getElementById('btnSignupMobile');
    const userInfoMobile = document.getElementById('userInfoMobile');
    const avatarMobile = document.getElementById('avatarMobile');

    if (user) {
        // Logged in
        if (btnLoginDesktop) btnLoginDesktop.style.display = 'none';
        if (btnSignupDesktop) btnSignupDesktop.style.display = 'none';
        if (userInfoDesktop) userInfoDesktop.style.display = 'block';

        if (btnLoginMobile) btnLoginMobile.style.display = 'none';
        if (btnSignupMobile) btnSignupMobile.style.display = 'none';
        if (userInfoMobile) userInfoMobile.style.display = 'block';

        // Set avatar with plan mascot
        const email = user.email || '';
        const initial = email.charAt(0).toUpperCase() || 'U';
        const planLevel = await getUserPlanLevel(user.id);
        const avatarUrl = PLAN_AVATARS[planLevel] || PLAN_AVATARS[0];

        setAvatar(avatarDesktop, avatarUrl, initial);
        setAvatar(avatarMobile, avatarUrl, initial);
    } else {
        // Logged out
        if (btnLoginDesktop) btnLoginDesktop.style.display = 'inline-flex';
        if (btnSignupDesktop) btnSignupDesktop.style.display = 'inline-flex';
        if (userInfoDesktop) userInfoDesktop.style.display = 'none';

        if (btnLoginMobile) btnLoginMobile.style.display = 'inline-flex';
        if (btnSignupMobile) btnSignupMobile.style.display = 'inline-flex';
        if (userInfoMobile) userInfoMobile.style.display = 'none';
    }
}

// Make logout available globally
window.logout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
};
