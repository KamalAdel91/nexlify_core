// Full Screen button in every page's header (Nexlify Core Settings > Full Screen Button, off until ticked).
// A click hides the side menus: Frappe's apps dock, its sidebar and the page's own sidebar (Assign, Attachments...),
// and turns on Frappe's Full Width, so the page takes the whole width. In full screen the same button opens a menu
// to show each menu again, or to leave full screen. Nothing is drawn or changed until the user clicks: the menus are
// only hidden by one class on <body>, and the choice is kept in this browser.
(() => {
	const KEY = "nexlify-full-screen";
	const PARTS = [
		{ key: "dock", label: () => __("Apps") },
		{ key: "sidebar", label: () => __("Sidebar") },
		{ key: "page_sidebar", label: () => __("Page Sidebar") },
	];

	function enabled() {
		return !!(frappe.boot && frappe.boot.nexlify_focus_mode);
	}

	// { on, shown: { dock, sidebar, page_sidebar } }; storage can be missing or refuse, then it is off
	function load() {
		try {
			const state = JSON.parse(localStorage.getItem(KEY) || "{}");
			return { on: !!state.on, shown: state.shown || {} };
		} catch {
			return { on: false, shown: {} };
		}
	}

	function save(state) {
		try {
			localStorage.setItem(KEY, JSON.stringify(state));
		} catch {
			// nothing to keep it in; it lasts until the page is reloaded
		}
	}

	let state = load();

	function apply() {
		const on = enabled() && state.on;
		document.body.classList.toggle("nexlify-full-screen", on);
		PARTS.forEach((part) => {
			document.body.classList.toggle(`nexlify-full-screen-show-${part.key}`, on && !!state.shown[part.key]);
		});
		// the page fills the room: Frappe's own Full Width while full screen is on, the user's saved choice after it
		if (on) document.body.classList.add("full-width");
		else frappe.ui.toolbar.set_fullwidth_if_enabled();
		draw_buttons();
	}

	function set_state(next) {
		state = next;
		save(state);
		apply();
	}

	function enter() {
		set_state({ on: true, shown: {} });
	}

	function leave() {
		set_state({ on: false, shown: {} });
	}

	function toggle_part(key) {
		set_state({ on: true, shown: { ...state.shown, [key]: !state.shown[key] } });
	}

	function make_button() {
		const on = state.on;
		const title = on ? __("Full Screen: show a menu or leave") : __("Full Screen");
		const wrapper = document.createElement("div");
		wrapper.className = "nexlify-full-screen-btn dropdown hidden-xs hidden-sm";

		const button = document.createElement("button");
		button.type = "button";
		button.className = "btn btn-default icon-btn";
		button.title = title;
		button.setAttribute("aria-label", title);
		button.innerHTML = frappe.utils.icon(on ? "minimize" : "maximize", "sm");
		wrapper.appendChild(button);

		if (!on) {
			button.addEventListener("click", enter);
			return wrapper;
		}

		button.setAttribute("data-toggle", "dropdown");
		button.setAttribute("aria-haspopup", "true");
		button.setAttribute("aria-expanded", "false");
		const menu = document.createElement("div");
		menu.className = "dropdown-menu dropdown-menu-right";
		const check = frappe.utils.icon("check", "sm");
		menu.innerHTML =
			PARTS.map(
				(part) => `
				<a class="dropdown-item" href="#" data-part="${part.key}">
					<span class="nexlify-full-screen-check">${state.shown[part.key] ? check : ""}</span>
					<span>${frappe.utils.escape_html(part.label())}</span>
				</a>`
			).join("") +
			`<div class="dropdown-divider"></div>
			<a class="dropdown-item" href="#" data-part="leave">
				<span class="nexlify-full-screen-check">${frappe.utils.icon("maximize", "sm")}</span>
				<span>${__("Leave Full Screen")}</span>
			</a>`;
		menu.addEventListener("click", (e) => {
			const item = e.target.closest("[data-part]");
			if (!item) return;
			e.preventDefault();
			const part = item.getAttribute("data-part");
			part === "leave" ? leave() : toggle_part(part);
		});
		wrapper.appendChild(menu);
		return wrapper;
	}

	// every page has its own header; each gets the button first in its standard actions
	function draw_buttons() {
		document.querySelectorAll(".page-head .standard-actions").forEach((actions) => {
			actions.querySelectorAll(":scope > .nexlify-full-screen-btn").forEach((old) => old.remove());
			if (enabled()) actions.prepend(make_button());
		});
	}

	$(document).on("page-change", () => {
		if (!enabled()) return;
		// the page's header is drawn with the page
		setTimeout(apply, 0);
		setTimeout(draw_buttons, 400);
	});
	$(document).on("app_ready", apply);
})();
