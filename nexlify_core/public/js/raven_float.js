window.nxRavenSounds = (() => {
	let ctx;
	const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
	const tone = (freq, start, dur, vol, type = "sine", toFreq) => {
		const c = ac(), t = c.currentTime + start;
		const o = c.createOscillator(), g = c.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(c.destination);
		o.start(t); o.stop(t + dur + 0.05);
	};
	const sounds = {
		"Ding": (v) => tone(880, 0, 0.5, v),
		"Chime": (v) => { tone(659, 0, 0.35, v); tone(988, 0.15, 0.6, v); },
		"Pop": (v) => tone(400, 0, 0.09, v, "sine", 900),
		"Bell": (v) => { tone(523, 0, 1.4, v); tone(1046, 0, 1, v * 0.5); tone(1568, 0, 0.6, v * 0.25); },
		"Triple Beep": (v) => [0, 0.14, 0.28].forEach((s) => tone(1000, s, 0.09, v * 0.35, "square")),
		"Soft": (v) => { tone(523, 0, 0.4, v * 0.8, "triangle"); tone(659, 0.12, 0.5, v * 0.8, "triangle"); },
		"Marimba": (v) => { tone(440, 0, 0.35, v); tone(1760, 0, 0.08, v * 0.4); },
	};
	const play = (name, volume = 50, customUrl = "") => {
		if (!volume) return;
		const v = volume / 100;
		if (name === "Custom" && customUrl) {
			const a = new Audio(customUrl); a.volume = v;
			return a.play().catch(() => {});
		}
		if (sounds[name]) {
			try { ac().resume(); sounds[name](v); } catch (e) {}
			return;
		}
		frappe.utils.play_sound("raven_notification");
	};
	return { names: Object.keys(sounds), play };
})();

$(document).on("app_ready", () => {
	if (!frappe.boot.nx_raven_float) return;
	if (frappe.session.user === "Guest" || $("#nx-raven-btn").length) return;

	$("<style>").text(`
		#nx-raven-btn {
			position: fixed; bottom: 20px; inset-inline-end: 20px; z-index: 1030;
			width: 52px; height: 52px; border-radius: 50%; border: none;
			background: var(--primary); color: #fff; cursor: pointer;
			box-shadow: var(--shadow-lg); display: flex; align-items: center; justify-content: center;
			transition: transform .15s;
		}
		#nx-raven-btn:hover { transform: scale(1.07); }
		#nx-raven-badge {
			position: absolute; top: -4px; inset-inline-end: -4px; min-width: 20px; height: 20px;
			padding: 0 5px; border-radius: 10px; background: var(--red-500, #e03636); color: #fff;
			font-size: 11px; font-weight: 700; line-height: 20px; text-align: center;
			border: 2px solid var(--bg-color); display: none;
		}
		#nx-raven-panel {
			position: fixed; bottom: 84px; inset-inline-end: 20px; z-index: 1030;
			width: 420px; height: 75vh; max-width: calc(100vw - 40px);
			background: var(--card-bg); border: 1px solid var(--border-color);
			border-radius: var(--border-radius-lg); box-shadow: var(--shadow-lg);
			display: none; flex-direction: column; overflow: hidden;
		}
		#nx-raven-panel.open { display: flex; }
		#nx-raven-panel .nx-head {
			display: flex; justify-content: space-between; align-items: center;
			padding: 8px 12px; border-bottom: 1px solid var(--border-color);
			font-weight: 600; color: var(--heading-color);
		}
		#nx-raven-panel .nx-head a, #nx-raven-panel .nx-head button {
			background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 6px;
		}
		#nx-raven-panel iframe { flex: 1; border: 0; width: 100%; }
	`).appendTo("head");

	const chatIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

	const $panel = $(`
		<div id="nx-raven-panel">
			<div class="nx-head">
				<span>Raven</span>
				<div>
					<a href="/raven" target="_blank" title="${__("Open in new tab")}">↗</a>
					<button class="nx-close" title="${__("Close")}">✕</button>
				</div>
			</div>
			<iframe></iframe>
		</div>`).appendTo("body");

	const $btn = $(`<button id="nx-raven-btn" title="${__("Chat")}">${chatIcon}<span id="nx-raven-badge"></span></button>`).appendTo("body");
	const $badge = $("#nx-raven-badge");
	const isOpen = () => $panel.hasClass("open");

	// ---- unread counter ----
	let refreshTimer = null;
	const refreshUnread = () => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			frappe.call({
				method: "raven.api.raven_message.get_unread_count_for_channels",
				type: "GET",
				callback: (r) => {
					const total = (r.message || []).reduce((s, c) => s + (c.unread_count || 0), 0);
					$badge.text(total > 99 ? "99+" : total).toggle(total > 0);
				},
			});
		}, 400);
	};

	// ---- browser notification ----
	const notify = (data) => {
		if (isOpen() || !("Notification" in window) || Notification.permission !== "granted") return;
		const sender = frappe.user.full_name(data.sent_by) || data.sent_by;
		const n = new Notification(sender, {
			body: __("New message on Raven"),
			icon: "/assets/raven/raven-logo.png",
			tag: "nx-raven-" + data.channel_id,
		});
		n.onclick = () => { window.focus(); openPanel(); n.close(); };
	};

	// ---- realtime ----
	frappe.realtime.doctype_subscribe("Raven User"); // channel messages are published to this room
	frappe.realtime.on("raven:unread_channel_count_updated", (data) => {
		refreshUnread();
		if (data && data.sent_by !== frappe.session.user && data.event_type !== "message_edited"
			&& data.event_type !== "message_deleted") {
			if (data.play_sound || !data.is_dm_channel) nxRavenSounds.play(frappe.boot.nx_raven_sound_type, frappe.boot.nx_raven_volume, frappe.boot.nx_raven_sound);
			notify(data);
		}
	});
	frappe.realtime.on("raven_mention", () => refreshUnread());

	// ---- panel ----
	const openPanel = () => {
		const $frame = $panel.find("iframe");
		if (!$frame.attr("src")) $frame.attr("src", "/raven");
		$panel.addClass("open");
	};
	const closePanel = () => { $panel.removeClass("open"); refreshUnread(); };

	$btn.on("click", () => {
		if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
		isOpen() ? closePanel() : openPanel();
	});
	$panel.find(".nx-close").on("click", closePanel);

	refreshUnread();
	setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000); // fallback if socket drops
});
