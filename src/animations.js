/**
 * Nice — Animations Module
 * Scroll reveals, stat counters, waveform canvas, and typing effects
 */

/**
 * Initialize Intersection Observer for scroll-triggered reveals
 */
export function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    // Stagger animation for grouped items
                    setTimeout(() => {
                        entry.target.classList.add('visible');
                    }, index * 80);
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    reveals.forEach((el) => observer.observe(el));
}

/**
 * Animate stat counter values
 */
export function initStatCounters() {
    const stats = document.querySelectorAll('.stat-value[data-target]');

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.dataset.target, 10);
                    animateCounter(el, 0, target, 1500);
                    observer.unobserve(el);
                }
            });
        },
        { threshold: 0.5 }
    );

    stats.forEach((el) => observer.observe(el));
}

function animateCounter(el, from, to, duration) {
    const start = performance.now();
    const diff = to - from;

    function step(timestamp) {
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.round(from + diff * eased);
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

/**
 * Particle canvas animation for hero background
 */
export function initParticleCanvas() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let animationId;
    let width, height;

    function resize() {
        width = canvas.width = canvas.offsetWidth;
        height = canvas.height = canvas.offsetHeight;
    }

    function createParticles() {
        const count = Math.min(Math.floor((width * height) / 15000), 80);
        particles = [];
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                radius: Math.random() * 1.5 + 0.5,
                opacity: Math.random() * 0.5 + 0.1,
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);

        // Draw particles
        particles.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(167, 139, 250, ${p.opacity})`;
            ctx.fill();
        });

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 120) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    const alpha = (1 - dist / 120) * 0.15;
                    ctx.strokeStyle = `rgba(167, 139, 250, ${alpha})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        // Update positions
        particles.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;
        });

        animationId = requestAnimationFrame(draw);
    }

    resize();
    createParticles();
    draw();

    window.addEventListener('resize', () => {
        resize();
        createParticles();
    });

    return () => cancelAnimationFrame(animationId);
}

/**
 * Waveform canvas animation for "listening" state
 */
export function initWaveform() {
    const canvas = document.getElementById('waveformCanvas');
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    let animating = false;
    let animationId;
    const barCount = 24;

    function drawWaveform() {
        if (!animating) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = canvas.width / barCount;
        const centerY = canvas.height / 2;

        for (let i = 0; i < barCount; i++) {
            const time = Date.now() / 200;
            const height = Math.sin(time + i * 0.4) * 12 + Math.sin(time * 1.5 + i * 0.3) * 6 + 4;

            const gradient = ctx.createLinearGradient(0, centerY - height, 0, centerY + height);
            gradient.addColorStop(0, 'rgba(244, 114, 182, 0.8)');
            gradient.addColorStop(0.5, 'rgba(167, 139, 250, 0.9)');
            gradient.addColorStop(1, 'rgba(6, 182, 212, 0.8)');

            ctx.fillStyle = gradient;
            ctx.fillRect(
                i * barWidth + barWidth * 0.15,
                centerY - height,
                barWidth * 0.7,
                height * 2
            );
        }

        animationId = requestAnimationFrame(drawWaveform);
    }

    return {
        start() {
            animating = true;
            drawWaveform();
        },
        stop() {
            animating = false;
            cancelAnimationFrame(animationId);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        },
    };
}

/**
 * Typing animation for chat messages
 */
export function typeText(element, html, speed = 15) {
    return new Promise((resolve) => {
        // Parse the HTML to extract text and tags
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const text = temp.textContent;

        let i = 0;
        element.innerHTML = '';

        function type() {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                setTimeout(type, speed);
            } else {
                // After typing animation, set actual HTML
                element.innerHTML = html;
                resolve();
            }
        }

        type();
    });
}

/**
 * Navbar scroll behavior
 */
export function initNavbar() {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.querySelector('.nav-links');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile toggle
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navLinks.classList.toggle('open');
        });

        // Close on link click
        navLinks.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('open');
            });
        });
    }

    // Smooth scroll for nav links — only for actual hash targets, not "#"
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            if (href && href.length > 1) {
                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    const navH = document.getElementById('navbar')?.offsetHeight || 60;
                    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - navH, behavior: 'smooth' });
                }
            }
        });
    });
}

/**
 * Initialize flow step highlighting on scroll
 */
export function initFlowAnimation() {
    const steps = document.querySelectorAll('.flow-step');

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const step = entry.target;
                    const delay = (parseInt(step.dataset.step, 10) - 1) * 200;
                    setTimeout(() => {
                        step.style.borderColor = 'rgba(167, 139, 250, 0.3)';
                        step.style.boxShadow = '0 0 30px rgba(167, 139, 250, 0.1)';
                    }, delay);
                }
            });
        },
        { threshold: 0.5 }
    );

    steps.forEach((step) => observer.observe(step));
}
