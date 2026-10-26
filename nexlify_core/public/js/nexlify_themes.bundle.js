// The Nexlify themes: a color and a scene for the desk, picked under "Nexlify Themes" in Frappe's
// Switch Theme (the navbar's Toggle Theme, Ctrl+Shift+G, and the Appearance tab of the user's
// settings). A theme goes over Frappe's Light, Dark or Automatic, and has a version for each; its
// colors are in css/nexlify_themes.css. The scene is drawn here, once, as an SVG fixed to the bottom
// of the page, behind everything; it takes its colors from the theme's CSS custom properties (its
// gradients too), so it follows light and dark by itself. The choice is the user's default
// `nexlify_core` (nexlify_core.nexlify_core.themes.set_theme).

frappe.provide("nexlify.themes");

(function () {
	const T = nexlify.themes;
	const W = 1440;
	const H = 320;
	let drawn = 0;

	// the same "random" stars and petals on every load, so a page never jumps
	function seeded(seed) {
		return () => {
			seed = (seed * 16807) % 2147483647;
			return (seed - 1) / 2147483646;
		};
	}

	const v = (name) => `var(--nxt-${name})`;
	const mix = (a, b, p) => `color-mix(in srgb, ${a} ${p}%, ${b})`;

	// what a scene draws with: its gradients, named once per SVG (a page can hold several, in
	// Switch Theme, each in its own theme's colors)
	function canvas() {
		const id = `nxt${++drawn}`;
		const defs = [];
		const stops = (list) =>
			list
				.map(
					([at, color, opacity = 1]) =>
						`<stop offset="${at}" style="stop-color:${color};stop-opacity:${opacity}"/>`
				)
				.join("");
		const k = {
			defs,
			id: (name) => `${id}-${name}`,
			// a vertical gradient (top to bottom), or along x1 y1 x2 y2
			lin(name, list, x = [0, 0, 0, 1]) {
				defs.push(
					`<linearGradient id="${id}-${name}" x1="${x[0]}" y1="${x[1]}" x2="${x[2]}" y2="${
						x[3]
					}">${stops(list)}</linearGradient>`
				);
				return `url(#${id}-${name})`;
			},
			rad(name, list) {
				defs.push(`<radialGradient id="${id}-${name}">${stops(list)}</radialGradient>`);
				return `url(#${id}-${name})`;
			},
		};
		// layer n (1 far .. 4 near), lighter at its top and deeper at its foot
		k.layer = (n) =>
			k.lin(`s${n}`, [
				[0, v(`s${n}`)],
				[1, n < 4 ? mix(v(`s${n}`), v(`s${n + 1}`), 45) : mix(v("s4"), "#000", 82)],
			]);
		return k;
	}

	// a band of hills (or waves) from the left edge to the right, closed at the bottom
	function wave_points(y, amp, waves, phase, step = 24) {
		const pts = [];
		for (let x = 0; x <= W; x += step) {
			const t = (x / W) * Math.PI * 2 * waves + phase;
			pts.push([x, y - amp * (Math.sin(t) * 0.7 + Math.sin(t * 2.3 + phase) * 0.3)]);
		}
		return pts;
	}
	const line_of = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y.toFixed(1)}`).join(" ");

	function hills(fill, y, amp, waves, phase = 0) {
		const pts = wave_points(y, amp, waves, phase);
		return `<path fill="${fill}" d="${line_of(pts)} L${W} ${H} L0 ${H} Z"/>`;
	}

	// the lit edge along a hill's top
	function ridge(cls, y, amp, waves, phase = 0) {
		return `<path class="${cls}" d="${line_of(wave_points(y, amp, waves, phase))}"/>`;
	}

	function glow(k, cx, cy, r, crescent = false) {
		const halo = k.rad("halo", [
			[0, v("sun"), 0.55],
			[0.45, v("sun"), 0.18],
			[1, v("sun"), 0],
		]);
		const disc = k.rad("disc", [
			[0, mix(v("sun"), "#fff", 55)],
			[1, v("sun")],
		]);
		// a crescent is the disc with a bite out of it (a mask: a circle a little up and to the right)
		let body = `<circle fill="${disc}" cx="${cx}" cy="${cy}" r="${r}"/>`;
		if (crescent) {
			const mask = k.id("bite");
			k.defs.push(
				`<mask id="${mask}"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><circle cx="${
					cx + r * 0.42
				}" cy="${cy - r * 0.3}" r="${r * 0.86}" fill="#000"/></mask>`
			);
			body = `<circle fill="${disc}" mask="url(#${mask})" cx="${cx}" cy="${cy}" r="${r}"/>`;
		}
		// the halo fades out before the drawing's top edge, so it never ends in a line
		return `<circle fill="${halo}" cx="${cx}" cy="${cy}" r="${Math.min(r * 3.2, cy - 2)}"/>` + body;
	}

	function mist(k, y, h) {
		const fill = k.lin("mist", [
			[0, v("mist"), 0],
			[0.5, v("mist"), 0.6],
			[1, v("mist"), 0],
		]);
		return `<rect fill="${fill}" x="0" y="${y}" width="${W}" height="${h}"/>`;
	}

	function stars(n, rand, top, bottom) {
		let s = "";
		for (let i = 0; i < n; i++) {
			s += `<circle class="star" style="animation-delay:${(rand() * 4).toFixed(1)}s" cx="${(
				rand() * W
			).toFixed(0)}" cy="${(top + rand() * (bottom - top)).toFixed(0)}" r="${(
				0.7 +
				rand() * 1.5
			).toFixed(1)}"/>`;
		}
		return s;
	}

	// a four-pointed sparkle
	function sparkle(x, y, r, cls = "star") {
		const q = r * 0.28;
		return `<path class="${cls}" d="M${x} ${y - r} Q${x + q} ${y - q} ${x + r} ${y} Q${x + q} ${
			y + q
		} ${x} ${y + r} Q${x - q} ${y + q} ${x - r} ${y} Q${x - q} ${y - q} ${x} ${y - r} Z"/>`;
	}

	function heart(x, y, s, cls = "deco2") {
		return `<path class="${cls}" transform="translate(${x} ${y}) scale(${s})" d="M0 4 C-6 -3 -14 4 0 14 C14 4 6 -3 0 4 Z"/>`;
	}

	function birds(list, cls = "line") {
		return list
			.map(
				([x, y, s = 1]) =>
					`<path class="${cls}" d="M${x - 9 * s} ${y} Q${x - 4 * s} ${y - 6 * s} ${x} ${y} Q${
						x + 4 * s
					} ${y - 6 * s} ${x + 9 * s} ${y}"/>`
			)
			.join("");
	}

	function pine(x, base, h, fill) {
		const w = h * 0.42;
		return `<path fill="${fill}" d="M${x} ${base - h} L${x + w * 0.55} ${base - h * 0.55} L${
			x + w * 0.3
		} ${base - h * 0.55} L${x + w} ${base - h * 0.12} L${x - w} ${base - h * 0.12} L${
			x - w * 0.3
		} ${base - h * 0.55} L${x - w * 0.55} ${base - h * 0.55} Z"/><rect fill="${fill}" x="${
			x - 3
		}" y="${base - h * 0.14}" width="6" height="${h * 0.16}"/>`;
	}

	function palm(x, base, h, cls = "deco") {
		const top = base - h;
		const leaf = (dx, dy) =>
			`<path class="${cls}" d="M${x} ${top} Q${x + dx * 0.5} ${top - 18 + dy * 0.2} ${x + dx} ${
				top + dy
			} Q${x + dx * 0.45} ${top - 6 + dy * 0.3} ${x} ${top + 3} Z"/>`;
		return (
			`<path class="${cls}" d="M${x - 3} ${base} Q${x + 8} ${base - h * 0.5} ${x} ${top} L${
				x + 3
			} ${top} Q${x + 13} ${base - h * 0.5} ${x + 4} ${base} Z"/>` +
			leaf(-46, 18) +
			leaf(46, 16) +
			leaf(-30, 34) +
			leaf(32, 34) +
			leaf(-8, -22)
		);
	}

	function blossom(k, cx, cy, r, rand) {
		const fill = k.rad("bloom", [
			[0, v("bloom2")],
			[1, v("bloom")],
		]);
		let s = "";
		for (let i = 0; i < 16; i++) {
			const a = rand() * Math.PI * 2;
			const d = rand() * r;
			s += `<circle fill="${fill}" cx="${(cx + Math.cos(a) * d * 1.4).toFixed(0)}" cy="${(
				cy +
				Math.sin(a) * d * 0.8
			).toFixed(0)}" r="${(r * (0.35 + rand() * 0.3)).toFixed(0)}"/>`;
		}
		return s;
	}

	function cherry_tree(k, x, base, s, rand) {
		return (
			`<path class="trunk" transform="translate(${x} ${base}) scale(${s})" d="M-12 0 Q-6 -70 -26 -120 Q-42 -150 -82 -168 L-76 -176 Q-32 -160 -14 -132 Q-2 -180 48 -200 L52 -192 Q12 -168 2 -120 Q12 -64 12 0 Z"/>` +
			blossom(k, x - 70 * s, base - 182 * s, 40 * s, rand) +
			blossom(k, x + 50 * s, base - 208 * s, 46 * s, rand) +
			blossom(k, x - 4 * s, base - 150 * s, 36 * s, rand)
		);
	}

	function butterfly(x, y, s) {
		return `<g transform="translate(${x} ${y}) scale(${s})"><g class="flutter"><path class="deco2" d="M0 0 C-10 -14 -20 -6 -14 2 C-20 8 -8 14 0 2 Z"/><path class="deco2" d="M0 0 C10 -14 20 -6 14 2 C20 8 8 14 0 2 Z"/></g></g>`;
	}

	function camel(x, y, s) {
		return `<path class="line-fill" transform="translate(${x} ${y}) scale(${s})" d="M0 -26 Q3 -31 8 -30 L11 -27 L13 -21 Q17 -18 21 -21 Q25 -33 33 -31 Q38 -38 44 -31 Q49 -24 52 -18 L51 -14 L50 0 L47 0 L46 -12 L42 -12 L41 0 L38 0 L37 -13 L24 -13 L23 0 L20 0 L19 -13 L15 -13 L14 0 L11 0 L11 -15 Q8 -18 7 -22 L4 -24 Z"/>`;
	}

	function cloud(k, x, y, s) {
		const fill = k.lin("cloud", [
			[0, v("cloud")],
			[1, v("cloud2")],
		]);
		return `<g transform="translate(${x} ${y}) scale(${s})"><g class="drift"><path fill="${fill}" d="M-60 20 Q-62 -2 -40 -4 Q-36 -30 -8 -26 Q8 -46 32 -30 Q58 -32 58 -6 Q76 0 70 20 Z"/></g></g>`;
	}

	function balloon(k, x, y, s, a, b) {
		const fill = k.lin(`balloon-${a}`, [
			[0, v(a)],
			[0.5, v(a)],
			[0.5, v(b)],
			[1, v(b)],
		], [0, 0, 1, 0]);
		return `<g transform="translate(${x} ${y}) scale(${s})"><g class="bob"><path fill="${fill}" d="M0 -60 C34 -60 40 -24 26 -4 C18 8 8 14 6 22 L-6 22 C-8 14 -18 8 -26 -4 C-40 -24 -34 -60 0 -60 Z"/><path class="line" d="M-6 22 L-7 34 M6 22 L7 34"/><rect class="deco" x="-8" y="34" width="16" height="11" rx="2"/></g></g>`;
	}

	function lantern(k, x, y, s) {
		const glass = k.rad("glass", [
			[0, v("glass")],
			[1, v("glass2")],
		]);
		return `<g transform="translate(${x} ${y}) scale(${s})"><g class="sway"><path class="line" d="M0 -40 L0 0"/><path class="deco2" d="M-6 0 L6 0 L10 8 L-10 8 Z"/><path fill="${glass}" d="M-10 8 L10 8 L14 22 L10 38 L-10 38 L-14 22 Z"/><path class="frame" d="M-10 8 L-14 22 L-10 38 M10 8 L14 22 L10 38 M0 8 L0 38 M-14 22 L14 22"/><path class="deco2" d="M-10 38 L10 38 L6 46 L-6 46 Z"/><circle class="deco2" cx="0" cy="50" r="3"/></g></g>`;
	}

	function umbrella(x, base, s, c1, c2) {
		let stripes = "";
		for (let i = 0; i < 6; i++) {
			const a0 = Math.PI + (i * Math.PI) / 6;
			const a1 = Math.PI + ((i + 1) * Math.PI) / 6;
			stripes += `<path fill="${v(i % 2 ? c2 : c1)}" d="M0 0 L${(Math.cos(a0) * 44).toFixed(1)} ${(
				Math.sin(a0) * 22
			).toFixed(1)} A44 22 0 0 1 ${(Math.cos(a1) * 44).toFixed(1)} ${(Math.sin(a1) * 22).toFixed(
				1
			)} Z"/>`;
		}
		return `<g transform="translate(${x} ${base - 56 * s}) scale(${s}) rotate(-8)"><path class="pole" d="M0 0 L0 58"/>${stripes}</g>`;
	}

	function mosque(x, base, s) {
		const minaret = (mx, h) =>
			`<rect x="${mx - 5}" y="${-h}" width="10" height="${h}"/><rect x="${mx - 8}" y="${
				-h * 0.72
			}" width="16" height="4"/><path d="M${mx - 5} ${-h} L${mx} ${-h - 18} L${mx + 5} ${-h} Z"/>`;
		return `<g class="deco" transform="translate(${x} ${base}) scale(${s})">
			<rect x="-70" y="-48" width="140" height="48"/>
			<path d="M-46 -48 A46 46 0 0 1 46 -48 Z"/><path d="M-2 -94 L0 -110 L2 -94 Z"/>
			<path d="M-70 -40 A18 18 0 0 1 -34 -40 Z M34 -40 A18 18 0 0 1 70 -40 Z"/>
			${minaret(-92, 120)}${minaret(92, 120)}
			<rect x="-110" y="-26" width="220" height="26"/>
		</g>`;
	}

	function skyline(cls, rand, base, min, max, windows) {
		let s = "";
		let w_ = "";
		let x = -10;
		while (x < W) {
			const w = 36 + rand() * 60;
			const h = min + rand() * (max - min);
			s += `<rect class="${cls}" x="${x.toFixed(0)}" y="${(base - h).toFixed(0)}" width="${w.toFixed(
				0
			)}" height="${(h + 40).toFixed(0)}"/>`;
			if (windows)
				for (let wy = base - h + 12; wy < base - 8; wy += 17)
					for (let wx = x + 7; wx < x + w - 9; wx += 13)
						if (rand() < 0.3)
							w_ += `<rect class="win" x="${wx.toFixed(0)}" y="${wy.toFixed(
								0
							)}" width="6" height="8"/>`;
			x += w + 4 + rand() * 12;
		}
		return s + w_;
	}

	// each theme's scene. Classes: s1 (far) .. s4 (near), sun, deco, deco2, star, win, line, …
	const SCENES = {
		nile(k, rand) {
			let shine = "";
			for (let i = 0; i < 9; i++) {
				const w = 70 - i * 6;
				shine += `<path class="shine" d="M${1120 - w / 2 + rand() * 10} ${228 + i * 9} h${w}"/>`;
			}
			for (let i = 0; i < 26; i++) {
				const x = rand() * W;
				const y = 236 + rand() * 70;
				shine += `<path class="ripple" d="M${x.toFixed(0)} ${y.toFixed(0)} h${(10 + rand() * 24).toFixed(
					0
				)}"/>`;
			}
			const sail = k.lin("sail", [
				[0, v("sail")],
				[1, v("sail2")],
			]);
			return (
				glow(k, 1120, 150, 48) +
				birds([
					[900, 80],
					[930, 96, 0.8],
					[960, 72, 0.9],
				]) +
				hills(k.layer(1), 210, 5, 2.2, 0.6) +
				palm(330, 216, 74) +
				palm(372, 214, 56) +
				palm(1290, 212, 66) +
				palm(1330, 214, 50) +
				`<rect fill="${k.lin("water", [
					[0, v("s2")],
					[1, v("s4")],
				])}" x="0" y="214" width="${W}" height="${H}"/>` +
				shine +
				`<g class="sail-boat"><path class="deco" d="M690 252 L800 252 L784 266 L708 266 Z"/><path class="line" d="M746 252 L746 146"/><path fill="${sail}" d="M742 248 L742 150 L692 240 Z"/><path fill="${sail}" d="M750 248 L750 158 L798 240 Z"/><path class="reflect" d="M708 270 L784 270 L760 300 L730 300 Z"/></g>` +
				hills(k.layer(3), 284, 4, 7, 2.1) +
				hills(k.layer(4), 304, 4, 9, 0.3)
			);
		},
		sakura(k, rand) {
			let ground = "";
			for (let i = 0; i < 22; i++)
				ground += `<ellipse class="bloom-petal" cx="${(rand() * W).toFixed(0)}" cy="${(
					292 +
					rand() * 22
				).toFixed(0)}" rx="4" ry="2.4"/>`;
			return (
				glow(k, 520, 132, 54) +
				heart(300, 70, 1.1) +
				heart(420, 112, 0.8) +
				heart(1000, 58, 0.9) +
				heart(820, 104, 0.7) +
				sparkle(360, 40, 9) +
				sparkle(940, 120, 7) +
				sparkle(700, 46, 6) +
				`<path fill="${k.layer(1)}" d="M640 236 L860 116 Q900 96 940 116 L1180 236 Z"/>` +
				`<path class="snow" d="M860 116 Q900 96 940 116 L918 132 L904 122 L890 134 L878 124 Z"/>` +
				mist(k, 176, 80) +
				hills(k.layer(2), 236, 16, 2.1, 2.2) +
				hills(k.layer(3), 268, 9, 3, 1) +
				cherry_tree(k, 1200, 300, 1, rand) +
				cherry_tree(k, 380, 290, 0.6, rand) +
				hills(k.layer(4), 298, 5, 4.5, 2.6) +
				ground
			);
		},
		lavender(k, rand) {
			let rows = "";
			const vx = 720;
			const vy = 240;
			const row = k.lin("row", [
				[0, v("row"), 0.35],
				[1, v("row"), 1],
			]);
			for (let i = -16; i <= 16; i++) {
				const top = vx + i * 16;
				const foot = vx + i * 120;
				rows += `<path fill="${row}" d="M${top - 3} ${vy} L${top + 3} ${vy} L${foot + 30} ${H} L${
					foot - 30
				} ${H} Z"/>`;
			}
			return (
				glow(k, 1200, 96, 40, true) +
				stars(30, rand, 8, 170) +
				sparkle(300, 60, 10) +
				sparkle(860, 40, 8) +
				hills(k.layer(1), 200, 12, 1.2, 1.8) +
				`<g class="deco"><circle cx="1010" cy="170" r="20"/><rect x="1008" y="180" width="4" height="22"/><rect x="952" y="182" width="36" height="22"/><path d="M948 184 L970 166 L992 184 Z"/></g><rect class="win" x="966" y="190" width="8" height="8"/>` +
				hills(k.layer(2), 226, 9, 2, 0.4) +
				`<rect fill="${k.layer(4)}" x="0" y="${vy}" width="${W}" height="${H - vy}"/>` +
				rows +
				mist(k, 222, 30) +
				butterfly(420, 150, 1.2) +
				butterfly(980, 120, 0.9) +
				butterfly(640, 110, 0.7)
			);
		},
		desert(k, rand) {
			const pyramid = (x, base, w, h) =>
				`<path fill="${k.lin("lit", [
					[0, mix(v("deco"), "#fff", 80)],
					[1, v("deco")],
				])}" d="M${x - w / 2} ${base} L${x} ${base - h} L${x + w * 0.12} ${base} Z"/><path fill="${k.lin(
					"shade",
					[
						[0, v("deco2")],
						[1, mix(v("deco2"), "#000", 85)],
					]
				)}" d="M${x} ${base - h} L${x + w / 2} ${base} L${x + w * 0.12} ${base} Z"/>`;
			return (
				glow(k, 400, 176, 66) +
				birds(
					[
						[640, 70],
						[668, 84, 0.8],
					],
					"line"
				) +
				hills(k.layer(1), 214, 7, 1.6, 0.2) +
				pyramid(960, 232, 230, 136) +
				pyramid(1150, 236, 166, 98) +
				pyramid(1280, 240, 96, 58) +
				hills(k.layer(2), 252, 10, 1.8, 2.8) +
				ridge("ridge", 252, 10, 1.8, 2.8) +
				camel(560, 246, 0.8) +
				camel(616, 244, 0.7) +
				camel(664, 243, 0.62) +
				palm(300, 280, 92, "line-fill") +
				palm(345, 282, 66, "line-fill") +
				hills(k.layer(3), 280, 9, 2.4, 1.4) +
				ridge("ridge", 280, 9, 2.4, 1.4) +
				hills(k.layer(4), 306, 6, 3, 0.2)
			);
		},
		forest(k, rand) {
			let far = "";
			let near = "";
			const f1 = k.lin("pine1", [
				[0, v("deco")],
				[1, mix(v("deco"), v("s3"), 60)],
			]);
			const f2 = k.lin("pine2", [
				[0, v("deco2")],
				[1, mix(v("deco2"), "#000", 80)],
			]);
			for (let i = 0; i < 28; i++) far += pine(20 + i * 52 + rand() * 20, 262, 44 + rand() * 28, f1);
			for (let i = 0; i < 15; i++) near += pine(30 + i * 98 + rand() * 30, 308, 70 + rand() * 44, f2);
			return (
				glow(k, 1090, 92, 38) +
				birds([
					[600, 70],
					[626, 82, 0.8],
					[652, 66, 0.7],
				]) +
				`<path fill="${k.layer(1)}" d="M0 230 L180 118 L300 188 L460 78 L620 198 L760 118 L900 208 L1060 106 L1220 198 L1340 138 L1440 188 L1440 320 L0 320 Z"/>` +
				`<path class="snow" d="M460 78 L420 106 L444 102 L460 116 L478 100 L500 106 Z M1060 106 L1024 132 L1046 128 L1062 140 L1078 126 L1098 132 Z M180 118 L150 136 L170 134 L182 144 L196 132 L212 138 Z M760 118 L736 134 L752 132 L762 142 L774 130 L786 134 Z"/>` +
				mist(k, 170, 90) +
				hills(k.layer(2), 246, 12, 1.6, 1.1) +
				far +
				mist(k, 240, 40) +
				hills(k.layer(3), 286, 7, 2.2, 2.2) +
				near +
				hills(k.layer(4), 312, 3, 3, 0.7)
			);
		},
		night(k, rand) {
			let reflect = "";
			for (let i = 0; i < 40; i++)
				reflect += `<path class="win-reflect" d="M${(rand() * W).toFixed(0)} ${(
					300 +
					rand() * 18
				).toFixed(0)} h${(6 + rand() * 14).toFixed(0)}"/>`;
			const tower = `<g class="deco"><path d="M992 300 L1008 300 L1004 124 L996 124 Z"/><path d="M984 124 L1016 124 L1020 106 L980 106 Z"/><rect x="986" y="98" width="28" height="8"/><path d="M998 98 L1000 62 L1002 98 Z"/></g><circle class="beacon" cx="1000" cy="60" r="3"/>`;
			return (
				glow(k, 440, 74, 34, true) +
				stars(50, rand, 6, 160) +
				sparkle(620, 50, 9) +
				sparkle(1180, 80, 7) +
				hills(k.layer(1), 210, 14, 1.3, 2) +
				skyline("s2", rand, 268, 30, 90, false) +
				tower +
				skyline("s3", rand, 300, 20, 110, true) +
				`<rect fill="${k.layer(4)}" x="0" y="298" width="${W}" height="30"/>` +
				reflect
			);
		},
		ramadan(k, rand) {
			// the string the bunting and the lanterns hang from: two curves, sagging between three points
			const string_y = (x) => {
				const first = x < 720;
				const t = first ? (x + 20) / 740 : (x - 720) / 740;
				const [a, c] = first ? [30, 40] : [40, 30];
				return (1 - t) ** 2 * a + 2 * (1 - t) * t * 92 + t ** 2 * c;
			};
			const string = `<path class="line" d="M-20 30 Q360 92 720 40 Q1080 92 1460 30"/>`;
			let flags = "";
			const colors = ["flag1", "flag2", "flag3"];
			for (let i = 0; i < 36; i++) {
				const x = -10 + i * 42;
				const y = string_y(x);
				flags += `<path class="${colors[i % 3]}" d="M${x - 10} ${y.toFixed(0)} L${x + 10} ${string_y(
					x + 10
				).toFixed(0)} L${x} ${(y + 20).toFixed(0)} Z"/>`;
			}
			const hang = (x, s) => lantern(k, x, string_y(x) + 40 * s, s);
			return (
				glow(k, 1170, 120, 44, true) +
				sparkle(1250, 96, 12) +
				stars(30, rand, 70, 190) +
				string +
				flags +
				hang(281, 1.1) +
				hang(533, 0.9) +
				hang(911, 0.95) +
				hang(1331, 1) +
				hills(k.layer(1), 230, 10, 1.4, 0.8) +
				mosque(700, 272, 1) +
				mosque(1180, 274, 0.6) +
				mist(k, 240, 40) +
				hills(k.layer(4), 296, 5, 3, 1.2)
			);
		},
		sahel(k, rand) {
			let foam = "";
			for (let i = 0; i < 30; i++)
				foam += `<path class="ripple" d="M${(rand() * W).toFixed(0)} ${(212 + rand() * 50).toFixed(
					0
				)} h${(14 + rand() * 30).toFixed(0)}"/>`;
			const sand = k.lin("sand", [
				[0, v("sand")],
				[1, v("sand2")],
			]);
			return (
				glow(k, 1000, 140, 50) +
				birds([
					[420, 80],
					[452, 94, 0.8],
					[1180, 70, 0.9],
				]) +
				`<rect fill="${k.lin("sea", [
					[0, v("s1")],
					[0.4, v("s2")],
					[1, v("s3")],
				])}" x="0" y="200" width="${W}" height="${H}"/>` +
				`<path class="shine" d="M960 214 h80 M972 224 h56 M984 234 h34"/>` +
				foam +
				`<g class="sail-boat"><path class="deco" d="M560 212 L600 212 L594 218 L566 218 Z"/><path class="sail-w" d="M580 210 L580 172 L562 206 Z"/></g>` +
				hills(sand, 270, 10, 1.2, 0.4) +
				ridge("foam", 270, 10, 1.2, 0.4) +
				umbrella(380, 290, 1, "umb1", "umb2") +
				umbrella(560, 296, 0.85, "umb3", "umb2") +
				umbrella(1120, 292, 0.95, "umb4", "umb2") +
				palm(1320, 300, 110) +
				palm(1370, 302, 80)
			);
		},
		aurora(k, rand) {
			const ribbon = (name, y, amp, phase, color) => {
				const fill = k.lin(name, [
					[0, v(color), 0],
					[0.55, v(color), 0.55],
					[1, v(color), 0],
				]);
				// wider than the drawing, as it drifts from side to side
				const wide = (pts) => [[-60, pts[0][1]], ...pts, [W + 60, pts[pts.length - 1][1]]];
				const top = wide(wave_points(y, amp, 1.6, phase, 40));
				const bottom = wide(wave_points(y + 70, amp * 0.6, 1.6, phase + 0.6, 40)).reverse();
				return `<g class="ribbon"><path fill="${fill}" d="${line_of(top)} ${bottom
					.map(([x, yy]) => `L${x} ${yy.toFixed(1)}`)
					.join(" ")} Z"/></g>`;
			};
			let trees = "";
			const fill = k.lin("tree", [
				[0, v("deco")],
				[1, mix(v("deco"), "#000", 80)],
			]);
			for (let i = 0; i < 30; i++) trees += pine(i * 50 + rand() * 20, 268, 30 + rand() * 26, fill);
			return (
				stars(60, rand, 6, 190) +
				ribbon("r1", 70, 28, 0.2, "r1") +
				ribbon("r2", 100, 22, 1.7, "r2") +
				ribbon("r3", 56, 20, 3.1, "r3") +
				`<circle class="sun" cx="1260" cy="60" r="16"/>` +
				`<path fill="${k.layer(2)}" d="M0 250 L120 170 L220 220 L360 130 L500 230 L640 160 L780 240 L920 150 L1080 230 L1220 160 L1340 220 L1440 180 L1440 320 L0 320 Z"/>` +
				`<path class="snow" d="M360 130 L330 152 L350 148 L362 160 L376 146 L394 152 Z M920 150 L894 170 L912 166 L922 176 L934 164 L950 170 Z M1220 160 L1198 176 L1212 174 L1222 182 L1232 172 L1246 176 Z"/>` +
				mist(k, 200, 60) +
				trees +
				`<rect fill="${k.layer(4)}" x="0" y="266" width="${W}" height="60"/>` +
				`<g opacity="0.35" transform="translate(0 532) scale(1 -1)">${ribbon(
					"r1b",
					70,
					28,
					0.2,
					"r1"
				)}</g>`
			);
		},
		candy(k, rand) {
			let rainbow = "";
			["rb1", "rb2", "rb3", "rb4", "rb5", "rb6"].forEach((c, i) => {
				const r = 230 - i * 14;
				rainbow += `<path class="arc" style="stroke:${v(c)}" d="M${900 - r} 300 A${r} ${r} 0 0 1 ${
					900 + r
				} 300"/>`;
			});
			return (
				glow(k, 380, 90, 34) +
				sparkle(420, 50, 9) +
				sparkle(1300, 60, 8) +
				sparkle(640, 130, 6) +
				heart(560, 70, 0.9) +
				heart(1180, 120, 0.8) +
				`<g class="rainbow">${rainbow}</g>` +
				cloud(k, 180, 170, 1.1) +
				cloud(k, 1240, 150, 1.3) +
				cloud(k, 760, 110, 0.7) +
				balloon(k, 560, 140, 0.9, "b1", "b2") +
				balloon(k, 1080, 90, 0.7, "b4", "b3") +
				hills(k.layer(3), 270, 14, 1.6, 0.9) +
				cloud(k, 960, 262, 1.6) +
				cloud(k, 80, 272, 1.4) +
				hills(k.layer(4), 300, 6, 3, 2.2)
			);
		},
	};

	// what falls in front of a scene, for the themes that have it
	const FALLING = { sakura: "petal", lavender: "sparkle-dot", candy: "sparkle-dot", ramadan: "sparkle-dot" };

	// the styles with soft color blobs drifting behind the glass, and the font each one loads
	const AURORA = ["prism"];
	// the calm styles share one font: Manrope, and IBM Plex Sans Arabic for Arabic
	const CALM_FONT =
		"https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";
	const FONTS = {
		prism: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap",
		sage: CALM_FONT,
		mint: CALM_FONT,
		linen: CALM_FONT,
		mist: CALM_FONT,
	};

	// the themes, in the three groups Switch Theme shows them in. A business theme and a style
	// re-color the desk (plain and exact, or warm and round); a scene adds a sky and a drawing to
	// Frappe's own surfaces.
	T.GROUPS = [
		{
			name: "business",
			label: __("Nexlify Business"),
			hint: __("A bookkeeping app's desk: a dark sidebar, white pages and one clear color."),
			themes: [
				{ name: "ledger", label: __("Ledger"), info: __("A navy sidebar, white pages and blue") },
				{ name: "slate", label: __("Slate"), info: __("A graphite sidebar, white pages and green") },
				{ name: "indigo", label: __("Indigo"), info: __("A violet sidebar and indigo") },
				{ name: "teal", label: __("Teal"), info: __("A pine sidebar and teal") },
				{ name: "ember", label: __("Ember"), info: __("A stone sidebar and orange") },
				{ name: "custom", label: __("Custom"), info: __("Your own accent and sidebar colors") },
			],
		},
		{
			name: "style",
			label: __("Nexlify Styles"),
			hint: __("The desk re-colored: paper, cards, buttons and the Kanban, in light and in dark."),
			themes: [
				{ name: "warm", label: __("Warm"), info: __("Cream paper, navy ink and terracotta") },
				{ name: "rose", label: __("Rose"), info: __("Blush, lilac and rose buttons") },
				{ name: "ocean", label: __("Ocean"), info: __("Pale water, deep blue ink and teal") },
				{ name: "prism", label: __("Prism"), info: __("Glass over drifting color, indigo and violet") },
				{ name: "sage", label: __("Sage"), info: __("Quiet gray-green paper, white cards and forest green") },
				{ name: "mint", label: __("Mint"), info: __("Fresh mint paper, white cards and emerald") },
				{ name: "linen", label: __("Linen"), info: __("Soft linen paper, white cards and olive green") },
				{ name: "mist", label: __("Mist"), info: __("Cool gray paper, white cards and slate blue") },
			],
		},
		{
			name: "scene",
			label: __("Nexlify Scenes"),
			hint: __("A color and a drawing over Frappe's own theme, in light and in dark."),
			themes: [
				{ name: "sakura", label: __("Sakura"), info: __("Pink blossoms, hearts and falling petals") },
				{ name: "candy", label: __("Cotton Candy"), info: __("Clouds, a rainbow and hot-air balloons") },
				{ name: "lavender", label: __("Lavender"), info: __("Lilac fields, a cottage and butterflies") },
				{ name: "nile", label: __("Nile"), info: __("A felucca on the Nile at sunset") },
				{ name: "sahel", label: __("Sahel"), info: __("The sea, the sand and beach umbrellas") },
				{ name: "desert", label: __("Desert Sunset"), info: __("The pyramids and a caravan") },
				{ name: "ramadan", label: __("Ramadan"), info: __("Lanterns, bunting and the crescent") },
				{ name: "forest", label: __("Forest"), info: __("Misty mountains and pines") },
				{ name: "aurora", label: __("Aurora"), info: __("Northern lights over the mountains") },
				{ name: "night", label: __("Cairo Nights"), info: __("The city and Cairo Tower under the moon") },
			],
		},
	];
	// the colors the Custom business theme offers before any other: six accents and six sidebars
	// (blue, green, red and orange first, as a bookkeeping app offers them)
	T.ACCENTS = ["#408dfb", "#22b07d", "#f0483e", "#f7941d", "#4f46e5", "#0d9488"];
	T.SIDEBARS = ["#1f2437", "#1f1d4a", "#10302e", "#292524", "#3b0a3f", "#0f172a"];
	const COLOR_DEFAULTS = { accent: "#408dfb", sidebar: "#1f2437" };

	T.GROUPS.forEach((group) => group.themes.forEach((theme) => (theme.kind = group.name)));
	T.THEMES = T.GROUPS.flatMap((group) => group.themes);
	const kind_of = (name) => (T.THEMES.find((theme) => theme.name === name) || {}).kind || "";

	// what a user sees before they pick: the site's own look (Nexlify Theme Settings), and
	// whether the themes are on at all. "none" is Frappe as it is, chosen.
	const SITE = (frappe.boot && frappe.boot.nexlify_themes) || { enabled: 1, default: "ledger", dock_labels: 1 };
	T.ENABLED = !!SITE.enabled;
	T.DEFAULT = SITE.default === "none" ? "" : SITE.default;
	T.NONE = "none";

	T.scene_svg = function (name, cls = "nxt-scene-svg") {
		const draw = SCENES[name];
		if (!draw) return "";
		const k = canvas();
		const body = draw(k, seeded(7));
		return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs>${k.defs.join(
			""
		)}</defs>${body}</svg>`;
	};

	function falling(name) {
		const kind = FALLING[name];
		if (!kind) return "";
		const rand = seeded(11);
		let s = "";
		for (let i = 0; i < 16; i++) {
			s += `<span class="${kind}" style="left:${(rand() * 100).toFixed(1)}%;animation-delay:${(
				rand() * -18
			).toFixed(1)}s;animation-duration:${(12 + rand() * 10).toFixed(1)}s;--drift:${(
				rand() * 160 -
				60
			).toFixed(0)}px;--size:${(0.7 + rand() * 0.7).toFixed(2)}"></span>`;
		}
		return `<div class="nxt-fall">${s}</div>`;
	}


	// a style's preview card: a little desk in its colors
	function style_preview_html() {
		return `<div class="nxt-style-preview"><div class="sb"></div><div class="main"><div class="card"></div><div class="card"></div><div class="pill"></div></div></div>`;
	}

	T.preview_html = function (name) {
		if (kind_of(name) === "scene") return T.scene_svg(name, "nxt-theme-preview-svg");
		// a style, a business theme, and None (Frappe's own grays, from the CSS)
		return style_preview_html();
	};

	function falling(name) {
		const kind = FALLING[name];
		if (!kind) return "";
		const rand = seeded(11);
		let s = "";
		for (let i = 0; i < 16; i++) {
			s += `<span class="${kind}" style="left:${(rand() * 100).toFixed(1)}%;animation-delay:${(
				rand() * -18
			).toFixed(1)}s;animation-duration:${(12 + rand() * 10).toFixed(1)}s;--drift:${(
				rand() * 160 -
				60
			).toFixed(0)}px;--size:${(0.7 + rand() * 0.7).toFixed(2)}"></span>`;
		}
		return `<div class="nxt-fall">${s}</div>`;
	}

	// a theme's own font, fetched once, the first time a theme that uses it is put on the page
	function load_font(name) {
		const href = FONTS[name];
		if (!href || [...document.querySelectorAll("link[data-nexlify-font]")].some((l) => l.href === href)) return;
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		link.setAttribute("data-nexlify-font", name);
		document.head.appendChild(link);
	}

	T.current = function () {
		return document.documentElement.getAttribute("data-nexlify-theme") || "";
	};

	// the theme the user's default asks for: theirs, the site's when they have none, nothing for "none"
	T.chosen = function () {
		const stored = frappe.defaults.get_user_default("nexlify_theme") || "";
		if (stored === T.NONE) return "";
		return kind_of(stored) ? stored : T.DEFAULT;
	};

	// put `name` on the page (or take the theme away, for none)
	T.apply = function (name) {
		const root = document.documentElement;
		const kind = kind_of(name);
		if (!kind) name = "";
		document.querySelectorAll(".nxt-scene, .nxt-aurora").forEach((el) => el.remove());
		if (!name) {
			root.removeAttribute("data-nexlify-theme");
			root.removeAttribute("data-nexlify-kind");
			root.removeAttribute("data-nexlify-pane");
			return;
		}
		root.setAttribute("data-nexlify-theme", name);
		root.setAttribute("data-nexlify-kind", kind);
		root.setAttribute("data-nexlify-pane", T.pane());
		apply_colors(T.colors());
		load_font(name);
		if (AURORA.includes(name)) {
			const aurora = document.createElement("div");
			aurora.className = "nxt-aurora";
			aurora.setAttribute("aria-hidden", "true");
			aurora.innerHTML = "<i></i><i></i><i></i>";
			document.body.prepend(aurora);
		}
		if (kind !== "scene") return;
		const scene = document.createElement("div");
		scene.className = "nxt-scene";
		scene.setAttribute("aria-hidden", "true");
		scene.innerHTML = T.scene_svg(name) + falling(name);
		document.body.prepend(scene);
	};

	T.set = function (name) {
		T.apply(name);
		const stored = name || T.NONE;
		frappe.boot.user.defaults.nexlify_theme = stored;
		return frappe.xcall("nexlify_core.nexlify_core.themes.set_theme", { theme: stored });
	};

	// the user's own colors for the Custom business theme (the defaults until they pick)
	const HEX = /^#[0-9a-f]{6}$/i;
	T.colors = function () {
		const d = frappe.boot.user.defaults || {};
		return {
			accent: HEX.test(d.nexlify_accent || "") ? d.nexlify_accent : COLOR_DEFAULTS.accent,
			sidebar: HEX.test(d.nexlify_sidebar || "") ? d.nexlify_sidebar : COLOR_DEFAULTS.sidebar,
		};
	};

	// put the colors on the root for the Custom theme's CSS, with the ink the sidebar can carry
	function apply_colors({ accent, sidebar }) {
		const root = document.documentElement.style;
		root.setProperty("--nxt-user-accent", accent);
		root.setProperty("--nxt-user-sidebar", sidebar);
		root.setProperty("--nxt-user-side-ink", luminance(sidebar) > 0.5 ? "#1b1e2b" : "#ffffff");
	}
	function luminance(hex) {
		const n = parseInt(hex.slice(1), 16);
		const c = [16, 8, 0].map((s) => {
			const v = ((n >> s) & 255) / 255;
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	}

	// keep the user's colors and put them on the page; the theme becomes Custom
	T.set_colors = function (colors) {
		Object.assign(frappe.boot.user.defaults, { nexlify_accent: colors.accent, nexlify_sidebar: colors.sidebar });
		apply_colors(colors);
		return frappe.xcall("nexlify_core.nexlify_core.themes.set_theme_colors", colors);
	};

	// a business theme's sidebar: the dark pane (the theme's own sidebar color) or a light one
	T.PANES = ["dark", "light"];
	T.pane = function () {
		const pane = (frappe.boot.user.defaults || {}).nexlify_pane;
		return T.PANES.includes(pane) ? pane : "dark";
	};
	T.set_pane = function (pane) {
		frappe.boot.user.defaults.nexlify_pane = pane;
		document.documentElement.setAttribute("data-nexlify-pane", pane);
		return frappe.xcall("nexlify_core.nexlify_core.themes.set_theme_pane", { pane });
	};

	// the picker under the business themes: swatches for the accent and the sidebar, and a well for
	// any other color. Picking one keeps the colors and selects Custom (through `select`).
	function color_picker(select) {
		const colors = T.colors();
		const row = (key, swatches) => {
			const chosen = colors[key];
			const own = swatches.includes(chosen) ? "" : chosen;
			return `<div class="nxt-color-row" data-key="${key}">${swatches
				.map(
					(c) =>
						`<button type="button" class="nxt-swatch${c === chosen ? " selected" : ""}" style="--swatch:${c}" data-color="${c}" aria-label="${c}"></button>`
				)
				.join("")}<span class="nxt-color-well${own ? " has-color" : ""}" style="--swatch:${own || "#888"}" title="${__(
				"Any color"
			)}"><input type="color" value="${chosen}" aria-label="${__("Any color")}"></span></div>`;
		};
		const pane = T.pane();
		const pane_card = (name, label) =>
			`<button type="button" class="nxt-pane${name === pane ? " selected" : ""}" data-pane="${name}">
				<span class="nxt-pane-preview nxt-pane-${name}"><i></i><b></b></span>${label}
			</button>`;
		const $picker = $(`<div class="nxt-color-picker">
			<label>${__("Pane")}</label><div class="nxt-pane-row">${pane_card("dark", __("Dark Pane"))}${pane_card(
				"light",
				__("Light Pane")
			)}</div>
			<label>${__("Accent")}</label>${row("accent", T.ACCENTS)}
			<label>${__("Sidebar")}</label>${row("sidebar", T.SIDEBARS)}
		</div>`);
		// the pane goes with any business theme; from another kind it brings the first business theme
		$picker.on("click", ".nxt-pane", (e) => {
			const name = e.currentTarget.dataset.pane;
			$picker.find(".nxt-pane").each((_, el) => $(el).toggleClass("selected", el.dataset.pane === name));
			T.set_pane(name);
			if (kind_of(T.current()) !== "business") select("ledger");
		});
		const pick = ($row, color) => {
			const next = Object.assign(T.colors(), { [$row.data("key")]: color });
			$row.find(".nxt-swatch").each((_, el) => $(el).toggleClass("selected", el.dataset.color === color));
			const $well = $row.find(".nxt-color-well");
			const own = !$row.find(`.nxt-swatch[data-color="${color}"]`).length;
			$well.toggleClass("has-color", own).css("--swatch", own ? color : "#888");
			$well.find("input").val(color);
			T.set_colors(next);
			if (T.current() !== "custom") select("custom");
		};
		$picker.on("click", ".nxt-swatch", (e) => pick($(e.target).closest(".nxt-color-row"), e.target.dataset.color));
		$picker.on("input", "input[type=color]", (e) => pick($(e.target).closest(".nxt-color-row"), e.target.value));
		return $picker;
	}

	// the Nexlify groups under Frappe's own cards, wherever Switch Theme shows them
	function add_to_switcher() {
		const Switcher = frappe.ui.ThemeSwitcher;
		if (!Switcher || Switcher.prototype._nexlify_themes) return;
		Switcher.prototype._nexlify_themes = true;
		const render = Switcher.prototype.render;
		Switcher.prototype.render = function () {
			render.call(this);
			(this.$nexlify || []).forEach(($s) => $s.remove());
			this.$nexlify = [];
			const $cards = [];
			const select = (name) => {
				$cards.forEach(($c) => $c.toggleClass("selected", $c.data("theme") === name));
				T.set(name);
			};
			const card = (theme) => {
				const $card = $(`<div class="nxt-theme-card${T.current() === theme.name ? " selected" : ""}">
					<button type="button" class="nxt-theme-button" title="${frappe.utils.escape_html(theme.info)}">
						<div class="nxt-theme-preview" ${
							theme.name ? `data-nexlify-theme="${theme.name}" data-nexlify-kind="${theme.kind}"` : ""
						}>
							${T.preview_html(theme.name)}
							<span class="nxt-theme-swatch"></span>
						</div>
						<div class="nxt-theme-footer">
							<span class="nxt-theme-label">${frappe.utils.escape_html(theme.label)}</span>
							<span class="theme-card-radio"></span>
						</div>
					</button>
				</div>`);
				$card.data("theme", theme.name);
				$card.on("click", () => T.current() !== theme.name && select(theme.name));
				$cards.push($card);
				return $card;
			};
			let $after = this.body;
			T.GROUPS.forEach((group, i) => {
				const $section = $(`<div class="nxt-theme-section">
					<div class="nxt-theme-heading">${group.label}</div>
					<div class="nxt-theme-hint">${group.hint}</div>
					<div class="nxt-theme-grid"></div>
				</div>`);
				const $grid = $section.find(".nxt-theme-grid");
				// "None" sits with the first group: Frappe as it is
				if (i === 0) $grid.append(card({ name: "", label: __("None"), info: __("Frappe as it is") }));
				group.themes.forEach((theme) => $grid.append(card(theme)));
				if (group.name === "business") $section.append(color_picker(select));
				$after.after($section);
				$after = $section;
				this.$nexlify.push($section);
			});
		};
	}

	// the names under the dock's icons, with or without a theme (Nexlify Theme Settings > Dock)
	$(() => document.body.classList.toggle("nxt-dock-labels", !!SITE.dock_labels));

	// turned off for the site: no theme on the page and none offered in Switch Theme
	if (!T.ENABLED) return;
	add_to_switcher();
	$(() => T.apply(T.chosen()));
})();
