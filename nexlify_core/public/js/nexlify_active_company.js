// Active Company (desk side).
//
// Everything that keeps records apart is on the server
// (nexlify_core/nexlify_core/active_company.py). This file only makes the desk
// reflect it: a pill showing the active company with a switcher, the Company
// field filled and locked on forms, and the Company filter locked on query
// reports. The dashboard filter bar locks itself in nexlify_dashboard_filter.js.
(function () {
	const state = (window.frappe && frappe.boot && frappe.boot.nexlify_active_company) || null;
	if (!state || !state.applies || !state.company) return;

	const company = state.company;
	const scope = state.scope && state.scope.length ? state.scope : [company];
	const is_group = scope.length > 1;
	const excluded = new Set(state.excluded_doctypes || []);
	const company_query = () => ({ filters: { name: ["in", scope] } });

	// ---------- forms: Company follows the active company ----------
	$(document).on("form-refresh", (e, frm) => {
		if (!frm || excluded.has(frm.doctype)) return;
		const field = frm.fields_dict && frm.fields_dict.company;
		if (!field || field.df.fieldtype !== "Link" || field.df.options !== "Company") return;

		if (is_group) {
			// A group session: documents still belong to one real company, so
			// the field stays open but only offers companies in the group.
			frm.set_query("company", company_query);
			if (frm.is_new() && frm.doc.company && !scope.includes(frm.doc.company)) {
				frm.set_value("company", "");
			}
			return;
		}

		if (frm.is_new() && frm.doc.company !== company) {
			frm.set_value("company", company);
		}
		frm.set_df_property("company", "read_only", 1);
	});

	// ---------- query reports: lock the Company filter ----------
	$(document).on("page-change", () => {
		const route = frappe.get_route();
		if (route[0] !== "query-report") return;

		let attempts = 0;
		const poll = setInterval(() => {
			attempts++;
			const qr = frappe.query_report;
			const filter =
				qr && qr.report_name === route[1]
					? (qr.filters || []).find((f) => f.df && f.df.fieldname === "company")
					: null;

			if (filter) {
				clearInterval(poll);
				if (filter.df.fieldtype !== "Link") return;
				if (is_group) {
					// Any company in the group; the server enforces the same rule.
					filter.df.get_query = company_query;
					if (!scope.includes(filter.get_value())) filter.set_value(company);
					return;
				}
				if (filter.get_value() !== company) filter.set_value(company);
				filter.df.read_only = 1;
				filter.refresh();
			} else if (attempts >= 40) {
				clearInterval(poll);
			}
		}, 150);
	});

	// ---------- the pill and the switcher ----------
	// v16 has no top navbar, so the pill sits in each page's own head, before
	// the page actions: a slot Frappe keeps for buttons, so nothing shifts.
	function make_button() {
		// Built exactly like the List View switcher (frappe.ui.button + dress),
		// so it takes the theme's button look in light and dark mode.
		let pill;
		if (frappe.ui.button && frappe.ui.button.dress) {
			pill = frappe.ui.button({ css_class: "ellipsis nx-ac-pill" });
			frappe.ui.button.dress(pill, {
				label: is_group ? __("{0} · {1} companies", [company, scope.length]) : company,
				icon: "building-2",
				icon_right: "chevrons-up-down",
			});
			pill.find(".es-button__label").addClass("hidden-xs");
		} else {
			pill = $(`<button type="button" class="btn btn-default btn-sm ellipsis nx-ac-pill">${frappe.utils.escape_html(company)}</button>`);
		}
		pill.attr({
			title: __("Active company: {0}. Click to switch", [company]),
			"aria-label": __("Active company: {0}. Switch company", [company]),
		});
		pill.on("click", open_switcher);
		return $('<div class="custom-btn-group nx-ac-group"></div>').append(pill);
	}

	// Returns true once the button is in place (or there is nowhere to put it).
	function render_pill() {
		const page = frappe.container && frappe.container.page;
		if (!page) return false;
		const $page = $(page);
		if ($page.find(".nx-ac-group").length) return true;

		// The apps screen (/desk) first: it also carries a page head, but a hidden
		// one, so its own top bar is the only place a button can be seen.
		const $bell = $page.find(".desktop-navbar .desktop-notifications").first();
		if ($bell.length) {
			$bell.before(make_button());
			return true;
		}

		// Desk pages: before the page actions, a slot Frappe keeps for buttons.
		const $section = $page.find(".page-head .standard-items-section").first();
		if ($section.length && $section.is(":visible")) {
			$section.prepend(make_button());
			return true;
		}
		return false;
	}

	// The apps screen renders its bar after page-change, and re-renders it on
	// every visit, so keep trying briefly instead of a single attempt.
	function place_pill() {
		let attempts = 0;
		const poll = setInterval(() => {
			attempts++;
			if (render_pill() || attempts >= 20) clearInterval(poll);
		}, 150);
	}

	function open_switcher() {
		frappe
			.xcall("nexlify_core.nexlify_core.active_company.get_picker_state")
			.then((res) => {
				const others = (res.companies || []).filter((c) => c.name !== company);
				if (!others.length) {
					frappe.msgprint(__("You only have access to {0}.", [company]));
					return;
				}

				const d = new frappe.ui.Dialog({
					title: __("Switch company"),
					fields: [
						{
							fieldtype: "HTML",
							options: `<p class="text-muted">${__("Working in")} <b>${frappe.utils.escape_html(company)}</b>. ${__("Switching reloads the page; unsaved changes will be lost.")}</p>`,
						},
						{
							fieldname: "company",
							fieldtype: "Select",
							label: __("Switch to"),
							options: others.map((c) => c.name),
							default: others[0].name,
							reqd: 1,
						},
					],
					primary_action_label: __("Switch"),
					primary_action(values) {
						d.get_primary_btn().prop("disabled", true);
						frappe
							.xcall("nexlify_core.nexlify_core.active_company.set_active_company", {
								company: values.company,
							})
							.then(() => {
								// The route may point at a record of the old company: start from the desk.
								window.location.href = "/desk";
							})
							.catch(() => d.get_primary_btn().prop("disabled", false));
					},
				});
				d.show();
			});
	}

	const style = document.createElement("style");
	style.textContent = `
		.nx-ac-group { margin-inline-end: 8px; flex-shrink: 0; }
		.nx-ac-pill .es-button__label { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	`;
	document.head.appendChild(style);

	$(document).on("page-change", place_pill);
	$(place_pill);
})();
