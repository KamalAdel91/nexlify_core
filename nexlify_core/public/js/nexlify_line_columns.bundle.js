// Keep Each Line in the Ledger, in Frappe's own reports: Add Column gets "Document line" choices.
// A report whose rows link to a ledger table (General Ledger's hidden GL Entry column, a Stock Ledger
// Entry column) can add a field of the document line each ledger row was made from: Item Code of a
// sales invoice line, of a delivery note line and of a stock entry line, in one column. Offered only
// while the setting is ticked (the server sends no choices otherwise). Like every column Add Column
// makes, it lasts until the report runs again. Frappe's code is not changed: its Add Column window gets
// the choices when it opens.
(() => {
	const METHOD = "nexlify_core.overrides.line_columns.";
	const NUM = new Set(["Currency", "Float", "Int", "Percent"]);
	const TYPES = ["Currency", "Float", "Int", "Percent", "Date", "Link", "Check"];
	const PART = 2000;

	$(document).on("shown.bs.modal", () => {
		const d = frappe.ui.open_dialogs[frappe.ui.open_dialogs.length - 1];
		const qr = frappe.query_report;
		if (!d || d.__nx_lines || !is_add_column(d) || !qr || (frappe.get_route() || [])[0] !== "query-report") return;
		d.__nx_lines = true;
		offer_lines(qr, d);
	});

	function is_add_column(d) {
		const f = d.fields_dict || {};
		return d.title === __("Add Column") && f.doctype && f.field && f.insert_after;
	}

	// the ledger tables among the documents the report links to, with their lines' fields
	function offer_lines(qr, d) {
		const links = qr.linked_doctypes || [];
		const doctypes = [...new Set(links.map((l) => l.doctype))];
		if (!doctypes.length) return;
		frappe
			.xcall(METHOD + "line_choices", { doctypes })
			.then((choices) => {
				const ledgers = links.filter((l) => ((choices || {})[l.doctype] || []).length);
				if (ledgers.length) add_choices(qr, d, ledgers, choices);
			})
			.catch(() => {});
	}

	function add_choices(qr, d, ledgers, choices) {
		const kind = __("Document line");
		const pick = d.fields_dict.doctype;
		const extra = ledgers.map((l) => ({ label: `${kind} (${__(l.doctype)})`, value: JSON.stringify({ doctype: l.doctype, fieldname: l.fieldname, line: 1 }) }));
		d.set_df_property("doctype", "options", (pick.df.options || []).concat(extra));
		const frappe_change = pick.df.change;
		pick.df.change = () => {
			const chosen = parse(d.get_value("doctype"));
			if (!chosen || !chosen.line) return frappe_change && frappe_change();
			const options = choices[chosen.doctype].map((f) => ({ label: __(f.label), value: f.field }));
			d.set_df_property("field", "options", options);
			d.get_field("field").set_data && d.get_field("field").set_data(options);
			d.set_value("field", "");
		};
		const frappe_add = d.primary_action;
		d.set_primary_action(d.primary_action_label || __("Submit", null, "Primary action in dialog"), (values) => {
			const chosen = parse(values.doctype);
			if (!chosen || !chosen.line) return frappe_add(values);
			const f = choices[chosen.doctype].find((x) => x.field === values.field);
			if (!f) return frappe.msgprint(__("Pick a field of the document line"));
			return add_line_column(qr, d, chosen, f, values.insert_after);
		});
	}

	// the column, filled from each row's line; a row that adds up several ledger rows (its amounts are
	// not its ledger row's own) has no one line and stays empty
	function add_line_column(qr, d, chosen, f, insert_after) {
		const fieldname = "nxline_" + f.field + "_" + chosen.fieldname;
		if ((qr.columns || []).some((c) => c.fieldname === fieldname)) return frappe.msgprint(__("This column is shown already"));
		const rows = qr.data || [];
		const names = [...new Set(rows.map((r) => r[chosen.fieldname]).filter(Boolean))];
		const compare = (qr.columns || []).filter((c) => NUM.has(c.fieldtype)).map((c) => c.fieldname);
		const parts = [];
		for (let i = 0; i < names.length; i += PART) parts.push(names.slice(i, i + PART));
		return Promise.all(parts.map((part) => frappe.xcall(METHOD + "line_values", { doctype: chosen.doctype, names: part, field: f.field, compare }))).then((got) => {
			const values = Object.assign({}, ...got.map((g) => (g && g.values) || {}));
			const amounts = Object.assign({}, ...got.map((g) => (g && g.amounts) || {}));
			const data = {};
			let added_up = 0;
			rows.forEach((r) => {
				const key = r[chosen.fieldname];
				if (!key) return;
				const own = amounts[key];
				const several = !!own && Object.keys(own).some((x) => x in r && Math.abs(flt(r[x]) - flt(own[x])) > 0.005);
				if (several) added_up++;
				data[key] = several ? null : values[key] ?? null;
			});
			const type = TYPES.includes(f.fieldtype) ? f.fieldtype : "Data";
			const index = (qr.columns || []).findIndex((c) => c.fieldname === insert_after);
			qr.add_custom_column(
				[{ fieldname, fieldtype: type, options: type === "Link" ? f.options : undefined, label: `${__(f.label)} (${__("Document line")})`, width: 150 }],
				data,
				{ fieldname: chosen.fieldname, field: fieldname, doctype: chosen.doctype },
				index
			);
			d.hide();
			if (added_up)
				frappe.show_alert(
					{ message: __("Rows that add up several lines: {0}. Their document line columns stay empty; show each line on its own row to see them.", [added_up]), indicator: "orange" },
					10
				);
		});
	}

	function parse(value) {
		try {
			return JSON.parse(value || "null");
		} catch (e) {
			return null;
		}
	}
})();
