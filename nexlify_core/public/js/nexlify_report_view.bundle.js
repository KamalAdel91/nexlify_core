// Nexlify Report View: the table of every query and script report, drawn so that it never shakes.
//
// Frappe still runs the report, keeps its filters, summary and chart where it puts them, and builds
// its own table (kept hidden, so Export and Print work as before). This file draws what the report
// returned in a table that looks like Frappe's: only the rows near the screen are drawn, and a drawn
// row never changes, so nothing moves while the user scrolls.
//
// On top of the table: Layout (the columns, their order and widths, the sort and the grouping, saved
// in Nexlify Report Layout for the user or for everyone) and Group By (for each group: a heading, its
// rows, its total). Values are formatted by the report's own columns (Frappe's formatter), so a cell
// reads as it does in Frappe's table.
//
// On and off in Nexlify Reports Settings (Use Nexlify Report View for All Reports).
frappe.provide("nexlify.report_view");

(function () {
	const NUM = new Set(["Currency", "Float", "Int", "Percent"]);
	const SUMMED = new Set(["Currency", "Float", "Int"]);
	const LAYOUT = "Nexlify Report Layout";
	const STANDARD = "";
	const MAX_LEVELS = 3;
	// the level that groups rows under the headings their report made (each row's __nxhead)
	const HEADS = { fieldname: "__nxhead", fieldtype: "Int", label: "" };
	const BLOCK = 40;
	const CHEVRON =
		'<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
	const CARET =
		'<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const icon = (name, size) => frappe.utils.icon(name, size || "sm");
	const clean = (s) => String(s ?? "").replace(/^'(.*)'$/, "$1");
	const round6 = (v) => Math.round(v * 1e6) / 1e6;
	// a unit price is not added up: told by the column's fieldname, which is never translated
	const is_rate = (c) => /(^|_)(rate|price)(_|$)|valuation_rate|_rate$/i.test((c && c.fieldname) || "");
	const FIELD = (v) => (typeof v === "string" && /^[A-Za-z0-9_\-:.\s]{1,140}$/.test(v) ? v : null);

	function to_number(v) {
		if (typeof v === "number") return v;
		if (v === null || v === undefined || v === "") return null;
		const n = Number(v);
		return isNaN(n) ? null : n;
	}

	// Settings > Filter: the conditions a row is checked against
	const OPS = [
		[">", __("greater than")],
		["<", __("less than")],
		["=", __("equal to")],
		["between", __("between")],
		["neg", __("is negative")],
		["zero", __("is zero")],
		["contains", __("contains")],
		["empty", __("is empty")],
		["notempty", __("is not empty")],
		["in", __("is any of")],
		["on", __("on")],
		["before", __("before")],
		["after", __("after")],
		["checked", __("is ticked")],
		["unchecked", __("is not ticked")],
	];
	const OP_KEYS = OPS.map((x) => x[0]);
	const NO_VALUE = new Set(["neg", "zero", "empty", "notempty", "checked", "unchecked"]);
	const OP_LABEL = Object.fromEntries(OPS);
	// the operators a column offers, by the kind of its data; the first is the one a new condition gets
	const KIND_OPS = {
		text: ["in", "contains", "empty", "notempty"],
		num: ["=", ">", "<", "between", "neg", "zero", "empty", "notempty"],
		date: ["on", "before", "after", "between", "empty", "notempty"],
		check: ["checked", "unchecked"],
	};
	function kind_of(c) {
		if (!c) return "text";
		if (NUM.has(c.fieldtype)) return "num";
		if (["Date", "Datetime"].includes(c.fieldtype)) return "date";
		if (c.fieldtype === "Check") return "check";
		return "text";
	}
	// a number typed by a person: Arabic-Indic digits too
	function parse_num(value) {
		const text = String(value ?? "")
			.trim()
			.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
			.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
		if (!/\d/.test(text)) return null;
		const n = flt(text);
		return isNaN(n) ? null : n;
	}

	function config() {
		return frappe.boot.nexlify_report_view || { enabled: 0 };
	}

	// ------------------------------------------------------------------ layouts
	// A layout: the columns shown in their order, their widths, the sort and the grouping.
	// One saved by an earlier build has more keys: only these are read.
	function clean_state(s) {
		s = s && typeof s === "object" ? s : {};
		const list = (v) => (Array.isArray(v) ? v : []);
		const out = { order: [], hidden: [], widths: {}, labels: {}, sorts: [], conds: [], group_by: [], added: [], freeze: 0, density: 0 };
		// compact rows (a layout of the old view has the same key)
		out.density = s.density ? 1 : 0;
		// the columns that stay in place on the left (a layout of the old view has the same key)
		const fz = parseInt(s.freeze, 10);
		out.freeze = isNaN(fz) ? 0 : Math.max(0, Math.min(fz, 10));
		out.order = list(s.order).map(FIELD).filter(Boolean).slice(0, 500);
		out.hidden = list(s.hidden).map(FIELD).filter(Boolean).slice(0, 500);
		const widths = s.widths && typeof s.widths === "object" ? s.widths : {};
		Object.keys(widths).forEach((k) => {
			const w = parseInt(widths[k], 10);
			if (FIELD(k) && w >= 40 && w <= 1200) out.widths[k] = w;
		});
		out.sorts = list(s.sorts)
			.map((x) => x && FIELD(x.key) && { key: x.key, dir: x.dir < 0 ? -1 : 1 })
			.filter(Boolean)
			.slice(0, 5);
		const labels = s.labels && typeof s.labels === "object" ? s.labels : {};
		Object.keys(labels).forEach((k) => {
			if (FIELD(k) && typeof labels[k] === "string" && labels[k].trim()) out.labels[k] = labels[k].slice(0, 120);
		});
		out.conds = list(s.conds)
			.filter((u) => u && FIELD(u.f) && OP_KEYS.includes(u.op))
			.map((u) => ({
				f: u.f,
				op: u.op,
				x: String(u.x ?? "").slice(0, 40),
				x2: String(u.x2 ?? "").slice(0, 40),
				// "is any of": the values picked from the column
				vals: list(u.vals)
					.filter((v) => typeof v === "string")
					.map((v) => v.slice(0, 140))
					.slice(0, 500),
				exclude: !!u.exclude,
			}))
			.slice(0, 30);
		// a column from a linked document: its field, and the report column that names the document;
		// nxline_: a field of the document line the linked ledger row was made from
		out.added = list(s.added)
			.filter((a) => a && /^nx(link|line)_[A-Za-z0-9_]+$/.test(a.f) && FIELD(a.doctype) && FIELD(a.field) && FIELD(a.link_field))
			.map((a) => ({
				f: a.f,
				line: /^nxline_/.test(a.f) ? 1 : 0,
				doctype: a.doctype,
				field: a.field,
				link_field: a.link_field,
				dynamic: FIELD(a.dynamic) || "",
				label: String(a.label || a.field).slice(0, 120),
				fieldtype: ["Currency", "Float", "Int", "Percent", "Date", "Link", "Check", "Data"].includes(a.fieldtype) ? a.fieldtype : "Data",
				options: FIELD(a.options) || undefined,
			}))
			.slice(0, 60);
		const g = Array.isArray(s.group_by) ? s.group_by : s.group_by ? [s.group_by] : [];
		out.group_by = g.map(FIELD).filter(Boolean).slice(0, MAX_LEVELS);
		return out;
	}

	// the layouts of each report, and the user's default one, read once per report
	const layout_store = {};
	function layouts_of(report) {
		if (layout_store[report]) return layout_store[report];
		const entry = { list: [], def: STANDARD };
		entry.ready = Promise.all([
			frappe.db.get_list(LAYOUT, {
				filters: { report },
				fields: ["name", "layout_name", "is_public", "owner", "state"],
				order_by: "layout_name asc",
				limit: 200,
			}),
			frappe
				.xcall("frappe.model.utils.user_settings.get", { doctype: report })
				.then((s) => (typeof s === "string" ? JSON.parse(s || "{}") : s || {}))
				.catch(() => ({})),
		])
			.then(([list, prefs]) => {
				entry.list = list || [];
				if (prefs && !frappe.model.user_settings[report]) frappe.model.user_settings[report] = prefs;
				const old = prefs && prefs.nexlify_report_view;
				entry.def = (prefs && prefs.nexlify_layout) || (old && old.default_variant) || STANDARD;
			})
			.catch((e) => console.warn("[Nexlify] report layouts", e))
			.then(() => entry);
		layout_store[report] = entry;
		return entry;
	}

	function parse_layout(layout) {
		if (!layout) return clean_state({});
		try {
			return clean_state(typeof layout.state === "string" ? JSON.parse(layout.state || "{}") : layout.state);
		} catch (e) {
			return clean_state({});
		}
	}

	function mine(layout) {
		return !!layout && (layout.owner === frappe.session.user || frappe.user.has_role("System Manager"));
	}

	// ------------------------------------------------------------------ the view
	class ReportView {
		constructor(qr) {
			this.qr = qr;
			this.report_name = qr.report_name;
			this.layout = { order: [], hidden: [], widths: {}, labels: {}, added: [], freeze: 0, density: 0 };
			// the values of the linked documents' fields, by column and document name
			this.linked_vals = {};
			this.state = { sorts: [], conds: [], group_by: [], filters: {}, query: "" };
			// the groups the user closed
			this.closed = new Set();
			this.saved_json = null;
			this.active = STANDARD;
			this.win = [-1, -1];
			this.row_h = 35;
			this.make();
		}

		make() {
			this.$wrap = $(`<div class="nxv" hidden>
				<div class="nxv-scroller" tabindex="0" aria-label="${__("Report table")}"><table class="nxv-grid"><colgroup></colgroup><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
			</div>`);
			this.$wrap.insertAfter(this.qr.$report);
			this.$scroller = this.$wrap.find(".nxv-scroller");
			this.scroller = this.$scroller[0];
			this.grid = this.$wrap.find(".nxv-grid")[0];
			this.bind();
		}

		show() {
			set_pending(false);
			this.$wrap.removeClass("nxv-loading");
			this.qr.$report.addClass("nxv-hidden");
			this.qr.page.main.addClass("nxv-on");
			this.$wrap.prop("hidden", false);
			this.fit_height();
		}

		hide() {
			this.qr.page.main.removeClass("nxv-on");
			this.$wrap.prop("hidden", true);
			if (this.qr.$loading) this.qr.$loading.removeClass("nxv-hide");
		}

		destroy() {
			document.removeEventListener("mousemove", this.on_move);
			document.removeEventListener("mouseup", this.on_up);
			window.removeEventListener("resize", this.on_resize);
			this.$wrap.remove();
		}

		// ---------------------------------------------------------------- data from the report
		load() {
			const qr = this.qr;
			this.report_columns = (qr.columns || [])
				.filter((c) => !c.hidden)
				.map((c, i) => ({
					fieldname: c.fieldname || c.id,
					label: c.label || c.name || c.fieldname,
					fieldtype: c.fieldtype || "Data",
					options: c.options,
					width: parseInt(c.width, 10) || 150,
					src: c,
					index: i,
					// an amount that repeats on each row of a document (see sum_of)
					once_per: c.once_per || (c.docfield && c.docfield.once_per) || undefined,
				}));
			// hidden columns a report keeps for linking (General Ledger's GL Entry): never shown, but the fields
			// of their documents can be added
			this.link_sources = (qr.columns || [])
				.filter((c) => c.hidden && c.fieldtype === "Link" && c.options && c.fieldname)
				.map((c) => ({ fieldname: c.fieldname, label: c.label || c.fieldname, fieldtype: "Link", options: c.options }));
			this.infer_links();
			this.guess_promise = null;
			this.avail_promise = null;
			this.columns = this.report_columns.slice();
			// copies: the view marks its rows, and Frappe's own data stays as Frappe left it
			const data = (qr.data || []).map((r) => Object.assign({}, r));
			// Frappe's total row: Frappe's table adds up the rows it shows instead, and so does this one
			this.show_total = !!(qr.raw_data && qr.raw_data.add_total_row && !(qr.report_settings && qr.report_settings.tree));
			if (this.show_total && data.length) data.pop();
			// a tree only when this run has levels: a report that turns its tree on for a filter is a plain table without it
			this.is_tree = !!qr.tree_report && data.some((r) => (r.indent || 0) > 0);
			this.link_tree(data);
			this.rows = data;
			const keys = this.report_columns.map((c) => c.fieldname);
			data.forEach((r) => (r.__nxt = keys.map((k) => clean(r[k])).join(" ").toLowerCase()));
			this.add_linked_columns();
			this.cells_of = new Map();
			const depth = qr.report_settings && typeof qr.report_settings.initial_depth === "number" ? qr.report_settings.initial_depth : null;
			this.rows.forEach((r) => (r.__nxopen = depth === null || (r.indent || 0) < depth));
			Object.keys(this.state.filters).forEach((f) => {
				if (!this.columns.find((c) => c.fieldname === f)) delete this.state.filters[f];
			});
			// each column starts as wide as its text, as Frappe's table does here; a layout's widths win
			const fit = this.measure(this.columns, this.rows);
			this.columns.forEach((c) => (c.width = Math.min(400, fit[c.fieldname] || c.width)));
			this.refresh();
			// the totals at the bottom are bold and can be longer than any row: their columns grow to show them whole
			if (this.fit_totals()) this.refresh(true);
			this.fetch_linked();
		}

		fit_totals() {
			const lines = this.foot_row() || [];
			if (!lines.length) return false;
			const ctx = (this.canvas = this.canvas || document.createElement("canvas")).getContext("2d");
			const cs = getComputedStyle(this.grid);
			ctx.font = `700 ${cs.fontSize} ${cs.fontFamily}`;
			let grew = false;
			this.columns.forEach((c) => {
				if (!NUM.has(c.fieldtype) || this.layout.widths[c.fieldname]) return;
				lines.forEach((line) => {
					if (line.__nxpart === "other" && this.currency_field(c)) return;
					if (line.__nxpart === "own" && !this.currency_field(c)) return;
					const text = $("<div>").html(this.sum_html(line.__nxrows, c)).text();
					const w = Math.ceil(ctx.measureText(text).width * 1.08 + 24);
					if (w > c.width && w <= 400) {
						c.width = w;
						grew = true;
					}
				});
			});
			return grew;
		}

		// A column with no type that names a DocType links to it (General Ledger's Project and dimensions);
		// one beside a column holding a DocType's name links to the document named there (party and
		// party_type); a plain column named like a DocType the user may read holds that DocType's names.
		infer_links() {
			const readable = new Set(frappe.boot.user.can_read || []);
			const names = new Set(this.report_columns.map((c) => c.fieldname));
			const by_name = new Map([...readable].map((dt) => [frappe.scrub(dt), dt]));
			const never = new Set(["Currency", "DocType", "Report", "Page", "File"]);
			this.report_columns.forEach((c) => {
				const src = c.src || {};
				if (!src.fieldtype && src.options && readable.has(src.options)) {
					c.fieldtype = "Link";
					return;
				}
				if (!src.fieldtype && !src.options) {
					const f = c.fieldname || "";
					const t = [f + "_type", f.replace(/_(name|no)$/, "_type"), f.replace(/_(name|no)$/, "_doctype")].find((x) => x !== f && names.has(x));
					if (t) {
						c.fieldtype = "Dynamic Link";
						c.options = t;
						return;
					}
				}
				if (c.fieldtype === "Data" && !src.options) {
					const dt = (readable.has(src.label) && src.label) || by_name.get(c.fieldname);
					if (dt && !never.has(dt)) {
						c.fieldtype = "Link";
						c.options = dt;
					}
				}
			});
		}

		// the columns the layout adds from linked documents, after the report's own
		add_linked_columns() {
			this.columns = this.report_columns.slice();
			(this.layout.added || []).forEach((a, i) => {
				if (this.columns.find((c) => c.fieldname === a.f)) return;
				if (!this.link_column(a.link_field)) return;
				this.columns.push({ fieldname: a.f, label: a.label, fieldtype: a.fieldtype || "Data", options: a.options, width: 150, index: 1000 + i, linked: a });
			});
			this.put_linked_values();
			this.send_to_export();
		}

		// the added columns go into Frappe's Export too, after the report's own (the server fills them:
		// nexlify_core.overrides.line_columns_export)
		send_to_export() {
			const own = (this.qr.custom_columns || []).filter((c) => !c.nexlify_view);
			const added = (this.layout.added || []).filter((a) => this.columns.find((c) => c.fieldname === a.f));
			this.qr.custom_columns = own.concat(
				added.map((a) => ({
					fieldname: a.f,
					fieldtype: a.fieldtype || "Data",
					label: a.label,
					options: a.options,
					width: 150,
					insert_after_index: 9999,
					doctype: a.doctype,
					link_field: { fieldname: a.link_field, names: [] },
					nexlify_view: 1,
					nexlify_added: { field: a.field, line: a.line ? 1 : 0, dynamic: a.dynamic || "" },
				}))
			);
		}

		// a field Frappe's own Add Column picked: one of this view's added columns, placed where the user
		// asked, so a layout keeps it; false when the view does not offer that field
		add_from_frappe(spec) {
			return this.avail_fields().then((list) => {
				const a = (list || []).find((x) => x.doctype === spec.doctype && x.field === spec.field && x.link_field === spec.link_field && !!x.line === !!spec.line);
				if (!a) return false;
				const st = this.current_state();
				if (!st.added.some((x) => x.f === a.f))
					st.added.push({ f: a.f, doctype: a.doctype, field: a.field, link_field: a.link_field, dynamic: a.dynamic, line: a.line ? 1 : 0, label: a.label, fieldtype: a.fieldtype, options: a.options });
				const order = st.order.filter((f) => f !== a.f);
				const at = order.indexOf(spec.insert_after);
				order.splice(at < 0 ? order.length : at + 1, 0, a.f);
				st.order = order;
				st.hidden = st.hidden.filter((f) => f !== a.f);
				this.use_state(st);
				this.fetch_linked();
				return true;
			});
		}

		// a linked field's value goes on each row, as if the report had it: sort, filter, groups and totals work on it
		put_linked_values() {
			const added = (this.layout.added || []).filter((a) => this.columns.find((c) => c.fieldname === a.f));
			this.added_up = 0;
			if (!added.length || !this.rows) return;
			this.rows.forEach((r) => {
				let several = false;
				added.forEach((a) => {
					const map = this.linked_vals[a.f];
					const key = r[a.link_field];
					r[a.f] = map && key !== undefined && key !== null && (!a.dynamic || r[a.dynamic] === a.doctype) ? map[key] ?? null : null;
					if (a.line && key && this.adds_up(r, a, key)) {
						r[a.f] = null;
						several = true;
					}
				});
				if (several) this.added_up++;
			});
		}

		// a report row whose amounts are not its ledger row's own adds up several ledger rows (General
		// Ledger by voucher, consolidated): it has no one line
		adds_up(r, a, key) {
			const own = ((this.line_amounts || {})[a.doctype] || {})[key];
			if (!own) return false;
			return Object.keys(own).some((f) => f in r && Math.abs(flt(r[f]) - flt(own[f])) > 0.005);
		}

		link_column(f) {
			return this.report_columns.find((c) => c.fieldname === f) || (this.link_sources || []).find((c) => c.fieldname === f);
		}

		// the values of the added fields, read with Frappe's own call for its Add Column (the user's permissions apply)
		fetch_linked() {
			const jobs = (this.layout.added || [])
				.filter((a) => this.columns.find((c) => c.fieldname === a.f))
				.map((a) => {
					// a field the database does not keep (a virtual field, as Stock Entry's Last Scanned Warehouse)
					// has no value to read: Frappe's call fails on it, so it is not asked (a layout saved before kept one)
					const df = !a.line && frappe.get_meta(a.doctype) ? frappe.meta.get_docfield(a.doctype, a.field) : null;
					if (df && df.is_virtual) return Promise.resolve();
					// only the documents not read yet
					const have = this.linked_vals[a.f] || {};
					const names = [...new Set(this.rows.filter((r) => !a.dynamic || r[a.dynamic] === a.doctype).map((r) => r[a.link_field]).filter((n) => n && !(n in have)))];
					if (!names.length) return Promise.resolve();
					if (a.line) return this.fetch_lines(a, names);
					return frappe
						.call({ method: "frappe.desk.query_report.get_data_for_custom_field", args: { doctype: a.doctype, field: a.field, names } })
						.then((r) => (this.linked_vals[a.f] = Object.assign(this.linked_vals[a.f] || {}, r.message || {})))
						.catch(() => {});
				});
			if (!jobs.length) return;
			Promise.all(jobs).then(() => {
				this.put_linked_values();
				const fit = this.measure(this.columns.filter((c) => c.linked), this.rows);
				this.columns.forEach((c) => c.linked && fit[c.fieldname] && (c.width = Math.min(400, fit[c.fieldname])));
				this.refresh(true);
				if (this.added_up)
					frappe.show_alert(
						{ message: __("Rows that add up several lines: {0}. Their document line columns stay empty; show each line on its own row to see them.", [this.added_up]), indicator: "orange" },
						10
					);
			});
		}

		// a document line's field, read through the ledger rows the report shows (as the user), with each
		// ledger row's own amounts of the report's number columns, to tell a row that adds up several
		fetch_lines(a, names) {
			const compare = this.report_columns.filter((c) => NUM.has(c.fieldtype) && frappe.meta.has_field(a.doctype, c.fieldname)).map((c) => c.fieldname);
			const parts = [];
			for (let i = 0; i < names.length; i += 2000) parts.push(names.slice(i, i + 2000));
			return Promise.all(
				parts.map((part) =>
					frappe.xcall("nexlify_core.overrides.line_columns.line_values", { doctype: a.doctype, names: part, field: a.field, compare }).then((got) => {
						const values = (got && got.values) || {};
						// a row the user may not read stays empty, and is not asked again
						part.forEach((n) => n in values || (values[n] = null));
						this.linked_vals[a.f] = Object.assign(this.linked_vals[a.f] || {}, values);
						const amounts = ((this.line_amounts = this.line_amounts || {})[a.doctype] = this.line_amounts[a.doctype] || {});
						Object.assign(amounts, (got && got.amounts) || {});
					})
				)
			).catch(() => {});
		}

		// How the columns link to other tables, asked once from the definition of the report's DocType:
		// a column the report did not mark becomes a Link or a Dynamic Link when its field there is one,
		// and a Dynamic Link gets every DocType its type field allows (not only those in the rows)
		guess_links() {
			if (this.guess_promise) return this.guess_promise;
			const columns = this.report_columns.filter((c) => c.fieldtype === "Data" && !(c.src && c.src.options)).map((c) => c.fieldname);
			const dynamic = this.report_columns.filter((c) => c.fieldtype === "Dynamic Link" && c.options).map((c) => [c.fieldname, c.options]);
			if (!columns.length && !dynamic.length) return (this.guess_promise = Promise.resolve());
			this.guess_promise = frappe
				.xcall("nexlify_core.nexlify_core.report_layouts.guess_links", { report: this.report_name, columns, dynamic })
				.then((found) => {
					Object.entries(found || {}).forEach(([f, how]) => {
						const c = this.report_columns.find((x) => x.fieldname === f);
						if (!c || !how) return;
						if (how.link && c.fieldtype === "Data") {
							c.fieldtype = "Link";
							c.options = how.link;
						} else if (how.dynamic && this.report_columns.some((x) => x.fieldname === how.dynamic)) {
							c.fieldtype = "Dynamic Link";
							c.options = how.dynamic;
							c.targets = how.targets || [];
						}
					});
				})
				.catch(() => {});
			return this.guess_promise;
		}

		linked_doctypes() {
			const out = [];
			const seen = new Set();
			this.report_columns.concat(this.link_sources || []).forEach((c) => {
				if (c.fieldtype === "Link" && c.options && !["Currency", "DocType"].includes(c.options)) {
					const k = c.options + "|" + c.fieldname;
					if (!seen.has(k)) out.push({ doctype: c.options, link_field: c.fieldname, label: c.label });
					seen.add(k);
				} else if (c.fieldtype === "Dynamic Link" && c.options) {
					// the DocTypes its type field allows, from the tables' definitions; the rows' own types
					// only when the definition says nothing
					const types = c.targets && c.targets.length ? c.targets : (this.rows || []).map((r) => r[c.options]).filter(Boolean);
					new Set(types).forEach((dt) => {
						const k = dt + "|" + c.fieldname;
						if (!seen.has(k)) out.push({ doctype: dt, link_field: c.fieldname, label: c.label, dynamic: c.options });
						seen.add(k);
					});
				}
			});
			return out;
		}

		// every field of every document the report links to, ready to add as a column
		avail_fields() {
			if (this.avail_promise) return this.avail_promise;
			const keep = ["Currency", "Float", "Int", "Percent", "Date", "Datetime", "Link", "Check", "Select", "Data", "Small Text", "Text", "Phone", "Read Only", "Dynamic Link"];
			const load = (dt) =>
				new Promise((res) => {
					setTimeout(() => res(false), 8000);
					try {
						const p = frappe.model.with_doctype(dt, () => res(true));
						if (p && p.catch) p.catch(() => res(false));
					} catch (e) {
						res(false);
					}
				});
			this.avail_promise = this.guess_links().then(() => {
				const links = this.linked_doctypes();
				return Promise.all(links.map((l) => load(l.doctype))).then(() => {
					const out = [];
					links.forEach((l) => {
						if (!frappe.get_meta(l.doctype)) return;
						const from = __(l.doctype) + (l.label && l.label !== l.doctype ? ` (${__(l.label)})` : "");
						frappe.meta
							.get_docfields(l.doctype)
							.filter((df) => keep.includes(df.fieldtype) && !df.hidden && !df.is_virtual && df.label)
							.forEach((df) => {
								const type = ["Currency", "Float", "Int", "Percent", "Date", "Link", "Check"].includes(df.fieldtype) ? df.fieldtype : "Data";
								out.push({
									f: "nxlink_" + frappe.scrub(l.doctype) + "_" + df.fieldname + "_" + l.link_field,
									doctype: l.doctype,
									field: df.fieldname,
									link_field: l.link_field,
									dynamic: l.dynamic || "",
									label: `${__(df.label)} (${__(l.doctype)})`,
									short: __(df.label),
									from,
									dt: __(l.doctype),
									via: l.label && l.label !== l.doctype ? __(l.label) : "",
									fieldtype: type,
									options: type === "Link" ? df.options : undefined,
								});
							});
					});
					return this.line_fields(links).then((lines) => out.concat(lines));
				});
			});
			return this.avail_promise;
		}

		// the fields of the document line each linked ledger row (GL Entry, Stock Ledger Entry) was made
		// from: one column a field, filled from whichever document the row is of
		line_fields(links) {
			const ledgers = links.filter((l) => ["voucher_type", "voucher_no", "voucher_detail_no"].every((f) => frappe.meta.has_field(l.doctype, f)));
			const kind = __("Document line");
			return Promise.all(
				ledgers.map((l) =>
					frappe
						.xcall("nexlify_core.overrides.line_columns.line_fields", { doctype: l.doctype })
						.catch(() => [])
						.then((fields) =>
							(fields || []).map((df) => {
								const type = ["Currency", "Float", "Int", "Percent", "Date", "Link", "Check"].includes(df.fieldtype) ? df.fieldtype : "Data";
								return {
									f: "nxline_" + df.field + "_" + l.link_field,
									doctype: l.doctype,
									field: df.field,
									link_field: l.link_field,
									dynamic: l.dynamic || "",
									line: 1,
									label: `${__(df.label)} (${kind})`,
									short: __(df.label),
									from: `${kind} (${__(l.doctype)})`,
									dt: kind,
									via: __(l.doctype),
									fieldtype: type,
									options: type === "Link" ? df.options : undefined,
								};
							})
						)
				)
			).then((groups) => [].concat(...groups));
		}

		// how wide each column's text is: its header and its first rows, as the report formats them
		measure(cols, rows) {
			const ctx = (this.canvas = this.canvas || document.createElement("canvas")).getContext("2d");
			const td = this.grid.tBodies[0].querySelector("tr[data-v] td:not(.nxv-idx)") || this.grid;
			const cs = getComputedStyle(td);
			const font = `${cs.fontSize} ${cs.fontFamily}`;
			const sample = rows.filter((r) => !r.__nxg && !r.__nxfoot).slice(0, 300);
			const out = {};
			cols.forEach((c, ci) => {
				ctx.font = "600 " + font;
				let w = ctx.measureText(__(c.label)).width * 1.08 + 40;
				ctx.font = (cs.fontWeight || "400") + " " + font;
				sample.forEach((r) => {
					let text;
					try {
						text = $("<div>").html(this.format(r, c, r[c.fieldname])).text();
					} catch (e) {
						text = clean(r[c.fieldname]);
					}
					// a bold row (a tree's parent, a total) is wider
					const bold = r.bold || r.__nxkids ? 1.1 : 1.08;
					const tree = ci === 0 && this.is_tree ? (r.indent || 0) * 20 + 22 : 0;
					w = Math.max(w, ctx.measureText(text).width * bold + 22 + tree);
				});
				out[c.fieldname] = Math.min(600, Math.max(60, Math.ceil(w)));
			});
			return out;
		}

		link_tree(data) {
			// a row under a heading the report made (is_group), up to that group's total line, belongs to that heading
			let head = -1;
			data.forEach((r, i) => {
				r.__nxi = i;
				r.__nxkids = false;
				r.__nxparent = -1;
				if (r.is_group) head = i;
				r.__nxhead = r.is_group || this.own_total(r) ? -1 : head;
				if (this.own_total(r)) head = -1;
			});
			if (!this.is_tree) return;
			const stack = [];
			data.forEach((r, i) => {
				const ind = r.indent || 0;
				while (stack.length && (data[stack[stack.length - 1]].indent || 0) >= ind) stack.pop();
				if (stack.length) {
					r.__nxparent = stack[stack.length - 1];
					data[r.__nxparent].__nxkids = true;
				}
				stack.push(i);
			});
		}

		// ---------------------------------------------------------------- columns shown
		build_cols() {
			const hidden = new Set(this.layout.hidden);
			const order = this.layout.order;
			const known = new Set(this.columns.map((c) => c.fieldname));
			const rank = new Map(order.filter((f) => known.has(f)).map((f, i) => [f, i]));
			const cols = this.columns
				.filter((c) => !hidden.has(c.fieldname))
				.map((c) => Object.assign({}, c, { width: this.layout.widths[c.fieldname] || c.width, label: this.layout.labels[c.fieldname] || c.label }))
				.sort((a, b) => (rank.has(a.fieldname) ? rank.get(a.fieldname) : 1000 + a.index) - (rank.has(b.fieldname) ? rank.get(b.fieldname) : 1000 + b.index));
			return cols.length ? cols : this.columns.slice(0, 1);
		}

		col_of(f) {
			return this.columns.find((x) => x.fieldname === f);
		}

		// ---------------------------------------------------------------- rows shown
		// the filter row under the header, as in Frappe's table: text is searched in the cell;
		// a number column takes >5, <10, =324, !=0 or a range 5:10
		pass_filters(r) {
			if (this.state.query && !(r.__nxt || "").includes(this.state.query)) return false;
			if (this.state.conds.length && !this.pass_conds(r)) return false;
			for (const f in this.state.filters) {
				const q = this.state.filters[f];
				const c = this.col_of(f);
				if (!c) continue;
				const v = r[f];
				if (NUM.has(c.fieldtype)) {
					const n = to_number(v);
					const m = /^\s*(>=|<=|!=|>|<|=)?\s*(-?[\d.,]+)\s*(?::\s*(-?[\d.,]+))?\s*$/.exec(q);
					if (m) {
						const a = flt(m[2]);
						if (n === null) return false;
						if (m[3] !== undefined) {
							const b = flt(m[3]);
							if (n < Math.min(a, b) || n > Math.max(a, b)) return false;
							continue;
						}
						const op = m[1] || "=";
						const ok = { ">": n > a, "<": n < a, ">=": n >= a, "<=": n <= a, "!=": Math.abs(n - a) > 1e-9, "=": Math.abs(n - a) < 0.005 }[op];
						if (!ok) return false;
						continue;
					}
				}
				const text = clean(v).toLowerCase();
				const shown = c.fieldtype === "Date" && v ? frappe.datetime.str_to_user(v).toLowerCase() : "";
				const want = q.toLowerCase();
				if (!text.includes(want) && !shown.includes(want)) return false;
			}
			return true;
		}

		// Settings > Filter: on one column, a row stays when any Include holds; no Exclude may hold
		pass_conds(r) {
			const inc = {};
			for (const u of this.state.conds) {
				const c = this.col_of(u.f);
				if (!c) continue;
				const hit = this.rule_hit(u, r, c);
				if (u.exclude && hit) return false;
				if (!u.exclude) inc[u.f] = inc[u.f] || hit;
			}
			return Object.values(inc).every(Boolean);
		}

		rule_hit(u, r, c) {
			const x = r[c.fieldname];
			const n = to_number(x);
			const a = parse_num(u.x);
			const b = parse_num(u.x2);
			const t = clean(x).toLowerCase();
			// a date compares as yyyy-mm-dd, whatever the time on it
			const day = x ? String(x).slice(0, 10) : "";
			switch (u.op) {
				case "in":
					return (u.vals || []).includes(clean(x));
				case "on":
					return !!day && day === u.x;
				case "before":
					return !!day && day < u.x;
				case "after":
					return !!day && day > u.x;
				case "checked":
					return !!cint(x);
				case "unchecked":
					return !cint(x);
				case ">":
					return n !== null && n > a;
				case "<":
					return n !== null && n < a;
				case "=":
					return NUM.has(c.fieldtype) ? n !== null && Math.abs(n - a) < 0.005 : t === String(u.x || "").toLowerCase();
				case "between":
					if (kind_of(c) === "date") return !!day && day >= [u.x, u.x2].sort()[0] && day <= [u.x, u.x2].sort()[1];
					return n !== null && n >= Math.min(a, b) && n <= Math.max(a, b);
				case "neg":
					return n !== null && n < 0;
				case "zero":
					return n !== null && !n;
				case "contains":
					return t.includes(String(u.x || "").toLowerCase());
				case "empty":
					return x === null || x === undefined || x === "";
				case "notempty":
					return !(x === null || x === undefined || x === "");
			}
			return false;
		}

		filtering() {
			return !!this.state.query || this.state.conds.length > 0 || Object.keys(this.state.filters).length > 0;
		}

		tree_on() {
			return this.is_tree && !this.groups_now().length;
		}

		// the report's own total lines: Frappe's is_total_row, a row the report marks is_total or is_group,
		// and ERPNext's lines named in quotes ('Opening', 'Total', 'Closing (Opening + Total)')
		own_total(r) {
			return !!(r.is_total_row || r.is_total);
		}

		own_line(r) {
			return this.own_total(r) || (!this.is_tree && !!r.is_group) || this.columns.some((x) => /^'.*'$/.test(String(r[x.fieldname] ?? "").trim()));
		}

		compute_view() {
			this.own_groups = false;
			this.grouped_by = [];
			const filtering = this.filtering();
			if (this.tree_on()) {
				if (filtering) {
					const keep = new Set();
					this.rows.forEach((r, i) => {
						if (!this.pass_filters(r)) return;
						keep.add(i);
						for (let p = r.__nxparent; p > -1; p = this.rows[p].__nxparent) keep.add(p);
					});
					return this.rows.filter((r, i) => keep.has(i));
				}
				const list = [];
				let skip = null;
				for (const r of this.rows) {
					const ind = r.indent || 0;
					if (skip !== null && ind > skip) continue;
					skip = null;
					list.push(r);
					if (r.__nxkids && !r.__nxopen) skip = ind;
				}
				return list;
			}
			// a tree grouped by the user: its lowest rows are grouped (the rows above them are their totals)
			const source = this.is_tree ? this.rows.filter((r) => !r.__nxkids) : this.rows;
			let list = filtering ? source.filter((r) => this.pass_filters(r)) : source;
			const sorts = this.state.sorts.map((x) => ({ c: this.col_of(x.key), dir: x.dir })).filter((x) => x.c);
			// The groups the table makes itself: the user's levels. When the report made groups too (its own Group By
			// filter), they stay the outer level and the user's go inside them; and when the user filters or sorts, the
			// report's heading and total lines are for all its rows, so the table puts the rows shown under the same
			// headings and adds them up itself
			let levels = this.groups_now();
			if (!this.is_tree && source.some((r) => r.is_group) && (levels.length || filtering || sorts.length)) levels = [HEADS, ...levels];
			this.grouped_by = levels;
			if (sorts.length) {
				// sorted: the report's own total lines stay after the rows
				const totals = list.filter((r) => this.own_total(r));
				list = list.filter((r) => !this.own_total(r)).slice();
				list.sort((a, b) => {
					for (const x of sorts) {
						const d = this.compare(a, b, x.c);
						if (d) return d * x.dir;
					}
					return 0;
				});
				if (!levels.length) list = list.concat(totals);
			}
			if (levels.length) return this.group_rows(list.filter((r) => !this.own_line(r)), levels);
			// the report's own groups (a heading it marks is_group, its rows, its is_total line): they open and close
			// too, while the rows keep the report's order
			this.own_groups = !sorts.length && list.some((r) => r.is_group);
			if (this.own_groups) return this.fold_own_groups(list);
			return list;
		}

		// a closed group of the report's own shows its heading and its total line; the rows between them go
		fold_own_groups(list) {
			const out = [];
			this.group_keys = [];
			let head = null;
			list.forEach((r) => {
				// how the line looks: a group's heading and total as the view's, the report's last totals as its total
				r.__nxown = r.is_group ? "head" : this.own_total(r) ? (head ? "total" : "foot") : "";
				if (r.is_group) {
					head = r;
					r.__nxkey = "own\u241f" + r.__nxi;
					r.__nxcount = 0;
					this.group_keys.push(r.__nxkey);
					return out.push(r);
				}
				if (head && this.own_total(r)) {
					out.push(r);
					head = null;
					return;
				}
				if (head) {
					head.__nxcount += 1;
					if (this.closed.has(head.__nxkey)) return;
				}
				out.push(r);
			});
			return out;
		}

		compare(a, b, c) {
			const x = a[c.fieldname];
			const y = b[c.fieldname];
			const ex = x === null || x === undefined || x === "";
			const ey = y === null || y === undefined || y === "";
			if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
			if (NUM.has(c.fieldtype)) return (to_number(x) || 0) - (to_number(y) || 0);
			return String(clean(x)).localeCompare(String(clean(y)), undefined, { numeric: true, sensitivity: "base" });
		}

		// Group By, at up to three levels: for each group a heading, its rows (or its inner groups), its total
		group_rows(list, keys) {
			const levels = (keys || this.state.group_by).map((f) => (f === HEADS ? f : this.col_of(f))).filter(Boolean);
			if (!levels.length) return list;
			const out = [];
			this.group_keys = [];
			const build = (rows, depth, parent) => {
				const c = levels[depth];
				const groups = new Map();
				rows.forEach((r) => {
					const k = clean(r[c.fieldname]);
					if (!groups.has(k)) groups.set(k, []);
					groups.get(k).push(r);
				});
				const keys = [...groups.keys()].sort((a, b) => {
					// the report's groups keep the report's order
					if (c === HEADS) return Number(a) - Number(b);
					if (!a || !b) return a === b ? 0 : !a ? 1 : -1;
					return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
				});
				keys.forEach((k) => {
					const rs = groups.get(k);
					const shown = c === HEADS ? this.head_label(Number(k)) : k ? this.plain(rs[0], c) : __("Not Set");
					// a report's group keeps its key, so it stays open or closed as it was
					const key = (c === HEADS ? "own" : parent) + "\u241f" + k;
					const closed = this.closed.has(key);
					this.group_keys.push(key);
					// a group: its heading (name and count), its rows (or inner groups), its total line under them;
					// a closed group is its heading alone, with the totals on it
					out.push({ __nxg: "head", __nxlevel: depth, __nxlabel: c === HEADS ? shown : `${__(c.label)}: ${shown}`, __nxkey: key, __nxclosed: closed, __nxrows: rs });
					if (closed) return;
					if (depth + 1 < levels.length) build(rs, depth + 1, key);
					else out.push(...rs);
					this.total_lines(rs, `${__("Total")} ${shown}`).forEach((t) => out.push(Object.assign(t, { __nxg: "total", __nxlevel: depth })));
				});
			};
			build(list, 0, "");
			return out;
		}

		// a report's group heading as the report shows it: its first column
		head_label(i) {
			const h = this.rows[i];
			if (!h) return __("Not Set");
			const c = this.cols[0];
			return (c && this.plain(h, c)) || clean(h.group_label || h.name) || __("Not Set");
		}

		// a value as the user reads it, without its link
		plain(r, c) {
			try {
				return $("<div>").html(this.format(r, c, r[c.fieldname])).text().trim() || clean(r[c.fieldname]);
			} catch (e) {
				return clean(r[c.fieldname]);
			}
		}

		// what a column adds up to over rows: amounts and counts are added, a percentage is averaged
		// (as Frappe's total row does); a unit price, a running balance and amounts in more than one
		// currency are not. A column marked once_per counts each document once.
		// the field holding each row's currency, when the column's amounts are in their rows' own currency
		currency_field(c) {
			return c.fieldtype === "Currency" && c.options && !String(c.options).includes(":") && this.col_of(c.options) ? c.options : null;
		}

		// a total as the table shows it: in the rows' currency, and one total per currency when they differ
		sum_html(rows, c) {
			if (!rows || !rows.length) return "";
			const cur = this.currency_field(c);
			const parts = [];
			if (cur && new Set(rows.map((r) => r[cur])).size > 1) {
				const by = new Map();
				rows.forEach((r) => {
					const k = r[cur] || "";
					if (!by.has(k)) by.set(k, []);
					by.get(k).push(r);
				});
				[...by.keys()].sort().forEach((k) => parts.push([this.sum_of(by.get(k), c, true), by.get(k)[0]]));
			} else parts.push([this.sum_of(rows, c), rows[0]]);
			return parts
				.filter(([v]) => v !== null && v !== undefined)
				.map(([v, proxy]) => {
					let html;
					try {
						html = this.format(proxy, c, v, proxy);
					} catch (e) {
						html = esc(v);
					}
					// Frappe formats an amount as a block: kept on one line beside the others
					return `<span class="nxv-sum-part">${html}</span>`;
				})
				.join('<span class="nxv-sum-sep"></span>');
		}

		sum_of(rows, c, one_currency) {
			if (!NUM.has(c.fieldtype) || is_rate(c) || (c.src && c.src.disable_total)) return null;
			const running = c.fieldname === "balance" && ["debit", "credit"].every((f) => this.col_of(f));
			if (running) return null;
			const cur = one_currency ? null : this.currency_field(c);
			if (cur && new Set(rows.map((r) => r[cur])).size > 1) return null;
			const seen = c.once_per ? new Set() : null;
			let n = 0;
			const total = rows.reduce((sum, r) => {
				const doc = seen ? r[c.once_per] : null;
				if (doc != null && doc !== "") {
					if (seen.has(doc)) return sum;
					seen.add(doc);
				}
				n += 1;
				return sum + (to_number(r[c.fieldname]) || 0);
			}, 0);
			if (c.fieldtype === "Percent") return n ? round6(total / n) : null;
			return round6(total);
		}

		// the footer: Frappe's table adds up the rows it shows; so does this one
		// The table's total, at the bottom: when the report asks Frappe for one, when the view groups the rows,
		// and for any report with amounts that does not add its own total lines ('Total', 'Closing', a group's
		// total) and is not a tree (a statement's tree would add income and expenses together)
		// The lines a total takes. Rows in one currency: one line. Rows in several: a line for the columns that do
		// not follow the row's currency (counts, amounts in the company's currency), then one line per currency for
		// the amounts in the rows' own currency ("Total · EGP"), as the reports themselves show them
		total_lines(rows, label) {
			const own = this.columns.filter((c) => SUMMED.has(c.fieldtype) && this.currency_field(c));
			const field = own.length ? this.currency_field(own[0]) : null;
			const codes = field ? [...new Set(rows.map((r) => r[field] || ""))].sort() : [];
			if (codes.length < 2) return [{ __nxlabel: label, __nxrows: rows }];
			const lines = [];
			if (this.columns.some((c) => SUMMED.has(c.fieldtype) && !this.currency_field(c))) lines.push({ __nxlabel: label, __nxrows: rows, __nxpart: "other" });
			codes.forEach((code) => lines.push({ __nxlabel: `${label} · ${code || __("Not Set")}`, __nxrows: rows.filter((r) => (r[field] || "") === code), __nxpart: "own" }));
			return lines;
		}

		foot_row() {
			if (!this.show_total && !(this.grouped_by || []).length) {
				if (this.is_tree || this.rows.some((r) => this.own_line(r))) return null;
				if (!this.columns.some((c) => SUMMED.has(c.fieldtype) && !is_rate(c))) return null;
			}
			// a tree: its lowest rows (the rows above them are their totals)
			const rows = this.is_tree
				? this.rows.filter((r) => !r.__nxkids && (!this.filtering() || this.pass_filters(r)))
				: this.view.flatMap((r) => (r.__nxg === "head" && r.__nxclosed ? r.__nxrows : r.__nxg || r.__nxfoot ? [] : [r])).filter((r) => !this.own_total(r));
			return this.total_lines(rows, __("Total")).map((t) => Object.assign(t, { __nxfoot: true }));
		}

		// the rows shown, and the table's total lines after them: plain bold lines at the end of the table,
		// reached by scrolling, as the reports' own total lines are
		set_view(view) {
			this.view = view;
			const foot = this.foot_row();
			if (foot) this.view = view.concat(foot);
		}

		refresh(keep_scroll) {
			this.cols = this.build_cols();
			this.set_view(this.compute_view());
			if (!keep_scroll) this.scroller.scrollTop = 0;
			this.render_head();
			this.render_body(true);
			update_buttons(this.qr, this);
		}

		// ---------------------------------------------------------------- drawing
		// the first N columns (and the row numbers) stay in place: each sticks at the width of what is before it
		frozen() {
			const n = Math.min(this.layout.freeze || 0, this.cols.length);
			let off = 50;
			this.fz = this.cols.map((c, ci) => {
				if (ci >= n) return null;
				const a = { off, last: ci === n - 1 };
				off += c.width;
				return a;
			});
			this.fz_on = n > 0;
		}

		fz_cell(html, ci) {
			const a = this.fz && this.fz[ci];
			if (!a) return html;
			return html.replace(/^<(td|th)/, `<$1 data-fz="${a.last ? "last" : "1"}" style="inset-inline-start:${a.off}px"`);
		}

		fz_idx(html) {
			return this.fz_on ? html.replace(/^<(td|th)/, '<$1 data-fz="1" style="inset-inline-start:0"') : html;
		}

		render_head() {
			this.$wrap.toggleClass("nxv-compact", !!this.layout.density);
			this.frozen();
			const width = 50 + this.cols.reduce((s, c) => s + c.width, 0);
			this.grid.style.width = width + "px";
			this.grid.querySelector("colgroup").innerHTML = `<col style="width:50px">` + this.cols.map((c) => `<col style="width:${c.width}px">`).join("");
			const sorts = this.state.sorts;
			const head = this.cols
				.map((c, ci) => {
					const num = NUM.has(c.fieldtype) ? " nxv-r" : "";
					const si = sorts.findIndex((x) => x.key === c.fieldname);
					const mark = si > -1 ? `<span class="nxv-sort">${sorts[si].dir > 0 ? "↑" : "↓"}${sorts.length > 1 ? si + 1 : ""}</span>` : "";
					return this.fz_cell(`<th class="nxv-th${num}" data-ci="${ci}" draggable="true" title="${esc(__(c.label))}"><span class="nxv-th-t">${esc(__(c.label))}</span>${mark}<button type="button" class="nxv-th-menu" data-ci="${ci}" aria-label="${__("Column menu")}">${CARET}</button><span class="nxv-rz" data-rz="${ci}"></span></th>`, ci);
				})
				.join("");
			const filters = this.cols
				.map((c, ci) => this.fz_cell(`<th class="nxv-fl"><input type="text" class="nxv-filter" data-f="${esc(c.fieldname)}" data-ci="${ci}" value="${esc(this.state.filters[c.fieldname] || "")}" placeholder="${esc(__("Filter"))}" aria-label="${__("Filter")} ${esc(__(c.label))}"></th>`, ci))
				.join("");
			const idx = this.fz_idx('<th class="nxv-idx"></th>');
			// open or close every group (or every level of a tree) at once: always in their place, dimmed
			// when the table has nothing to open or close
			const can = !!((this.grouped_by || []).length || this.tree_on() || this.own_groups);
			const off = can ? "" : " disabled";
			const xtip = (t) => (can ? t : __("Group the rows to open or close them"));
			const corner = this.fz_idx(
				`<th class="nxv-idx nxv-corner"><span class="nxv-corner-btns"><button type="button" data-xall="1" title="${xtip(__("Expand All"))}" aria-label="${__("Expand All")}"${off}>${icon("chevrons-up-down")}</button><button type="button" data-xall="0" title="${xtip(__("Collapse All"))}" aria-label="${__("Collapse All")}"${off}>${icon("chevrons-down-up")}</button></span></th>`
			);
			// compact rows, and back
			const dense = !!this.layout.density;
			const tip = dense ? __("Normal rows") : __("Compact rows");
			const density = this.fz_idx(
				`<th class="nxv-idx nxv-corner"><span class="nxv-corner-btns"><button type="button" data-density="1" title="${tip}" aria-label="${tip}" aria-pressed="${dense}">${icon(dense ? "unfold-vertical" : "fold-vertical")}</button></span></th>`
			);
			this.grid.tHead.innerHTML = `<tr class="nxv-hr">${corner}${head}</tr><tr class="nxv-fr">${density}${filters}</tr>`;
			this.grid.tFoot.innerHTML = "";
		}

		// Frappe's table calls a column's format with the row's cells and the column's place
		// (colIndex: 0 is the row number, the report's columns start at 1); report formatters read both
		format(r, c, raw, data) {
			// a field of a linked document: formatted as that field is in its own form
			if (c.linked) return raw === null || raw === undefined ? "" : frappe.format(raw, { fieldtype: c.fieldtype, options: c.options }, { inline: true }, data || r);
			if (!c.src || !c.src.format) return esc(clean(raw));
			if (!c.fcol) c.fcol = Object.assign({}, c.src, { colIndex: c.index + 1, docfield: c.src });
			let cells = this.cells_of.get(r);
			if (!cells) {
				cells = [{ content: r.__nxi, colIndex: 0 }].concat(this.report_columns.map((x, k) => ({ content: r[x.fieldname], colIndex: k + 1, column: x.src })));
				this.cells_of.set(r, cells);
			}
			const html = c.src.format(raw, cells, c.fcol, data || r);
			return html === null || html === undefined ? "" : String(html);
		}

		cell(r, c, ci) {
			const num = NUM.has(c.fieldtype) ? "nxv-r" : "";
			if (r.__nxg === "head" && ci === 0) {
				const tw = `<span class="nxv-tw ${r.__nxclosed ? "" : "open"}" data-g="${esc(r.__nxkey)}" role="button" aria-label="${__("Expand or collapse")}">${CHEVRON}</span>`;
				return `<td class="nxv-glabel"><span class="nxv-acc" style="padding-inline-start:${r.__nxlevel * 16}px">${tw}<span>${esc(r.__nxlabel)}</span><span class="nxv-cnt">${r.__nxrows.length}</span></span></td>`;
			}
			// a group's total line, a closed group's heading and the table's total: each amount added up over their rows
			if (r.__nxg || r.__nxfoot) {
				if (ci === 0 && r.__nxfoot) return `<td class="nxv-glabel"><span>${esc(r.__nxlabel)}</span></td>`;
				if (ci === 0 && r.__nxg === "total") return `<td class="nxv-glabel"><span style="padding-inline-start:${r.__nxlevel * 16 + 22}px">${esc(r.__nxlabel)}</span></td>`;
				if (!NUM.has(c.fieldtype) || (r.__nxg === "head" && !r.__nxclosed)) return "<td></td>";
				// a line of a total in several currencies: each amount on its own line, once
				if (r.__nxpart === "other" && this.currency_field(c)) return "<td></td>";
				if (r.__nxpart === "own" && !this.currency_field(c)) return "<td></td>";
				const html = this.sum_html(r.__nxrows, c);
				const tip = html.includes("nxv-sum-sep") ? ` title="${esc($("<div>").html(html.replace(/<span class="nxv-sum-sep"><\/span>/g, " · ")).text())}"` : "";
				return `<td class="${num}"${tip}>${html}</td>`;
			}
			// a heading or a total line the report made: empty where it has nothing, as the view's own lines
			if (ci > 0 && this.own_groups && r.__nxown && (r.__nxown === "head" || !NUM.has(c.fieldtype))) return "<td></td>";
			// and its name as the view's own lines show theirs: plain, the total's under the heading's name
			if (ci === 0 && this.own_groups && r.__nxown) {
				const name = esc(this.plain(r, c));
				if (r.__nxown === "head" && r.__nxkey) {
					const tw = `<span class="nxv-tw ${this.closed.has(r.__nxkey) ? "" : "open"}" data-g="${esc(r.__nxkey)}" role="button" aria-label="${__("Expand or collapse")}">${CHEVRON}</span>`;
					return `<td class="nxv-glabel"><span class="nxv-acc">${tw}<span>${name}</span><span class="nxv-cnt">${r.__nxcount}</span></span></td>`;
				}
				return `<td class="nxv-glabel"><span${r.__nxown === "total" ? ' style="padding-inline-start:22px"' : ""}>${name}</span></td>`;
			}
			const raw = r[c.fieldname];
			let html;
			try {
				html = this.format(r, c, raw);
			} catch (e) {
				html = esc(clean(raw));
			}
			if (ci === 0 && this.tree_on()) {
				const tw = `<span class="nxv-tw ${r.__nxkids ? (r.__nxopen || this.filtering() ? "open" : "") : "leaf"}" data-tw="${r.__nxi}" role="button" aria-label="${__("Expand or collapse")}">${CHEVRON}</span>`;
				html = `<span class="nxv-acc" style="padding-inline-start:${(r.indent || 0) * 20}px">${tw}<span>${html}</span></span>`;
			}
			const tip = typeof raw === "string" || typeof raw === "number" ? ` title="${esc(clean(raw))}"` : "";
			return `<td class="${num}"${tip}>${html}</td>`;
		}

		row_html(r, v, no) {
			const own = this.own_groups && r.__nxown;
			const cls = r.__nxg
				? `nxv-g nxv-g-${r.__nxg} nxv-l${Math.min(r.__nxlevel, 2)}`
				: r.__nxfoot || own === "foot"
				? "nxv-foot"
				: own
				? `nxv-g nxv-g-${own} nxv-l0`
				: this.own_total(r)
				? "nxv-tot"
				: "";
			const idx = this.fz_idx(`<td class="nxv-idx">${no || ""}</td>`);
			return `<tr class="${cls}" data-v="${v}">${idx}${this.cols.map((c, ci) => this.fz_cell(this.cell(r, c, ci), ci)).join("")}</tr>`;
		}

		// only the rows near the screen are drawn; drawn rows never change, so nothing shakes
		render_body(force) {
			const n = this.view.length;
			if (!this.numbers || force) {
				let k = 0;
				this.numbers = this.view.map((r) => (r.__nxg || r.__nxfoot || (this.own_groups && r.__nxown) ? "" : ++k));
			}
			let s = 0;
			let e = n;
			if (n > 150) {
				const first = Math.floor(this.scroller.scrollTop / this.row_h);
				s = Math.max(0, Math.floor(first / BLOCK) * BLOCK - BLOCK);
				e = Math.min(n, s + Math.ceil((this.scroller.clientHeight || 600) / this.row_h) + BLOCK * 3);
			}
			if (!force && s === this.win[0] && e === this.win[1]) return;
			this.win = [s, e];
			const span = this.cols.length + 1;
			const spacer = (h) => (h > 0 ? `<tr class="nxv-sp"><td colspan="${span}" style="height:${h}px"></td></tr>` : "");
			let html = spacer(s * this.row_h);
			for (let v = s; v < e; v++) html += this.row_html(this.view[v], v, this.numbers[v]);
			html += spacer((n - e) * this.row_h);
			if (!n) html = `<tr class="nxv-empty"><td colspan="${span}">${__("Nothing to show")}</td></tr>`;
			// the focus was on a drawn row (a link in a cell): it stays with the table, so the arrow keys keep working
			const had_focus = this.grid.tBodies[0].contains(document.activeElement);
			this.grid.tBodies[0].innerHTML = html;
			if (had_focus) this.scroller.focus({ preventScroll: true });
			this.paint_cur();
			// the rows' real height, measured once: the room left above and below the drawn rows uses it
			const tr = this.grid.tBodies[0].querySelector("tr[data-v]");
			if (tr && tr.offsetHeight && Math.abs(tr.offsetHeight - this.row_h) > 0.5) {
				this.row_h = tr.offsetHeight;
				this.render_body(true);
			}
		}

		// ---------------------------------------------------------------- the current cell, moved with the keys
		cur_td() {
			if (!this.cur) return null;
			const tr = this.grid.tBodies[0].querySelector(`tr[data-v="${this.cur.v}"]`);
			return tr ? tr.children[this.cur.c + 1] || null : null;
		}

		paint_cur() {
			this.grid.querySelectorAll("td.nxv-cur").forEach((td) => td.classList.remove("nxv-cur"));
			this.grid.querySelectorAll("tr.nxv-cur-row").forEach((tr) => tr.classList.remove("nxv-cur-row"));
			if (!this.cur) return;
			if (this.cur.v >= this.view.length || this.cur.c >= this.cols.length) {
				this.cur = this.view.length && this.cols.length ? { v: Math.min(this.cur.v, this.view.length - 1), c: Math.min(this.cur.c, this.cols.length - 1) } : null;
				if (!this.cur) return;
			}
			const td = this.cur_td();
			if (td) {
				td.classList.add("nxv-cur");
				// the whole row stays shaded until another row is picked
				td.parentElement.classList.add("nxv-cur-row");
			}
		}

		// moves the current cell and scrolls it into sight: under the header, above the total, beside the frozen columns
		move_cur(v, c) {
			const n = this.view.length;
			if (!n || !this.cols.length) return;
			v = Math.max(0, Math.min(n - 1, v));
			c = Math.max(0, Math.min(this.cols.length - 1, c));
			this.cur = { v, c };
			const sc = this.scroller;
			const head = this.grid.tHead.offsetHeight;
			const foot = this.grid.tFoot.offsetHeight;
			const top = head + v * this.row_h;
			if (top - head < sc.scrollTop) sc.scrollTop = top - head;
			else if (top + this.row_h > sc.scrollTop + sc.clientHeight - foot) sc.scrollTop = top + this.row_h - sc.clientHeight + foot;
			let left = 50;
			for (let i = 0; i < c; i++) left += this.cols[i].width;
			const right = left + this.cols[c].width;
			// what stays on the left: the row numbers and the frozen columns
			let fixed = 50;
			(this.fz || []).forEach((a, i) => {
				if (a && a.last) fixed = a.off + this.cols[i].width;
			});
			if (!(this.fz && this.fz[c])) {
				if (left - fixed < sc.scrollLeft) sc.scrollLeft = left - fixed;
				else if (right > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = right - sc.clientWidth;
			}
			this.render_body(false);
			this.paint_cur();
		}

		on_key(e) {
			if (e.target.closest && e.target.closest("input, select, textarea")) return;
			if (!this.cur) return;
			const { v, c } = this.cur;
			const page = Math.max(1, Math.floor((this.scroller.clientHeight - this.grid.tHead.offsetHeight) / this.row_h) - 1);
			const ctrl = e.ctrlKey || e.metaKey;
			const go = {
				ArrowUp: [v - 1, c],
				ArrowDown: [v + 1, c],
				ArrowLeft: frappe.utils.is_rtl() ? [v, c + 1] : [v, c - 1],
				ArrowRight: frappe.utils.is_rtl() ? [v, c - 1] : [v, c + 1],
				Tab: e.shiftKey ? [v, c - 1] : [v, c + 1],
				Home: ctrl ? [0, c] : [v, 0],
				End: ctrl ? [this.view.length - 1, c] : [v, this.cols.length - 1],
				PageUp: [v - page, c],
				PageDown: [v + page, c],
			}[e.key];
			if (go) {
				e.preventDefault();
				return this.move_cur(go[0], go[1]);
			}
			if (e.key === "Escape") {
				this.cur = null;
				return this.paint_cur();
			}
			const td = this.cur_td();
			if (!td) return;
			if (e.key === "Enter") {
				const a = td.querySelector("a[href], [data-tw], [data-g]");
				if (a) {
					e.preventDefault();
					a.click();
				}
			} else if (ctrl && (e.key === "c" || e.key === "C") && !String(window.getSelection() || "")) {
				e.preventDefault();
				frappe.utils.copy_to_clipboard(td.innerText.trim());
			}
		}

		// the table as tall as the room left on the screen, so the page under it does not scroll too
		fit_height() {
			const el = this.scroller;
			if (this.$wrap.prop("hidden") || !el.offsetParent || window.innerWidth <= 640) {
				el.style.height = "";
				return;
			}
			const rect = el.getBoundingClientRect();
			// where the table starts, as if the page were scrolled to its top
			const sp = el.closest(".main-section");
			const top = rect.top + (sp ? sp.scrollTop : window.scrollY);
			// what shows under the table (Frappe's line about filtering, the execution time): only the parts
			// after it that are on the screen, never the empty room at the end of the page
			let below = 0;
			for (let n = this.$wrap[0].nextElementSibling; n; n = n.nextElementSibling) {
				if (!n.offsetParent || n.classList.contains("nxv-skel")) continue;
				below = Math.max(below, n.getBoundingClientRect().bottom - rect.bottom);
			}
			const h = Math.round(Math.max(300, window.innerHeight - top - below - 16));
			if (Math.abs(rect.height - h) < 2) return;
			el.style.height = h + "px";
			if (this.view) this.render_body(true);
		}

		// each column as wide as its longest text (the header and the first rows), for the Autofit button
		autofit() {
			this.layout.widths = Object.assign({}, this.layout.widths, this.measure(this.cols, this.view));
			this.refresh(true);
		}

		// each column as wide as its text again
		reset_widths() {
			this.layout.widths = {};
			this.refresh(true);
		}

		// ---------------------------------------------------------------- the layout in use
		current_state() {
			return {
				order: this.cols.map((c) => c.fieldname),
				hidden: this.columns.map((c) => c.fieldname).filter((f) => !this.cols.find((c) => c.fieldname === f)),
				// only the widths the user set: the others are measured from the rows each time
				widths: Object.assign({}, this.layout.widths),
				labels: Object.assign({}, this.layout.labels),
				sorts: JSON.parse(JSON.stringify(this.state.sorts)),
				conds: JSON.parse(JSON.stringify(this.state.conds)),
				group_by: this.state.group_by.slice(),
				added: JSON.parse(JSON.stringify(this.layout.added || [])),
				freeze: this.layout.freeze || 0,
				density: this.layout.density ? 1 : 0,
			};
		}

		// the table as the layout in use saved it, or changed since (a * on the Layout button)
		mark_saved() {
			this.saved_json = this.cols ? JSON.stringify(this.current_state()) : null;
			update_buttons(this.qr, this);
		}

		is_dirty() {
			return !!this.saved_json && !!this.cols && JSON.stringify(this.current_state()) !== this.saved_json;
		}

		use_state(st, saved) {
			this.closed = new Set();
			this.layout = { order: st.order, hidden: st.hidden, widths: st.widths, labels: st.labels || {}, added: st.added || [], freeze: st.freeze || 0, density: st.density ? 1 : 0 };
			if (this.rows) this.add_linked_columns();
			this.state.sorts = st.sorts;
			this.state.conds = st.conds || [];
			this.state.group_by = st.group_by.slice(0, MAX_LEVELS);
			if (this.rows) {
				this.refresh();
				this.fetch_linked();
			}
			if (saved) this.mark_saved();
		}

		set_sort(f, dir) {
			this.state.sorts = dir ? [{ key: f, dir }] : [];
			this.refresh();
		}

		hide_column(f) {
			if (this.cols.length < 2) return;
			const st = this.current_state();
			st.hidden.push(f);
			st.order = st.order.filter((x) => x !== f);
			this.use_state(st);
		}

		// the user's levels whose column the table has now (a level on a column the report leaves out this run,
		// or a linked column not added yet, waits: it is kept, not dropped)
		groups_now() {
			return this.state.group_by.filter((f) => this.col_of(f));
		}

		set_groups(keys) {
			this.state.group_by = [...new Set(keys)].slice(0, MAX_LEVELS);
			this.closed = new Set();
			this.refresh();
		}

		// Frappe's own rule (frappe.ui.handle_link_cell_click), for this table's cells
		open_link(e, link) {
			if (!frappe.ui.split_view_enabled || !frappe.ui.split_view_enabled()) return;
			if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
			const { doctype, name } = link.dataset;
			const td = link.closest("td");
			const c = td && td.closest("tbody") ? this.cols[td.cellIndex - 1] : null;
			if (!doctype || !name || !c) return;
			if (!["Link", "Dynamic Link"].includes(c.fieldtype) || c.fieldname === "name") return;
			e.preventDefault();
			// keeps Frappe's router from routing away
			e.stopPropagation();
			frappe.require("side_panel.bundle.js").then(() => frappe.ui.get_side_panel().open(doctype, name));
		}

		// ---------------------------------------------------------------- the column menu
		// Frappe's own menu (frappe.ui.Dropdown) on the arrow of each header: made on the first click, and
		// built again each time it opens, so it always reads the table as it is
		open_colmenu(btn) {
			if (btn.__nxv_menu) return;
			btn.__nxv_menu = new frappe.ui.Dropdown({ trigger: btn, align: "end", options: () => this.colmenu_items(+btn.dataset.ci) });
			btn.__nxv_menu.open();
		}

		colmenu_items(ci) {
			const c = this.cols[ci];
			if (!c) return [];
			const sorted = this.state.sorts[0] && this.state.sorts[0].key === c.fieldname;
			const freeze = this.layout.freeze || 0;
			return [
				{ label: __("Sort Ascending"), icon: "arrow-up", disabled: this.tree_on(), onclick: () => this.set_sort(c.fieldname, 1) },
				{ label: __("Sort Descending"), icon: "arrow-down", disabled: this.tree_on(), onclick: () => this.set_sort(c.fieldname, -1) },
				{ label: __("Reset Sorting"), icon: "x", disabled: !sorted, onclick: () => this.set_sort(null, 0) },
				{ label: __("Group By This Column"), icon: "layers", disabled: NUM.has(c.fieldtype) || this.groups_now().includes(c.fieldname), onclick: () => this.set_groups(this.groups_now().concat([c.fieldname])) },
				{ label: __("Remove Column"), icon: "trash-2", disabled: this.cols.length < 2, onclick: () => this.hide_column(c.fieldname) },
				{
					group: "",
					hide_label: true,
					options: [
						{ label: ci === 0 ? __("Freeze This Column") : __("Freeze Up to This Column"), icon: "lock", disabled: freeze === ci + 1, onclick: () => this.set_freeze(ci + 1) },
						{ label: __("Unfreeze Columns"), icon: "lock-open", disabled: !freeze, onclick: () => this.set_freeze(0) },
					],
				},
			];
		}

		set_freeze(n) {
			this.layout.freeze = n;
			this.refresh(true);
		}

		// ---------------------------------------------------------------- events
		bind() {
			const grid = this.grid;
			let resizing = null;
			let just_resized = false;
			let drag_f = null;

			grid.addEventListener("mousedown", (e) => {
				const td = e.target.closest("tbody td");
				if (td && !td.closest("tr.nxv-sp, tr.nxv-empty") && td.cellIndex > 0) {
					this.cur = { v: +td.parentElement.dataset.v, c: td.cellIndex - 1 };
					this.paint_cur();
					this.scroller.focus({ preventScroll: true });
					return;
				}
				const rz = e.target.closest(".nxv-rz");
				if (!rz) return;
				e.preventDefault();
				e.stopPropagation();
				const ci = +rz.dataset.rz;
				resizing = { ci, x: e.clientX, w: this.cols[ci].width, col: grid.querySelectorAll("col")[ci + 1] };
			});
			this.on_move = (e) => {
				if (!resizing) return;
				const width = Math.max(50, resizing.w + (frappe.utils.is_rtl() ? resizing.x - e.clientX : e.clientX - resizing.x));
				resizing.col.style.width = width + "px";
				this.cols[resizing.ci].width = width;
				grid.style.width = 50 + this.cols.reduce((s, c) => s + c.width, 0) + "px";
			};
			this.on_up = () => {
				if (!resizing) return;
				const c = this.cols[resizing.ci];
				this.layout.widths = Object.assign({}, this.layout.widths, { [c.fieldname]: Math.round(c.width) });
				if (this.fz && this.fz[resizing.ci]) this.refresh(true);
				update_buttons(this.qr, this);
				resizing = null;
				just_resized = true;
				setTimeout(() => (just_resized = false), 50);
			};
			document.addEventListener("mousemove", this.on_move);
			document.addEventListener("mouseup", this.on_up);

			grid.addEventListener("click", (e) => {
				const tw = e.target.closest("[data-tw]");
				if (tw) {
					const r = this.rows[+tw.dataset.tw];
					if (r && r.__nxkids && !this.filtering()) {
						r.__nxopen = !r.__nxopen;
						this.refresh(true);
					}
					return;
				}
				// a link opens as it does in Frappe's report: a Link or Dynamic Link cell in the side panel,
				// anything else (and Ctrl/Shift/middle clicks) the way the browser and Frappe's router open it
				const a = e.target.closest("a[data-doctype][data-name]");
				if (a) return this.open_link(e, a);
				if (e.target.closest("[data-density]")) {
					this.layout.density = this.layout.density ? 0 : 1;
					this.refresh(true);
					return this.fit_height();
				}
				const x = e.target.closest("[data-xall]");
				if (x) {
					const open = x.dataset.xall === "1";
					if ((this.grouped_by || []).length || this.own_groups) this.closed = open ? new Set() : new Set(this.group_keys || []);
					else (this.rows || []).forEach((r) => r.__nxkids && (r.__nxopen = open));
					return this.refresh(true);
				}
				const g = e.target.closest("[data-g]");
				if (g) {
					const k = g.dataset.g;
					if (this.closed.has(k)) this.closed.delete(k);
					else this.closed.add(k);
					return this.refresh(true);
				}
				const mb = e.target.closest(".nxv-th-menu");
				if (mb) {
					e.stopPropagation();
					return this.open_colmenu(mb);
				}
				const th = e.target.closest("th.nxv-th");
				if (th && !this.tree_on() && !just_resized && !e.target.closest(".nxv-rz")) {
					const c = this.cols[+th.dataset.ci];
					const s = this.state.sorts[0];
					this.set_sort(c.fieldname, s && s.key === c.fieldname ? -s.dir : NUM.has(c.fieldtype) ? -1 : 1);
				}
			});

			// the filter row: the rows are filtered a moment after the user stops typing
			let ft = null;
			grid.addEventListener("input", (e) => {
				const inp = e.target.closest(".nxv-filter");
				if (!inp) return;
				clearTimeout(ft);
				ft = setTimeout(() => {
					const q = inp.value.trim();
					if (q) this.state.filters[inp.dataset.f] = q;
					else delete this.state.filters[inp.dataset.f];
					this.set_view(this.compute_view());
					this.scroller.scrollTop = 0;
					this.render_body(true);
				}, 250);
			});

			// drag a header to move its column
			grid.addEventListener("dragstart", (e) => {
				const th = e.target.closest("th.nxv-th");
				if (!th) return;
				drag_f = this.cols[+th.dataset.ci].fieldname;
				e.dataTransfer.effectAllowed = "move";
				try {
					e.dataTransfer.setData("text/plain", drag_f);
				} catch (err) {
					// some browsers refuse custom drag data
				}
			});
			grid.addEventListener("dragover", (e) => {
				const th = e.target.closest("th.nxv-th");
				if (!th || !drag_f) return;
				e.preventDefault();
				grid.querySelectorAll("th.nxv-drop").forEach((x) => x.classList.remove("nxv-drop"));
				th.classList.add("nxv-drop");
			});
			grid.addEventListener("drop", (e) => {
				const th = e.target.closest("th.nxv-th");
				if (!th || !drag_f) return;
				e.preventDefault();
				const target = this.cols[+th.dataset.ci].fieldname;
				if (target !== drag_f) {
					const st = this.current_state();
					const list = st.order.filter((f) => f !== drag_f);
					list.splice(list.indexOf(target), 0, drag_f);
					st.order = list;
					this.use_state(st);
				}
				drag_f = null;
			});
			grid.addEventListener("dragend", () => {
				drag_f = null;
				grid.querySelectorAll("th.nxv-drop").forEach((x) => x.classList.remove("nxv-drop"));
			});

			this.scroller.addEventListener("keydown", (e) => this.on_key(e));

			let ticking = false;
			this.scroller.addEventListener(
				"scroll",
				() => {
					if (ticking) return;
					ticking = true;
					requestAnimationFrame(() => {
						ticking = false;
						this.render_body(false);
					});
				},
				{ passive: true }
			);

			this.on_resize = frappe.utils.debounce(() => this.fit_height(), 120);
			window.addEventListener("resize", this.on_resize);
		}
	}

	// ------------------------------------------------------------------ Layout and Group By buttons
	// Two buttons in the report's header, next to Frappe's own. Layout opens a menu of the saved layouts, as
	// Frappe's list view opens its own (Standard, the public layouts, the user's, then Save, Save As, View
	// Settings and Manage Layouts); the layout picked last opens the report next time, as in Frappe's list.
	// Group By opens View Settings on its Group tab.

	function active_layout(view) {
		const entry = layout_store[view.report_name];
		return (entry && entry.list.find((l) => l.name === view.active)) || null;
	}

	function col_label(view, f) {
		const c = view.col_of(f);
		return c ? __(c.label) : f;
	}

	function update_buttons(qr, view) {
		const page = qr && qr.page;
		if (!page || !page.inner_toolbar) return;
		if (!page.inner_toolbar.find(".nxr-layout-btn").length) {
			const $layout = page.add_inner_button(__("Layout"), () => {}).addClass("nxr-layout-btn");
			new frappe.ui.Dropdown({
				trigger: $layout,
				align: "end",
				options: () => (qr.__nxv && qr.__nxv.cols ? layout_menu(qr.__nxv) : []),
				empty_text: __("Run the report first"),
			});
			page.add_inner_button(__("Group By"), () => qr.__nxv && qr.__nxv.cols && open_settings(qr.__nxv, "group")).addClass("nxr-group-btn");
		}
		// the buttons stay while the report opens or runs (they never come and go): only a report shown in
		// Frappe's table (one with row check boxes, or too many rows) has none
		const on = !uses_row_checkboxes(qr) && !too_big(qr);
		const $ours = page.inner_toolbar.find(".nxr-layout-btn, .nxr-group-btn");
		$ours.toggleClass("hide", !on);
		// after the report's own buttons, as they always were
		const $last = page.inner_toolbar.children().last();
		if ($last.length && !$last.is(".nxr-group-btn") && !$last.is($ours)) $ours.appendTo(page.inner_toolbar);
		if (!on) return;
		if (!view || view.report_name !== qr.report_name || !view.cols) {
			// before the table: the layout the report opens with, so the button's text does not change size later
			const entry = layout_store[qr.report_name];
			const def = entry && entry.list.find((l) => l.name === entry.def);
			const text = __("Layout") + ": " + (def ? def.layout_name : __("Standard"));
			const $l = page.inner_toolbar.find(".nxr-layout-btn");
			if ($l.text() !== text) $l.text(text);
			return;
		}
		const layout = active_layout(view);
		const name = layout ? layout.layout_name : __("Standard");
		page.inner_toolbar
			.find(".nxr-layout-btn")
			.text(__("Layout") + ": " + name + (view.is_dirty() ? " *" : ""))
			.attr("title", view.is_dirty() ? __("Changed since it was saved") : name);
		const names = view.groups_now().map((f) => col_label(view, f));
		page.inner_toolbar
			.find(".nxr-group-btn")
			.text(names.length ? __("Group By") + ": " + names[0] + (names.length > 1 ? " +" + (names.length - 1) : "") : __("Group By"))
			.attr("title", names.join(" › "));
	}

	// the Layout menu: built again each time it opens, so it always shows the layout in use
	function layout_menu(view) {
		const entry = layout_store[view.report_name] || { list: [] };
		const me = frappe.session.user;
		const active = active_layout(view);
		const row = (l) => ({
			label: l ? l.layout_name : __("Standard"),
			selected: (active ? active.name : STANDARD) === (l ? l.name : STANDARD),
			onclick: () => choose_layout(view, l),
		});
		const shared = entry.list.filter((l) => l.is_public && l.owner !== me);
		const own = entry.list.filter((l) => l.owner === me);
		const items = [row(null)];
		if (shared.length) items.push({ group: __("Public Layouts"), options: shared.map(row) });
		if (own.length) items.push({ group: __("Your Layouts"), options: own.map(row) });
		items.push({
			group: "",
			hide_label: true,
			options: [
				{
					label: active ? __("Save to {0}", [active.layout_name]) : __("Save"),
					icon: "save",
					disabled: !(active && mine(active) && view.is_dirty()),
					onclick: () => save_layout(view),
				},
				{ label: __("Save As New Layout"), icon: "plus", onclick: () => save_layout_as(view) },
				{ label: __("View Settings"), icon: "columns-3", onclick: () => open_settings(view, "columns") },
				{ label: __("Manage Layouts"), icon: "settings", onclick: () => open_settings(view, "layouts") },
			],
		});
		return items;
	}

	// a layout picked: the table takes it, and the report opens with it next time
	function choose_layout(view, layout) {
		view.active = layout ? layout.name : STANDARD;
		view.use_state(parse_layout(layout), true);
		set_default(view, view.active);
	}

	function save_layout(view, after) {
		const layout = active_layout(view);
		if (!layout) return save_layout_as(view, after);
		if (!mine(layout)) return frappe.msgprint(__("This layout belongs to {0}. Use Save As to keep your own copy.", [esc(frappe.user.full_name(layout.owner))]));
		const state = JSON.stringify(view.current_state());
		return frappe.db.set_value(LAYOUT, layout.name, "state", state).then(() => {
			layout.state = state;
			view.mark_saved();
			frappe.show_alert({ message: __("Layout {0} saved", [esc(layout.layout_name)]), indicator: "green" });
			if (after) after();
		});
	}

	// a new layout: of the table as it is now, or a copy of another layout (Duplicate)
	function save_layout_as(view, after, from) {
		const entry = layouts_of(view.report_name);
		const d = new frappe.ui.Dialog({
			title: from ? __("Duplicate Layout") : __("Save Layout As"),
			fields: [
				{ fieldname: "layout_name", fieldtype: "Data", label: __("Layout Name"), reqd: 1, default: from ? __("{0} (Copy)", [from.layout_name]) : "" },
				{ fieldname: "is_public", fieldtype: "Check", label: __("Available to all users"), description: __("Everyone who can open this report can use it") },
			],
			primary_action_label: __("Save"),
			primary_action(values) {
				const name = values.layout_name.trim();
				if (entry.list.some((l) => l.owner === frappe.session.user && l.layout_name === name)) return frappe.msgprint(__("A layout with this name already exists"));
				d.disable_primary_action();
				Promise.resolve(frappe.db.insert({ doctype: LAYOUT, report: view.report_name, layout_name: name, is_public: values.is_public ? 1 : 0, state: from ? from.state : JSON.stringify(view.current_state()) }))
					.then((doc) => {
						d.hide();
						entry.list.push({ name: doc.name, layout_name: doc.layout_name, is_public: doc.is_public, owner: doc.owner, state: doc.state });
						entry.list.sort((a, b) => a.layout_name.localeCompare(b.layout_name));
						if (from) choose_layout(view, entry.list.find((l) => l.name === doc.name));
						else {
							view.active = doc.name;
							view.mark_saved();
							set_default(view, doc.name);
						}
						frappe.show_alert({ message: __("Layout {0} saved", [esc(doc.layout_name)]), indicator: "green" });
						if (after) after();
					})
					.finally(() => d.enable_primary_action());
			},
		});
		d.show();
	}

	// a layout's name, and whether everyone can use it
	function edit_layout(view, layout, after) {
		const d = new frappe.ui.Dialog({
			title: __("Edit Layout"),
			fields: [
				{ fieldname: "layout_name", fieldtype: "Data", label: __("Layout Name"), reqd: 1, default: layout.layout_name },
				{ fieldname: "is_public", fieldtype: "Check", label: __("Available to all users"), default: layout.is_public ? 1 : 0, description: __("Everyone who can open this report can use it") },
			],
			primary_action_label: __("Update"),
			primary_action(values) {
				const name = values.layout_name.trim();
				d.disable_primary_action();
				// Frappe's set_value answers with a jQuery promise: made a real one, so finally() works
				Promise.resolve(frappe.db.set_value(LAYOUT, layout.name, { layout_name: name, is_public: values.is_public ? 1 : 0 }))
					.then(() => {
						d.hide();
						layout.layout_name = name;
						layout.is_public = values.is_public ? 1 : 0;
						update_buttons(view.qr, view);
						frappe.show_alert({ message: __("Layout {0} updated", [esc(name)]), indicator: "green" });
						if (after) after();
					})
					.finally(() => d.enable_primary_action());
			},
		});
		d.show();
	}

	function delete_layout(view, layout, after) {
		frappe.confirm(__("Delete the layout {0}?", [esc(layout.layout_name)]), () => {
			frappe.db.delete_doc(LAYOUT, layout.name).then(() => {
				const entry = layouts_of(view.report_name);
				entry.list = entry.list.filter((x) => x.name !== layout.name);
				if (entry.def === layout.name) set_default(view, STANDARD);
				if (view.active === layout.name) {
					view.active = STANDARD;
					view.mark_saved();
				}
				frappe.show_alert({ message: __("Layout {0} deleted", [esc(layout.layout_name)]), indicator: "green" });
				if (after) after();
			});
		});
	}

	function set_default(view, name) {
		layouts_of(view.report_name).def = name || STANDARD;
		return frappe.model.user_settings.save(view.report_name, "nexlify_layout", name || STANDARD);
	}

	// ------------------------------------------------------------------ View Settings
	// Frappe's own settings window (frappe.ui.SettingsDialog, as DocType Settings): a list of tabs on the left,
	// a panel on the right. Each change goes to the table at once; a condition with no value yet waits.
	function open_settings(view, tab) {
		layouts_of(view.report_name).ready.then(() => new ViewSettings(view, tab).show());
	}

	const clone = (x) => JSON.parse(JSON.stringify(x));

	class ViewSettings {
		constructor(view, tab) {
			this.view = view;
			this.tab = tab || "columns";
			this.avail = null;
			this.take_view();
		}

		// the settings of the table as it is now
		take_view() {
			const v = this.view;
			const all = v.columns.map((c) => c.fieldname);
			const shown = v.cols.map((c) => c.fieldname);
			this.draft = {
				order: shown.concat(all.filter((f) => !shown.includes(f))),
				hidden: new Set(all.filter((f) => !shown.includes(f))),
				labels: Object.assign({}, v.layout.labels),
				widths: Object.assign({}, v.layout.widths),
				sorts: clone(v.state.sorts),
				conds: clone(v.state.conds),
				group_by: v.state.group_by.slice(),
				added: clone(v.layout.added || []),
			};
		}

		// the settings the table gets: conditions with no value yet (or a word where a number is needed) wait
		draft_state() {
			const d = this.draft;
			return {
				order: d.order.filter((f) => !d.hidden.has(f)),
				hidden: [...d.hidden],
				widths: Object.assign({}, d.widths),
				labels: Object.assign({}, d.labels),
				sorts: this.view.tree_on() && !d.group_by.filter(Boolean).length ? [] : d.sorts.filter((x) => x.key),
				conds: d.conds.filter((u) => this.cond_ready(u)),
				group_by: [...new Set(d.group_by.filter(Boolean))],
				added: clone(d.added),
				freeze: this.view.layout.freeze || 0,
				density: this.view.layout.density ? 1 : 0,
			};
		}

		// a condition the table can use: one with no value needs none; "is any of" needs a value picked;
		// a date a date; a number a number
		cond_ready(u) {
			if (!u.f || !this.view.col_of(u.f)) return false;
			if (NO_VALUE.has(u.op)) return true;
			if (u.op === "in") return !!(u.vals && u.vals.length);
			const kind = kind_of(this.view.col_of(u.f));
			const has = (v) => String(v || "") !== "";
			if (kind === "date") return has(u.x) && (u.op !== "between" || has(u.x2));
			if (kind === "num") return parse_num(u.x) !== null && (u.op !== "between" || parse_num(u.x2) !== null);
			return has(u.x);
		}

		// the table takes the settings at once
		apply() {
			this.view.use_state(this.draft_state());
			if (this.dialog) this.redraw("layouts");
		}

		col(f) {
			const c = this.view.report_columns.find((x) => x.fieldname === f);
			if (c) return { f, label: c.label, from: __("This report") };
			const a = this.draft.added.find((x) => x.f === f) || (this.avail || []).find((x) => x.f === f);
			return a ? { f, label: a.label, from: a.line ? __("Document line") : __(a.doctype), linked: true } : null;
		}

		col_opts(val, with_none) {
			const cols = this.draft.order.map((f) => this.col(f)).filter(Boolean);
			return (
				(with_none ? `<option value="">${__("None")}</option>` : "") +
				cols.map((c) => `<option value="${esc(c.f)}" ${c.f === val ? "selected" : ""}>${esc(this.draft.labels[c.f] || __(c.label))}</option>`).join("")
			);
		}

		show() {
			const item = (id, label, icon, render) => ({ id, label, icon, render: (p) => render.call(this, p) });
			const d = (this.dialog = new frappe.ui.SettingsDialog({
				title: __("View Settings"),
				default_tab: this.tab,
				tabs: [
					{ group: __("Layouts"), items: [item("layouts", __("Layouts"), "bookmark", this.layouts_panel)] },
					{
						group: __("Table"),
						items: [
							item("columns", __("Columns"), "columns-3", this.columns_panel),
							item("sort", __("Sort"), "arrow-down-up", this.sort_panel),
							item("filter", __("Filter"), "funnel", this.filter_panel),
							item("group", __("Group"), "layers", this.group_panel),
						],
					},
				],
			}));
			// a closed settings window leaves the page: a new one is made each time
			d.onhide = () => setTimeout(() => d.$wrapper.remove(), 400);
			d.show();
		}

		// a panel drawn again (the panels already opened; the others draw when they open)
		redraw(id) {
			const p = this.dialog && this.dialog.get_panel(id);
			if (p) p.refresh();
		}

		// a line of a panel: Frappe's grid row, the controls side by side
		line(lane, controls, remove) {
			return `<div class="row align-items-center mb-2 nxv-set-line">
				${lane !== null ? `<div class="col-2 text-muted text-sm">${lane}</div>` : ""}
				${controls}
				<div class="col-auto">${remove ? frappe.ui.button.html({ icon: "x", variant: "ghost", title: __("Remove"), attrs: remove }) : ""}</div>
			</div>`;
		}

		empty(icon_name, title, description) {
			return frappe.ui.empty_state.html({ icon: icon_name, title, description });
		}

		// ---------------------------------------------------------------- Layouts: as Frappe's Manage Layouts
		layouts_panel(p) {
			const v = this.view;
			const entry = layout_store[v.report_name];
			const active = active_layout(v);
			const dirty = v.is_dirty();
			const actions = [{ label: __("Save As New Layout"), icon: "plus", click: () => save_layout_as(v, () => this.redraw("layouts")) }];
			if (active && mine(active) && dirty) actions.push({ label: __("Save to {0}", [active.layout_name]), icon: "save", variant: "solid", click: () => save_layout(v, () => this.redraw("layouts")) });
			p.set_header({
				title: __("Layouts"),
				description: dirty ? __("The table has changed since its layout was saved.") : __("The layout you pick opens this report next time."),
				actions,
			});
			const me = frappe.session.user;
			const button = (icon_name, title, act, disabled) => frappe.ui.button.html({ icon: icon_name, title, variant: "ghost", disabled, attrs: { "data-lact": act } });
			const row = (l) => {
				const on = (active ? active.name : STANDARD) === (l ? l.name : STANDARD);
				const scope = !l ? __("Standard") : l.is_public ? __("Public") : __("Personal");
				const who = l && l.owner !== me ? `<div class="text-sm text-muted truncate">${esc(frappe.user.full_name(l.owner))}</div>` : "";
				const acts = l
					? button("pencil", __("Edit"), "edit", !mine(l)) + button("copy", __("Duplicate"), "duplicate") + button("trash-2", __("Delete"), "delete", !mine(l))
					: "";
				return `<div class="layout-manage-row flex items-center justify-between py-2 border-b" data-name="${esc(l ? l.name : "")}">
					<div class="min-w-0 pe-2">
						<div class="flex gap-1 items-center">
							<div class="truncate text-base-semibold text-ink-gray-8">${esc(l ? l.layout_name : __("Standard"))}</div>
							${frappe.ui.badge.html({ label: scope })}
							${on ? frappe.ui.badge.html({ label: __("In use") + (dirty ? " *" : ""), theme: "green" }) : ""}
						</div>${who}
					</div>
					<div class="flex shrink-0 gap-1">${on ? "" : frappe.ui.button.html({ label: __("Use"), variant: "subtle", attrs: { "data-lact": "use" } })}${acts}</div>
				</div>`;
			};
			p.body.html(`<div class="layout-manage-list">${row(null)}${entry.list.map(row).join("")}</div>`);
			p.body.off("click.nxv").on("click.nxv", "[data-lact]", (e) => {
				const act = e.currentTarget.dataset.lact;
				const name = $(e.currentTarget).closest("[data-name]").attr("data-name");
				const l = entry.list.find((x) => x.name === name) || null;
				const again = () => this.redraw("layouts");
				if (act === "use") {
					choose_layout(v, l);
					this.take_view();
					["layouts", "columns", "sort", "filter", "group"].forEach((id) => this.redraw(id));
				}
				if (act === "edit" && l) edit_layout(v, l, again);
				if (act === "duplicate" && l) save_layout_as(v, again, l);
				if (act === "delete" && l) delete_layout(v, l, again);
			});
		}

		// ---------------------------------------------------------------- Columns: as Frappe's layout field picker
		columns_panel(p) {
			p.set_header({
				title: __("Columns"),
				description: __("The columns the table shows, in their order. Drag a column to move it."),
				actions: [{ label: __("Add / Remove Columns"), icon: "plus", click: () => this.pick_columns() }],
			});
			const d = this.draft;
			const shown = d.order.filter((f) => !d.hidden.has(f) && this.col(f));
			const rows = shown
				.map((f) => {
					const c = this.col(f);
					const width = d.widths[f] || (this.view.col_of(f) || {}).width || 150;
					return `<div class="control-input form-control fields_order sortable flex mb-1" data-f="${esc(f)}">
						<div class="row flex-fill align-items-center">
							<div class="col-1 flex align-items-center justify-content-center px-1">${frappe.utils.icon("grip", "xs", "", "", "sortable-handle")}</div>
							<div class="col px-0"><input class="form-control nxv-set-label" data-slabel="${esc(f)}" value="${esc(d.labels[f] || __(c.label))}" title="${__("Type a new name")}" aria-label="${__("Name")}"></div>
							<div class="col-3 text-muted text-sm truncate">${esc(c.from)}</div>
							<div class="col-2"><input inputmode="numeric" class="form-control text-right nxv-set-width" data-swidth="${esc(f)}" value="${width}" aria-label="${__("Width (px)")}"></div>
							<div class="col-1 flex align-items-center justify-content-center px-0">${
								shown.length > 1 ? `<a class="text-muted" role="button" data-sremove="${esc(f)}" title="${__("Remove")}">${frappe.utils.icon("x", "xs")}</a>` : ""
							}</div>
						</div>
					</div>`;
				})
				.join("");
			p.body.html(`<div class="form-group mb-0">
				<div class="row flex-fill px-1 mb-1 text-muted text-xs">
					<div class="col-1"></div><div class="col px-0">${__("Column")}</div><div class="col-3">${__("From")}</div>
					<div class="col-2 text-right pr-2">${__("Width (px)")}</div><div class="col-1"></div>
				</div>
				<div class="nxv-set-cols">${rows}</div>
			</div>`);
			new Sortable(p.body.find(".nxv-set-cols")[0], {
				handle: ".sortable-handle",
				draggable: ".sortable",
				animation: 150,
				onUpdate: () => {
					const now = p.body.find(".fields_order").map((i, el) => el.dataset.f).get();
					d.order = now.concat(d.order.filter((f) => !now.includes(f)));
					this.apply();
				},
			});
			p.body.off(".nxv");
			p.body.on("change.nxv", "[data-slabel]", (e) => {
				const f = e.target.dataset.slabel;
				const c = this.col(f);
				const v = e.target.value.trim();
				if (!v || (c && (v === c.label || v === __(c.label)))) delete d.labels[f];
				else d.labels[f] = v;
				this.apply();
			});
			p.body.on("change.nxv", "[data-swidth]", (e) => {
				d.widths[e.target.dataset.swidth] = Math.max(50, cint(e.target.value) || 50);
				this.apply();
			});
			p.body.on("click.nxv", "[data-sremove]", (e) => {
				d.hidden.add(e.currentTarget.dataset.sremove);
				this.apply();
				this.redraw("columns");
			});
		}

		// Add / Remove Columns: two lists side by side, in Frappe's own field rows. On the left the columns the
		// table can show (the report's own, then each linked document's, each under its name); on the right the
		// ones it shows, in their order. Tick columns and send them across with the arrows in the middle (or all
		// the columns listed at once); a double click sends one; drag on the right moves a column up or down.
		pick_columns() {
			const ready = this.avail ? Promise.resolve(this.avail) : this.view.avail_fields().then((list) => (this.avail = list || []));
			frappe.dom.freeze(__("Loading the fields of linked documents") + "…");
			ready.finally(() => frappe.dom.unfreeze()).then(() => this.pick_dialog());
		}

		pick_dialog() {
			const d = this.draft;
			const norm = (x) => String(x || "").trim().toLowerCase();
			const shown = new Set(d.order.filter((f) => !d.hidden.has(f) && this.col(f)));
			// every column that can be picked, each in its section
			const all = new Map();
			const groups = [{ key: "report", name: __("This report"), list: [] }];
			const put = (g, x) => {
				g.list.push(x);
				all.set(x.f, x);
			};
			this.view.report_columns.forEach((c) => put(groups[0], { f: c.fieldname, label: __(c.label), g: groups[0] }));
			// a field of a linked document named like a column the report already has is left out: the same name
			// would show twice
			const report_labels = new Set(this.view.report_columns.flatMap((c) => [norm(c.label), norm(__(c.label))]));
			const by = new Map();
			(this.avail || []).forEach((a) => {
				if (!shown.has(a.f) && report_labels.has(norm(a.short))) return;
				if (!by.has(a.from)) by.set(a.from, { key: a.from, name: a.via ? __("{0} by {1}", [a.dt, a.via]) : a.dt, list: [] });
				put(by.get(a.from), { f: a.f, label: a.short, g: by.get(a.from) });
			});
			by.forEach((g) => groups.push(g));
			let picked = d.order.filter((f) => shown.has(f) && all.has(f));
			// the sections open on the left: the report's own, and those with a column shown
			const open = new Set(["report", ...picked.map((f) => all.get(f).g.key)]);
			const q = { a: "", s: "" };
			const hit = (x, text) => !text || norm(x.label).includes(text) || norm(x.g.name).includes(text);

			const dialog = new frappe.ui.Dialog({
				title: __("Add / Remove Columns"),
				size: "extra-large",
				fields: [{ fieldtype: "HTML", fieldname: "body" }],
				primary_action_label: __("Apply"),
				primary_action: () => {
					const keep = new Set(picked);
					// a new linked column joins the layout's added columns; one taken away leaves them
					picked.forEach((f) => {
						if (this.view.report_columns.some((c) => c.fieldname === f) || d.added.some((a) => a.f === f)) return;
						const a = this.avail.find((x) => x.f === f);
						if (a) d.added.push({ f: a.f, doctype: a.doctype, field: a.field, link_field: a.link_field, dynamic: a.dynamic, line: a.line ? 1 : 0, label: a.short, fieldtype: a.fieldtype, options: a.options });
					});
					d.added = d.added.filter((a) => keep.has(a.f));
					const rest = this.view.report_columns.map((c) => c.fieldname).filter((f) => !keep.has(f));
					d.order = picked.concat(rest);
					d.hidden = new Set(rest);
					dialog.hide();
					this.apply();
					this.redraw("columns");
				},
			});
			const $b = dialog.get_field("body").$wrapper;
			// the ticked columns on each side
			const sel = { a: new Set(), s: new Set() };
			const side = (key, title, holder) => `<div class="nxv-pick-side">
				<div class="nxv-pick-top"><label class="control-label mb-0">${title}</label><span class="text-muted text-xs" data-n="${key}"></span></div>
				<input type="text" class="form-control mb-2" data-q="${key}" placeholder="${esc(holder)}" aria-label="${esc(holder)}">
				<div class="nxv-pick-list" data-side="${key}"></div>
			</div>`;
			const move = (act, icon_name, title) => frappe.ui.button.html({ icon: icon_name, title, variant: "subtle", attrs: { "data-move": act } });
			$b.html(`<div class="nxv-pick">
				${side("a", __("Available"), __("Search, e.g. territory"))}
				<div class="nxv-pick-mid">
					${move("to-s", "chevron-right", __("Show the ticked columns"))}
					${move("to-a", "chevron-left", __("Hide the ticked columns"))}
					${move("all-s", "chevrons-right", __("Show all the columns listed"))}
					${move("all-a", "chevrons-left", __("Hide all the columns listed"))}
				</div>
				${side("s", __("Shown in the table"), __("Search"))}
			</div>`);
			const row = (x, where) => `<label class="form-control nxv-pick-row${where === "s" ? " sortable" : ""}" data-f="${esc(x.f)}" data-side="${where}">
				${where === "s" ? frappe.utils.icon("grip", "xs", "", "", "sortable-handle") : ""}
				<input type="checkbox" ${sel[where].has(x.f) ? "checked" : ""} aria-label="${esc(x.label)}">
				<span class="nxv-pick-name">${esc(x.label)}</span>
				${where === "s" && x.g.key !== "report" ? `<span class="text-muted text-xs nxv-pick-from">${esc(x.g.name)}</span>` : ""}
			</label>`;
			// the columns each side lists now (a search narrows them)
			const listed = (where) => {
				const on = new Set(picked);
				if (where === "s") return picked.filter((f) => hit(all.get(f), q.s));
				return groups.flatMap((g) => g.list.filter((x) => !on.has(x.f) && hit(x, q.a)).map((x) => x.f));
			};
			const draw = () => {
				const on = new Set(picked);
				const left = groups
					.map((g) => {
						const items = g.list.filter((x) => !on.has(x.f) && hit(x, q.a));
						if (!items.length) return "";
						const unfolded = open.has(g.key) || !!q.a;
						return `<div class="text-sm nxv-pick-head" data-g="${esc(g.key)}" role="button" aria-expanded="${unfolded}">
								${frappe.utils.icon(unfolded ? "chevron-down" : "chevron-right", "xs")}<span class="truncate">${esc(g.name)}</span><span class="text-muted text-xs">${items.length}</span>
							</div>` + (unfolded ? items.map((x) => row(x, "a")).join("") : "");
					})
					.join("");
				$b.find('[data-side="a"]').html(left || `<p class="text-muted text-sm">${__("Nothing left to add")}</p>`);
				$b.find('[data-side="s"]').html(listed("s").map((f) => row(all.get(f), "s")).join(""));
				$b.find('[data-n="a"]').text(sel.a.size ? __("{0} of {1} ticked", [sel.a.size, all.size - picked.length]) : all.size - picked.length);
				$b.find('[data-n="s"]').text(sel.s.size ? __("{0} of {1} ticked", [sel.s.size, picked.length]) : picked.length);
				$b.find('[data-move="to-s"]').prop("disabled", !sel.a.size);
				$b.find('[data-move="to-a"]').prop("disabled", !sel.s.size);
			};
			const send = (where, fs) => {
				if (where === "s") picked = picked.concat(fs.filter((f) => !picked.includes(f)));
				else picked = picked.filter((f) => !fs.includes(f));
				sel.a.clear();
				sel.s.clear();
				draw();
			};
			$b.on("input", "[data-q]", (e) => {
				q[e.target.dataset.q] = norm(e.target.value);
				draw();
			});
			$b.on("click", ".nxv-pick-head", (e) => {
				const k = e.currentTarget.dataset.g;
				if (open.has(k)) open.delete(k);
				else open.add(k);
				draw();
			});
			// a tick: the column joins (or leaves) the ones the arrows send; a double click sends it at once
			$b.on("change", ".nxv-pick-row input", (e) => {
				const r = e.target.closest(".nxv-pick-row");
				const s = sel[r.dataset.side];
				if (e.target.checked) s.add(r.dataset.f);
				else s.delete(r.dataset.f);
				draw();
			});
			$b.on("dblclick", ".nxv-pick-row", (e) => {
				const r = e.currentTarget;
				send(r.dataset.side === "a" ? "s" : "a", [r.dataset.f]);
			});
			$b.on("click", "[data-move]", (e) => {
				const act = e.currentTarget.dataset.move;
				if (act === "to-s") send("s", listed("a").filter((f) => sel.a.has(f)));
				if (act === "to-a") send("a", [...sel.s]);
				if (act === "all-s") send("s", listed("a"));
				if (act === "all-a") send("a", listed("s"));
			});
			// drag on the right: the new order (while nothing is searched, so every row shown is in the list)
			new Sortable($b.find('[data-side="s"]')[0], {
				handle: ".sortable-handle",
				draggable: ".sortable",
				animation: 150,
				onUpdate: () => {
					if (q.s) return draw();
					picked = $b.find('[data-side="s"] .nxv-pick-row').map((i, el) => el.dataset.f).get();
				},
			});
			draw();
			dialog.show();
		}

		// ---------------------------------------------------------------- Sort
		sort_panel(p) {
			const d = this.draft;
			const first = d.order.find((f) => !d.hidden.has(f)) || d.order[0];
			p.set_header({
				title: __("Sort"),
				description: __("The order of the rows. The first sort counts most."),
				actions: [{ label: __("Add Sort"), icon: "plus", click: () => (d.sorts.push({ key: first, dir: 1 }), this.apply(), this.redraw("sort")) }],
			});
			const tree = this.view.tree_on() ? `<p class="text-muted text-sm">${__("This report is a tree, so it keeps the report's own order.")}</p>` : "";
			const rows = d.sorts
				.map((x, i) =>
					this.line(
						i === 0 ? __("Sort by") : __("Then by"),
						`<div class="col"><select class="form-control" data-ssort="${i}">${this.col_opts(x.key)}</select></div>
						<div class="col-3"><select class="form-control" data-sdir="${i}"><option value="1" ${x.dir > 0 ? "selected" : ""}>${__("Ascending")}</option><option value="-1" ${x.dir < 0 ? "selected" : ""}>${__("Descending")}</option></select></div>`,
						{ "data-sdel": String(i) }
					)
				)
				.join("");
			p.body.html(tree + (rows || this.empty("arrow-down-up", __("No sorting"), __("The rows keep the report's order."))));
			this.bind_rows(p, "sort");
		}

		// ---------------------------------------------------------------- Filter
		filter_panel(p) {
			const d = this.draft;
			p.set_header({
				title: __("Filter"),
				description: __("Keep or leave out rows of what the report returned. On one column, a row stays when any Include holds."),
				actions: [
					{
						label: __("Add Condition"),
						icon: "plus",
						click: () => {
							// a text column first: picking its values is the most common filter
							const c = this.view.cols.find((x) => kind_of(x) === "text") || this.view.cols[0];
							d.conds.push({ f: c.fieldname, op: KIND_OPS[kind_of(c)][0], x: "", x2: "", vals: [], exclude: false });
							this.redraw("filter");
						},
					},
				],
			});
			const rows = d.conds
				.map((u, i) => {
					const kind = kind_of(this.view.col_of(u.f));
					const ops = KIND_OPS[kind].map((k) => `<option value="${k}" ${k === u.op ? "selected" : ""}>${esc(OP_LABEL[k])}</option>`).join("");
					let value = "";
					if (u.op === "in" || (kind === "date" && !NO_VALUE.has(u.op))) value = `<div class="nxv-ctl" data-i="${i}"></div>`;
					else if (!NO_VALUE.has(u.op)) {
						const type = kind === "num" ? "number" : "text";
						const input = (k, val) => `<input class="form-control" type="${type}" data-${k}="${i}" value="${esc(val || "")}" placeholder="${__("Value")}">`;
						value = u.op === "between" ? `<div class="flex gap-1 items-center">${input("sx", u.x)}<span class="text-muted">${__("and")}</span>${input("sx2", u.x2)}</div>` : input("sx", u.x);
					}
					return this.line(
						null,
						`<div class="col-2"><select class="form-control" data-sinc="${i}"><option value="0" ${u.exclude ? "" : "selected"}>${__("Include")}</option><option value="1" ${u.exclude ? "selected" : ""}>${__("Exclude")}</option></select></div>
						<div class="col-3"><select class="form-control" data-scf="${i}">${this.col_opts(u.f)}</select></div>
						<div class="col-3"><select class="form-control" data-sop="${i}">${ops}</select></div>
						<div class="col">${value}</div>`,
						{ "data-cdel": String(i) }
					);
				})
				.join("");
			p.body.html(rows || this.empty("funnel", __("No conditions"), __("Every row the report returned shows.")));
			this.mount_controls(p.body);
			this.bind_rows(p, "filter");
		}

		// the values a text column holds in this report's rows, the most used first, as the report shows them
		column_values(f) {
			const v = this.view;
			const c = v.col_of(f);
			const counts = new Map();
			(v.rows || []).forEach((r) => {
				const k = clean(r[f]);
				if (!k) return;
				if (!counts.has(k)) counts.set(k, { n: 0, r });
				counts.get(k).n += 1;
			});
			return [...counts.entries()]
				.sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
				.slice(0, 1000)
				.map(([k, x]) => {
					const shown = c ? v.plain(x.r, c) : k;
					return { value: k, label: shown, description: shown !== k ? __("{0} · {1} rows", [k, x.n]) : __("{0} rows", [x.n]) };
				});
		}

		// Frappe's own controls for the values: a list to tick for "is any of", a calendar for a date
		mount_controls($root) {
			$root.find(".nxv-ctl").each((n, el) => {
				const i = +el.dataset.i;
				const u = this.draft.conds[i];
				if (!u) return;
				const make = (df) => frappe.ui.form.make_control({ parent: $(el), df: Object.assign({ fieldname: "nxv_" + i + "_" + df.fieldtype.toLowerCase() }, df), render_input: true, only_input: true });
				const done = () => this.apply();
				if (u.op === "in") {
					const all = this.column_values(u.f);
					const ctl = make({
						fieldtype: "MultiSelectList",
						placeholder: __("Pick values"),
						get_data: (txt) => {
							const q = String(txt || "").toLowerCase();
							return all.filter((x) => !q || x.label.toLowerCase().includes(q) || x.value.toLowerCase().includes(q)).slice(0, 200);
						},
						onchange: () => {
							u.vals = (ctl.get_value() || []).slice(0, 500);
							done();
						},
					});
					ctl.set_value((u.vals || []).slice());
				} else if (u.op === "between") {
					const ctl = make({
						fieldtype: "DateRange",
						placeholder: __("From – To"),
						onchange: () => {
							const v = ctl.get_value() || [];
							u.x = v[0] || "";
							u.x2 = v[1] || "";
							done();
						},
					});
					if (u.x && u.x2) ctl.set_value([u.x, u.x2]);
				} else {
					const ctl = make({
						fieldtype: "Date",
						placeholder: __("Pick a date"),
						onchange: () => {
							u.x = ctl.get_value() || "";
							done();
						},
					});
					if (u.x) ctl.set_value(u.x);
				}
			});
		}

		// ---------------------------------------------------------------- Group
		group_panel(p) {
			const d = this.draft;
			// the panel always shows a first level, empty until a column is picked
			if (!d.group_by.length) d.group_by.push("");
			const levels = d.group_by;
			const add = () => {
				d.group_by.push("");
				this.redraw("group");
			};
			const actions = levels.length < MAX_LEVELS ? [{ label: __("Add Level"), icon: "plus", click: add }] : [];
			p.set_header({ title: __("Group"), description: __("Each group shows a heading, its rows and its total. Up to three levels."), actions });
			const rows = levels
				.map((f, i) => this.line(i === 0 ? __("Group by") : __("Then by"), `<div class="col"><select class="form-control" data-sgroup="${i}">${this.col_opts(f, true)}</select></div>`, i > 0 ? { "data-gdel": String(i) } : null))
				.join("");
			const notes = [
				this.view.rows.some((r) => r.is_group) ? __("The report groups its rows too (its own Group By filter): its groups stay outside, these go inside them.") : "",
				this.view.is_tree ? __("This report is a tree: grouped, it shows its lowest rows in your groups, so no amount counts twice.") : "",
			]
				.filter(Boolean)
				.map((t) => `<p class="text-muted text-sm">${t}</p>`)
				.join("");
			p.body.html(rows + notes);
			this.bind_rows(p, "group");
		}

		// the controls of the Sort, Filter and Group panels: each change goes to the table at once
		bind_rows(p, id) {
			const d = this.draft;
			p.body.off(".nxv");
			p.body.on("change.nxv", "select, input", (e) => {
				const ds = e.target.dataset;
				let again = false;
				if (ds.ssort !== undefined) d.sorts[+ds.ssort].key = e.target.value;
				if (ds.sdir !== undefined) d.sorts[+ds.sdir].dir = +e.target.value;
				if (ds.sinc !== undefined) d.conds[+ds.sinc].exclude = e.target.value === "1";
				if (ds.scf !== undefined) {
					const u = d.conds[+ds.scf];
					u.f = e.target.value;
					u.op = KIND_OPS[kind_of(this.view.col_of(u.f))][0];
					u.x = u.x2 = "";
					u.vals = [];
					again = true;
				}
				if (ds.sop !== undefined) {
					const u = d.conds[+ds.sop];
					// the value stays when it still means something (a date from "on" to "before")
					if (u.op === "in" || e.target.value === "in" || u.op === "between" || e.target.value === "between") u.x = u.x2 = "";
					if (e.target.value !== "in") u.vals = [];
					u.op = e.target.value;
					again = true;
				}
				if (ds.sx !== undefined) d.conds[+ds.sx].x = e.target.value;
				if (ds.sx2 !== undefined) d.conds[+ds.sx2].x2 = e.target.value;
				if (ds.sgroup !== undefined) d.group_by[+ds.sgroup] = e.target.value;
				if (!ds.ssort && !ds.sdir && !ds.sinc && !ds.scf && !ds.sop && !ds.sx && !ds.sx2 && !ds.sgroup) return;
				this.apply();
				if (again) this.redraw(id);
			});
			p.body.on("click.nxv", "[data-sdel], [data-cdel], [data-gdel]", (e) => {
				const ds = e.currentTarget.dataset;
				if (ds.sdel !== undefined) d.sorts.splice(+ds.sdel, 1);
				if (ds.cdel !== undefined) d.conds.splice(+ds.cdel, 1);
				if (ds.gdel !== undefined) d.group_by.splice(+ds.gdel, 1);
				this.apply();
				this.redraw(id);
			});
		}
	}

	// ------------------------------------------------------------------ on Frappe's report page, from the outside
	// Nothing of Frappe is changed. The view reads the report page's public state (frappe.query_report:
	// columns, data) and notices a new run on the page itself: Frappe redraws its own table (kept hidden)
	// when the report runs, and shows a message instead of rows while it runs or when there are none.

	nexlify.report_view.current = function (qr) {
		const v = qr && qr.__nxv;
		return v && v.report_name === qr.report_name && !v.$wrap.prop("hidden") ? v : null;
	};

	// From the moment a report page opens until the table is drawn, Frappe's own table and loading
	// screen wait out of sight and a skeleton of the table shows: Frappe's table never shows first.
	const PENDING = "nxv-pending";
	let pending_timer = null;

	function set_pending(on, qr) {
		clearTimeout(pending_timer);
		document.body.classList.toggle(PENDING, !!on);
		if (!on) return $(".nxv-skel").remove();
		if (qr && qr.$report && qr.$report.length && !$(".nxv-skel").length) {
			const rows = Array.from({ length: 12 }, (_, i) => `<div class="nxv-skel-row"><i style="width:${38 + ((i * 17) % 30)}%"></i><i></i><i></i></div>`).join("");
			$(`<div class="nxv-skel" aria-busy="true" aria-label="${__("Loading")}"><div class="nxv-skel-head"></div>${rows}</div>`).insertAfter(qr.$report);
		}
		// never longer than this: a report that answers nothing still gets its page back
		pending_timer = setTimeout(() => set_pending(false), 30000);
	}

	// what Frappe asked for with its own show() and hide(), not what the screen shows
	function frappe_shows($el) {
		return !!($el && $el.length && $el[0].style.display !== "none" && !$el.prop("hidden"));
	}

	function too_big(qr) {
		return (qr.data || []).length > (cint(frappe.boot.sysdefaults.max_report_rows) || 100000);
	}

	// reports that pick rows with Frappe's checkbox column keep Frappe's table: their buttons read it
	function uses_row_checkboxes(qr) {
		try {
			const get = qr.report_settings && qr.report_settings.get_datatable_options;
			return !!(get && (get({}) || {}).checkboxColumn);
		} catch (e) {
			return false;
		}
	}

	function shows_rows(qr) {
		return !!(qr.data && qr.data.length && qr.columns && qr.$report && !too_big(qr));
	}

	nexlify.report_view.update = function (qr, force) {
		const name = qr.report_name;
		const v = qr.__nxv;
		// the view will show this report: Frappe's table stays out of sight from the start (while the report
		// runs Frappe shows a message, and its table would show for a moment before the view)
		const ours = !uses_row_checkboxes(qr) && !too_big(qr);
		qr.$report.toggleClass("nxv-hidden", ours);
		try {
			sections(qr);
		} catch (e) {
			console.warn("[Nexlify] report sections", e);
		}
		// another report on the same page: the old one's rows never stay on screen while the new one loads
		if (v && v.report_name !== name && !v.$wrap.prop("hidden")) v.hide();
		// Frappe's "Loading..." screen: the same report runs again, so the table stays with its rows dimmed
		const $ld = qr.$loading;
		if (frappe_shows($ld)) {
			const same = !!(v && v.report_name === name && !v.$wrap.prop("hidden"));
			$ld.toggleClass("nxv-hide", same);
			if (same) v.$wrap.addClass("nxv-loading");
			return;
		}
		const $msg = qr.$message;
		if (frappe_shows($msg)) {
			const text = $msg.text().trim();
			if (v && !text && v.report_name === name && !v.$wrap.prop("hidden")) v.$wrap.addClass("nxv-loading");
			else {
				if (v && !v.$wrap.prop("hidden")) v.hide();
				// a message instead of rows: the skeleton goes, Frappe's message shows
				if (text) set_pending(false);
				update_buttons(qr, null);
			}
			return;
		}
		if (!shows_rows(qr) || !ours) {
			if (v && !v.$wrap.prop("hidden")) v.hide();
			if (!ours) qr.$report.removeClass("nxv-hidden");
			// no rows yet because the report has not run yet: the page keeps waiting for them, unchanged
			const running = frappe_shows(qr.$loading) || (frappe_shows(qr.$message) && !qr.$message.text().trim());
			const not_run = !qr.raw_data || running;
			if (!ours || !not_run) set_pending(false);
			update_buttons(qr, null);
			return;
		}
		// Frappe has one report page for every report: a new report gets a new view, with its default layout
		if (!v || v.report_name !== name || !document.body.contains(v.$wrap[0])) {
			if (v) v.destroy();
			qr.page.main.find(".nxv").remove();
			const view = (qr.__nxv = new ReportView(qr));
			const entry = layouts_of(name);
			view.hidden_until_layout = true;
			entry.ready.then(() => {
				if (qr.__nxv !== view) return;
				const def = entry.list.find((l) => l.name === entry.def);
				if (def) {
					view.active = def.name;
					const st = parse_layout(def);
					view.layout = { order: st.order, hidden: st.hidden, widths: st.widths, labels: st.labels, added: st.added, freeze: st.freeze, density: st.density };
					view.state.sorts = st.sorts;
					view.state.conds = st.conds;
					view.state.group_by = st.group_by;
				}
				view.hidden_until_layout = false;
				nexlify.report_view.update(qr, true);
			});
			return;
		}
		if (v.hidden_until_layout) return;
		// the same rows as last time: nothing to draw again
		if (!force && v.loaded_data === qr.data && v.loaded_cols === (qr.columns || []).length && !v.$wrap.prop("hidden")) {
			v.$wrap.removeClass("nxv-loading");
			return;
		}
		v.show();
		v.loaded_data = qr.data;
		v.loaded_cols = (qr.columns || []).length;
		v.load();
		// the layout opened with the report is the one "changed since saved" is measured against
		if (v.saved_json === null) v.mark_saved();
		setTimeout(() => qr.__nxv === v && v.fit_height(), 300);
	};

	// ------------------------------------------------------------------ the parts above the table open and close
	// The filters fold to their first row, with an arrow at its end (as Frappe does for the General Ledger);
	// the summary and the chart fold into a slim bar (the summary's figures stay on it). All start folded
	// each time a report opens. Frappe's parts stay where Frappe puts them: they are only hidden.

	function sections(qr) {
		if (!qr || !qr.page || !qr.page.main) return;
		if (qr.__nxv_sec_report !== qr.report_name) {
			qr.__nxv_sec_report = qr.report_name;
			qr.__nxv_closed = { summary: true, chart: true };
		}
		fold_filters(qr);
		if (!qr.$summary || !qr.$summary.length || !qr.$chart || !qr.$chart.length) return;
		// a slim line right above each: the summary (its figures on it) and the chart, each opening under its own line
		sec_button(qr, "summary", qr.$summary, __("Summary"), () => summary_chips(qr));
		sec_button(qr, "chart", qr.$chart, __("Chart"), () => "");
		refit(qr);
	}

	// the table takes the room left when a part above it opens or closes, at once: a resize observer and the
	// page's observers run before the screen is painted, so the table never shows at its old height
	function refit(qr) {
		const v = qr.__nxv;
		if (v && v.report_name === qr.report_name && !v.$wrap.prop("hidden")) v.fit_height();
	}

	function sec_button(qr, key, $el, title, chips) {
		let $btn = qr.page.main.children(`.nxv-secbtn[data-sec="${key}"]`);
		if (!$btn.length) {
			$btn = $(`<button type="button" class="nxv-secbtn" data-sec="${key}" hidden></button>`).insertBefore($el);
			$btn.on("click", () => {
				qr.__nxv_closed[key] = !qr.__nxv_closed[key];
				sections(qr);
				// a chart drawn while it was folded draws again at its real width
				if (key === "chart" && !qr.__nxv_closed[key]) setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
			});
		}
		// while the report runs, Frappe hides the summary and the chart until the rows come: the line keeps
		// its place, so nothing under it jumps up and down (a report that runs twice when it opens)
		const running = frappe_shows(qr.$loading) || (frappe_shows(qr.$message) && !qr.$message.text().trim());
		const shows = running && !$btn.prop("hidden") ? true : frappe_shows($el) && $el.children().length > 0;
		const closed = !!qr.__nxv_closed[key];
		$el.toggleClass("nxv-sec-closed", closed);
		$btn.prop("hidden", !shows);
		if (!shows) return false;
		const figures = closed ? chips() : "";
		const html = `<span class="nxv-secbtn-arr">${icon("chevron-right")}</span><b>${esc(title)}</b>${figures ? `<span class="nxv-secbtn-chips">${figures}</span>` : ""}`;
		if ($btn.data("html") !== html) $btn.data("html", html).html(html);
		$btn.attr("aria-expanded", String(!closed));
		return true;
	}

	// the summary's figures, as Frappe shows them (label, value, its color), in one line
	function summary_chips(qr) {
		return qr.$summary
			.find(".summary-item")
			.map((i, el) => {
				const label = $(el).find(".summary-label").text().trim();
				const $v = $(el).find(".summary-value");
				const color = $v.length ? getComputedStyle($v[0]).color : "";
				return `<span class="nxv-chip-s"><i>${esc(label)}</i> <b style="color:${esc(color)}">${esc($v.text().trim())}</b></span>`;
			})
			.get()
			.join("");
	}

	// a filter holds something else than its default: shown on the arrow when it is folded away
	function filter_set(f) {
		let v;
		try {
			v = f.get_value();
		} catch (e) {
			return false;
		}
		const d = f.df.default;
		if (f.df.fieldtype === "Check") return cint(v) !== cint(d);
		if (Array.isArray(v)) return v.length > 0;
		return v !== undefined && v !== null && v !== "" && String(v) !== String(d ?? "");
	}

	function filter_empty(f) {
		let v;
		try {
			v = f.get_value();
		} catch (e) {
			return false;
		}
		return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
	}

	function frappe_folds(qr, filters) {
		const btn = qr.$collapse_button && qr.$collapse_button[0];
		return !!(qr.report_settings && qr.report_settings.collapsible_filters && btn && filters.some((f) => f.wrapper.contains(btn)));
	}

	function fold_filters(qr) {
		const filters = (qr.filters || []).filter((f) => f && f.wrapper && f.df);
		// a report Frappe folds itself (General Ledger) keeps Frappe's arrow. Frappe keeps the arrow of the last
		// such report after the user moves to another one: only an arrow among this report's filters counts
		if (!filters.length || frappe_folds(qr, filters)) return;
		const s = qr.__nxv_fold;
		if (s && s.list === qr.filters) return apply_fold(qr);
		// the rows are known only once the filters are on the screen
		const shown = filters.filter((f) => !f.df.hidden && f.wrapper.offsetParent);
		if (!shown.length) return;
		const top = Math.min(...shown.map((f) => f.wrapper.getBoundingClientRect().top));
		const first = shown.filter((f) => Math.abs(f.wrapper.getBoundingClientRect().top - top) < 6);
		const rest = filters.filter((f) => !first.includes(f));
		const checks = qr.page.page_form ? qr.page.page_form.find(".check-filter-area") : $();
		if (!rest.length && !checks.length) {
			qr.__nxv_fold = { list: qr.filters, none: true };
			return;
		}
		const $btn = $(`<button type="button" class="nxv-ftoggle"></button>`);
		$(first[first.length - 1].wrapper).addClass("nxv-fhost").append($btn);
		$btn.on("click", () => {
			qr.__nxv_fold.closed = !qr.__nxv_fold.closed;
			apply_fold(qr);
		});
		qr.__nxv_fold = { list: qr.filters, rest, checks, closed: true, $btn };
		// a changed filter updates the count on the arrow
		qr.page.page_form && qr.page.page_form.off("change.nxvfold").on("change.nxvfold", () => apply_fold(qr));
		apply_fold(qr);
	}

	function apply_fold(qr) {
		const s = qr.__nxv_fold;
		if (!s || s.none || !s.$btn) return;
		// a filter the report needs and has no value yet always shows
		s.rest.forEach((f) => $(f.wrapper).toggleClass("nxv-fhide", s.closed && !(f.df.reqd && filter_empty(f))));
		s.checks.toggleClass("nxv-fhide", s.closed);
		const n = s.closed ? s.rest.filter(filter_set).length : 0;
		const title = s.closed ? (n ? __("{0} more filters are set", [n]) : __("More filters")) : __("Fewer filters");
		const html = `${icon(s.closed ? "chevron-down" : "chevron-up")}${n ? `<span class="nxv-ftoggle-n">${n}</span>` : ""}`;
		if (s.$btn.data("html") !== html) s.$btn.data("html", html).html(html);
		s.$btn.attr({ title, "aria-label": title, "aria-expanded": String(!s.closed) });
		refit(qr);
	}

	// something broke: the report shows in Frappe's own table, and no half-built view stays on the page
	function fail(qr, e) {
		console.error("Nexlify Report View", e);
		nexlify.report_view.last_error = e && e.stack ? String(e.stack) : String(e);
		try {
			if (qr.__nxv) qr.__nxv.hide();
			if (qr.page && qr.page.main) qr.page.main.find(".nxv").remove();
			qr.__nxv = null;
			if (qr.$report) qr.$report.removeClass("nxv-hidden");
			if (qr.page && qr.page.main) qr.page.main.removeClass("nxv-on");
			set_pending(false);
			update_buttons(qr, null);
		} catch (e2) {
			console.error("Nexlify Report View", e2);
		}
	}

	// the parts above the table, set at once (before the screen is painted) whenever Frappe changes them
	function settle(qr) {
		// each report's layouts are read as soon as it opens: the Layout button names the one it opens with
		if (qr.report_name && !layout_store[qr.report_name]) layouts_of(qr.report_name).ready.then(() => settle(qr));
		try {
			sections(qr);
			update_buttons(qr, qr.__nxv && qr.__nxv.report_name === qr.report_name ? qr.__nxv : null);
		} catch (e) {
			console.warn("[Nexlify] report sections", e);
		}
	}

	const watched = new WeakSet();
	function watch(qr) {
		if (!qr || !qr.$report || !qr.$report.length || watched.has(qr)) return;
		watched.add(qr);
		settle(qr);
		// Frappe makes the filters of each report it opens: they fold as they come
		if (qr.page && qr.page.page_form && qr.page.page_form.length) {
			new MutationObserver(() => settle(qr)).observe(qr.page.page_form[0], { childList: true, subtree: true });
		}
		// the table takes the room left whenever a part above it changes height: Frappe's own filter arrow,
		// a filter that shows or hides another, the summary, the chart, the line about a prepared report
		if (window.ResizeObserver) {
			const ro = new ResizeObserver(() => refit(qr));
			[qr.page && qr.page.page_form, qr.$summary, qr.$chart, qr.$report_message].forEach(($e) => $e && $e[0] && ro.observe($e[0]));
		}
		// and the buttons of the header
		if (qr.page && qr.page.inner_toolbar && qr.page.inner_toolbar.length) {
			new MutationObserver(() => {
				const $last = qr.page.inner_toolbar.children().last();
				if (!qr.page.inner_toolbar.find(".nxr-layout-btn").length || !$last.is(".nxr-group-btn")) settle(qr);
			}).observe(qr.page.inner_toolbar[0], { childList: true });
		}
		let timer = null;
		const later = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				try {
					nexlify.report_view.update(qr);
				} catch (e) {
					fail(qr, e);
				}
			}, 60);
		};
		// the parts above the table follow every change at once; the table a moment later
		const now = () => {
			settle(qr);
			later();
		};
		// Frappe redraws its own table each time the report runs ...
		new MutationObserver(now).observe(qr.$report[0], { childList: true, subtree: true });
		// ... shows its "Loading..." screen while a report loads ...
		if (qr.$loading && qr.$loading.length) {
			qr.$loading.addClass("nxv-frappe-loading");
			new MutationObserver(now).observe(qr.$loading[0], { attributes: true, attributeFilter: ["style"] });
		}
		// ... draws the summary and the chart of each run ...
		[qr.$summary, qr.$chart].forEach(($el) => {
			// folded at once (before the screen is painted), so it never shows open for a moment
			if ($el && $el.length)
				new MutationObserver(now).observe($el[0], { attributes: true, attributeFilter: ["style"], childList: true });
		});
		// ... and shows a message while it runs, or instead of rows
		if (qr.$message && qr.$message.length) {
			new MutationObserver(now).observe(qr.$message[0], { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
		}
		later();
	}

	function on_route() {
		const route = (frappe.get_route && frappe.get_route()) || [];
		const current = frappe.query_report;
		if (route[0] === "query-report" && current && current.__nxv && current.__nxv.report_name !== route[1]) current.__nxv.hide();
		if (route[0] !== "query-report") return set_pending(false);
		const name = route[1];
		// back on a report whose table is already drawn (Frappe does not run it again): nothing to wait for
		const drawn = !!(current && current.report_name === name && current.__nxv && current.__nxv.report_name === name && !current.__nxv.$wrap.prop("hidden"));
		set_pending(!drawn, current && current.report_name === name ? current : null);
		let tries = 0;
		const look = () => {
			const qr = frappe.query_report;
			if (qr && qr.report_name === route[1] && qr.$report && qr.$report.length) {
				if (document.body.classList.contains(PENDING)) set_pending(true, qr);
				return watch(qr);
			}
			if (++tries < 100) setTimeout(look, 100);
		};
		look();
	}

	// Frappe's arrow that shows a report's other filters opens them and then stops on an error
	// (toggle_filter_visiblity reads check_filter_area, which a report without separate check filters
	// never has), so it never closes them again. For the moment of the click only, an empty area lets it
	// finish; it is taken away right after, as the next report's tick-box filters would go into it.
	// Frappe's code is not changed.
	function mend_filter_toggle() {
		let tries = 0;
		const look = () => {
			const qr = frappe.query_report;
			const route = (frappe.get_route && frappe.get_route()) || [];
			if (route[0] !== "query-report") return;
			const btn = qr && qr.report_name === route[1] && qr.$collapse_button && qr.$collapse_button[0];
			if (btn && document.body.contains(btn)) {
				if (btn.__nxv_mended) return;
				btn.__nxv_mended = true;
				btn.addEventListener(
					"click",
					() => {
						if (qr.check_filter_area) return;
						qr.check_filter_area = $();
						setTimeout(() => {
							if (qr.check_filter_area && !qr.check_filter_area.length) delete qr.check_filter_area;
						});
					},
					true
				);
				return;
			}
			if (++tries < 100) setTimeout(look, 100);
		};
		look();
	}
	$(document).ready(() => {
		if (frappe.router && frappe.router.on) frappe.router.on("change", mend_filter_toggle);
		mend_filter_toggle();
	});

	if (config().enabled) {
		$(document).ready(() => {
			if (frappe.router && frappe.router.on) frappe.router.on("change", on_route);
			on_route();
		});
	}
})();
