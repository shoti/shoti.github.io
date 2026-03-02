'use strict';

document.addEventListener('DOMContentLoaded', function () {
  // Theme toggle
  var toggle = document.getElementById('theme-toggle');
  var root = document.documentElement;
  var stored = localStorage.getItem('theme');
  if (stored) root.setAttribute('data-theme', stored);

  // Enable theme transitions after initial paint to prevent flash
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      root.classList.add('transitions-ready');
    });
  });

  if (toggle) {
    toggle.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      if (!current) {
        next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
      }
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      var r = (parseInt(toggle.dataset.r || '0', 10) + 180);
      toggle.dataset.r = r;
      toggle.style.transform = 'rotate(' + r + 'deg)';
    });
  }

  // Active nav link
  var p = window.location.pathname;
  var navLinks = document.querySelectorAll('.site-nav a');
  for (var i = 0; i < navLinks.length; i++) {
    var href = navLinks[i].getAttribute('href');
    if (href === '/' ? p === '/' : p.startsWith(href)) {
      navLinks[i].classList.add('nav-active');
    }
  }

  // Reading time
  var el = document.querySelector('.reading-time');
  if (el) {
    var words = parseInt(el.getAttribute('data-words'), 10) || 0;
    var minutes = Math.max(1, Math.round(words / 200));
    el.textContent = minutes + ' min read';
  }

  // Reading progress bar
  var bar = document.getElementById('reading-progress');
  if (bar) {
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
    });
  }
});
