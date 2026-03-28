// ── Shop Badge ──
// Shows a floating badge/button linking to the pricing section
// This script is loaded on the landing page (index.html)

(function () {
  'use strict';

  // Only show on the main landing page
  if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') return;

  // Create floating shop badge
  const badge = document.createElement('a');
  badge.href = '#pricing';
  badge.id = 'shopBadge';
  badge.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="21" r="1"/>
      <circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
    <span>View Plans</span>
  `;

  // Styling
  Object.assign(badge.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '11px 20px',
    background: '#a7e169',
    color: '#0d1a00',
    borderRadius: '50px',
    textDecoration: 'none',
    fontFamily: "'DM Sans', -apple-system, sans-serif",
    fontSize: '13.5px',
    fontWeight: '700',
    boxShadow: '0 4px 18px rgba(167,225,105,.45)',
    zIndex: '9999',
    transition: 'transform 0.2s, box-shadow 0.2s, background 0.2s',
    cursor: 'pointer',
    letterSpacing: '.01em',
  });

  badge.addEventListener('mouseenter', () => {
    badge.style.transform = 'translateY(-2px) scale(1.03)';
    badge.style.background = '#8cca50';
    badge.style.boxShadow = '0 8px 28px rgba(167,225,105,.55)';
  });

  badge.addEventListener('mouseleave', () => {
    badge.style.transform = 'translateY(0) scale(1)';
    badge.style.background = '#a7e169';
    badge.style.boxShadow = '0 4px 18px rgba(167,225,105,.45)';
  });

  // Hide badge when pricing section is visible
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      badge.style.opacity = entry.isIntersecting ? '0' : '1';
      badge.style.pointerEvents = entry.isIntersecting ? 'none' : 'auto';
    });
  }, { threshold: 0.2 });

  // Wait for DOM
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(badge);

    const pricingSection = document.getElementById('pricing');
    if (pricingSection) {
      observer.observe(pricingSection);
    }
  });
})();
