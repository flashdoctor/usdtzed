"use strict";

(function ($) {
    // In Elementor the preview iframe can be narrow even on desktop.
    // Detect "mobile" by pointer/hover capabilities, not by width.
    const isTouchLike = () => window.matchMedia("(hover: none), (pointer: coarse)").matches;

    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

    const getCssVar = (el, name, fallback) => {
        const value = window.getComputedStyle(el).getPropertyValue(name).trim();
        return value || fallback;
    };
 
    const getNumberCssVar = (el, name, fallback) => {
        const raw = getCssVar(el, name, "");
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : fallback;
    };

    const setupSpoilerCanvas = ($item, $inner) => {
        if ($item.data("kngSpoilerInit")) return;
        $item.data("kngSpoilerInit", true);

        const innerEl = $inner.get(0);
        const textEl = $inner.find("span").first().get(0);
        if (!innerEl || !textEl) return;

        const canvas = document.createElement("canvas");
        canvas.className = "king-addons-spoiler-canvas";
        innerEl.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const state = {
            dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
            w: 0,
            h: 0,
            particles: [],
            revealPoints: [],
            rafId: 0,
            start: performance.now(),
            last: performance.now(),
            running: false,
            bounds: null,
            cloud: null,
            region: null,
            sprites: null,
            spriteKey: "",
            edgeFadeStart: 0.65,
            edgeFadeEnd: 2.05,
        };

        const getText = () => ($(textEl).text() || "").trim();

        const parseColor = (color) => {
            // Supports: #rgb, #rrggbb, rgb(), rgba(). Falls back to medium gray.
            const fallback = { r: 156, g: 163, b: 175 };
            if (!color) return fallback;
            const c = color.toString().trim();
            if (c.startsWith("#")) {
                const hex = c.slice(1);
                if (hex.length === 3) {
                    const r = parseInt(hex[0] + hex[0], 16);
                    const g = parseInt(hex[1] + hex[1], 16);
                    const b = parseInt(hex[2] + hex[2], 16);
                    return { r, g, b };
                }
                if (hex.length === 6) {
                    const r = parseInt(hex.slice(0, 2), 16);
                    const g = parseInt(hex.slice(2, 4), 16);
                    const b = parseInt(hex.slice(4, 6), 16);
                    return { r, g, b };
                }
                return fallback;
            }
            const m = c.match(/rgba?\(([^)]+)\)/i);
            if (m) {
                const parts = m[1].split(",").map((p) => p.trim());
                const r = parseInt(parts[0], 10);
                const g = parseInt(parts[1], 10);
                const b = parseInt(parts[2], 10);
                if ([r, g, b].every((n) => Number.isFinite(n))) {
                    return { r, g, b };
                }
            }
            return fallback;
        };

        const rebuildParticles = () => {
            const text = getText();
            state.particles = [];
            state.cloud = null;
            state.region = null;
            if (!text || state.w <= 1 || state.h <= 1) return;

            // iMessage Invisible Ink is not per-letter; it's a tight rounded-rect over the text box.
            const computed = window.getComputedStyle($item.get(0));
            const font = computed.font || `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;

            // Measure using an offscreen context.
            const mcanvas = document.createElement("canvas");
            const mctx = mcanvas.getContext("2d");
            if (!mctx) return;
            mctx.font = font;

            const fontSize = parseFloat(computed.fontSize) || 16;
            const lineHeightRaw = computed.lineHeight;
            const lineHeight = Number.isFinite(parseFloat(lineHeightRaw)) ? parseFloat(lineHeightRaw) : fontSize * 1.25;

            // Region from actual laid-out text box.
            const innerRect = innerEl.getBoundingClientRect();
            const spanRect = textEl.getBoundingClientRect();
            const relX = spanRect.left - innerRect.left;
            const relY = spanRect.top - innerRect.top;
            const relW = spanRect.width;
            const relH = spanRect.height;

            const padX = Math.max(10, relW * 0.04, fontSize * 0.7);
            const padY = Math.max(6, relH * 0.18, fontSize * 0.35);
            const rx = relW / 2;
            const corner = clamp(lineHeight * 0.55, 10, Math.max(10, (relH + padY * 2) / 2));

            const region = {
                x: clamp(relX - padX, 0, Math.max(0, state.w - 1)),
                y: clamp(relY - padY, 0, Math.max(0, state.h - 1)),
                w: Math.max(1, relW + padX * 2),
                h: Math.max(1, relH + padY * 2),
                r: corner,
                feather: Math.max(8, lineHeight * 0.28),
            };
            // Clamp region size inside canvas.
            if (region.x + region.w > state.w) region.w = Math.max(1, state.w - region.x);
            if (region.y + region.h > state.h) region.h = Math.max(1, state.h - region.y);
            state.region = region;

            // Target count based on region area.
            const maxParticles = 2200;
            const minParticles = 520;
            const area = region.w * region.h;
            const targetTotal = clamp(Math.round(area / 22), minParticles, maxParticles);

            const sdfRoundRect = (px, py, rr) => {
                const cx = rr.x + rr.w / 2;
                const cy = rr.y + rr.h / 2;
                const hx = rr.w / 2 - rr.r;
                const hy = rr.h / 2 - rr.r;
                const qx = Math.abs(px - cx) - hx;
                const qy = Math.abs(py - cy) - hy;
                const ax = Math.max(qx, 0);
                const ay = Math.max(qy, 0);
                return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rr.r;
            };

            const samplePoint = () => {
                const margin = region.feather * 1.15;
                for (let k = 0; k < 14; k += 1) {
                    const x = region.x + (Math.random() * (region.w + margin * 2) - margin);
                    const y = region.y + (Math.random() * (region.h + margin * 2) - margin);
                    if (sdfRoundRect(x, y, region) <= margin) return { x, y };
                }
                return { x: region.x + region.w / 2, y: region.y + region.h / 2 };
            };

            for (let i = 0; i < targetTotal; i += 1) {
                const pt = samplePoint();
                const speed = 7 + Math.random() * 10;
                const dir = Math.random() * Math.PI * 2;
                const sparkle = Math.random() < 0.06;
                const size = sparkle ? (0.90 + Math.random() * 0.35) : (0.55 + Math.random() * 0.28);
                const tint = sparkle ? (0.65 + Math.random() * 0.25) : (0.22 + Math.random() * 0.22);
                const kind = sparkle ? "spark" : (Math.random() < 0.55 ? "dust" : "dust2");
                state.particles.push({
                    x: pt.x,
                    y: pt.y,
                    vx: Math.cos(dir) * speed,
                    vy: Math.sin(dir) * speed,
                    baseSpeed: speed,
                    alpha: 1,
                    size,
                    sparkle,
                    tint,
                    kind,
                    phase: Math.random() * Math.PI * 2,
                    twinkleSpeed: 0.6 + Math.random() * 1.0,
                    // store region ref values for cheaper access
                    rx: region.x,
                    ry: region.y,
                    rw: region.w,
                    rh: region.h,
                    rr: region.r,
                    rf: region.feather,
                });
            }
        };

        const resize = () => {
            const rect = innerEl.getBoundingClientRect();
            const w = Math.max(1, rect.width);
            const h = Math.max(1, rect.height);

            // Avoid rebuilding on tiny sub-pixel changes.
            if (Math.abs(w - state.w) < 0.5 && Math.abs(h - state.h) < 0.5) return;

            state.w = w;
            state.h = h;
            canvas.width = Math.ceil(w * state.dpr);
            canvas.height = Math.ceil(h * state.dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

            rebuildParticles();
        };

        const addRevealPoint = (x, y) => {
            state.revealPoints.push({ x, y, t: performance.now() });
            if (state.revealPoints.length > 30) {
                state.revealPoints.shift();
            }
        };

        const setSpotlight = (clientX, clientY, enabled) => {
            if (!enabled) {
                innerEl.style.setProperty("--kng-spoiler-spot-r", "0px");
                return;
            }

            const rect = textEl.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            const r = 34;

            innerEl.style.setProperty("--kng-spoiler-spot-x", `${x}px`);
            innerEl.style.setProperty("--kng-spoiler-spot-y", `${y}px`);
            innerEl.style.setProperty("--kng-spoiler-spot-r", `${r}px`);
        };

        const clearRevealPoints = () => {
            state.revealPoints = [];
            // Restore particles quickly.
            state.particles.forEach((p) => {
                p.alpha = 1;
                // Keep their motion; just restore opacity.
            });
        };

        const draw = () => {
            if ($inner.hasClass("is-revealed")) {
                state.running = false;
                state.rafId = 0;
                return;
            }

            const now = performance.now();
            const time = (now - state.start) / 1000;
            const dt = clamp((now - state.last) / 1000, 0, 0.05);
            state.last = now;

            // Decay reveal points.
            const ttl = 1200;
            state.revealPoints = state.revealPoints.filter((p) => now - p.t < ttl);

            resize();
            if (!state.w || !state.h) {
                state.rafId = requestAnimationFrame(draw);
                return;
            }

            const text = getText();
            const computed = window.getComputedStyle($item.get(0));
            const font = computed.font || `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
            const textColor = computed.color || "#000";

            const spoilerColorRaw = getCssVar($item.get(0), "--kng-spoiler-color", "#9ca3af");
            const spoilerRgb = parseColor(spoilerColorRaw);
            const spoilerOpacity = clamp(getNumberCssVar($item.get(0), "--kng-spoiler-opacity", 1), 0, 1);

            ctx.clearRect(0, 0, state.w, state.h);

            const radius = 26;
            const fadeSpeed = 0.12;

            const smoothStep = (a, b, x) => {
                const t = clamp((x - a) / (b - a), 0, 1);
                return t * t * (3 - 2 * t);
            };

            const mixToWhite = (rgb, t) => {
                const tt = clamp(t, 0, 1);
                const r = Math.round(rgb.r + (255 - rgb.r) * tt);
                const g = Math.round(rgb.g + (255 - rgb.g) * tt);
                const b = Math.round(rgb.b + (255 - rgb.b) * tt);
                return { r, g, b };
            };

            const snap = (v) => {
                // Snap to device pixels for crisp rendering.
                const dpr = state.dpr || 1;
                return Math.round(v * dpr) / dpr;
            };

            const ensureSprites = (rgb) => {
                const key = `${rgb.r},${rgb.g},${rgb.b}`;
                if (state.sprites && state.spriteKey === key) return;

                const makeSprite = (radiusPx, tintToWhite) => {
                    const size = Math.ceil(radiusPx * 2 + 4);
                    const c = document.createElement("canvas");
                    c.width = size;
                    c.height = size;
                    const cctx = c.getContext("2d");
                    if (!cctx) return c;

                    // Keep color visible: only tiny whitening.
                    const col = mixToWhite(rgb, tintToWhite);
                    const cx = Math.floor(size / 2);
                    const cy = Math.floor(size / 2);

                    cctx.clearRect(0, 0, size, size);
                    cctx.imageSmoothingEnabled = false;

                    // Hard core (no AA): 1–2 device-independent pixels.
                    const core = radiusPx >= 1.05 ? 2 : 1;
                    cctx.globalAlpha = 1;
                    cctx.fillStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 1)`;
                    cctx.fillRect(cx - Math.floor(core / 2), cy - Math.floor(core / 2), core, core);

                    // Minimal halo (very subtle) so it doesn't look blurry.
                    const grad = cctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx + 0.8);
                    grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0.18)`);
                    grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
                    cctx.fillStyle = grad;
                    cctx.beginPath();
                    cctx.arc(cx + 0.5, cy + 0.5, radiusPx + 0.8, 0, Math.PI * 2);
                    cctx.fill();
                    return c;
                };

                // Mostly small dust, rare brighter sparkles.
                state.sprites = {
                    dust: makeSprite(0.72, 0.06),
                    dust2: makeSprite(0.92, 0.08),
                    spark: makeSprite(1.18, 0.14),
                };
                state.spriteKey = key;
            };

            const sdfRoundRectFast = (px, py, x, y, w, h, r) => {
                const cx = x + w / 2;
                const cy = y + h / 2;
                const hx = w / 2 - r;
                const hy = h / 2 - r;
                const qx = Math.abs(px - cx) - hx;
                const qy = Math.abs(py - cy) - hy;
                const ax = Math.max(qx, 0);
                const ay = Math.max(qy, 0);
                return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
            };

            const edgeFactorAt = (p) => {
                if (typeof p.cx !== "number" || typeof p.cy !== "number" || typeof p.rx !== "number" || typeof p.ry !== "number") {
                    return 1;
                }
                const nx = (p.x - p.cx) / p.rx;
                const ny = (p.y - p.cy) / p.ry;
                const r = Math.sqrt(nx * nx + ny * ny) + (typeof p.edgeJitter === "number" ? p.edgeJitter : 0);

                // Feathered edge so the cloud doesn't end with a hard oval.
                // r <= 1.0  -> fully visible
                // 1.0 < r < 1.55 -> fade out
                // r >= 1.55 -> fully invisible (and we respawn)
                const fadeStart = state.edgeFadeStart || 1.0;
                const fadeEnd = state.edgeFadeEnd || 1.55;
                if (r <= fadeStart) return 1;
                if (r >= fadeEnd) return 0;
                const t = clamp((r - fadeStart) / (fadeEnd - fadeStart), 0, 1);
                const s = t * t * (3 - 2 * t);
                return 1 - s;
            };

            const shouldRespawn = (p) => {
                if (typeof p.cx !== "number" || typeof p.cy !== "number" || typeof p.rx !== "number" || typeof p.ry !== "number") {
                    return false;
                }
                const nx = (p.x - p.cx) / p.rx;
                const ny = (p.y - p.cy) / p.ry;
                const r = Math.sqrt(nx * nx + ny * ny);
                const fadeEnd = state.edgeFadeEnd || 1.55;
                return r > fadeEnd + 0.55;
            };

            const respawn = (p) => {
                if (!state.region) {
                    return;
                }
                const margin = state.region.feather * 1.15;
                for (let k = 0; k < 12; k += 1) {
                    const x = state.region.x + (Math.random() * (state.region.w + margin * 2) - margin);
                    const y = state.region.y + (Math.random() * (state.region.h + margin * 2) - margin);
                    if (sdfRoundRectFast(x, y, state.region.x, state.region.y, state.region.w, state.region.h, state.region.r) <= margin) {
                        p.x = x;
                        p.y = y;
                        break;
                    }
                }

                const speed = typeof p.baseSpeed === "number" ? p.baseSpeed : (7 + Math.random() * 10);
                const dir = Math.random() * Math.PI * 2;
                p.vx = Math.cos(dir) * speed;
                p.vy = Math.sin(dir) * speed;
            };

            ensureSprites(spoilerRgb);

            // Preserve color (lighter tends to wash into white).
            ctx.globalCompositeOperation = "source-over";
            ctx.imageSmoothingEnabled = false;

            for (let i = 0; i < state.particles.length; i += 1) {
                const p = state.particles[i];

                // Natural iMessage-like shimmer: gentle drift + tiny curl.
                if (typeof p.vx === "number" && typeof p.vy === "number") {
                    const phase = (p.phase || 0);
                    const ax = Math.sin(p.y * 0.045 + time * 0.85 + phase) * 3.2;
                    const ay = Math.cos(p.x * 0.045 - time * 0.80 + phase) * 3.2;
                    p.vx += ax * dt;
                    p.vy += ay * dt;

                    const base = typeof p.baseSpeed === "number" ? p.baseSpeed : 14;
                    const maxV = base * 1.18;
                    const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                    if (v > maxV) {
                        const k = maxV / (v || 1);
                        p.vx *= k;
                        p.vy *= k;
                    }

                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                }

                if (!state.region) continue;
                // No hard boundary: fade via SDF with a bit of noise.
                const sdf = sdfRoundRectFast(p.x, p.y, state.region.x, state.region.y, state.region.w, state.region.h, state.region.r);
                // Irregular edge (not a visible geometric boundary)
                const edgeNoise = (Math.sin(p.x * 0.11 + time * 0.8 + (p.phase || 0)) + Math.cos(p.y * 0.13 - time * 0.7 + (p.phase || 0))) * 0.5;
                const feather = state.region.feather;
                const edge = 1 - smoothStep(-feather, 0, sdf + edgeNoise * feather * 0.18);
                if (edge <= 0.01) {
                    // if far outside, respawn; if near outside, just drift back.
                    if (sdf > feather * 1.8) respawn(p);
                    continue;
                }

                // If slightly outside, gently pull back toward center (no bounce).
                if (sdf > 0.6) {
                    const cx = state.region.x + state.region.w / 2;
                    const cy = state.region.y + state.region.h / 2;
                    p.x += (cx - p.x) * 0.02;
                    p.y += (cy - p.y) * 0.02;
                    p.vx *= 0.98;
                    p.vy *= 0.98;
                }

                // Soft wrap/respawn so the cloud keeps moving without visible "bounce".
                // Only respawn when far outside; near-edge particles fade out instead.
                if (shouldRespawn(p)) {
                    respawn(p);
                }

                // Reveal around cursor/touch movement.
                let shouldFade = false;
                for (let k = 0; k < state.revealPoints.length; k += 1) {
                    const rp = state.revealPoints[k];
                    const dx = p.x - rp.x;
                    const dy = p.y - rp.y;
                    if (dx * dx + dy * dy < radius * radius) {
                        shouldFade = true;
                        break;
                    }
                }

                if (shouldFade) {
                    p.alpha = Math.max(0, p.alpha - fadeSpeed);
                } else {
                    p.alpha = Math.min(1, p.alpha + fadeSpeed * 0.35);
                }

                const tw = 0.94 + 0.06 * Math.sin(time * (p.twinkleSpeed || 1.0) + (p.phase || 0));
                // Boost a bit so color reads.
                const baseAlpha = clamp(spoilerOpacity * p.alpha * edge * tw * 1.48, 0, 1);
                if (baseAlpha <= 0.01) continue;

                const size = typeof p.size === "number" ? p.size : 0.8;
                const kind = (p.kind || (p.sparkle ? "spark" : "dust"));
                const sprite = kind === "spark" ? state.sprites.spark : (kind === "dust2" ? state.sprites.dust2 : state.sprites.dust);
                const sw = sprite.width;
                const sh = sprite.height;
                // Limit scaling to avoid blur and keep pointy look.
                const scale = clamp(size / 0.8, 0.9, 1.15);
                const dw = Math.max(1, Math.round(sw * scale));
                const dh = Math.max(1, Math.round(sh * scale));

                const tintBoost = typeof p.tint === "number" ? (1 + p.tint * 0.82) : 1;
                ctx.globalAlpha = clamp(baseAlpha * tintBoost * (kind === "spark" ? 1 : 1), 0, 1);
                // Snap to device pixel grid for crispness.
                const dx = snap(p.x - dw / 2);
                const dy = snap(p.y - dh / 2);
                ctx.drawImage(sprite, dx, dy, dw, dh);
            }

            ctx.globalCompositeOperation = "source-over";

            ctx.globalAlpha = 1;
            state.rafId = requestAnimationFrame(draw);
        };

        const start = () => {
            if (state.running) return;
            state.running = true;
            state.start = performance.now();
            state.rafId = requestAnimationFrame(draw);
        };

        const stopAndRevealAll = () => {
            $inner.addClass("is-revealed");
            setSpotlight(0, 0, false);
            clearRevealPoints();
            if (state.rafId) {
                cancelAnimationFrame(state.rafId);
                state.rafId = 0;
            }
            state.running = false;
        };

        const hideAll = () => {
            $inner.removeClass("is-revealed");
            setSpotlight(0, 0, false);
            clearRevealPoints();
            start();
        };

        // Initial sizing & animation.
        resize();
        start();

        // Use triggers from widget settings.
        const triggerDesktop = $item.data("spoiler-desktop") || "hover";
        const triggerMobile = $item.data("spoiler-mobile") || "tap";

        const attachHoverInk = () => {
            $item.on("mousemove", (e) => {
                const rect = innerEl.getBoundingClientRect();
                addRevealPoint(e.clientX - rect.left, e.clientY - rect.top);
                setSpotlight(e.clientX, e.clientY, true);
            });
            $item.on("mouseleave", () => {
                setSpotlight(0, 0, false);
                clearRevealPoints();
            });
        };

        const attachTouchInk = () => {
            $item.on("touchstart", (e) => {
                const touch = e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0];
                if (touch) setSpotlight(touch.clientX, touch.clientY, true);
            });
            $item.on("touchmove", (e) => {
                const touch = e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0];
                if (!touch) return;
                const rect = innerEl.getBoundingClientRect();
                addRevealPoint(touch.clientX - rect.left, touch.clientY - rect.top);
                setSpotlight(touch.clientX, touch.clientY, true);
            });
            $item.on("touchend", () => {
                setSpotlight(0, 0, false);
                // On mobile iOS-like behavior: reset when touch ends.
                clearRevealPoints();
            });
        };

        const attachClickRemove = () => {
            $item.on("click", (e) => {
                e.preventDefault();
                if ($inner.hasClass("is-revealed")) {
                    hideAll();
                } else {
                    stopAndRevealAll();
                }
            });
        };

        const attachClickToggle = () => {
            $item.on("click", (e) => {
                e.preventDefault();
                if ($inner.hasClass("is-revealed")) {
                    hideAll();
                } else {
                    stopAndRevealAll();
                }
            });
        };

        if (isTouchLike()) {
            if (triggerMobile === "hover") {
                attachTouchInk();
            } else if (triggerMobile === "hover-click") {
                attachTouchInk();
                attachClickRemove();
            } else {
                attachClickToggle();
            }
        } else {
            if (triggerDesktop === "click") {
                attachClickToggle();
            } else if (triggerDesktop === "hover-click") {
                attachHoverInk();
                attachClickRemove();
            } else {
                attachHoverInk();
            }
        }

        // Keep canvas in sync with layout changes.
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => {
                resize();
            });
            ro.observe(innerEl);
        } else {
            $(window).on("resize", () => resize());
        }
    };

    const bindSpoiler = ($item) => {
        const $inner = $item.find(".king-addons-styled-text-inner").first();
        if (!$inner.length) return;
        setupSpoilerCanvas($item, $inner);
    };

    const startTyping = ($item) => {
        const $inner = $item.find(".king-addons-styled-text-inner span").first();
        if (!$inner.length) return;

        const fullText = $inner.text();
        const speed = parseInt($item.data("typing-speed"), 10) || 80;
        const delay = parseInt($item.data("typing-delay"), 10) || 1200;
        const loop = $item.data("typing-loop") === "yes";
        const cursorChar = ($item.data("typing-cursor") || "|").toString();

        const $cursor = $('<span class="king-addons-styled-text__cursor"></span>').text(cursorChar);
        $inner.after($cursor);

        let pos = 0;
        let isTyping = false;

        const typeOnce = () => {
            if (isTyping) return;
            isTyping = true;
            $inner.text("");
            pos = 0;

            const step = () => {
                if (pos <= fullText.length) {
                    $inner.text(fullText.substring(0, pos));
                    pos += 1;
                    setTimeout(step, speed);
                } else {
                    isTyping = false;
                    if (loop) {
                        setTimeout(typeOnce, delay);
                    }
                }
            };

            step();
        };

        typeOnce();
    };

    const initStyledText = ($scope) => {
        const $items = $scope.find('.king-addons-styled-text[data-effect="spoiler"]');
        if ($items.length) {
            $items.each(function () {
                bindSpoiler($(this));
            });
        }

        const $typingItems = $scope.find('.king-addons-styled-text[data-effect="typing"]');
        if ($typingItems.length) {
            $typingItems.each(function () {
                startTyping($(this));
            });
        }
    };

    $(window).on("elementor/frontend/init", function () {
        elementorFrontend.hooks.addAction(
            "frontend/element_ready/king-addons-styled-text-builder.default",
            function ($scope) {
                initStyledText($scope);
            }
        );
    });
})(jQuery);







