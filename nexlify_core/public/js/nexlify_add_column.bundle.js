// Frappe's own Add Column, in every report:
// - an added column stays when the report runs again (the reload button, a changed filter) until the user
//   leaves the report; a layout of the Nexlify Report View keeps it for good;
// - with the Nexlify Report View shown, the column joins the view's own columns, so a layout saves it;
// - with Keep Each Line in the Ledger ticked, "Document line" choices: a report whose rows link to a ledger
//   table (General Ledger's hidden GL Entry column) adds a field of the document line each ledger row was
//   made from, filled from whichever document the row is of; a row that adds up several ledger rows stays empty.
// Every added column goes into Frappe's Export (the server fills the line ones: line_columns_export.py).
// Frappe's code is not changed: its Add Column window gets the choices and the action when it opens.
(() => {
	const LINES = "nexlify_core.overrides.line_columns.";
	const NUM = new Set(["Currency", "Float", "Int", "Percent"]);
	const TYPES = ["Currency", "Float", "Int", "Percent", "Date", "Link", "Check"];
	const PART = 2000;
	// the columns added to the report open now: {report, specs: [{doctype, link_field, field, line, insert_after}]}
	let kept = null;

	$(document).on("shown.bs.modal", () => {
		const d = frappe.ui.open_dialogs[frappe.ui.open_dialogs.length - 1];
		const qr = frappe.query_report;
		if (!frappe.boot.nexlify_reports_enabled || !d || d.__nx_add || !is_add_column(d) || !qr || route()[0] !== "query-report") return;
		d.__nx_add = true;
		take_over(qr, d);
	});

	// leaving the report: its added columns go
	$(document).ready(() => {
		if (frappe.router && frappe.router.on)
			frappe.router.on("change", () => {
				if (kept && (route()[0] !== "query-report" || route()[1] !== kept.report)) kept = null;
			});
	});

	function take_over(qr, d) {
		const lines = {};
		offer_lines(qr, d, lines);
		const frappe_add = d.primary_action;
		d.set_primary_action(d.primary_action_label || __("Submit", null, "Primary action in dialog"), (values) => {
			const chosen = parse(values.doctype);
			if (!chosen || !values.field) return frappe_add(values);
			const spec = { doctype: chosen.doctype, link_field: chosen.fieldname, field: values.field, line: chosen.line ? 1 : 0, insert_after: values.insert_after };
			if (spec.line) spec.df = (lines[spec.doctype] || []).find((x) => x.field === spec.field);
			if (spec.line && !spec.df) return frappe.msgprint(__("Pick a field of the document line"));
			const view = shown_view(qr);
			const done = view && view.add_from_frappe ? view.add_from_frappe(spec) : Promise.resolve(false);
			return done.then((in_view) => {
				if (in_view) return d.hide();
				return add(qr, spec).then((ok) => {
					if (!ok) return;
					keep(qr, spec);
					d.hide();
				});
			});
		});
	}

	// the column, its values read now, in Frappe's table and in its Export; quiet when it comes back after a run
	function add(qr, spec, quiet) {
		const index = (qr.columns || []).findIndex((c) => c.fieldname === spec.insert_after);
		const made = spec.line ? line_column(qr, spec, quiet) : doc_column(qr, spec, quiet);
		return made.then((got) => {
			if (!got) return false;
			const { column, data, field, added_up } = got;
			qr.add_custom_column([column], data, { fieldname: spec.link_field, field, doctype: spec.doctype }, index);
			const sent = Object.assign({}, column, { insert_after_index: index, doctype: spec.doctype, link_field: { fieldname: spec.link_field, names: [] } });
			if (spec.line) sent.nexlify_added = { field: spec.field, line: 1 };
			qr.custom_columns = (qr.custom_columns || []).concat([sent]);
			if (added_up && !quiet) tell_added_up(added_up);
			return true;
		});
	}

	// a field of the linked document, read as Frappe's own Add Column reads it
	function doc_column(qr, spec, quiet) {
		const df = frappe.meta.get_docfield(spec.doctype, spec.field);
		if (!df) return Promise.resolve(null);
		const clash = (qr.columns || []).some((c) => c.fieldname === df.fieldname);
		const fieldname = clash ? df.fieldname + "-" + frappe.scrub(spec.doctype) : df.fieldname;
		if ((qr.columns || []).some((c) => c.fieldname === fieldname)) return shown_already(quiet);
		const names = [...new Set((qr.data || []).map((r) => r[spec.link_field]).filter((n) => n !== null && n !== undefined && n !== ""))];
		return frappe.xcall("frappe.desk.query_report.get_data_for_custom_field", { doctype: spec.doctype, field: spec.field, names }).then((data) => ({
			column: { fieldname, fieldtype: df.fieldtype, label: __(df.label, null, df.parent), options: df.options, width: 100 },
			data: data || {},
			field: df.fieldname,
		}));
	}

	// a field of each row's document line; a row that adds up several ledger rows (its amounts are not its
	// ledger row's own) has no one line and stays empty
	function line_column(qr, spec, quiet) {
		const fieldname = "nxline_" + spec.field + "_" + spec.link_field;
		if ((qr.columns || []).some((c) => c.fieldname === fieldname)) return shown_already(quiet);
		const rows = qr.data || [];
		const names = [...new Set(rows.map((r) => r[spec.link_field]).filter(Boolean))];
		const compare = (qr.columns || []).filter((c) => NUM.has(c.fieldtype)).map((c) => c.fieldname);
		const parts = [];
		for (let i = 0; i < names.length; i += PART) parts.push(names.slice(i, i + PART));
		return Promise.all(parts.map((part) => frappe.xcall(LINES + "line_values", { doctype: spec.doctype, names: part, field: spec.field, compare }))).then((got) => {
			const values = Object.assign({}, ...got.map((g) => (g && g.values) || {}));
			const amounts = Object.assign({}, ...got.map((g) => (g && g.amounts) || {}));
			const data = {};
			let added_up = 0;
			rows.forEach((r) => {
				const key = r[spec.link_field];
				if (!key) return;
				const own = amounts[key];
				const several = !!own && Object.keys(own).some((x) => x in r && Math.abs(flt(r[x]) - flt(own[x])) > 0.005);
				if (several) added_up++;
				data[key] = several ? null : values[key] ?? null;
			});
			const type = TYPES.includes(spec.df.fieldtype) ? spec.df.fieldtype : "Data";
			const label = `${__(spec.df.label)} (${__("Document line")})`;
			return { column: { fieldname, fieldtype: type, options: type === "Link" ? spec.df.options : undefined, label, width: 150 }, data, field: fieldname, added_up };
		});
	}

	// ---------------------------------------------------------------- staying until the user leaves the report
	function keep(qr, spec) {
		if (!kept || kept.report !== qr.report_name) kept = { report: qr.report_name, specs: [] };
		kept.specs.push(spec);
		if (qr.__nx_refresh) return;
		// Frappe's run of the report rebuilds its columns; the added ones come back after it
		const frappe_refresh = qr.refresh;
		qr.__nx_refresh = true;
		qr.refresh = function (...args) {
			const run = frappe_refresh.apply(this, args);
			Promise.resolve(run).then(() => put_back(qr));
			return run;
		};
	}

	function put_back(qr) {
		if (!kept || kept.report !== qr.report_name) return;
		kept.specs.reduce((before, spec) => before.then(() => add(qr, spec, true)).catch(() => {}), Promise.resolve());
	}

	// ---------------------------------------------------------------- Document line choices
	function offer_lines(qr, d, lines) {
		const links = qr.linked_doctypes || [];
		const doctypes = [...new Set(links.map((l) => l.doctype))];
		if (!doctypes.length) return;
		frappe
			.xcall(LINES + "line_choices", { doctypes })
			.then((choices) => {
				const ledgers = links.filter((l) => ((choices || {})[l.doctype] || []).length);
				ledgers.forEach((l) => (lines[l.doctype] = choices[l.doctype]));
				if (ledgers.length) add_choices(d, ledgers, lines);
			})
			.catch(() => {});
	}

	function add_choices(d, ledgers, lines) {
		const kind = __("Document line");
		const pick = d.fields_dict.doctype;
		const extra = ledgers.map((l) => ({ label: `${kind} (${__(l.doctype)})`, value: JSON.stringify({ doctype: l.doctype, fieldname: l.fieldname, line: 1 }) }));
		d.set_df_property("doctype", "options", (pick.df.options || []).concat(extra));
		const frappe_change = pick.df.change;
		pick.df.change = () => {
			const chosen = parse(d.get_value("doctype"));
			if (!chosen || !chosen.line) return frappe_change && frappe_change();
			const options = lines[chosen.doctype].map((f) => ({ label: __(f.label), value: f.field }));
			d.set_df_property("field", "options", options);
			d.get_field("field").set_data && d.get_field("field").set_data(options);
			d.set_value("field", "");
		};
	}

	// ---------------------------------------------------------------- small helpers
	function is_add_column(d) {
		const f = d.fields_dict || {};
		return d.title === __("Add Column") && f.doctype && f.field && f.insert_after;
	}

	function shown_view(qr) {
		const v = qr.__nxv;
		return v && v.$wrap && !v.$wrap.prop("hidden") ? v : null;
	}

	function shown_already(quiet) {
		if (!quiet) frappe.msgprint(__("This column is shown already"));
		return Promise.resolve(null);
	}

	function tell_added_up(n) {
		frappe.show_alert({ message: __("Rows that add up several lines: {0}. Their document line columns stay empty; show each line on its own row to see them.", [n]), indicator: "orange" }, 10);
	}

	function route() {
		return (frappe.get_route && frappe.get_route()) || [];
	}

	function parse(value) {
		try {
			return JSON.parse(value || "null");
		} catch (e) {
			return null;
		}
	}
})();
