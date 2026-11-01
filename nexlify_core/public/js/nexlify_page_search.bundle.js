// Search box in the middle of every page's header (Nexlify Core Settings > Search Box in Page Header, off until
// ticked). It opens Frappe's Global Search (Ctrl+G) with what was typed, searching the page's DocType when Global
// Search has it (its DocType filter, which the dialog widens to all again); elsewhere, everything. Nothing of its
// own: the search and its results are Frappe's.
(() => {
	const SHORTCUT = frappe.utils.is_mac() ? "⌘G" : "Ctrl+G";

	// the DocType the page is about: a list, board or report view of it, or one of its documents
	function page_doctype() {
		const route = frappe.get_route() || [];
		if (["List", "Form"].includes(route[0]) && route[1]) return route[1];
		if (route[0] === "query-report" && frappe.query_report && frappe.query_report.report_doc) {
			return frappe.query_report.report_doc.ref_doctype || null;
		}
		return null;
	}

	function open_search(text) {
		const dialog = frappe.searchdialog && frappe.searchdialog.search;
		if (!dialog) return;
		dialog.open_global_search_dialog(text);
		const doctype = page_doctype();
		if (!doctype) return;
		// only a DocType Global Search has (Global Search Settings): another would find nothing
		dialog.ensure_global_search_allowed_doctypes().then(() => {
			if (!(dialog._cached_global_search_allowed || []).includes(doctype)) return;
			if ((text || "").trim().length > 1) dialog.apply_global_doctype_filter(doctype);
			else dialog.global_doctype_filter = doctype;
		});
	}

	function make_box() {
		const doctype = page_doctype();
		const label = doctype ? __("Search in {0}", [__(doctype)]) : __("Search everywhere");
		const box = document.createElement("div");
		box.className = "nexlify-page-search hidden-xs";
		// the middle of the header, between the title and the buttons
		box.style.cssText = "flex:1 1 auto;display:flex;justify-content:center;min-width:0;padding:0 12px";
		box.innerHTML = `
			<div style="position:relative;width:100%;max-width:420px">
				<span style="position:absolute;inset-inline-start:8px;top:50%;transform:translateY(-50%);display:flex;z-index:1;pointer-events:none;color:var(--ink-gray-5, var(--text-muted))">${frappe.utils.icon("search", "sm")}</span>
				<input type="text" class="form-control input-sm" autocomplete="off"
					aria-label="${frappe.utils.escape_html(label)}"
					placeholder="${frappe.utils.escape_html(label)} (${SHORTCUT})"
					style="padding-inline-start:28px">
			</div>`;
		const input = box.querySelector("input");
		// a key typed here goes on in Global Search's box
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
		document.querySelectorAll(".page-head .page-title").forEach((title) => {
			const row = title.parentElement;
			// the box says the page's DocType: drawn again when another page is shown in this header
			row.querySelectorAll(":scope > .nexlify-page-search").forEach((old) => old.remove());
			title.insertAdjacentElement("afterend", make_box());
		});
	}

	$(document).on("page-change", () => {
		if (!(frappe.boot && frappe.boot.nexlify_page_search)) return;
		// the page's header is drawn with the page
		setTimeout(add_to_page, 0);
		setTimeout(add_to_page, 400);
	});
})();
