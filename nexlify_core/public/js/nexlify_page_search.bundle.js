// Search box in every page's header (Nexlify Core Settings > Search Box in Page Header, off until ticked): a
// box before the page's buttons that opens Frappe's own search (the awesome bar, Ctrl+K), with what was typed.
// Nothing of its own: the search is Frappe's, the look its Search control's.
(() => {
	const SHORTCUT = frappe.utils.is_mac() ? "⌘K" : "Ctrl+K";

	// Frappe's search: the dock's Search button (or the desktop's Search widget) opens it
	function open_search(text) {
		const trigger = document.querySelector(".navbar-modal-search-mobile, #search-widget-button");
		if (!trigger) return;
		trigger.click();
		if (!text) return;
		setTimeout(() => {
			const input = document.querySelector("#navbar-search");
			if (!input) return;
			input.value = text;
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}, 40);
	}

	function make_box() {
		const box = document.createElement("div");
		box.className = "nexlify-page-search hidden-xs";
		box.style.cssText = "position:relative;width:240px;margin-inline-end:8px;flex:none";
		box.innerHTML = `
			<span style="position:absolute;inset-inline-start:8px;top:50%;transform:translateY(-50%);display:flex;z-index:1;pointer-events:none;color:var(--ink-gray-5, var(--text-muted))">${frappe.utils.icon("search", "sm")}</span>
			<input type="text" class="form-control input-sm" autocomplete="off"
				aria-label="${__("Search")}" placeholder="${__("Search")} (${SHORTCUT})"
				style="padding-inline-start:28px">`;
		const input = box.querySelector("input");
		// a key typed here goes on in Frappe's search box
		input.addEventListener("input", () => {
			const text = input.value;
			input.value = "";
			input.blur();
			open_search(text);
		});
		input.addEventListener("mousedown", (e) => {
			e.preventDefault();
			open_search("");
		});
		return box;
	}

	function add_to_page() {
		document.querySelectorAll(".page-head .page-actions").forEach((actions) => {
			if (actions.querySelector(":scope > .nexlify-page-search")) return;
			actions.prepend(make_box());
		});
	}

	$(document).on("page-change", () => {
		if (!(frappe.boot && frappe.boot.nexlify_page_search)) return;
		// the page's header is drawn with the page
		setTimeout(add_to_page, 0);
		setTimeout(add_to_page, 400);
	});
})();
