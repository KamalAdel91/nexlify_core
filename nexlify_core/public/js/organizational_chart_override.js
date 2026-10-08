frappe.pages["organizational-chart"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Organizational Chart"),
		single_column: true,
	});

	$(wrapper).bind("show", () => {
		frappe.require("hierarchy-chart.bundle.js", () => {
			hrms.HierarchyChart.prototype.show = show_with_all_companies;
			hrms.HierarchyChartMobile.prototype.show = show_mobile_with_all_companies;

			const method = "hrms.hr.page.organizational_chart.organizational_chart.get_children";
			const organizational_chart = frappe.is_mobile()
				? new hrms.HierarchyChartMobile("Employee", wrapper, method)
				: new hrms.HierarchyChart("Employee", wrapper, method);

			frappe.breadcrumbs.add("HR");
			organizational_chart.show();
		});
	});
};

function show_with_all_companies() {
	this.setup_actions();
	if (this.page.main.find('[data-fieldname="company"]').length) return;
	let me = this;

	let company = this.page.add_field({
		fieldtype: "Select",
		fieldname: "company",
		placeholder: __("Select Company"),
		change: () => {
			me.company = "";
			$("#hierarchy-chart-wrapper").remove();

			if (company.get_value()) {
				me.company = company.get_value();

				// svg for connectors
				me.make_svg_markers();
				me.setup_hierarchy();
				me.render_root_nodes();
				me.all_nodes_expanded = false;
			} else {
				frappe.throw(__("Please select a company first."));
			}
		},
	});

	$(`[data-fieldname="company"]`).css({ "z-index": 2, "position": "relative" });

	frappe.call({
		method: "nexlify_core.org_chart.get_companies",
		callback: (r) => {
			if (!r.exc) {
				company.df.options = r.message;
				company.refresh();
				company.set_value("All Companies");
			}
		},
	});
}

function show_mobile_with_all_companies() {
	if (this.page.main.find('[data-fieldname="company"]').length) return;
	let me = this;

	let company = this.page.add_field({
		fieldtype: "Select",
		fieldname: "company",
		placeholder: __("Select Company"),
		change: () => {
			me.company = "";

			if (company.get_value() && me.company != company.get_value()) {
				me.company = company.get_value();

				me.make_svg_markers();

				if (me.$sibling_group) me.$sibling_group.remove();

				me.$sibling_group = $(`<div class="sibling-group mt-4 mb-4"></div>`);
				me.page.main.append(me.$sibling_group);

				me.setup_hierarchy();
				me.render_root_nodes();
			}
		},
	});

	$(`[data-fieldname="company"]`).css({ "z-index": 2, "position": "relative" });

	frappe.call({
		method: "nexlify_core.org_chart.get_companies",
		callback: (r) => {
			if (!r.exc) {
				company.df.options = r.message;
				company.refresh();
				company.set_value("All Companies");
			}
		},
	});
}
