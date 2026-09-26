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

	const $btn = $(`<button id="nx-raven-btn" title="${__("Chat")}">${chatIcon}</button>`).appendTo("body");

	$btn.on("click", () => {
		const $frame = $panel.find("iframe");
		if (!$frame.attr("src")) $frame.attr("src", "/raven");
		$panel.toggleClass("open");
	});
	$panel.find(".nx-close").on("click", () => $panel.removeClass("open"));
});
