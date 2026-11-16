// Nexlify Report View: one table for every query and script report.
// Frappe still runs the report, builds its own table (kept hidden, so Export and Print work as before)
// and keeps the filters. This file only draws what the report returned: columns, rows, indent, total row.
// On and off in Nexlify Reports Settings, with a list of reports that keep Frappe's table.
// Each user's choices (formats, columns, rules, views) are kept in Frappe's user settings, per report.
frappe.provide("nexlify.report_view");

(function () {
	const NUM = new Set(["Currency", "Float", "Int", "Percent"]);
	const AMT = new Set(["Currency", "Float"]);
	const PATTERNS = {
		"#,###.##": [",", "."],
		"#.###,##": [".", ","],
		"# ###.##": [" ", "."],
		"#'###.##": ["'", "."],
		"#,##,###.##": [",", ".", "indian"],
		"####.##": ["", "."],
		"# ###,##": [" ", ","],
		"#, ###.##": [", ", "."],
		"#,###.###": [",", "."],
		"#.###": [".", ","],
		"#,###": [",", "."],
	};
	const SCALE_LABEL = { 1000: "K", 1000000: "M", 1000000000: "B" };
	const SETTINGS_KEY = "nexlify_report_view";
	const API = "nexlify_core.nexlify_core.report_view.";
	const BLOCK = 40;
	const CHEVRON =
		'<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
	const FUNNEL = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M1 2h10L7.2 6.6V10L4.8 11V6.6z"/></svg>';
	const STYLES = [
		["redbg", __("Red background")],
		["amberbg", __("Amber background")],
		["greenbg", __("Green background")],
		["bluebg", __("Blue background")],
		["red", __("Red text")],
		["green", __("Green text")],
		["muted", __("Grey text")],
		["bold", __("Bold")],
	];
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
	];
	const NO_VALUE = new Set(["neg", "zero", "empty", "notempty"]);
	const DATE_FORMATS = [
		["", __("As in System Settings")],
		["yyyy-mm-dd", "2026-11-16"],
		["dd-mm-yyyy", "16-11-2026"],
		["dd/mm/yyyy", "16/11/2026"],
		["mm/dd/yyyy", "11/16/2026"],
		["dd MMM yyyy", "16 Nov 2026"],
	];
	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const icon = (name, size) => frappe.utils.icon(name, size || "sm");
	const round2 = (v) => Math.round(v * 100) / 100;
	// sums keep the report's own decimals (Frappe allows up to 9): round only float noise away
	const round6 = (v) => Math.round(v * 1e6) / 1e6;
	// a unit price is not added up or scaled: told by the column's fieldname, which is never translated
	const is_rate = (c) => /(^|_)(rate|price)(_|$)|valuation_rate|_rate$/i.test((c && c.fieldname) || "");
	// a number typed by a person: Arabic-Indic digits, and the site's own thousands and decimal marks
	function parse_num(value) {
		const text = String(value ?? "")
			.trim()
			.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
			.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
		if (!/\d/.test(text)) return null;
		const n = flt(text);
		return isNaN(n) ? null : n;
	}
	const clean = (s) => String(s ?? "").replace(/^'(.*)'$/, "$1");

	function hash(s) {
		let h = 2166136261;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(16);
	}

	function config() {
		return frappe.boot.nexlify_report_view || { enabled: 0, excluded: [] };
	}

	function is_wanted(report_name) {
		const c = config();
		if (!c.enabled) return false;
		if ((c.excluded || []).includes(report_name)) return false;
		return !user_prefs(report_name).frappe_view;
	}

	function user_prefs(report_name) {
		return frappe.get_user_settings(report_name, SETTINGS_KEY) || {};
	}

	function save_prefs(report_name, value) {
		frappe.model.user_settings[report_name] = frappe.model.user_settings[report_name] || {};
		frappe.model.user_settings[report_name][SETTINGS_KEY] = value;
		return frappe.model.user_settings.update(report_name, frappe.model.user_settings[report_name]);
	}

	// ------------------------------------------------------------------ number formats
	// The defaults come from System Settings; the user changes them for the report or for one column.
	function cint_or(v, d) {
		const n = parseInt(v, 10);
		return isNaN(n) ? d : n;
	}

	function type_defaults(fieldtype) {
		const sys = frappe.boot.sysdefaults || {};
		const pattern = PATTERNS[sys.number_format] ? sys.number_format : "#,###.##";
		const base = { pattern, scale: "inherit", prefix: "", suffix: "", digits: "latin", align: "right", bold: false, plus: false, neg_red: true };
		if (fieldtype === "Currency") return Object.assign(base, { decimals: cint_or(sys.currency_precision, 2), neg: "paren", zero: "dash" });
		if (fieldtype === "Float") return Object.assign(base, { decimals: cint_or(sys.float_precision, 2), neg: "paren", zero: "dash" });
		if (fieldtype === "Int") return Object.assign(base, { decimals: 0, neg: "minus", zero: "dash" });
		return Object.assign(base, { decimals: 1, neg: "minus", zero: "zero", plus: true, suffix: "%" });
	}

	function group_int(s, pattern) {
		const [sep, , mode] = PATTERNS[pattern] || PATTERNS["#,###.##"];
		if (!sep) return s;
		if (mode === "indian") {
			const last = s.slice(-3);
			const rest = s.slice(0, -3);
			return rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, sep) + sep + last : last;
		}
		return s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
	}

	function format_number(v, o) {
		const scale = o.scale_n || 1;
		const x = Math.abs(v) / scale;
		let s = x.toFixed(o.decimals);
		const zero = Number(s) === 0;
		if (zero && o.zero === "dash") return "–";
		if (zero && o.zero === "blank") return "";
		const [int_part, frac] = s.split(".");
		s = group_int(int_part, o.pattern) + (frac ? (PATTERNS[o.pattern] || PATTERNS["#,###.##"])[1] + frac : "");
		if (scale > 1) s += SCALE_LABEL[scale] || "";
		s = (o.prefix || "") + s + (o.suffix || "");
		if (v < 0 && !zero) s = o.neg === "paren" ? "(" + s + ")" : o.neg === "trail" ? s + "-" : "-" + s;
		else if (v > 0 && o.plus) s = "+" + s;
		if (o.digits === "arabic") s = s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
		return s;
	}

	function format_date(v, pattern) {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
		if (!m || !pattern) return null;
		const [, y, mo, d] = m;
		return (
			{
				"yyyy-mm-dd": `${y}-${mo}-${d}`,
				"dd-mm-yyyy": `${d}-${mo}-${y}`,
				"dd/mm/yyyy": `${d}/${mo}/${y}`,
				"mm/dd/yyyy": `${mo}/${d}/${y}`,
				"dd MMM yyyy": `${d} ${MONTHS[+mo - 1]} ${y}`,
			}[pattern] || null
		);
	}

	function to_number(v) {
		if (typeof v === "number") return v;
		if (v === null || v === undefined || v === "") return null;
		const n = Number(v);
		return isNaN(n) ? null : n;
	}

	// a calculated column: the report's number columns, numbers and + - * / ( ) only.
	// A column whose name is not a plain word (like 2026) is written in braces: {2026}
	const field_ref = (f) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(f) ? f : "{" + f + "}");
	function compile(expr, known) {
		const names = [];
		const plain = expr.replace(/\{([^{}]+)\}/g, (m, f) => {
			names.push(f.trim());
			return " __nxf" + (names.length - 1) + " ";
		});
		if (!/^[\sA-Za-z0-9_.+\-*/()]+$/.test(plain)) throw new Error(__("Use column names, numbers and + - * / ( ) only"));
		(plain.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach((id) => {
			const f = /^__nxf\d+$/.test(id) ? names[+id.slice(5)] : id;
			if (!known.has(f)) throw new Error(__("Unknown column: {0}", [f]));
		});
		const js = plain.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (m) => `(+r[${JSON.stringify(/^__nxf\d+$/.test(m) ? names[+m.slice(5)] : m)}]||0)`);
		const fn = new Function("r", '"use strict"; return (' + js + ");");
		fn({});
		return fn;
	}

	// ------------------------------------------------------------------ saved settings are checked before use
	// A public layout comes from another user. Every value that reaches a class, a style or the page
	// must be one this view knows; anything else is dropped.
	const ONE_OF = (v, list, d) => (list.includes(v) ? v : d);
	const STR = (v, max) => (typeof v === "string" ? v.slice(0, max || 140) : "");
	const INT = (v, lo, hi, d) => {
		const n = parseInt(v, 10);
		return isNaN(n) ? d : Math.max(lo, Math.min(hi, n));
	};
	const FIELD = (v) => (typeof v === "string" && /^[A-Za-z0-9_\-:.\s]{1,140}$/.test(v) ? v : null);
	const STYLE_KEYS = STYLES.map((x) => x[0]);
	const OP_KEYS = OPS.map((x) => x[0]);

	function clean_fmt(o) {
		const out = {};
		if (!o || typeof o !== "object") return out;
		if ("pattern" in o) out.pattern = ONE_OF(o.pattern, Object.keys(PATTERNS), "#,###.##");
		if ("decimals" in o) out.decimals = INT(o.decimals, 0, 9, 2);
		if ("neg" in o) out.neg = ONE_OF(o.neg, ["paren", "minus", "trail"], "paren");
		if ("zero" in o) out.zero = ONE_OF(o.zero, ["dash", "zero", "blank"], "dash");
		if ("scale" in o) out.scale = o.scale === "inherit" ? "inherit" : ONE_OF(+o.scale, [1, 1000, 1000000, 1000000000], 1);
		if ("prefix" in o) out.prefix = STR(o.prefix, 12);
		if ("suffix" in o) out.suffix = STR(o.suffix, 12);
		if ("digits" in o) out.digits = ONE_OF(o.digits, ["latin", "arabic"], "latin");
		if ("align" in o) out.align = ONE_OF(o.align, ["right", "center", "left"], "right");
		["bold", "plus", "neg_red"].forEach((k) => {
			if (k in o) out[k] = !!o[k];
		});
		if ("date" in o) out.date = ONE_OF(o.date, DATE_FORMATS.map((x) => x[0]), "");
		return out;
	}

	function clean_rule(u) {
		if (!u || typeof u !== "object") return null;
		const f = u.f === "*" ? "*" : FIELD(u.f);
		if (!f) return null;
		return {
			f,
			op: ONE_OF(u.op, OP_KEYS, ">"),
			x: STR(u.x, 40),
			x2: STR(u.x2, 40),
			style: ONE_OF(u.style, STYLE_KEYS, "amberbg"),
			scope: ONE_OF(u.scope, ["cell", "row"], "cell"),
			exclude: !!u.exclude,
		};
	}

	function clean_state(s) {
		s = s && typeof s === "object" ? s : {};
		const list = (v) => (Array.isArray(v) ? v : []);
		const map = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
		const out = {
			hidden: list(s.hidden).map(FIELD).filter(Boolean),
			order: list(s.order).map(FIELD).filter(Boolean),
			widths: {},
			labels: {},
			fmt: { report: clean_fmt(map(s.fmt).report), cols: {} },
			rules: list(s.rules).map(clean_rule).filter(Boolean).slice(0, 50),
			calcs: list(s.calcs)
				.filter((k) => k && /^nxcalc_[a-z0-9]+$/.test(k.f) && typeof k.expr === "string" && k.expr.length < 300)
				.map((k) => ({ f: k.f, label: STR(k.label, 80), expr: k.expr, type: ONE_OF(k.type, ["Currency", "Float", "Percent", "Int"], "Float") }))
				.slice(0, 20),
			added: list(s.added)
				.filter((a) => a && /^nxlink_[A-Za-z0-9_]+$/.test(a.f) && FIELD(a.doctype) && FIELD(a.field) && FIELD(a.link_field))
				.map((a) => ({
					f: a.f,
					doctype: a.doctype,
					field: a.field,
					link_field: a.link_field,
					dynamic: FIELD(a.dynamic) || "",
					label: STR(a.label, 120),
					fieldtype: ONE_OF(a.fieldtype, ["Currency", "Float", "Int", "Percent", "Date", "Link", "Check", "Data"], "Data"),
					options: FIELD(a.options) || undefined,
				}))
				.slice(0, 60),
			sorts: list(s.sorts)
				.map((x) => x && FIELD(x.key) && { key: x.key, dir: x.dir < 0 ? -1 : 1 })
				.filter(Boolean)
				.slice(0, 5),
			conds: list(s.conds).map(clean_rule).filter(Boolean).slice(0, 30),
			col_filters: {},
			group_by: FIELD(s.group_by) || "",
		};
		Object.entries(map(s.widths)).forEach(([k, v]) => {
			if (FIELD(k)) out.widths[k] = INT(v, 40, 1200, 120);
		});
		Object.entries(map(s.labels)).forEach(([k, v]) => {
			if (FIELD(k) && typeof v === "string") out.labels[k] = v.slice(0, 120);
		});
		Object.entries(map(map(s.fmt).cols)).forEach(([k, v]) => {
			if (FIELD(k)) out.fmt.cols[k] = clean_fmt(v);
		});
		Object.entries(map(s.col_filters)).forEach(([k, fl]) => {
			if (!FIELD(k) || !fl || typeof fl !== "object") return;
			if (fl.t === "in" || fl.t === "out") out.col_filters[k] = { t: fl.t, vals: list(fl.vals).filter((x) => typeof x === "string").slice(0, 5000) };
			else if (fl.t === "num") out.col_filters[k] = { t: "num", op: ONE_OF(fl.op, [">", "<", "=", "nz"], ">"), x: Number(fl.x) || 0 };
		});
		if ("units" in s) out.units = ONE_OF(+s.units, [1, 1000, 1000000, 1000000000], 1);
		if ("density" in s) out.density = s.density ? 1 : 0;
		if ("freeze" in s) out.freeze = INT(s.freeze, 0, 5, 1);
		if ("level" in s) out.level = INT(s.level, 1, 99, 99);
		return out;
	}

	// ------------------------------------------------------------------ the view
	class ReportView {
		constructor(qr) {
			this.qr = qr;
			this.report_name = qr.report_name;
			this.prefs = this.read_prefs(user_prefs(this.report_name));
			this.state = this.blank_state();
			this.sel = null;
			this.cur = null;
			this.win = [-1, -1];
			this.fcache = {};
			this.reviews = {};
			this.review_mode = false;
			this.chart_on = false;
			this.cards_shown = 40;
			this.make();
		}

		read_prefs(p) {
			p = p && typeof p === "object" ? p : {};
			const s = clean_state(p);
			return {
				density: s.density || 0,
				units: s.units || 1,
				fmt: s.fmt,
				hidden: s.hidden,
				widths: s.widths,
				order: s.order,
				labels: s.labels,
				rules: s.rules,
				calcs: s.calcs,
				added: s.added,
				layout: ONE_OF(p.layout, ["", "table", "cards"], ""),
				default_variant: typeof p.default_variant === "string" ? p.default_variant.slice(0, 140) : "",
				freeze: "freeze" in s ? s.freeze : 1,
				frappe_view: p.frappe_view ? 1 : 0,
				main_col: FIELD(p.main_col) || "",
				// the report's filters and its summary and chart open closed, until the user opens them
				closed: { filters: p.closed ? !!p.closed.filters : true, chart: p.closed ? !!p.closed.chart : true },
			};
		}

		blank_state() {
			return { query: "", col_filters: {}, sorts: [], conds: [], group_by: "", group_open: new Set(), compare: null };
		}

		// ---------------------------------------------------------------- layout
		make() {
			this.$wrap = $(`<div class="nxv">
				<div class="nxv-tools nxv-topbar">
					<div class="nxv-tg nxv-tg-find">
						<div class="nxv-menu-wrap nxv-variant-wrap"><button class="btn btn-default btn-sm nxv-variant-btn" title="${__("Layouts")}"></button><div class="nxv-menu nxv-variant-menu" hidden></div></div>
						<div class="nxv-search">${icon("search", "sm")}<input type="search" class="form-control input-sm" placeholder="${__("Find in this report")}" aria-label="${__("Find in this report")}"></div>
					</div>
					<div class="nxv-tg nxv-tg-shape">
						<div class="nxv-seg nxv-levels" title="${__("Levels")}"></div>
						<select class="form-control input-sm nxv-gb" aria-label="${__("Group by")}" title="${__("Group by")}"></select>
						<div class="nxv-seg nxv-expand" hidden><button data-x="1" title="${__("Expand all")}" aria-label="${__("Expand all")}">${icon("chevrons-up-down", "sm")}</button><button data-x="0" title="${__("Collapse all")}" aria-label="${__("Collapse all")}">${icon("chevrons-down-up", "sm")}</button></div>
					</div>
					<span class="nxv-spacer"></span>
					<div class="nxv-tg nxv-tg-icons">
						<button class="nxv-ibtn nxv-addcols-btn" title="${__("Columns")}" aria-label="${__("Columns")}">${icon("columns-3", "sm")}<span class="nxv-ibtn-lbl">${__("Columns")}</span></button>
						<button class="nxv-ibtn nxv-settings-btn" title="${__("Sort, filter and group")}" aria-label="${__("Sort, filter and group")}">${icon("arrow-down-up", "sm")}<span class="nxv-ibtn-lbl">${__("Sort & Filter")}</span></button>
						<div class="nxv-menu-wrap"><button class="nxv-ibtn nxv-view-btn" title="${__("View")}" aria-label="${__("View")}">${icon("sliders-horizontal", "sm")}<span class="nxv-ibtn-lbl">${__("View")}</span></button>
							<div class="nxv-menu nxv-cmenu nxv-view-menu" role="menu" hidden></div></div>
						<span class="nxv-isep"></span>
						<div class="nxv-menu-wrap"><button class="nxv-ibtn nxv-export-btn" title="${__("Export, print or copy")}" aria-label="${__("Export, print or copy")}">${icon("download", "sm")}<span class="nxv-ibtn-lbl">${__("Export")}</span></button><div class="nxv-menu nxv-cmenu nxv-export-menu" role="menu" hidden></div></div>
						<button class="nxv-ibtn nxv-full-btn" title="${__("Full Screen")}" aria-label="${__("Full Screen")}">${icon("maximize-2", "sm")}</button>
					</div>
					<div class="nxv-menu-wrap nxv-more-wrap"><button class="nxv-ibtn nxv-more-btn" title="${__("More")}" aria-label="${__("More")}">${icon("ellipsis", "sm")}</button><div class="nxv-menu nxv-cmenu nxv-more-menu" role="menu" hidden></div></div>
					<div class="nxv-hidden-actions" hidden>
						<button class="nxv-cmp-btn" aria-pressed="false"></button><button class="nxv-rev-btn" aria-pressed="false"></button><button class="nxv-frappe-btn"></button><button class="nxv-cust-btn" aria-pressed="false"></button>
					</div>
				</div>
				<div class="nxv-secs">
					<section class="nxv-sec" data-sec="filters" hidden>
						<button type="button" class="nxv-sec-hd" aria-expanded="true"><span class="nxv-sec-arr">${icon("chevron-down", "sm")}</span><span class="nxv-sec-ic">${icon("filter", "sm")}</span><span class="nxv-sec-t"></span><span class="nxv-sec-sum"></span></button>
						<div class="nxv-sec-body"></div>
					</section>
					<section class="nxv-sec" data-sec="chart" hidden>
						<button type="button" class="nxv-sec-hd" aria-expanded="true"><span class="nxv-sec-arr">${icon("chevron-down", "sm")}</span><span class="nxv-sec-ic">${icon("chart-column", "sm")}</span><span class="nxv-sec-t"></span><span class="nxv-sec-sum"></span></button>
						<div class="nxv-sec-body"></div>
					</section>
				</div>
				<div class="nxv-vfilters" hidden></div>
				<div class="nxv-scroller" tabindex="0" aria-label="${__("Report table")}"><table class="nxv-grid"><colgroup></colgroup><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
				<div class="nxv-cards" hidden></div>
				<div class="nxv-chart" hidden></div>
				<div class="nxv-status"></div>
				<div class="nxv-pop nxv-filter-pop" hidden></div>
				<div class="nxv-pop nxv-review-pop" hidden></div>
				<div class="nxv-sheet" hidden><div class="nxv-sheet-card" role="dialog" aria-modal="true"></div></div>

				<aside class="nxv-drawer nxv-drill" aria-label="${__("Drill down")}">
					<div class="nxv-path"></div>
					<header><div class="nxv-drawer-title"><h4></h4><p></p></div><button class="btn btn-default btn-xs nxv-close" aria-label="${__("Close")}">×</button></header>
					<div class="nxv-drawer-sum" hidden></div>
					<div class="nxv-drawer-body"></div>
					<footer></footer>
				</aside>
				<aside class="nxv-drawer nxv-cust" aria-label="${__("Customize")}">
					<header><div class="nxv-drawer-title"><h4>${__("Customize this report")}</h4><p>${__("Saved for you, for this report")}</p></div><button class="btn btn-default btn-xs nxv-close" aria-label="${__("Close")}">×</button></header>
					<nav class="nxv-ctabs">
						<button data-t="format">${__("Number Format")}</button>
						<button data-t="rules">${__("Highlight Rules")}</button><button data-t="calc">${__("Calculated Columns")}</button>
					</nav>
					<div class="nxv-cust-body"></div>
				</aside>
			</div>`);
			this.$wrap.insertAfter(this.qr.$report);
			this.$scroller = this.$wrap.find(".nxv-scroller");
			this.scroller = this.$scroller[0];
			this.grid = this.$wrap.find(".nxv-grid")[0];
			this.cust_tab = "format";
			this.variants = [];
			this.variant = null;
			this.variant_saved = null;
			this.added_vals = {};
			this.fmt_scope = "report";
			this.bind();
			this.set_density(this.prefs.density);
			this.set_units(this.prefs.units);
			this.set_layout(this.prefs.layout || (window.innerWidth < 640 ? "cards" : "table"), true);
		}

		show() {
			this.$wrap.removeClass("nxv-loading");
			this.qr.$report.addClass("nxv-hidden");
			this.qr.page.main.addClass("nxv-on");
			this.$wrap.prop("hidden", false);
			this.adopt_head();
		}

		hide() {
			if (this.$wrap.hasClass("nxv-full")) this.toggle_full();
			this.qr.$report.removeClass("nxv-hidden");
			this.qr.page.main.removeClass("nxv-on");
			this.$wrap.prop("hidden", true);
			this.close_drawers();
			this.release_head();
			if (this.qr.$loading) this.qr.$loading.removeClass("nxv-hide");
			// Frappe's own table is back: its menu items with it
			sync_header(this.qr);
		}

		destroy() {
			if (this.$wrap.hasClass("nxv-full")) this.toggle_full();
			document.removeEventListener("mousemove", this.on_move);
			document.removeEventListener("mouseup", this.on_up);
			document.removeEventListener("click", this.on_doc_click);
			document.removeEventListener("keydown", this.on_esc);
			window.removeEventListener("resize", this.on_resize);
			this.release_head();
			this.$wrap.remove();
		}

		// ---------------------------------------------------------------- data from the report
		load() {
			const qr = this.qr;
			// the filters these rows were run with: exports, prints and review marks use them,
			// even while the user is already changing the filters for the next run
			this.run_filters = null;
			this.run_filters = this.filters();
			const columns = (qr.columns || []).filter((c) => !c.hidden);
			this.columns = columns.map((c, i) => ({
				fieldname: c.fieldname || c.id,
				label: c.label || c.name || c.fieldname,
				fieldtype: c.fieldtype || "Data",
				options: c.options,
				width: parseInt(c.width, 10) || (i === 0 ? 240 : 120),
				src: c,
				fkey: c.fieldname || c.id,
			}));
			this.report_columns = this.columns.slice();
			this.avail_promise = null;
			this.add_linked_defs();
			// copies: the view marks its rows, and Frappe's own data stays as Frappe left it
			const data = (qr.data || []).map((r) => Object.assign({}, r));
			this.totals = [];
			if (qr.raw_data && qr.raw_data.add_total_row && !qr.report_settings.tree && data.length) this.totals = [data.pop()];
			this.totals.forEach((r) => (r.__nxtotal = true));
			this.is_tree = !!qr.tree_report;
			this.link_tree(data);
			this.rows = data;
			// review and compare keys come from the report's own columns, the same for every user
			this.set_keys(data, this.report_columns);
			const keys = this.report_columns.map((c) => c.fieldname);
			data.forEach((r) => (r.__nxt = keys.map((k) => clean(r[k])).join(" ").toLowerCase()));
			this.max_indent = this.is_tree ? data.reduce((m, r) => Math.max(m, r.indent || 0), 0) : 0;
			const depth = qr.report_settings && typeof qr.report_settings.initial_depth === "number" ? qr.report_settings.initial_depth : null;
			// filters picked in the view stay through a re-run, for columns the report still has
			Object.keys(this.state.col_filters).forEach((f) => {
				if (!this.columns.find((c) => c.fieldname === f)) delete this.state.col_filters[f];
			});
			this.state.compare = null;
			this.state.group_open = new Set();
			if (this.is_tree) this.state.group_by = "";
			this.bmap = new Map();
			this.sel = null;
			this.cur = null;
			this.recompile_calcs();
			this.set_level(depth === null ? 99 : depth + 1, true);
			this.render_controls();
			this.refresh();
			this.load_reviews();
			this.fetch_linked();
			this.load_variants(!this.variants_ready);
		}

		link_tree(data) {
			data.forEach((r, i) => {
				r.__nxi = i;
				r.__nxkids = false;
				r.__nxparent = -1;
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

		// A row's key: its text columns under its parent's key. The match key (for comparing two runs)
		// leaves out dates and vouchers; the review key keeps them and is made unique.
		set_keys(data, columns) {
			const text = columns.filter((c) => !NUM.has(c.fieldtype));
			const match_cols = text.filter((c) => c.fieldtype !== "Date" && !/voucher/i.test(c.fieldname));
			const own = (r, cols) => cols.map((c) => clean(r[c.fieldname])).join("|");
			data.forEach((r) => {
				const parent = r.__nxparent > -1 ? data[r.__nxparent] : null;
				r.__nxmk = (parent ? parent.__nxmk + "/" : "") + own(r, match_cols);
				r.__nxrk = (parent ? parent.__nxrk + "/" : "") + own(r, text);
			});
			const seen = {};
			data.forEach((r) => {
				seen[r.__nxrk] = (seen[r.__nxrk] || 0) + 1;
				if (seen[r.__nxrk] > 1) r.__nxrk += "#" + seen[r.__nxrk];
				r.__nxrh = hash(r.__nxrk);
			});
			const keyed = data.filter((r) => r.__nxmk.replace(/[|/]/g, ""));
			return new Set(keyed.map((r) => r.__nxmk)).size === keyed.length;
		}

		number_fieldnames() {
			return new Set((this.report_columns || []).filter((c) => NUM.has(c.fieldtype)).map((c) => c.fieldname));
		}

		recompile_calcs() {
			const known = this.number_fieldnames();
			this.calc_fns = {};
			(this.prefs.calcs || []).forEach((k) => {
				try {
					this.calc_fns[k.f] = compile(k.expr, known);
				} catch (e) {
					this.calc_fns[k.f] = null;
				}
			});
		}

		// ---------------------------------------------------------------- columns shown
		build_cols() {
			this.fcache = {};
			const hidden = new Set(this.prefs.hidden || []);
			const order = this.prefs.order || [];
			const rank = (c, i) => (i === 0 ? -1 : order.includes(c.fieldname) ? order.indexOf(c.fieldname) : 1000 + i);
			const base = this.columns
				.map((c, i) => ({ c, i, r: rank(c, i) }))
				.sort((a, b) => a.r - b.r)
				.map((x) => x.c);
			const out = [];
			const cmp = this.state.compare;
			const add = (col) => {
				const fo = NUM.has(col.fieldtype) ? this.opts_for(col) : null;
				col.title = col.label + (fo && fo.scale_n > 1 ? " (" + SCALE_LABEL[fo.scale_n] + ")" : "");
				out.push(col);
			};
			base.forEach((c, i) => {
				if (i > 0 && hidden.has(c.fieldname)) return;
				const label = this.prefs.labels[c.fieldname] || c.label;
				let width = this.prefs.widths[c.fieldname] || c.width;
				// a grouped table shows the group's name in the first column: give it room
				if (i === 0 && this.state.group_by) width = Math.max(width, 280);
				add(Object.assign({}, c, { label, width, raw_label: c.label }));
				if (cmp && NUM.has(c.fieldtype) && c.fieldtype !== "Percent" && cmp.colmap[c.fieldname]) {
					add(Object.assign({}, c, { label: `${label} (${cmp.label})`, fieldname: c.fieldname + "__b", twin: c.fieldname, width: this.prefs.widths[c.fieldname] || c.width }));
					if (AMT.has(c.fieldtype) && !is_rate(c)) {
						add({ label: "Δ %", fieldname: c.fieldname + "__d", fkey: c.fieldname + "__d", fieldtype: "Percent", delta: c.fieldname, calc: true, width: 90 });
					}
				}
			});
			(this.prefs.calcs || []).forEach((k) => {
				if (hidden.has(k.f)) return;
				add({ label: this.prefs.labels[k.f] || k.label, fieldname: k.f, fkey: k.f, fieldtype: k.type, calc: true, expr: k.expr, fn: this.calc_fns[k.f], width: this.prefs.widths[k.f] || 140 });
			});
			return out;
		}

		opts_for(c) {
			const key = c.fkey || c.fieldname;
			if (this.fcache[key]) return this.fcache[key];
			const o = type_defaults(c.fieldtype);
			const amt = AMT.has(c.fieldtype);
			const shared = ["pattern", "digits", "neg_red", "align", "bold", "neg"];
			Object.entries(this.prefs.fmt.report).forEach(([k, v]) => {
				if (k !== "date" && (amt || shared.includes(k))) o[k] = v;
			});
			const own = this.prefs.fmt.cols[key] || {};
			Object.assign(o, own);
			const precision = c.src && c.src.precision;
			if (precision !== undefined && precision !== null && precision !== "" && !("decimals" in own) && !("decimals" in this.prefs.fmt.report)) {
				o.decimals = cint_or(precision, o.decimals);
			}
			o.scale_n = o.scale === "inherit" ? (amt && !is_rate(c) ? this.units : 1) : +o.scale;
			return (this.fcache[key] = o);
		}

		// the value a cell shows: the report's, run B's, or worked out in this view
		val(r, c) {
			if (c.fn !== undefined) {
				if (!c.fn) return null;
				try {
					const x = c.fn(r);
					return isFinite(x) ? round6(x) : null;
				} catch (e) {
					return null;
				}
			}
			if (c.delta) {
				const a = to_number(r[c.delta]);
				const b = to_number(this.bval(r, c.delta));
				if (a === null || b === null || !b) return null;
				return round2(((a - b) / Math.abs(b)) * 100);
			}
			if (c.twin) return this.bval(r, c.twin);
			if (c.linked) return this.linked_val(r, c);
			return r[c.fieldname];
		}

		col_of(f) {
			return this.columns.find((x) => x.fieldname === f) || (this.cols || []).find((x) => x.fieldname === f);
		}

		bval(r, f) {
			if (r.__nxgroup || r.__nxcalcrow) return r[f + "__b"];
			const b = this.bmap.get(r);
			return b ? b[f] : null;
		}

		// ---------------------------------------------------------------- rows shown
		pass_filters(r) {
			if (this.state.conds.length && !this.pass_conds(r)) return false;
			for (const f in this.state.col_filters) {
				const fl = this.state.col_filters[f];
				const c = this.col_of(f);
				const v = c ? this.val(r, c) : r[f];
				if (fl.t === "in") {
					if (!fl.vals.has(String(v ?? ""))) return false;
				} else if (fl.t === "out") {
					if (fl.vals.has(String(v ?? ""))) return false;
				} else {
					const n = to_number(v);
					if (n === null) return false;
					if (fl.op === ">" && !(n > fl.x)) return false;
					if (fl.op === "<" && !(n < fl.x)) return false;
					if (fl.op === "=" && Math.abs(n - fl.x) > 0.005) return false;
					if (fl.op === "nz" && !n) return false;
				}
			}
			return true;
		}

		// Settings > Filter: on one column, a row passes when any "include" holds; no "exclude" may hold
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

		compute_view() {
			const rows = this.rows;
			const q = this.state.query;
			const filtering = q || Object.keys(this.state.col_filters).length || this.state.conds.length;
			const match = (r) => (!q || r.__nxt.includes(q)) && this.pass_filters(r);
			let list;
			if (this.is_tree && filtering) {
				const keep = new Set();
				rows.forEach((r, i) => {
					if (!match(r)) return;
					keep.add(i);
					for (let p = r.__nxparent; p > -1; p = rows[p].__nxparent) keep.add(p);
				});
				list = rows.filter((r, i) => keep.has(i));
			} else if (this.is_tree) {
				list = [];
				let skip = null;
				for (const r of rows) {
					const ind = r.indent || 0;
					if (skip !== null && ind > skip) continue;
					skip = null;
					list.push(r);
					if (r.__nxkids && !r.__nxopen) skip = ind;
				}
			} else list = rows.filter(match);
			if (this.is_tree) return list;
			const sorts = this.state.sorts.map((s) => ({ c: this.col_of(s.key) || this.cols.find((x) => x.fieldname === s.key), dir: s.dir })).filter((s) => s.c);
			if (sorts.length) {
				list = list.slice().sort((a, b) => {
					for (const { c, dir } of sorts) {
						const d = NUM.has(c.fieldtype)
							? (to_number(this.val(a, c)) ?? -Infinity) - (to_number(this.val(b, c)) ?? -Infinity)
							: String(this.val(a, c) ?? "").localeCompare(String(this.val(b, c) ?? ""));
						if (d) return d * dir;
					}
					return 0;
				});
			}
			return this.state.group_by ? this.group_rows(list, sorts[0]) : list;
		}

		// Group by: the subtotals are worked out here from the rows under them, so they show as calculated
		group_rows(list, first_sort) {
			const c = this.col_of(this.state.group_by);
			if (!c) return list;
			const sc = first_sort && first_sort.c;
			const dir = first_sort ? first_sort.dir : 1;
			const groups = new Map();
			list.forEach((r) => {
				const k = clean(this.val(r, c)) || __("(blank)");
				if (!groups.has(k)) groups.set(k, []);
				groups.get(k).push(r);
			});
			const sum_cols = this.cols.filter((x) => AMT.has(x.fieldtype) && !x.calc && !is_rate(x));
			let out = [...groups.entries()].map(([k, rs]) => {
				const g = { __nxgroup: true, __nxgkey: k, __nxglabel: this.prefs.labels[c.fieldname] || c.label, __nxcount: rs.length, __nxrows: rs };
				sum_cols.forEach((x) => (g[x.fieldname] = round6(rs.reduce((s, r) => s + (to_number(this.val(r, x)) || 0), 0))));
				return g;
			});
			if (sc && NUM.has(sc.fieldtype)) out.sort((a, b) => ((to_number(this.val(a, sc)) || 0) - (to_number(this.val(b, sc)) || 0)) * dir);
			else out.sort((a, b) => a.__nxgkey.localeCompare(b.__nxgkey));
			const flat = [];
			out.forEach((g) => {
				flat.push(g);
				if (this.state.group_open.has(g.__nxgkey)) flat.push(...g.__nxrows);
			});
			return flat;
		}

		filtering() {
			return !!(this.state.query || Object.keys(this.state.col_filters).length || this.state.conds.length);
		}

		// The report's own total row, as it came. When the rows are filtered it no longer adds up to
		// what is shown, so the footer then adds up the rows shown, as Frappe's table does, and says so.
		foot() {
			if (!this.totals.length || !this.filtering()) return this.totals;
			if (this.foot_cache && this.foot_cache.view === this.view && this.foot_cache.cols === this.cols) return this.foot_cache.rows;
			const t = { __nxtotal: true, __nxcalcrow: true };
			// every row that passed the filters, closed groups included (a group carries its rows),
			// each row once (an open group's rows also follow it in the view)
			const seen = new Set();
			const rows = [];
			this.view.forEach((r) =>
				(r.__nxgroup ? r.__nxrows || [] : [r]).forEach((x) => {
					if (seen.has(x)) return;
					seen.add(x);
					rows.push(x);
				})
			);
			this.cols.forEach((c) => {
				if (!NUM.has(c.fieldtype) || c.fieldtype === "Percent" || c.delta || c.fn !== undefined || is_rate(c)) return;
				const key = c.twin ? c.twin + "__b" : c.fieldname;
				t[key] = round6(rows.reduce((sum, r) => sum + (to_number(this.val(r, c)) || 0), 0));
			});
			this.foot_cache = { view: this.view, cols: this.cols, rows: [t] };
			return this.foot_cache.rows;
		}

		refresh(keep_scroll) {
			this.cols = this.build_cols();
			this.view = this.compute_view();
			this.sel = null;
			if (this.cur && (this.cur.v >= this.view.length || this.cur.c >= this.cols.length)) this.cur = null;
			if (!keep_scroll) {
				this.scroller.scrollTop = 0;
				this.cards_shown = 40;
			}
			this.render_head();
			this.render_body(true);
			this.render_vfilters();
			this.draw_chart();
			if (this.variants_ready) this.render_variant_btn();
		}

		freeze_n() {
			const n = this.prefs.freeze === undefined || this.prefs.freeze === null ? 1 : +this.prefs.freeze;
			return Math.max(0, Math.min(n, 5));
		}

		// the first N columns stay in place: each one sticks at the width of the frozen columns before it
		frozen_attrs() {
			const n = Math.min(this.freeze_n(), (this.cols || []).length);
			let off = 0;
			this.fz = (this.cols || []).map((c, ci) => {
				if (ci >= n) return null;
				const a = { off, last: ci === n - 1 };
				off += c.width;
				return a;
			});
			this.fz_width = off;
		}

		fz_cell(html, ci, tag) {
			const a = this.fz && this.fz[ci];
			if (!a) return html;
			return html.replace(`<${tag} class="`, `<${tag} style="inset-inline-start:${a.off}px" class="nxv-fz${a.last ? " nxv-fz-last" : ""} `);
		}

		// ---------------------------------------------------------------- drawing
		render_head() {
			this.frozen_attrs();
			const width = this.cols.reduce((s, c) => s + c.width, 0);
			this.grid.style.width = width + "px";
			this.grid.querySelector("colgroup").innerHTML = this.cols.map((c) => `<col style="width:${c.width}px">`).join("");
			this.grid.tHead.innerHTML =
				"<tr>" +
				this.cols
					.map((c, ci) => {
						const num = NUM.has(c.fieldtype);
						const cls = [num ? "nxv-r" : "", this.is_tree ? "" : "nxv-sortable", c.twin ? "nxv-twin" : "", c.calc ? "nxv-calc" : ""].join(" ");
						const si = this.state.sorts.findIndex((x) => x.key === c.fieldname);
						const sort = si > -1 ? `<span class="nxv-sort">${this.state.sorts[si].dir > 0 ? "▲" : "▼"}${this.state.sorts.length > 1 ? si + 1 : ""}</span>` : "";
						const fb =
							!c.twin && !c.calc
								? `<button class="nxv-fbtn${this.state.col_filters[c.fieldname] ? " on" : ""}" data-f="${esc(c.fieldname)}" aria-label="${__("Filter")} ${esc(c.label)}">${FUNNEL}</button>`
								: "";
						const drag = ci > 0 && !c.twin && !c.calc ? ' draggable="true"' : "";
						const tip = c.expr ? __("Calculated in this view: {0}", [c.expr]) : c.delta ? __("Calculated in this view from the two runs") : c.label;
						return this.fz_cell(`<th class="${cls}" data-ci="${ci}"${drag} title="${esc(tip)}">${esc(c.title)}${sort}${fb}<span class="nxv-rz" data-rz="${ci}"></span></th>`, ci, "th");
					})
					.join("") +
				"</tr>";
			this.grid.tFoot.innerHTML = this.foot().map((r) => this.row_html(r, -1)).join("");
		}

		review_of(r, c) {
			if (r.__nxgroup || r.__nxtotal || c.calc || c.twin) return null;
			return this.reviews[r.__nxrh + "|" + c.fieldname] || null;
		}

		rule_hit(u, r, c) {
			const x = this.val(r, c);
			const n = to_number(x);
			const a = parse_num(u.x);
			const b = parse_num(u.x2);
			const t = clean(x).toLowerCase();
			switch (u.op) {
				case ">":
					return n !== null && n > a;
				case "<":
					return n !== null && n < a;
				case "=":
					return NUM.has(c.fieldtype) ? n !== null && Math.abs(n - a) < 0.005 : t === String(u.x || "").toLowerCase();
				case "between":
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

		rule_for(u, c) {
			return u.f === "*" ? NUM.has(c.fieldtype) && !c.delta : u.f === c.fieldname;
		}

		row_rule_classes(r) {
			const rules = this.prefs.rules || [];
			if (!rules.length || r.__nxgroup || r.__nxtotal) return "";
			return rules
				.filter((u) => u.scope === "row")
				.filter((u) => {
					if (u.f === "*") return this.cols.some((c) => NUM.has(c.fieldtype) && !c.delta && this.rule_hit(u, r, c));
					const c = this.cols.find((x) => x.fieldname === u.f) || this.columns.find((x) => x.fieldname === u.f);
					return c && this.rule_hit(u, r, c);
				})
				.map((u) => " nxv-hs-" + u.style)
				.join("");
		}

		cell(r, c, v, ci) {
			const raw = this.val(r, c);
			const cur = v > -1 && this.cur && this.cur.v === v && this.cur.c === ci ? " nxv-cur" : "";
			let rules = "";
			if ((this.prefs.rules || []).length && !r.__nxgroup && !r.__nxtotal) {
				this.prefs.rules.forEach((u) => {
					if (u.scope === "cell" && this.rule_for(u, c) && this.rule_hit(u, r, c)) rules += " nxv-hs-" + u.style;
				});
			}
			if (NUM.has(c.fieldtype)) {
				const n = to_number(raw);
				const fo = this.opts_for(c);
				let cls = (fo.align === "left" ? "" : fo.align === "center" ? "nxv-c" : "nxv-r") + cur + rules;
				if (c.calc || (r.__nxgroup && !c.twin) || r.__nxcalcrow) cls += " nxv-calc";
				if (c.twin) cls += " nxv-twin";
				if (n !== null) {
					cls += " nxv-num";
					if (fo.neg_red) {
						if (c.fieldtype === "Percent") cls += n < 0 ? " nxv-neg" : n > 0 ? " nxv-pos" : "";
						else if (n < 0) cls += " nxv-neg";
					}
					if (!n) cls += " nxv-zero";
					if (fo.bold) cls += " nxv-b";
					if (v > -1 && this.in_sel(v, ci)) cls += " nxv-sel";
				}
				let mark = "";
				const rv = this.review_of(r, c);
				if (rv) {
					mark = `<i class="nxv-tk ${rv.status === "Reviewed" ? "ok" : "flag"}">${rv.status === "Reviewed" ? "✓" : "!"}</i>`;
					if (rv.note) cls += " nxv-noted";
				}
				// a report formatter that shows something else than the number (a growth %, a label) wins
				if (!c.twin && !c.calc && !r.__nxgroup) {
					const own = this.report_formatted(r, c, raw, n);
					if (own !== null) return `<td class="${cls}" data-c="${ci}">${mark}${own}</td>`;
				}
				const text = n === null ? clean(raw) : format_number(n, fo);
				const tip = text + (rv && rv.note ? " · " + __("Note") + ": " + rv.note : "");
				return `<td class="${cls}" data-c="${ci}" title="${esc(tip)}">${mark}${esc(text)}</td>`;
			}
			let html;
			if (r.__nxgroup) {
				html = "";
				if (ci === 0) {
					const open = this.state.group_open.has(r.__nxgkey) ? "open" : "";
					html = `<span class="nxv-acc"><span class="nxv-tw ${open}" data-g="${esc(r.__nxgkey)}" role="button" aria-label="${__("Expand or collapse")}">${CHEVRON}</span><span>${esc(r.__nxglabel)}: ${esc(r.__nxgkey)}<span class="nxv-cnt">${r.__nxcount}</span></span></span>`;
				}
				return `<td class="${cur.trim()}${rules}" data-c="${ci}">${html}</td>`;
			}
			const date_fmt = this.prefs.fmt.report.date;
			const own_date = c.fieldtype === "Date" && date_fmt ? format_date(raw, date_fmt) : null;
			if (own_date !== null) html = esc(own_date);
			else {
				try {
					html = raw === null || raw === undefined ? "" : c.src && c.src.format ? this.call_format(r, c, raw) : esc(clean(raw));
				} catch (e) {
					html = esc(clean(raw));
				}
			}
			if (v === -1 && ci === 0 && r.__nxcalcrow) html = `<b class="nxv-calc">${__("Total of the rows shown")}</b>`;
			else if (v === -1 && ci === 0 && !raw) html = `<b>${__("Total")}</b>`;
			if (ci === 0 && this.is_tree && v > -1) {
				const tw = `<span class="nxv-tw ${r.__nxkids ? (r.__nxopen || this.state.query ? "open" : "") : "leaf"}" data-tw="${r.__nxi}" role="button" aria-label="${__("Expand or collapse")}">${CHEVRON}</span>`;
				html = `<span class="nxv-acc" style="padding-inline-start:${(r.indent || 0) * 18}px">${tw}<span>${html}</span></span>`;
			} else if (ci === 0 && this.state.group_by && v > -1) {
				html = `<span class="nxv-acc" style="padding-inline-start:26px"><span>${html}</span></span>`;
			}
			return `<td class="${cur.trim()}${rules}" data-c="${ci}" title="${esc(clean(raw))}">${html}</td>`;
		}

		// Frappe's table calls a column's format with the row's cells and the column's place
		// (colIndex: 0 is the row number, the report's columns start at 1); report formatters read both
		call_format(r, c, raw) {
			const i = this.report_columns.findIndex((x) => x.fieldname === c.fieldname);
			if (!c.fcol) c.fcol = Object.assign({}, c.src, { colIndex: i + 1, docfield: c.src });
			if (!r.__nxcells) {
				r.__nxcells = [{ content: r.__nxi, colIndex: 0 }].concat(this.report_columns.map((x, k) => ({ content: r[x.fieldname], colIndex: k + 1, column: x.src })));
			}
			return c.src.format(raw, r.__nxcells, c.fcol, r);
		}

		// A report formatter that only formats the number leaves the number to this view. One that
		// shows something else (a growth %, a label, an icon) wins.
		report_formatted(r, c, raw, n) {
			const qr = this.qr;
			if (!qr.report_settings || !qr.report_settings.formatter || !c.src || !c.src.format) return null;
			let html;
			try {
				html = this.call_format(r, c, raw);
			} catch (e) {
				return null;
			}
			if (html === null || html === undefined) return null;
			const text = $("<div>").html(String(html)).text().trim();
			if (!text) return n ? null : "";
			if (n === null) return String(html);
			const digits = text.replace(/[^0-9]/g, "").replace(/^0+/, "");
			if (/%/.test(text)) return String(html);
			for (let d = 0; d <= 9; d++) {
				const want = Math.abs(n).toFixed(d).replace(/[^0-9]/g, "").replace(/^0+/, "");
				if (digits === want) return null;
			}
			return String(html);
		}

		row_html(r, v) {
			const cells = this.cols.map((c, ci) => this.fz_cell(this.cell(r, c, v, ci), ci, "td")).join("");
			return `<tr class="${this.row_cls(r, v)}" data-v="${v}">${cells}</tr>`;
		}

		row_cls(r, v) {
			let cls = r.bold || r.is_total_row ? "nxv-bold" : "";
			if (r.__nxgroup) cls = "nxv-grp";
			if (this.is_tree && v > -1 && r.__nxkids) cls += (r.indent || 0) === 0 ? " nxv-g1" : " nxv-g2";
			// a top row of a tree with no rows under it and a name is the statement's total (Total Income, Net Profit)
			else if (this.is_tree && v > -1 && !cls && !(r.indent > 0) && String(r[this.cols[0].fieldname] ?? "").trim()) cls = "nxv-bold";
			return cls + this.row_rule_classes(r);
		}

		// only the rows near the screen are drawn; drawn rows never change, so nothing shakes
		render_body(force) {
			if (this.layout === "cards") return this.render_cards();
			const n = this.view.length;
			let s = 0;
			let e = n;
			if (n > 150) {
				const first = Math.floor(this.scroller.scrollTop / this.row_h);
				s = Math.max(0, Math.floor(first / BLOCK) * BLOCK - BLOCK);
				e = Math.min(n, s + Math.ceil((this.scroller.clientHeight || 600) / this.row_h) + BLOCK * 3);
			}
			if (!force && s === this.win[0] && e === this.win[1]) return;
			this.win = [s, e];
			const span = this.cols.length;
			const spacer = (h) => (h > 0 ? `<tr class="nxv-sp"><td colspan="${span}" style="height:${h}px"></td></tr>` : "");
			let html = spacer(s * this.row_h);
			for (let v = s; v < e; v++) html += this.row_html(this.view[v], v);
			html += spacer((n - e) * this.row_h);
			this.grid.tBodies[0].innerHTML = html;
			this.status();
		}

		// A list for small screens (and for anyone who picks it): one row a line, the name and a
		// short line under it on one side, the main figure on the other. A tap shows every figure.
		render_cards() {
			const n = Math.min(this.view.length, this.cards_shown);
			const main = this.main_col();
			const text_cols = this.cols.filter((c) => !NUM.has(c.fieldtype));
			// a column naming a document type (Party Type, Voucher Type) says little about the row
			const name_col = text_cols.find((c) => c.fieldtype !== "Date" && !(c.fieldtype === "Link" && c.options === "DocType")) || this.cols[0];
			const sub_cols = text_cols.filter((c) => c !== name_col && !(c.fieldtype === "Link" && c.options === "DocType")).slice(0, 2);
			const figure = (r) => {
				if (!main) return "";
				const x = to_number(this.val(r, main));
				const fo = this.opts_for(main);
				const cls = ["nxv-row-fig", x !== null && x < 0 && fo.neg_red ? "nxv-neg" : "", main.calc || r.__nxgroup || r.__nxcalcrow ? "nxv-calc" : ""].join(" ");
				return `<span class="${cls}">${esc(x === null ? "" : format_number(x, fo))}</span>`;
			};
			const row = (r, v, tot) => {
				let name;
				let sub = "";
				let cls = "nxv-row";
				if (r.__nxgroup) {
					const open = this.state.group_open.has(r.__nxgkey) ? "open" : "";
					name = `<span class="nxv-tw ${open}" data-g="${esc(r.__nxgkey)}" role="button">${CHEVRON}</span><span class="nxv-row-name">${esc(r.__nxgkey)}</span>`;
					sub = `${esc(r.__nxglabel)} · ${__("{0} rows", [r.__nxcount])}`;
					cls += " nxv-row-grp";
				} else if (tot) {
					name = `<span class="nxv-row-name">${r.__nxcalcrow ? __("Total of the rows shown") : __("Total")}</span>`;
					cls += " nxv-row-tot";
				} else {
					const tw = this.is_tree ? `<span class="nxv-tw ${r.__nxkids ? (r.__nxopen || this.state.query ? "open" : "") : "leaf"}" data-tw="${r.__nxi}" role="button">${CHEVRON}</span>` : "";
					name = `${tw}<span class="nxv-row-name">${esc(clean(r[name_col.fieldname]))}</span>`;
					sub = sub_cols
						.map((c) => (c.fieldtype === "Date" && r[c.fieldname] ? frappe.datetime.str_to_user(r[c.fieldname]) : clean(r[c.fieldname])))
						.filter(Boolean)
						.map(esc)
						.join(" · ");
					if (r.bold || (this.is_tree && r.__nxkids)) cls += " nxv-row-bold";
				}
				const pad = this.is_tree && !tot ? ` style="padding-inline-start:${12 + (r.indent || 0) * 14}px"` : "";
				return `<div class="${cls}" data-v="${v}"${pad}><div class="nxv-row-main"><div class="nxv-row-title">${name}</div>${sub ? `<div class="nxv-row-sub">${sub}</div>` : ""}</div>${figure(r)}</div>`;
			};
			let html = main && !this.is_tree ? `<div class="nxv-row nxv-row-head"><span>${esc(name_col.title || name_col.label)}</span><span>${esc(main.title)}</span></div>` : "";
			for (let v = 0; v < n; v++) html += row(this.view[v], v, false);
			if (this.view.length > n) html += `<button class="btn btn-default btn-sm nxv-more">${__("Show {0} more of {1}", [Math.min(40, this.view.length - n), this.view.length - n])}</button>`;
			html += this.foot().map((r) => row(r, -1, true)).join("");
			this.$wrap.find(".nxv-cards").html(html);
			this.status();
		}

		// every figure of one row, in a sheet from the bottom; a figure opens what is behind it
		open_sheet(r, v) {
			const $s = this.$wrap.find(".nxv-sheet");
			const nums = this.cols.filter((c) => NUM.has(c.fieldtype));
			const texts = this.cols.filter((c) => !NUM.has(c.fieldtype));
			const title = r.__nxgroup ? r.__nxgkey : r.__nxtotal ? (r.__nxcalcrow ? __("Total of the rows shown") : __("Total")) : this.row_label(r);
			const fig = (c) => {
				const x = to_number(this.val(r, c));
				const fo = this.opts_for(c);
				// a figure with something behind it is a link; a zero is not
				const cls = [x !== null && x < 0 && fo.neg_red ? "nxv-neg" : "", c.calc || r.__nxgroup || r.__nxcalcrow ? "nxv-calc" : "", x ? "nxv-num" : "nxv-zero"].join(" ");
				return `<div class="nxv-sheet-line"><span>${esc(c.title)}</span><b class="${cls}" data-c="${this.cols.indexOf(c)}">${esc(x === null ? "" : format_number(x, fo))}</b></div>`;
			};
			const info = r.__nxgroup || r.__nxtotal ? "" : texts.map((c) => {
				const val = c.fieldtype === "Date" && r[c.fieldname] ? frappe.datetime.str_to_user(r[c.fieldname]) : clean(this.val(r, c));
				return val ? `<div class="nxv-sheet-line nxv-sheet-info"><span>${esc(c.title)}</span><span>${esc(val)}</span></div>` : "";
			}).join("");
			$s.find(".nxv-sheet-card").html(`
				<div class="nxv-sheet-grip"></div>
				<div class="nxv-sheet-hd"><b>${esc(title)}</b><button class="nxv-ibtn nxv-sheet-close" aria-label="${__("Close")}">${icon("x", "sm")}</button></div>
				<div class="nxv-sheet-body">${nums.map(fig).join("")}${info}</div>
				${r.__nxgroup || r.__nxtotal ? "" : `<p class="nxv-small">${__("Tap a figure to see what is behind it.")}</p>`}`);
			this.sheet_row = { r, v };
			$s.prop("hidden", false);
		}

		in_sel(v, ci) {
			const s = this.sel;
			if (!s) return false;
			return v >= Math.min(s.a.v, s.b.v) && v <= Math.max(s.a.v, s.b.v) && ci >= Math.min(s.a.c, s.b.c) && ci <= Math.max(s.a.c, s.b.c);
		}

		paint() {
			this.grid.tBodies[0].querySelectorAll("tr[data-v]").forEach((tr) => {
				const v = +tr.dataset.v;
				tr.querySelectorAll("td").forEach((td) => {
					const ci = +td.dataset.c;
					td.classList.toggle("nxv-sel", td.classList.contains("nxv-num") && this.in_sel(v, ci));
					td.classList.toggle("nxv-cur", !!this.cur && this.cur.v === v && this.cur.c === ci);
				});
			});
			this.status();
			this.draw_chart();
		}

		sel_cells() {
			const s = this.sel;
			const out = [];
			if (!s) return out;
			for (let v = Math.min(s.a.v, s.b.v); v <= Math.max(s.a.v, s.b.v); v++) {
				for (let ci = Math.min(s.a.c, s.b.c); ci <= Math.max(s.a.c, s.b.c); ci++) {
					const c = this.cols[ci];
					const r = this.view[v];
					if (!c || !r || !NUM.has(c.fieldtype)) continue;
					const x = to_number(this.val(r, c));
					if (x !== null) out.push({ r, c, x });
				}
			}
			return out;
		}

		status() {
			const int = Object.assign(type_defaults("Int"), { zero: "zero" });
			const parts = [`<span><b>${format_number(this.view.length, int)}</b> ${__("rows")}</span>`];
			if (this.layout === "table" && this.view.length > 150) parts.push(`<span>${__("drawn now")}: <b>${this.win[1] - this.win[0]}</b></span>`);
			const rv = Object.values(this.reviews);
			const ok = rv.filter((x) => x.status === "Reviewed").length;
			const fl = rv.length - ok;
			if (rv.length) parts.push(`<span><b class="nxv-ok">✓ ${ok}</b> ${__("reviewed")} · <b class="nxv-flag">! ${fl}</b> ${__("need support")}</span>`);
			if (this.cols.some((c) => c.calc) || this.state.group_by) parts.push(`<span class="nxv-calc-note">${__("purple italic = calculated in this view")}</span>`);
			const cells = this.sel_cells();
			if (cells.length > 1) {
				const sum = cells.reduce((s, k) => s + k.x, 0);
				const fo = Object.assign({}, this.opts_for(cells[0].c), { zero: "zero", plus: false });
				parts.push(
					`<span class="nxv-push">${__("Count")} <b>${cells.length}</b></span><span>${__("Average")} <b>${esc(format_number(sum / cells.length, fo))}</b></span><span>${__("Sum")} <b>${esc(format_number(sum, fo))}</b></span>`
				);
				parts.push(`<button class="btn btn-default btn-xs nxv-chart-btn" aria-pressed="${this.chart_on}">${__("Chart")}</button>`);
				if (this.review_mode) parts.push(`<button class="btn btn-default btn-xs nxv-tick-all">✓ ${__("Mark {0} cells reviewed", [cells.length])}</button>`);
			} else {
				parts.push(
					`<span class="nxv-push">${
						this.review_mode ? __("Review: click a number to mark it or add a note") : __("Drag over numbers to add them up. Click a number to see what is behind it.")
					}</span>`
				);
			}
			this.$wrap.find(".nxv-status").html(parts.join(""));
		}

		// the selected figures as bars, exactly as the report shows them
		draw_chart() {
			const $c = this.$wrap.find(".nxv-chart");
			const cells = this.sel_cells();
			if (!this.chart_on || cells.length < 2 || this.layout !== "table") return $c.prop("hidden", true);
			const items = cells.slice(0, 15);
			const max = Math.max(...items.map((k) => Math.abs(k.x))) || 1;
			const neg = items.some((k) => k.x < 0);
			const many_cols = new Set(cells.map((k) => k.c.fieldname)).size > 1;
			const first = this.cols[0];
			$c.html(
				`<div class="nxv-chart-hd"><b>${__("Selected figures")}</b><span>${__("{0} cells, as the report shows them", [cells.length])}</span><span class="nxv-spacer"></span><button class="btn btn-default btn-xs nxv-chart-close">×</button></div>` +
					items
						.map((k) => {
							const w = (Math.abs(k.x) / max) * (neg ? 50 : 100);
							const left = neg ? (k.x < 0 ? 50 - w : 50) : 0;
							const name = (k.r.__nxgroup ? k.r.__nxgkey : clean(k.r[first.fieldname])) + (many_cols ? " · " + k.c.label : "");
							return `<div class="nxv-bar"><span class="nxv-bar-l" title="${esc(name)}">${esc(name)}</span><span class="nxv-bar-t">${neg ? '<i class="nxv-bar-axis"></i>' : ""}<i class="nxv-bar-f${k.x < 0 ? " neg" : ""}" style="inset-inline-start:${left}%;width:${Math.max(0.5, w)}%"></i></span><span class="nxv-bar-v">${esc(format_number(k.x, this.opts_for(k.c)))}</span></div>`;
						})
						.join("") +
					(cells.length > items.length ? `<span class="nxv-lbl">${__("{0} more cells", [cells.length - items.length])}</span>` : "")
			);
			$c.prop("hidden", false);
		}

		// ---------------------------------------------------------------- toolbar parts
		set_level(l, quiet) {
			this.level = l;
			(this.rows || []).forEach((r) => (r.__nxopen = l === 99 || (r.indent || 0) < l - 1));
			this.$wrap.find(".nxv-levels button").each((i, b) => b.setAttribute("aria-pressed", String(+b.dataset.l === l)));
			if (!quiet) this.refresh();
		}

		render_controls() {
			const $lv = this.$wrap.find(".nxv-levels");
			this.$wrap.find(".nxv-levels-lbl").prop("hidden", !this.is_tree);
			$lv.prop("hidden", !this.is_tree);
			if (this.is_tree) {
				const levels = Math.min(this.max_indent + 1, 6);
				$lv.html(
					Array.from({ length: levels }, (_, k) => `<button data-l="${k + 1}" aria-pressed="${this.level === k + 1}">${k + 1}</button>`).join("") +
						`<button data-l="99" aria-pressed="${this.level === 99}">${__("All")}</button>`
				);
			} else $lv.empty();
			this.$wrap.find(".nxv-expand").prop("hidden", !this.is_tree && !this.state.group_by);
			const $gb = this.$wrap.find(".nxv-gb");
			this.$wrap.find(".nxv-gb-lbl").prop("hidden", this.is_tree);
			$gb.prop("hidden", this.is_tree);
			$gb.html(
				`<option value="">${__("No grouping")}</option>` +
					this.columns
						.filter((c) => !NUM.has(c.fieldtype) && c.fieldtype !== "Date" && !(this.prefs.hidden || []).includes(c.fieldname))
						.map((c) => `<option value="${esc(c.fieldname)}">${esc(this.prefs.labels[c.fieldname] || c.label)}</option>`)
						.join("")
			);
			$gb.val(this.state.group_by || "");
			this.$wrap.find(".nxv-cmp-btn").attr("aria-pressed", String(!!this.state.compare));
			this.render_variant_btn();
		}

		set_density(d) {
			this.row_h = d === 1 ? 28 : 34;
			this.$wrap.toggleClass("nxv-dense", d === 1);
			this.$wrap[0].style.setProperty("--nxv-row-h", this.row_h + "px");
		}

		set_units(u) {
			this.units = u || 1;
		}

		// the figure a list row shows on its side: the user's pick, else a balance or outstanding
		// column, else the report's last amount column (the latest period of a statement)
		main_col() {
			const nums = (this.cols || []).filter((c) => NUM.has(c.fieldtype) && !c.delta);
			if (!nums.length) return null;
			const pick = nums.find((c) => c.fieldname === this.prefs.main_col);
			if (pick) return pick;
			const named = nums.find((c) => /^(outstanding|outstanding_amount|balance|closing_balance|net|total|grand_total|amount|bal_val|value)$/.test(c.fieldname));
			if (named) return named;
			const amts = nums.filter((c) => AMT.has(c.fieldtype) && !c.twin && !c.calc);
			return amts.length ? amts[amts.length - 1] : nums[0];
		}

		// a classic menu: one line per choice, a dot or a tick on the chosen one, ▸ opens a side list
		menu_html(items) {
			return items
				.filter(Boolean)
				.map((it) => {
					if (it === "-") return "<hr>";
					if (it.note) return `<small class="nxv-small">${esc(it.note)}</small>`;
					const mk = `<span class="nxv-mk">${it.on ? (it.radio ? "●" : "✓") : ""}</span>`;
					const ic = `<span class="nxv-ic">${it.icon ? icon(it.icon, "sm") : ""}</span>`;
					const lbl = `<span class="nxv-it-lbl">${esc(it.label)}</span>`;
					if (it.sub)
						return `<div class="nxv-item nxv-has-sub" role="menuitem" aria-haspopup="true">${mk}${ic}${lbl}<span class="nxv-tag">${esc(it.cur || "")}</span><span class="nxv-sub-arr">${icon("chevron-right", "xs")}</span><div class="nxv-menu nxv-cmenu nxv-sub" role="menu">${this.menu_html(it.sub)}</div></div>`;
					const role = it.radio ? "menuitemradio" : it.check ? "menuitemcheckbox" : "menuitem";
					const checked = it.radio || it.check ? ` aria-checked="${!!it.on}"` : "";
					return `<div class="nxv-item${it.on ? " on" : ""}" data-vm="${esc(it.act)}" data-val="${esc(it.val ?? "")}" role="${role}"${checked}>${mk}${ic}${lbl}${it.tag ? `<span class="nxv-tag">${esc(it.tag)}</span>` : ""}</div>`;
				})
				.join("");
		}

		// a side list opens toward the side of the page that has room
		fit_sub(item) {
			const sub = item.querySelector(":scope > .nxv-sub");
			if (!sub) return;
			item.classList.remove("nxv-sub-flip");
			const r = item.getBoundingClientRect();
			const w = sub.offsetWidth || 220;
			const rtl = frappe.utils.is_rtl();
			// by default it opens toward the start side (left in English, right in Arabic)
			const room = rtl ? window.innerWidth - r.right : r.left;
			if (room < w + 8) item.classList.add("nxv-sub-flip");
		}

		// the parts the View menu and the phone's ⋯ menu share
		view_parts() {
			const nums = (this.cols || []).filter((c) => NUM.has(c.fieldtype) && !c.delta);
			const main = this.main_col();
			const fz = this.freeze_n();
			const dense = this.row_h === 28;
			const units = [
				[1, __("Full numbers"), __("Full")],
				[1000, __("Thousands (K)"), "K"],
				[1000000, __("Millions (M)"), "M"],
				[1000000000, __("Billions (B)"), "B"],
			];
			const unit = units.find((u) => u[0] === this.units) || units[0];
			const fz_label = (n) => (n === 0 ? __("None") : n === 1 ? __("1 column") : __("{0} columns", [n]));
			return {
				layout: [
					{ act: "layout", val: "table", icon: "table", label: __("Table"), radio: 1, on: this.layout === "table" },
					{ act: "layout", val: "cards", icon: "list", label: __("List"), radio: 1, on: this.layout === "cards" },
				],
				rows: [
					{ act: "density", val: 0, icon: "rows-3", label: __("Comfortable rows"), radio: 1, on: !dense },
					{ act: "density", val: 1, icon: "rows-4", label: __("Compact rows"), radio: 1, on: dense },
				],
				units: { icon: "hash", label: __("Units"), cur: unit[2], sub: units.map(([v, l]) => ({ act: "units", val: v, label: l, radio: 1, on: v === unit[0] })) },
				freeze: {
					icon: "pin",
					label: __("Freeze columns"),
					cur: fz ? String(fz) : __("None"),
					sub: [0, 1, 2, 3, 4, 5].map((n) => ({ act: "freeze", val: n, label: fz_label(n), radio: 1, on: n === fz })),
				},
				main: nums.length
					? {
							icon: "star",
							label: __("Main figure in the list"),
							cur: main ? main.title : "",
							sub: nums.map((c) => ({ act: "main", val: c.fieldname, label: c.title, radio: 1, on: !!main && main.fieldname === c.fieldname })),
					  }
					: null,
			};
		}

		fill_view_menu() {
			const v = this.view_parts();
			this.$wrap.find(".nxv-view-menu").html(
				this.menu_html([
					...v.layout,
					"-",
					...v.rows,
					"-",
					v.units,
					v.freeze,
					v.main,
					"-",
					{ act: "autofit", icon: "move-horizontal", label: __("Fit columns to content") },
					{ act: "format", icon: "palette", label: __("Number format, highlights, calculated columns") },
					"-",
					{ note: __("Keyboard: arrows move, Shift selects, Enter opens, Ctrl+C copies.") },
				])
			);
		}

		fill_export_menu() {
			this.$wrap.find(".nxv-export-menu").html(
				this.menu_html([
					{ act: "xlsx", icon: "file-spreadsheet", label: __("Excel"), tag: ".xlsx" },
					{ act: "csv", icon: "file-text", label: __("CSV"), tag: ".csv" },
					"-",
					{ act: "print", icon: "printer", label: __("Print") },
					{ act: "pdf", icon: "file", label: __("PDF") },
					"-",
					{ act: "sel", icon: "copy", label: __("Copy selected cells"), tag: "Ctrl+C" },
					{ act: "shown", icon: "clipboard", label: __("Copy the table as shown") },
					{ act: "raw", icon: "clipboard-list", label: __("Copy with plain numbers") },
					{ note: __("The table as you see it: columns, formats, grouping and filters.") },
				])
			);
		}

		set_layout(y, quiet) {
			this.layout = y === "cards" ? "cards" : "table";
			this.$scroller.prop("hidden", this.layout !== "table");
			this.$wrap.find(".nxv-cards").prop("hidden", this.layout !== "cards");
			if (!quiet) this.refresh();
			this.fit_height();
		}

		save() {
			this.prefs.density = this.row_h === 28 ? 1 : 0;
			this.prefs.units = this.units;
			this.prefs.frappe_view = user_prefs(this.report_name).frappe_view ? 1 : 0;
			const out = JSON.parse(JSON.stringify(this.prefs));
			save_prefs(this.report_name, out);
		}

		render_vfilters() {
			const chips = Object.entries(this.state.col_filters).map(([f, fl]) => {
				const c = this.columns.find((x) => x.fieldname === f);
				const txt =
					fl.t === "in"
						? fl.vals.size === 1
							? clean([...fl.vals][0]) || __("(blank)")
							: __("{0} values", [fl.vals.size])
						: fl.t === "out"
						? __("not {0}", [fl.vals.size === 1 ? clean([...fl.vals][0]) || __("(blank)") : __("{0} values", [fl.vals.size])])
						: fl.op === "nz"
						? __("not zero")
						: fl.op + " " + fl.x;
				return `<button class="nxv-chip" data-rmf="${esc(f)}">${esc(c ? this.prefs.labels[f] || c.label : f)}: ${esc(txt)} <span>×</span></button>`;
			});
			this.state.conds.forEach((u, i) => {
				const op = (OPS.find((o) => o[0] === u.op) || [, u.op])[1];
				const v = NO_VALUE.has(u.op) ? "" : " " + u.x + (u.op === "between" ? " " + __("and") + " " + u.x2 : "");
				chips.push(`<button class="nxv-chip${u.exclude ? " nxv-chip-ex" : ""}" data-rmcond="${i}">${u.exclude ? __("Exclude") + ": " : ""}${esc(this.col_name(u.f))} ${esc(op)}${esc(v)} <span>×</span></button>`);
			});
			if (this.state.group_by) {
				const c = this.col_of(this.state.group_by);
				chips.push(`<button class="nxv-chip nxv-chip-calc" data-rmg="1">${__("Grouped by {0}", [esc(c ? this.prefs.labels[c.fieldname] || c.label : "")])} <span>×</span></button>`);
			}
			if (this.review_mode) chips.push(`<button class="nxv-chip nxv-chip-rev" data-rmrev="1">${__("Review mode")} <span>×</span></button>`);
			if (this.state.compare) chips.push(`<button class="nxv-chip" data-rmc="1">${__("Compared with")}: ${esc(this.state.compare.label)} <span>×</span></button>`);
			const $v = this.$wrap.find(".nxv-vfilters");
			$v.prop("hidden", !chips.length).html(`<span class="nxv-lbl">${__("In this view")}:</span>` + chips.join(""));
		}

		// ---------------------------------------------------------------- copy
		clip(text, msg) {
			frappe.utils.copy_to_clipboard(text);
			frappe.show_alert({ message: msg, indicator: "green" }, 3);
		}

		cell_text(r, c, raw) {
			if (r.__nxgroup && c === this.cols[0]) return `${r.__nxglabel}: ${r.__nxgkey}`;
			const x = this.val(r, c);
			if (NUM.has(c.fieldtype)) {
				const n = to_number(x);
				if (raw) return n === null ? "" : n;
				return n === null ? "" : format_number(n, this.opts_for(c));
			}
			if (r.__nxgroup) return "";
			if (x === null || x === undefined) return "";
			if (c.fieldtype === "Date" && this.prefs.fmt.report.date && !raw) return format_date(x, this.prefs.fmt.report.date) || clean(x);
			return clean(x);
		}

		copy_cells() {
			const a = this.sel ? this.sel.a : this.cur;
			const b = this.sel ? this.sel.b : this.cur;
			if (!a) return frappe.show_alert({ message: __("Select some cells first"), indicator: "orange" });
			const lines = [];
			for (let v = Math.min(a.v, b.v); v <= Math.max(a.v, b.v); v++) {
				const out = [];
				for (let ci = Math.min(a.c, b.c); ci <= Math.max(a.c, b.c); ci++) out.push(this.cell_text(this.view[v], this.cols[ci], true));
				lines.push(out.join("\t"));
			}
			this.clip(lines.join("\n"), __("Copied. Paste it straight into Excel."));
		}

		copy_table(raw) {
			const line = (r) => this.cols.map((c) => this.cell_text(r, c, raw)).join("\t");
			const foot = this.foot();
			const text = [this.cols.map((c) => c.title).join("\t"), ...this.view.map(line), ...foot.map(line)].join("\n");
			this.clip(text, __("Copied {0} rows", [this.view.length + foot.length]));
		}

		// Frappe's own Save makes a Custom Report the user owns and can share; this view's settings go with it
		save_as() {
			if (!frappe.user.is_report_manager()) {
				return frappe.msgprint(__("Only a Report Manager can save a report. Ask your System Manager for the role."));
			}
			const d = new frappe.ui.Dialog({
				title: __("Save as My Own Report"),
				fields: [
					{ fieldtype: "Data", fieldname: "report_name", label: __("Report Name"), reqd: 1, default: __("{0} - my version", [this.report_name]) },
					{
						fieldtype: "HTML",
						options: `<p class="text-muted small">${__(
							"Makes a Custom Report with the current filters and columns, and copies this view's formats, rules, calculated columns and views to it. Share it from the report like any document."
						)}</p>`,
					},
				],
				primary_action_label: __("Save"),
				primary_action: (values) => {
					frappe.call({
						method: "frappe.desk.query_report.save_report",
						args: {
							reference_report: this.report_name,
							report_name: values.report_name,
							columns: this.qr.get_visible_columns(),
							filters: this.qr.get_filter_values(),
						},
						callback: (r) => {
							if (!r.message) return;
							d.hide();
							const prefs = JSON.parse(JSON.stringify(this.prefs));
							const name = r.message;
							// the user stays on this report; the new one opens only when asked
							save_prefs(name, prefs).then(() =>
								frappe.msgprint({
									title: __("Saved as Your Own Report"),
									indicator: "green",
									message: __("Saved as {0}. This report stays as it was. Your report is in the Report list, and its menu (⋯) leads back here.", [`<b>${esc(name)}</b>`]),
									primary_action: {
										label: __("Open {0}", [esc(name)]),
										action: () => {
											frappe.hide_msgprint();
											frappe.set_route("query-report", name);
										},
									},
								})
							);
						},
					});
				},
			});
			d.show();
		}

		// ---------------------------------------------------------------- layouts (variants), like SAP's variant management
		capture_view() {
			const col_filters = {};
			Object.entries(this.state.col_filters).forEach(([f, fl]) => (col_filters[f] = fl.t === "num" ? fl : { t: fl.t, vals: [...fl.vals] }));
			return JSON.parse(
				JSON.stringify({
					hidden: this.prefs.hidden,
					order: this.prefs.order,
					widths: this.prefs.widths,
					labels: this.prefs.labels,
					fmt: this.prefs.fmt,
					units: this.units,
					density: this.row_h === 28 ? 1 : 0,
					freeze: this.freeze_n(),
					rules: this.prefs.rules,
					calcs: this.prefs.calcs,
					added: this.prefs.added,
					sorts: this.state.sorts,
					conds: this.state.conds,
					col_filters,
					group_by: this.state.group_by,
					level: this.level,
				})
			);
		}

		apply_view(s, variant) {
			s = clean_state(s);
			["hidden", "order", "rules", "calcs", "added"].forEach((k) => (this.prefs[k] = JSON.parse(JSON.stringify(s[k] || []))));
			["widths", "labels"].forEach((k) => (this.prefs[k] = JSON.parse(JSON.stringify(s[k] || {}))));
			this.prefs.fmt = JSON.parse(JSON.stringify(s.fmt || { report: {}, cols: {} }));
			this.set_units(s.units || 1);
			this.set_density(s.density || 0);
			this.prefs.freeze = s.freeze === undefined ? 1 : s.freeze;
			this.state.sorts = JSON.parse(JSON.stringify(s.sorts || (s.sort && s.sort.key ? [s.sort] : [])));
			this.state.conds = JSON.parse(JSON.stringify(s.conds || []));
			this.state.col_filters = {};
			Object.entries(s.col_filters || {}).forEach(([f, fl]) => (this.state.col_filters[f] = fl.t === "num" ? { ...fl } : { t: fl.t, vals: new Set(fl.vals) }));
			this.state.group_by = this.is_tree ? "" : s.group_by || "";
			this.state.group_open = new Set();
			this.variant = variant || null;
			this.columns = this.report_columns.slice();
			this.add_linked_defs();
			this.recompile_calcs();
			this.save();
			if (this.is_tree) this.set_level(s.level || 99, true);
			this.render_controls();
			this.refresh();
			this.fetch_linked();
			this.variant_saved = JSON.stringify(this.capture_view());
			this.render_variant_btn();
			if (this.$wrap.find(".nxv-cust").hasClass("open")) this.render_cust();
		}

		is_dirty() {
			return this.variant_saved !== null && JSON.stringify(this.capture_view()) !== this.variant_saved;
		}

		render_variant_btn() {
			const name = this.variant ? this.variant.layout_name : __("Standard");
			this.$wrap.find(".nxv-variant-btn").html(`${esc(name)}${this.is_dirty() ? " *" : ""} <span class="nxv-caret">▾</span>`);
		}

		load_variants(apply_default) {
			return frappe.db
				.get_list("Nexlify Report Layout", {
					filters: { report: this.report_name },
					fields: ["name", "layout_name", "is_public", "owner", "state", "modified"],
					limit: 500,
					order_by: "layout_name asc",
				})
				.then((list) => {
					this.variants = list || [];
					this.variants_ready = true;
					if (this.variant) this.variant = this.variants.find((v) => v.name === this.variant.name) || null;
					const def = this.prefs.default_variant && this.variants.find((v) => v.name === this.prefs.default_variant);
					if (apply_default && def) this.apply_view(this.parse_state(def), def);
					else {
						if (this.variant_saved === null) this.variant_saved = JSON.stringify(this.capture_view());
						this.render_variant_btn();
					}
				})
				.catch(() => {
					this.variants_ready = true;
					if (this.variant_saved === null) this.variant_saved = JSON.stringify(this.capture_view());
					this.render_variant_btn();
				});
		}

		parse_state(v) {
			try {
				return typeof v.state === "string" ? JSON.parse(v.state) : v.state || {};
			} catch (e) {
				return {};
			}
		}

		fill_variant_menu() {
			const me = frappe.session.user;
			const q = (this.variant_query || "").toLowerCase();
			const item = (v) => {
				const on = this.variant ? this.variant.name === v.name : false;
				const tags = [
					this.prefs.default_variant === v.name ? `<span class="nxv-vtag">${__("Default")}</span>` : "",
					v.is_public ? `<span class="nxv-vtag">${__("Public")}</span>` : "",
					v.owner !== me ? `<span class="nxv-tag">${esc(frappe.user.full_name(v.owner))}</span>` : "",
				].join("");
				return `<div class="nxv-item${on ? " on" : ""}" data-var="${esc(v.name)}"><span class="nxv-vname">${esc(v.layout_name)}</span>${tags}</div>`;
			};
			const list = this.variants.filter((v) => !q || v.layout_name.toLowerCase().includes(q));
			const mine = list.filter((v) => v.owner === me);
			const others = list.filter((v) => v.owner !== me);
			const std_default = !this.prefs.default_variant ? `<span class="nxv-vtag">${__("Default")}</span>` : "";
			this.$wrap.find(".nxv-variant-menu").html(
				`<input class="form-control input-xs nxv-var-search" placeholder="${__("Find a layout")}" value="${esc(this.variant_query || "")}">
				<div class="nxv-item${this.variant ? "" : " on"}" data-var=""><span class="nxv-vname">${__("Standard")}</span>${std_default}</div>
				${mine.length ? `<small class="nxv-small">${__("My layouts")}</small>` + mine.map(item).join("") : ""}
				${others.length ? `<small class="nxv-small">${__("Public layouts")}</small>` + others.map(item).join("") : ""}
				<hr><div class="nxv-var-acts">
					<button class="btn btn-default btn-xs" data-va="save" ${this.variant && this.variant.owner === me ? "" : "disabled"}>${__("Save")}</button>
					<button class="btn btn-default btn-xs" data-va="saveas">${__("Save As")}</button>
					<button class="btn btn-default btn-xs" data-va="manage">${__("Manage")}</button>
				</div>`
			);
		}

		save_variant() {
			const v = this.variant;
			if (!v) return;
			const state = this.capture_view();
			frappe.db.set_value("Nexlify Report Layout", v.name, "state", JSON.stringify(state)).then(() => {
				this.variant_saved = JSON.stringify(state);
				frappe.show_alert({ message: __("Saved the layout {0}", [v.layout_name]), indicator: "green" });
				this.load_variants(false);
			});
		}

		save_variant_as() {
			const d = new frappe.ui.Dialog({
				title: __("Save Layout"),
				fields: [
					{ fieldtype: "Data", fieldname: "layout_name", label: __("Layout Name"), reqd: 1 },
					{ fieldtype: "Check", fieldname: "is_default", label: __("Set as Default"), description: __("Opens this report with this layout, for you") },
					{ fieldtype: "Check", fieldname: "is_public", label: __("Public"), description: __("Everyone who can open this report can use it") },
				],
				primary_action_label: __("Save"),
				primary_action: (values) => {
					const state = this.capture_view();
					frappe.db
						.insert({ doctype: "Nexlify Report Layout", report: this.report_name, layout_name: values.layout_name, is_public: values.is_public ? 1 : 0, state: JSON.stringify(state) })
						.then((doc) => {
							d.hide();
							this.variant = doc;
							this.variant_saved = JSON.stringify(state);
							if (values.is_default) {
								this.prefs.default_variant = doc.name;
								this.save();
							}
							this.load_variants(false);
							frappe.show_alert({ message: __("Saved the layout {0}", [doc.layout_name]), indicator: "green" });
						});
				},
			});
			d.show();
		}

		manage_variants() {
			const me = frappe.session.user;
			const rows = this.variants
				.map(
					(v) => `<tr data-name="${esc(v.name)}">
					<td><input type="radio" name="nxv-def" value="${esc(v.name)}" ${this.prefs.default_variant === v.name ? "checked" : ""} aria-label="${__("Default")}"></td>
					<td>${v.owner === me ? `<input class="form-control input-xs" data-mv="layout_name" value="${esc(v.layout_name)}">` : esc(v.layout_name)}</td>
					<td class="text-center"><input type="checkbox" data-mv="is_public" ${v.is_public ? "checked" : ""} ${v.owner === me ? "" : "disabled"}></td>
					<td>${esc(frappe.user.full_name(v.owner))}</td>
					<td>${v.owner === me ? `<button class="btn btn-default btn-xs" data-mv-del="1">${__("Delete")}</button>` : ""}</td></tr>`
				)
				.join("");
			const d = new frappe.ui.Dialog({
				title: __("Manage Layouts"),
				size: "large",
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "table",
						options: `<table class="table table-bordered nxv-manage"><thead><tr><th>${__("Default")}</th><th>${__("Layout")}</th><th>${__("Public")}</th><th>${__("Created By")}</th><th></th></tr></thead>
						<tbody><tr><td><input type="radio" name="nxv-def" value="" ${this.prefs.default_variant ? "" : "checked"}></td><td>${__("Standard")}</td><td></td><td>${__("The report")}</td><td></td></tr>${rows}</tbody></table>`,
					},
				],
				primary_action_label: __("Save"),
				primary_action: () => {
					const $t = d.$wrapper.find(".nxv-manage");
					const jobs = [];
					$t.find("tbody tr[data-name]").each((i, tr) => {
						const name = tr.dataset.name;
						const v = this.variants.find((x) => x.name === name);
						if (!v || v.owner !== me) return;
						if (tr.dataset.deleted) return jobs.push(frappe.db.delete_doc("Nexlify Report Layout", name));
						const ln = $(tr).find('[data-mv="layout_name"]').val();
						const pub = $(tr).find('[data-mv="is_public"]').prop("checked") ? 1 : 0;
						if (ln !== v.layout_name || pub !== (v.is_public ? 1 : 0)) jobs.push(frappe.db.set_value("Nexlify Report Layout", name, { layout_name: ln, is_public: pub }));
					});
					const def = $t.find('input[name="nxv-def"]:checked').val() || "";
					if (def !== (this.prefs.default_variant || "")) {
						this.prefs.default_variant = def;
						this.save();
					}
					Promise.all(jobs).then(() => {
						d.hide();
						if (this.variant && $t.find(`tr[data-name="${this.variant.name}"]`).attr("data-deleted")) this.variant = null;
						this.load_variants(false);
					});
				},
			});
			d.$wrapper.on("click", "[data-mv-del]", (e) => {
				const tr = e.currentTarget.closest("tr");
				tr.dataset.deleted = "1";
				$(tr).addClass("nxv-deleted");
			});
			d.show();
		}

		// ---------------------------------------------------------------- columns from linked documents (Frappe's own Add Column data)
		linked_doctypes() {
			const out = [];
			const seen = new Set();
			this.report_columns.forEach((c) => {
				if (c.fieldtype === "Link" && c.options && !["Currency", "DocType"].includes(c.options)) {
					const k = c.options + "|" + c.fieldname;
					if (!seen.has(k)) out.push({ doctype: c.options, link_field: c.fieldname, label: c.label });
					seen.add(k);
				} else if (c.fieldtype === "Dynamic Link" && c.options) {
					new Set((this.rows || []).map((r) => r[c.options]).filter(Boolean)).forEach((dt) => {
						const k = dt + "|" + c.fieldname;
						if (!seen.has(k)) out.push({ doctype: dt, link_field: c.fieldname, label: c.label, dynamic: c.options });
						seen.add(k);
					});
				}
			});
			return out;
		}

		add_linked_defs() {
			(this.prefs.added || []).forEach((a) => {
				if (this.columns.find((c) => c.fieldname === a.f)) return;
				if (!this.report_columns.find((c) => c.fieldname === a.link_field)) return;
				this.columns.push({ fieldname: a.f, fkey: a.f, label: a.label, fieldtype: a.fieldtype || "Data", options: a.options, width: a.width || 140, linked: a });
			});
		}

		linked_val(r, c) {
			const a = c.linked;
			if (a.dynamic && r[a.dynamic] !== a.doctype) return null;
			const map = this.added_vals[a.f];
			const key = r[a.link_field];
			return map && key !== undefined && key !== null ? map[key] ?? null : null;
		}

		fetch_linked() {
			const jobs = (this.prefs.added || []).map((a) => {
				const names = [...new Set((this.rows || []).filter((r) => !a.dynamic || r[a.dynamic] === a.doctype).map((r) => r[a.link_field]).filter(Boolean))];
				this.added_vals[a.f] = this.added_vals[a.f] || {};
				if (!names.length) return Promise.resolve();
				return frappe
					.call({ method: "frappe.desk.query_report.get_data_for_custom_field", args: { doctype: a.doctype, field: a.field, names } })
					.then((r) => (this.added_vals[a.f] = r.message || {}))
					.catch(() => {});
			});
			if (jobs.length) Promise.all(jobs).then(() => this.refresh(true));
		}

		// every field of every document the report links to, ready to add as a column
		avail_fields() {
			if (this.avail_promise) return this.avail_promise;
			const links = this.linked_doctypes();
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
			const keep = ["Currency", "Float", "Int", "Percent", "Date", "Datetime", "Link", "Check", "Select", "Data", "Small Text", "Text", "Phone", "Read Only", "Dynamic Link"];
			this.avail_promise = Promise.all(links.map((l) => load(l.doctype))).then(() => {
				const out = [];
				links.forEach((l) => {
					if (!frappe.get_meta(l.doctype)) return;
					const from = __(l.doctype) + (l.label && l.label !== l.doctype ? ` (${__(l.label)})` : "");
					frappe.meta
						.get_docfields(l.doctype)
						.filter((df) => keep.includes(df.fieldtype) && !df.hidden && df.label)
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
								fieldtype: type,
								options: type === "Link" ? df.options : undefined,
							});
						});
				});
				return out;
			});
			return this.avail_promise;
		}

		toggle_added(added, order, f, on) {
			const a = (this.avail_resolved || []).find((x) => x.f === f);
			if (on && !a) return;
			if (on && a && !added.find((x) => x.f === f)) {
				added.push({ f, doctype: a.doctype, field: a.field, link_field: a.link_field, dynamic: a.dynamic, label: a.label, fieldtype: a.fieldtype, options: a.options });
				if (!order.includes(f)) order.push(f);
			}
			if (!on) {
				const i = added.findIndex((x) => x.f === f);
				if (i > -1) added.splice(i, 1);
				const j = order.indexOf(f);
				if (j > -1) order.splice(j, 1);
			}
		}

		// ---------------------------------------------------------------- Settings: columns, sort, filter, group
		open_settings(tab) {
			const draft = {
				hidden: new Set(this.prefs.hidden || []),
				labels: Object.assign({}, this.prefs.labels),
				widths: Object.assign({}, this.prefs.widths),
				order: this.columns.slice(1).map((c) => c.fieldname),
				added: JSON.parse(JSON.stringify(this.prefs.added || [])),
				sorts: JSON.parse(JSON.stringify(this.state.sorts)),
				conds: JSON.parse(JSON.stringify(this.state.conds)),
				group_by: this.state.group_by,
			};
			const ordered = this.build_cols().map((c) => c.fieldname);
			draft.order.sort((a, b) => {
				const ia = ordered.indexOf(a);
				const ib = ordered.indexOf(b);
				return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
			});
			(this.prefs.calcs || []).forEach((k) => {
				if (!draft.order.includes(k.f)) draft.order.push(k.f);
			});
			this.draft = draft;
			this.settings_tab = tab || "columns";
			this.dsel = { a: new Set(), s: new Set() };
			this.dlast = { a: null, s: null };
			this.dq = { a: "", s: "" };
			this.dopen = new Set([__("This report"), __("Calculated columns")]);
			const d = new frappe.ui.Dialog({
				title: __("View Settings"),
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "body" }],
				primary_action_label: __("OK"),
				primary_action: () => {
					this.apply_settings();
					d.hide();
				},
				secondary_action_label: __("Reset"),
				secondary_action: () => {
					this.draft = {
						hidden: new Set(),
						labels: {},
						widths: {},
						order: this.report_columns.slice(1).map((c) => c.fieldname),
						added: [],
						sorts: [],
						conds: [],
						group_by: "",
					};
					this.render_settings();
				},
			});
			this.settings_dialog = d;
			d.$wrapper.addClass("nxv-settings-dialog");
			// a closed settings dialog leaves the page: a new one is made each time
			d.onhide = () => setTimeout(() => d.$wrapper.remove(), 400);
			this.render_settings();
			const $b = d.fields_dict.body.$wrapper;
			$b.on("click", "[data-st]", (e) => {
				this.settings_tab = e.currentTarget.dataset.st;
				this.render_settings();
			});
			$b.on("click", "[data-sact]", (e) => this.settings_action(e.currentTarget));
			$b.on("change", "input, select", (e) => this.settings_change(e.target));
			$b.on("click", ".nxv-dual-item", (e) => {
				if (e.target.closest("input")) return;
				this.dual_pick(e.currentTarget, e.ctrlKey || e.metaKey, e.shiftKey);
			});
			// drag and drop: across the two lists, and up and down on the right
			const clear_drop = () => $b.find(".drop-before, .drop-after, .drop-list, .dragging").removeClass("drop-before drop-after drop-list dragging");
			$b.on("dragstart", ".nxv-dual-item[draggable]", (e) => {
				if (e.target.closest && e.target.closest("input")) return e.preventDefault();
				const it = e.currentTarget;
				const side = it.dataset.side;
				const set = this.dsel[side];
				const fs = set.has(it.dataset.f) ? [...set] : [it.dataset.f];
				this.drag = { side, fs };
				const dt = e.originalEvent.dataTransfer;
				dt.effectAllowed = "move";
				try {
					dt.setData("text/plain", fs.join(","));
				} catch (err) {
					// some browsers refuse custom drag data
				}
				$b.find(".nxv-dual-item").filter((i, x) => x.dataset.side === side && fs.includes(x.dataset.f)).addClass("dragging");
			});
			$b.on("dragend", ".nxv-dual-item", () => {
				this.drag = null;
				clear_drop();
			});
			$b.on("dragover", ".nxv-dual-list", (e) => {
				if (!this.drag) return;
				e.preventDefault();
				$b.find(".drop-before, .drop-after, .drop-list").removeClass("drop-before drop-after drop-list");
				const list = e.currentTarget;
				const it = e.target.closest && e.target.closest(".nxv-dual-item");
				if (list.dataset.side === "s" && it && it.dataset.side === "s") {
					const r = it.getBoundingClientRect();
					const before = e.originalEvent.clientY < r.top + r.height / 2 && !it.classList.contains("fixed");
					it.classList.add(before ? "drop-before" : "drop-after");
				} else list.classList.add("drop-list");
			});
			$b.on("drop", ".nxv-dual-list", (e) => {
				e.preventDefault();
				const drag = this.drag;
				if (!drag) return;
				const side = e.currentTarget.dataset.side;
				const mark = $b.find(".drop-before, .drop-after")[0];
				const target = mark ? mark.dataset.f : null;
				const after = mark ? mark.classList.contains("drop-after") : false;
				this.drag = null;
				clear_drop();
				if (side === "a") {
					if (drag.side === "s") this.dual_move("to-avail", drag.fs);
					return;
				}
				if (drag.side === "a") this.dual_move("to-sel", drag.fs, true);
				this.dual_place(drag.fs, target, after);
			});
			$b.on("dblclick", ".nxv-dual-item", (e) => {
				if (e.target.closest("input")) return;
				const it = e.currentTarget;
				this.dual_move(it.dataset.side === "a" ? "to-sel" : "to-avail", [it.dataset.f]);
			});
			$b.on("click", ".nxv-dual-group", (e) => {
				const g = e.currentTarget.dataset.g;
				this.dopen.has(g) ? this.dopen.delete(g) : this.dopen.add(g);
				this.dual_filter("a");
			});
			$b.on("input", ".nxv-dual-search", (e) => {
				this.dq[e.target.dataset.side] = e.target.value.trim().toLowerCase();
				this.dual_filter(e.target.dataset.side);
			});
			d.show();
		}

		settings_col(f) {
			const c = this.report_columns.find((x) => x.fieldname === f);
			if (c) return { f, label: c.label, type: __(c.fieldtype) };
			const a = this.draft.added.find((x) => x.f === f);
			if (a) return { f, label: a.label, type: __(a.doctype), added: true };
			const k = (this.prefs.calcs || []).find((x) => x.f === f);
			if (k) return { f, label: k.label, type: __("calculated") };
			return null;
		}

		render_settings() {
			const d = this.settings_dialog;
			const t = this.settings_tab;
			const tabs = [
				["columns", __("Columns")],
				["sort", __("Sort")],
				["filter", __("Filter")],
				["group", __("Group")],
			]
				.map(([k, l]) => `<button class="nxv-st-tab" data-st="${k}" aria-selected="${t === k}">${l}</button>`)
				.join("");
			const all_cols = [this.report_columns[0].fieldname].concat(this.draft.order).map((f) => this.settings_col(f)).filter(Boolean);
			const col_opts = (val, with_any) =>
				(with_any ? `<option value="">${__("None")}</option>` : "") + all_cols.map((c) => `<option value="${esc(c.f)}" ${c.f === val ? "selected" : ""}>${esc(this.draft.labels[c.f] || c.label)}</option>`).join("");
			let body = "";
			if (t === "columns") {
				body = this.dual_html();
			} else if (t === "sort") {
				const rows = this.draft.sorts
					.map(
						(s, i) => `<div class="nxv-st-row"><span class="nxv-lbl">${i === 0 ? __("Sort by") : __("Then by")}</span>
						<select class="form-control input-xs" data-ssort="${i}">${col_opts(s.key)}</select>
						<select class="form-control input-xs" data-sdir="${i}"><option value="1" ${s.dir > 0 ? "selected" : ""}>${__("Ascending")}</option><option value="-1" ${s.dir < 0 ? "selected" : ""}>${__("Descending")}</option></select>
						<button class="nxv-del" data-sact="del-sort" data-i="${i}">×</button></div>`
					)
					.join("");
				body = `${this.is_tree ? `<p class="nxv-muted">${__("This report is a tree, so it keeps the report's own order.")}</p>` : ""}${rows || `<p class="nxv-muted">${__("No sorting: rows keep the report's order.")}</p>`}
					<div><button class="btn btn-default btn-xs" data-sact="add-sort">+ ${__("Add sort")}</button></div>`;
			} else if (t === "filter") {
				const rows = this.draft.conds
					.map(
						(u, i) => `<div class="nxv-st-row">
						<select class="form-control input-xs" data-sinc="${i}"><option value="0" ${u.exclude ? "" : "selected"}>${__("Include")}</option><option value="1" ${u.exclude ? "selected" : ""}>${__("Exclude")}</option></select>
						<select class="form-control input-xs" data-scf="${i}">${col_opts(u.f)}</select>
						<select class="form-control input-xs" data-sop="${i}">${this.opt(OPS, u.op)}</select>
						<input class="form-control input-xs" data-sx="${i}" value="${esc(u.x || "")}" ${NO_VALUE.has(u.op) ? "disabled" : ""} placeholder="${__("Value")}">
						<input class="form-control input-xs" data-sx2="${i}" value="${esc(u.x2 || "")}" ${u.op === "between" ? "" : "disabled"} placeholder="${__("and")}">
						<button class="nxv-del" data-sact="del-cond" data-i="${i}">×</button></div>`
					)
					.join("");
				body = `<p class="nxv-muted">${__("Filters the rows the report returned. On one column, a row stays when any Include holds, and goes when any Exclude holds.")}</p>
					${rows || `<p class="nxv-muted">${__("No conditions yet.")}</p>`}
					<div><button class="btn btn-default btn-xs" data-sact="add-cond">+ ${__("Add condition")}</button></div>`;
			} else {
				body = this.is_tree
					? `<p class="nxv-muted">${__("This report is a tree: it is grouped by the report itself.")}</p>`
					: `<div class="nxv-st-row"><span class="nxv-lbl">${__("Group by")}</span><select class="form-control input-xs" data-sgroup="1">${col_opts(this.draft.group_by, true)}</select></div>
					<p class="nxv-muted">${__("The subtotals are worked out in this view and show in purple.")}</p>`;
			}
			d.fields_dict.body.$wrapper.html(`<div class="nxv-settings"><nav class="nxv-st-tabs">${tabs}</nav><div class="nxv-st-body">${body}</div></div>`);
			const $b = d.fields_dict.body.$wrapper;
			if (t === "columns") {
				$b.find('.nxv-dual-search[data-side="a"]').val(this.dq.a);
				$b.find('.nxv-dual-search[data-side="s"]').val(this.dq.s);
				this.dual_filter("a");
				this.dual_filter("s");
				this.dual_marks();
				if (!this.avail_resolved) {
					this.avail_fields().then((list) => {
						this.avail_resolved = list;
						if (this.settings_tab === "columns" && this.settings_dialog) this.render_settings();
					});
				}
			}
		}

		// ---------------------------------------------------------------- Settings > Columns: available on one side, selected on the other
		dual_lists() {
			const dr = this.draft;
			const first_f = this.report_columns[0].fieldname;
			const selected = [first_f].concat(dr.order.filter((f) => f !== first_f && !dr.hidden.has(f) && this.settings_col(f)));
			const chosen = new Set(selected);
			const groups = [];
			const own = this.report_columns.filter((c) => !chosen.has(c.fieldname)).map((c) => ({ f: c.fieldname, label: c.label, type: __(c.fieldtype) }));
			if (own.length) groups.push([__("This report"), own]);
			const calcs = (this.prefs.calcs || []).filter((k) => !chosen.has(k.f)).map((k) => ({ f: k.f, label: k.label, type: __("calculated") }));
			if (calcs.length) groups.push([__("Calculated columns"), calcs]);
			const by = {};
			(this.avail_resolved || []).forEach((a) => {
				if (chosen.has(a.f)) return;
				(by[a.from] = by[a.from] || []).push({ f: a.f, label: a.short, type: __(a.fieldtype) });
			});
			Object.entries(by).forEach((g) => groups.push(g));
			return { selected, groups, first_f };
		}

		dual_html() {
			const { selected, groups, first_f } = this.dual_lists();
			const txt = (c) => esc((c.label + " " + c.type + " " + c.f).toLowerCase());
			const avail = groups
				.map(
					([g, list]) =>
						`<div class="nxv-dual-group" data-g="${esc(g)}"><span class="nxv-dual-caret"></span>${esc(g)}<span class="nxv-dual-count">${list.length}</span></div>` +
						list
							.map((c) => `<div class="nxv-dual-item${this.dsel.a.has(c.f) ? " on" : ""}" draggable="true" data-side="a" data-f="${esc(c.f)}" data-g="${esc(g)}" data-txt="${txt(c)}"><span class="nxv-dual-check"></span><span class="nxv-dual-name">${esc(c.label)}</span><span class="nxv-lbl">${esc(c.type)}</span></div>`)
							.join("")
				)
				.join("");
			const chosen = selected
				.map((f) => {
					const c = this.settings_col(f);
					const fixed = f === first_f;
					return `<div class="nxv-dual-item${fixed ? " fixed" : ""}${this.dsel.s.has(f) ? " on" : ""}"${fixed ? "" : ' draggable="true"'} data-side="s" data-f="${esc(f)}" data-txt="${txt(c)}">
						<span class="nxv-dual-grip" title="${__("Drag to move")}">${fixed ? "🔒" : "⋮⋮"}</span>
						${fixed ? '<span class="nxv-dual-check nxv-dual-check-off"></span>' : '<span class="nxv-dual-check"></span>'}
						<input class="form-control input-xs" data-slabel="${esc(f)}" value="${esc(this.draft.labels[f] || c.label)}" aria-label="${__("Name")}">
						<input class="form-control input-xs nxv-dual-w" type="number" min="60" step="10" data-swidth="${esc(f)}" value="${this.draft.widths[f] || this.col_width(f)}" title="${__("Width")}" aria-label="${__("Width")}">
						<span class="nxv-lbl">${esc(c.type)}</span></div>`;
				})
				.join("");
			const loading = this.avail_resolved ? "" : `<p class="nxv-small">${__("Loading the fields of linked documents")}…</p>`;
			return `<div class="nxv-dual">
				<div class="nxv-dual-pane">
					<div class="nxv-dual-hd"><b>${__("Available Columns")}</b><span class="nxv-dual-count">${groups.reduce((n, g) => n + g[1].length, 0)}</span></div>
					<input class="form-control input-xs nxv-dual-search" data-side="a" placeholder="${__("Search, e.g. territory")}">
					<div class="nxv-dual-list" data-side="a">${avail}${loading}</div>
				</div>
				<div class="nxv-dual-mid">
					<button class="btn btn-default btn-sm" data-sact="to-sel" title="${__("Add the ticked columns")}"><span class="nxv-arrow">›</span><span class="nxv-dual-n" data-n="a"></span></button>
					<button class="btn btn-default btn-sm" data-sact="to-avail" title="${__("Remove the ticked columns")}"><span class="nxv-arrow">‹</span><span class="nxv-dual-n" data-n="s"></span></button>
				</div>
				<div class="nxv-dual-pane">
					<div class="nxv-dual-hd"><b>${__("Selected Columns")}</b><span class="nxv-dual-count">${selected.length}</span><span class="nxv-spacer"></span>
						<button class="btn btn-default btn-xs" data-sact="top" title="${__("To the top")}">⤒</button>
						<button class="btn btn-default btn-xs" data-sact="up" title="${__("Up")}">↑</button>
						<button class="btn btn-default btn-xs" data-sact="down" title="${__("Down")}">↓</button>
						<button class="btn btn-default btn-xs" data-sact="bottom" title="${__("To the bottom")}">⤓</button>
					</div>
					<input class="form-control input-xs nxv-dual-search" data-side="s" placeholder="${__("Search the selected columns")}">
					<div class="nxv-dual-list" data-side="s">${chosen}</div>
				</div>
			</div>
			<div class="nxv-dual-foot">
				<p class="nxv-muted">${__("Click columns to tick them (Shift ticks a range), then press an arrow to send them all. Or drag them: across, or up and down on the right. Double-click sends one column. On the right, type a new name or width.")}</p>
				<button class="btn btn-default btn-xs" data-sact="new-calc">+ ${__("Calculated column")}</button>
			</div>`;
		}

		col_width(f) {
			const c = this.columns.find((x) => x.fieldname === f);
			return c ? c.width : 140;
		}

		dual_filter(side) {
			const $b = this.settings_dialog.fields_dict.body.$wrapper;
			const q = this.dq[side];
			const $list = $b.find(`.nxv-dual-list[data-side="${side}"]`);
			$list.find(".nxv-dual-item").each((i, it) => {
				const hit = !q || it.dataset.txt.includes(q);
				it.hidden = !hit || (side === "a" && !q && !this.dopen.has(it.dataset.g));
			});
			if (side !== "a") return;
			$list.find(".nxv-dual-group").each((i, g) => {
				const items = $list.find(`.nxv-dual-item[data-g="${CSS.escape(g.dataset.g)}"]`).toArray();
				const any = items.some((it) => !q || it.dataset.txt.includes(q));
				g.hidden = !any;
				g.classList.toggle("open", !!q || this.dopen.has(g.dataset.g));
			});
		}

		dual_pick(el, multi, range) {
			const side = el.dataset.side;
			const other = side === "a" ? "s" : "a";
			const f = el.dataset.f;
			if (el.classList.contains("fixed")) return;
			const set = this.dsel[side];
			if (range && this.dlast[side]) {
				const $list = $(el).closest(".nxv-dual-list");
				const all = $list.find(".nxv-dual-item:not([hidden]):not(.fixed)").toArray().map((x) => x.dataset.f);
				const a = all.indexOf(this.dlast[side]);
				const b = all.indexOf(f);
				all.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => set.add(x));
			} else {
				set.has(f) ? set.delete(f) : set.add(f);
				this.dlast[side] = f;
			}
			this.dsel[other].clear();
			this.dual_marks();
		}

		dual_marks() {
			const $b = this.settings_dialog.fields_dict.body.$wrapper;
			// a block body: jQuery's each stops at the first callback that returns false
			$b.find(".nxv-dual-item").each((i, it) => {
				it.classList.toggle("on", this.dsel[it.dataset.side].has(it.dataset.f));
			});
			["a", "s"].forEach((side) => $b.find(`.nxv-dual-n[data-n="${side}"]`).text(this.dsel[side].size ? this.dsel[side].size : ""));
		}

		// drop the columns in `fs` on the right, before or after `target`
		dual_place(fs, target, after) {
			const dr = this.draft;
			const { selected, first_f } = this.dual_lists();
			const moving = fs.filter((f) => f !== first_f);
			let vis = selected.filter((f) => f !== first_f && !moving.includes(f));
			let at = vis.length;
			if (target === first_f) at = 0;
			else if (target && vis.includes(target)) at = vis.indexOf(target) + (after ? 1 : 0);
			vis.splice(at, 0, ...moving);
			dr.order = vis.concat(dr.order.filter((f) => !vis.includes(f)));
			this.dsel = { a: new Set(), s: new Set(moving) };
			this.render_settings();
		}

		dual_move(dir, list, quiet) {
			const dr = this.draft;
			const first_f = this.report_columns[0].fieldname;
			const own = new Set(this.report_columns.map((c) => c.fieldname));
			const calcs = new Set((this.prefs.calcs || []).map((k) => k.f));
			if (dir === "to-sel") {
				const fs = list || [...this.dsel.a];
				if (!fs.length) return frappe.show_alert({ message: __("Pick a column on the left first"), indicator: "orange" });
				fs.forEach((f) => {
					if (own.has(f) || calcs.has(f)) {
						dr.hidden.delete(f);
						dr.order = dr.order.filter((x) => x !== f).concat(f);
					} else this.toggle_added(dr.added, dr.order, f, true);
				});
				this.dsel = { a: new Set(), s: new Set(fs) };
			} else {
				const fs = (list || [...this.dsel.s]).filter((f) => f !== first_f);
				if (!fs.length) return frappe.show_alert({ message: __("Pick a column on the right first"), indicator: "orange" });
				fs.forEach((f) => {
					if (dr.added.find((a) => a.f === f)) this.toggle_added(dr.added, dr.order, f, false);
					else dr.hidden.add(f);
				});
				this.dsel = { a: new Set(fs), s: new Set() };
			}
			if (!quiet) this.render_settings();
		}

		dual_order(act) {
			const dr = this.draft;
			const { selected, first_f } = this.dual_lists();
			let vis = selected.filter((f) => f !== first_f);
			const picked = vis.filter((f) => this.dsel.s.has(f));
			if (!picked.length) return frappe.show_alert({ message: __("Pick a column on the right first"), indicator: "orange" });
			if (act === "top") vis = picked.concat(vis.filter((f) => !this.dsel.s.has(f)));
			else if (act === "bottom") vis = vis.filter((f) => !this.dsel.s.has(f)).concat(picked);
			else if (act === "up") {
				for (let i = 1; i < vis.length; i++) if (this.dsel.s.has(vis[i]) && !this.dsel.s.has(vis[i - 1])) [vis[i - 1], vis[i]] = [vis[i], vis[i - 1]];
			} else {
				for (let i = vis.length - 2; i >= 0; i--) if (this.dsel.s.has(vis[i]) && !this.dsel.s.has(vis[i + 1])) [vis[i + 1], vis[i]] = [vis[i], vis[i + 1]];
			}
			dr.order = vis.concat(dr.order.filter((f) => !vis.includes(f)));
			this.render_settings();
			const $l = this.settings_dialog.fields_dict.body.$wrapper.find('.nxv-dual-list[data-side="s"]');
			const it = $l.find(".nxv-dual-item.on")[0];
			if (it) it.scrollIntoView({ block: "nearest" });
		}

		settings_change(el) {
			const dr = this.draft;
			if (el.dataset.swidth !== undefined) {
				dr.widths[el.dataset.swidth] = Math.max(60, +el.value || 60);
				return;
			}
			if (el.dataset.slabel !== undefined) {
				const f = el.dataset.slabel;
				const c = this.settings_col(f);
				const v = el.value.trim();
				if (!v || (c && v === c.label)) delete dr.labels[f];
				else dr.labels[f] = v;
				return;
			}
			if (el.dataset.ssort !== undefined) dr.sorts[+el.dataset.ssort].key = el.value;
			if (el.dataset.sdir !== undefined) dr.sorts[+el.dataset.sdir].dir = +el.value;
			if (el.dataset.sinc !== undefined) dr.conds[+el.dataset.sinc].exclude = el.value === "1";
			if (el.dataset.scf !== undefined) dr.conds[+el.dataset.scf].f = el.value;
			if (el.dataset.sop !== undefined) {
				dr.conds[+el.dataset.sop].op = el.value;
				return this.render_settings();
			}
			if (el.dataset.sx !== undefined) dr.conds[+el.dataset.sx].x = el.value;
			if (el.dataset.sx2 !== undefined) dr.conds[+el.dataset.sx2].x2 = el.value;
			if (el.dataset.sgroup !== undefined) dr.group_by = el.value;
		}

		settings_action(b) {
			const dr = this.draft;
			const act = b.dataset.sact;
			const $b = this.settings_dialog.fields_dict.body.$wrapper;
			const first_f = this.report_columns[0].fieldname;
			if (act === "to-sel" || act === "to-avail") return this.dual_move(act);
			if (act === "new-calc") {
				this.apply_settings();
				this.settings_dialog.hide();
				this.cust_tab = "calc";
				return this.open_cust();
			}
			if (["top", "up", "down", "bottom"].includes(act)) return this.dual_order(act);
			if (act === "del-added") {
				const f = b.dataset.f;
				dr.added = dr.added.filter((a) => a.f !== f);
				dr.order = dr.order.filter((x) => x !== f);
				return this.render_settings();
			}
			if (act === "add-sort") dr.sorts.push({ key: first_f, dir: 1 });
			if (act === "del-sort") dr.sorts.splice(+b.dataset.i, 1);
			if (act === "add-cond") dr.conds.push({ f: first_f, op: "contains", x: "", x2: "", exclude: false });
			if (act === "del-cond") dr.conds.splice(+b.dataset.i, 1);
			this.render_settings();
		}

		apply_settings() {
			const dr = this.draft;
			this.prefs.hidden = [...dr.hidden];
			this.prefs.labels = dr.labels;
			this.prefs.widths = dr.widths || this.prefs.widths;
			this.prefs.order = dr.order.slice();
			this.prefs.added = dr.added;
			this.state.sorts = this.is_tree ? [] : dr.sorts.filter((s) => s.key);
			this.state.conds = dr.conds
				.filter((u) => u.f && (NO_VALUE.has(u.op) || String(u.x || "") !== ""))
				.filter((u) => ![">", "<", "between"].includes(u.op) || (parse_num(u.x) !== null && (u.op !== "between" || parse_num(u.x2) !== null)));
			const dropped = dr.conds.length - this.state.conds.length;
			if (dropped) frappe.show_alert({ message: __("{0} conditions were left out: their value is empty or not a number", [dropped]), indicator: "orange" });
			this.state.group_by = this.is_tree ? "" : dr.group_by || "";
			this.state.group_open = new Set();
			this.columns = this.report_columns.slice();
			this.add_linked_defs();
			this.save();
			this.render_controls();
			this.refresh();
			this.fetch_linked();
		}

		// ---------------------------------------------------------------- export and print: the table as it is on screen
		cell_styles(r, c) {
			if (r.__nxgroup || r.__nxtotal) return [];
			const row_styles = this.row_rule_classes(r).trim().split(/\s+/).filter(Boolean);
			return (this.prefs.rules || [])
				.filter((u) => (u.scope === "row" ? row_styles.includes("nxv-hs-" + u.style) : this.rule_for(u, c) && this.rule_hit(u, r, c)))
				.map((u) => u.style);
		}

		row_kind(r) {
			if (r.__nxtotal) return "total";
			if (r.__nxgroup) return "group";
			if (r.bold || r.is_total_row || (this.is_tree && r.__nxkids)) return "bold";
			return "row";
		}

		export_rows() {
			const row = (r) => ({
				kind: this.row_kind(r),
				indent: this.is_tree && !r.__nxtotal ? r.indent || 0 : this.state.group_by && !r.__nxgroup && !r.__nxtotal ? 1 : 0,
				cells: this.cols.map((c, ci) => {
					if (r.__nxgroup && ci === 0) return `${r.__nxglabel}: ${r.__nxgkey} (${r.__nxcount})`;
					if (r.__nxtotal && ci === 0 && !r[c.fieldname]) return r.__nxcalcrow ? __("Total of the rows shown") : __("Total");
					const x = this.val(r, c);
					if (NUM.has(c.fieldtype)) return to_number(x);
					if (r.__nxgroup) return "";
					if (c.fieldtype === "Date") return x ? String(x).slice(0, 10) : "";
					return this.cell_text(r, c, false);
				}),
				styles: this.cols.map((c) => this.cell_styles(r, c)),
			});
			return this.view.map(row).concat(this.foot().map(row));
		}

		// an Excel number format that shows the number the way this view does; Excel keeps the real number
		excel_format(c) {
			const o = this.opts_for(c);
			const dec = o.decimals > 0 ? "." + "0".repeat(o.decimals) : "";
			const core = (o.pattern === "####.##" ? "0" : "#,##0") + dec;
			const scale = { 1000: ",", 1000000: ",,", 1000000000: ",,," }[o.scale_n] || "";
			const label = o.scale_n > 1 ? `"${SCALE_LABEL[o.scale_n]}"` : "";
			const q = (t) => (t ? `"${String(t).replace(/"/g, "")}"` : "");
			const body = q(o.prefix) + core + scale + label + q(o.suffix);
			const pos = (o.plus ? '"+"' : "") + body;
			const neg = (o.neg_red ? "[Red]" : "") + (o.neg === "paren" ? `(${body})` : o.neg === "trail" ? `${body}"-"` : `"-"${body}`);
			const zero = o.zero === "dash" ? '"–"' : o.zero === "blank" ? '""' : body;
			return `${pos};${neg};${zero}`;
		}

		// the filters that have a value, as [label, value] ("" for a ticked check)
		filter_items() {
			const f = this.filters();
			return (this.qr.filters || [])
				.filter((x) => x.df && f[x.df.fieldname] !== undefined && f[x.df.fieldname] !== "" && f[x.df.fieldname] !== null && !(Array.isArray(f[x.df.fieldname]) && !f[x.df.fieldname].length))
				.filter((x) => x.df.fieldtype !== "Check" || f[x.df.fieldname])
				.map((x) => {
					const val = f[x.df.fieldname];
					if (x.df.fieldtype === "Check") return [__(x.df.label), ""];
					const text = String(Array.isArray(val) ? val.join(", ") : x.df.fieldtype === "Date" ? frappe.datetime.str_to_user(val) : val).trim();
					return text ? [__(x.df.label), text] : null;
				})
				.filter(Boolean);
		}

		filters_text() {
			return this.filter_items()
				.map(([k, v]) => (v ? `${k}: ${v}` : k))
				.join(" · ");
		}

		export_file(format) {
			const ref = this.qr.report_doc && this.qr.report_doc.ref_doctype;
			if (ref && !frappe.model.can_export(ref)) return frappe.msgprint(__("You are not allowed to export this report"));
			const columns = this.cols.map((c) => ({
				label: c.title,
				width: c.width,
				number: NUM.has(c.fieldtype),
				date: c.fieldtype === "Date",
				calc: !!c.calc,
				num_format: NUM.has(c.fieldtype) ? this.excel_format(c) : null,
			}));
			const title = this.variant ? `${__(this.report_name)} - ${this.variant.layout_name}` : __(this.report_name);
			// only the styles that are set travel, keyed by the column's place
			const rows = this.export_rows().map((row) => {
				const out = { kind: row.kind, cells: row.cells };
				if (row.indent) out.indent = row.indent;
				const styles = {};
				row.styles.forEach((st, i) => {
					if (st.length) styles[i] = st;
				});
				if (Object.keys(styles).length) out.styles = styles;
				return out;
			});
			const body = new FormData();
			body.append("report", this.report_name);
			body.append("file_format", format);
			body.append("title", title);
			body.append("subtitle", this.filters_text());
			body.append("columns", JSON.stringify(columns));
			body.append("rows", JSON.stringify(rows));
			if (this.qr.make_access_log) this.qr.make_access_log("Export", format === "csv" ? "CSV" : "Excel");
			frappe.show_alert({ message: __("Preparing the file"), indicator: "blue" }, 3);
			fetch("/api/method/" + API + "export_view", { method: "POST", body, headers: { "X-Frappe-CSRF-Token": frappe.csrf_token } })
				.then((res) => {
					if (!res.ok) {
						return res.text().then((t) => {
							let msg = res.status === 413 ? __("This table is too large to export from the view. Filter it, or use the report's own Export.") : "";
							try {
								const j = JSON.parse(t);
								const m = j._server_messages && JSON.parse(JSON.parse(j._server_messages)[0]).message;
								msg = msg || m || j.exception || "";
							} catch (e) {
								// not JSON
							}
							throw new Error(msg || __("The export failed"));
						});
					}
					return res.blob().then((blob) => {
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a");
						a.href = url;
						a.download = `${title}.${format === "csv" ? "csv" : "xlsx"}`;
						document.body.appendChild(a);
						a.click();
						a.remove();
						setTimeout(() => URL.revokeObjectURL(url), 2000);
					});
				})
				.catch((e) => frappe.msgprint({ title: __("Export"), message: esc(e.message || e), indicator: "red" }));
		}

		print_html(title, subtitle) {
			const head = this.cols.map((c) => `<th class="${NUM.has(c.fieldtype) ? "r" : ""}">${esc(c.title)}</th>`).join("");
			const body = this.export_rows()
				.map((row, i) => {
					const r = i < this.view.length ? this.view[i] : this.foot()[i - this.view.length];
					const cells = this.cols
						.map((c, ci) => {
							const num = NUM.has(c.fieldtype);
							const x = row.cells[ci];
							let text = num ? (x === null || x === undefined ? "" : format_number(x, this.opts_for(c))) : x;
							if (!num && c.fieldtype === "Date" && x && !r.__nxgroup) text = this.cell_text(r, c, false);
							const fo = num ? this.opts_for(c) : null;
							const cls = [num ? "r" : "", num && x < 0 && fo.neg_red ? "neg" : "", c.calc || (r.__nxgroup && num) ? "calc" : ""].concat(row.styles[ci].map((st) => "hs-" + st)).join(" ");
							const pad = ci === 0 && row.indent ? ` style="padding-left:${6 + row.indent * 12}px"` : "";
							return `<td class="${cls}"${pad}>${esc(text)}</td>`;
						})
						.join("");
					return `<tr class="${{ total: "t", group: "g", bold: "b", row: "" }[row.kind]}">${cells}</tr>`;
				})
				.join("");
			return `<style>
				.nxv-print-title { margin: 0 0 4px; font-size: 16px; }
				.nxv-print-sub { margin: 0 0 10px; color: #6b7280; font-size: 10px; }
				table.nxv-print { width: 100%; border-collapse: collapse; font-size: 9px; }
				table.nxv-print th, table.nxv-print td { border-bottom: 1px solid #e3e6ec; padding: 3px 6px; white-space: nowrap; text-align: left; }
				table.nxv-print th { background: #f3f4f7; font-weight: 600; }
				table.nxv-print .r { text-align: right; }
				table.nxv-print tr.b td, table.nxv-print tr.g td { font-weight: 700; }
				table.nxv-print tr.g td { background: #f4f6fa; }
				table.nxv-print tr.t td { font-weight: 700; border-top: 1.5px solid #333; background: #eef1f6; }
				table.nxv-print .neg { color: #c2362f; }
				table.nxv-print .calc { font-style: italic; color: #6b4fbb; }
				table.nxv-print .hs-redbg { background: #ffe0de; } table.nxv-print .hs-amberbg { background: #fff0d0; }
				table.nxv-print .hs-greenbg { background: #ddf3e6; } table.nxv-print .hs-bluebg { background: #e1e9fc; }
				table.nxv-print .hs-red { color: #c2362f; } table.nxv-print .hs-green { color: #18794e; }
				table.nxv-print .hs-muted { color: #8a8f99; } table.nxv-print .hs-bold { font-weight: 700; }
			</style>
			<h2 class="nxv-print-title">${esc(title)}</h2>${subtitle ? `<p class="nxv-print-sub">${esc(subtitle)}</p>` : ""}
			<table class="nxv-print"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
		}

		open_print(html) {
			const w = window.open();
			if (!w) return frappe.msgprint(__("Please allow pop-ups for this site, then print again."));
			w.document.write(html);
			w.document.close();
			const go = () => {
				w.focus();
				w.print();
			};
			// wait for the print stylesheet before the browser's print dialog opens
			if (w.document.readyState === "complete") setTimeout(go, 400);
			else w.addEventListener("load", () => setTimeout(go, 200));
		}

		print_view(pdf) {
			const qr = this.qr;
			const ref = qr.report_doc && qr.report_doc.ref_doctype;
			if (ref && !frappe.model.can_print(ref)) return frappe.msgprint(__("You are not allowed to print this report"));
			frappe.ui.get_print_settings(
				false,
				async (ps) => {
					if (ps.print_format && qr.print_report && qr.pdf_report) {
						// a print format is laid out by Frappe from the report's own rows
						return pdf ? qr.pdf_report(ps) : qr.print_report(ps);
					}
					if (qr.render_report_letterhead) await qr.render_report_letterhead(ps);
					if (qr.make_access_log) qr.make_access_log(pdf ? "PDF" : "Print", "PDF");
					const title = this.variant ? `${__(this.report_name)} - ${this.variant.layout_name}` : __(this.report_name);
					const content = this.print_html(title, ps.include_filters === 0 ? "" : this.filters_text());
					const landscape = ps.orientation === "Landscape" || this.cols.length > 8;
					const html = frappe.render_template("print_template", {
						title: esc(title),
						content,
						base_url: frappe.urllib.get_base_url(),
						print_css: frappe.boot.print_css,
						print_settings: ps,
						landscape,
						columns: this.cols,
						lang: frappe.boot.lang,
						layout_direction: frappe.utils.is_rtl() ? "rtl" : "ltr",
						can_use_smaller_font: 1,
					});
					if (!pdf) return this.open_print(html);
					ps.report_name = `${title}.pdf`;
					frappe.render_pdf(html, ps);
				},
				qr.report_doc && qr.report_doc.letter_head,
				null,
				true,
				pdf ? __("PDF Settings") : null
			);
		}

		// ---------------------------------------------------------------- autofit: each column as wide as its content
		// each column takes the width of its widest cell, measured on a hidden copy of the real cells:
		// the same font, letter spacing, digits, indents, arrows and marks as the table draws them
		autofit(only_ci) {
			const probe = document.createElement("table");
			probe.className = "nxv-grid";
			probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;top:0;inset-inline-start:0;width:auto;table-layout:auto;";
			this.$wrap[0].appendChild(probe);
			const rows = this.view.map((r, v) => [r, v]).concat(this.foot().map((r) => [r, -1]));
			try {
				this.cols.forEach((c, ci) => {
					if (only_ci !== undefined && ci !== only_ci) return;
					// the longest texts are the widest cells: only those few are drawn and measured
					const longest = rows
						.map(([r, v]) => [r, v, this.cell_text(r, c, false).length + (ci === 0 ? (r.indent || 0) * 3 : 0)])
						.sort((x, y) => y[2] - x[2])
						.slice(0, 40);
					const body = longest.map(([r, v]) => `<tr class="${v === -1 ? "nxv-bold " : ""}${this.row_cls(r, v)}">${this.cell(r, c, v, ci)}</tr>`).join("");
					// the header keeps room for its sort arrow and filter button
					probe.innerHTML = `<thead><tr><th class="${c.calc ? "nxv-calc" : ""}">${esc(c.title)}<span class="nxv-sort">▲</span></th></tr></thead><tbody>${body}</tbody>`;
					probe.querySelectorAll("td, th").forEach((el) => {
						el.style.overflow = "visible";
						el.style.textOverflow = "clip";
						el.style.width = "auto";
						el.style.maxWidth = "none";
					});
					const w = Math.ceil(probe.getBoundingClientRect().width) + 4;
					const key = c.delta ? null : c.twin || c.fieldname;
					if (key) this.prefs.widths[key] = Math.min(Math.max(w, 60), 640);
				});
			} finally {
				probe.remove();
			}
			this.save();
			this.refresh(true);
			frappe.show_alert({ message: only_ci !== undefined ? __("Column fitted") : __("Columns fitted"), indicator: "green" }, 2);
		}

		// every column back to the width the report gives it
		reset_widths() {
			this.prefs.widths = {};
			this.save();
			this.refresh(true);
			frappe.show_alert({ message: __("Columns reset to default"), indicator: "green" }, 2);
		}

		// ---------------------------------------------------------------- compare: run the report again with other filters
		open_compare() {
			if (this.state.compare) {
				this.state.compare = null;
				this.bmap = new Map();
				this.$wrap.find(".nxv-cmp-btn").attr("aria-pressed", "false");
				return this.refresh(true);
			}
			if (this.qr.prepared_report) {
				return frappe.msgprint(__("This report runs in the background, so it cannot run a second time here to compare. Use its own filters instead."));
			}
			const keyed = this.rows.filter((r) => r.__nxmk.replace(/[|/]/g, ""));
			const unique = new Set(keyed.map((r) => r.__nxmk)).size === keyed.length;
			if (!unique) {
				return frappe.msgprint(__("The rows of this report have no key of their own, so two runs cannot be matched row by row. Group or filter the report, or compare a summary report."));
			}
			const current = this.filters();
			const shift = (df, v) => {
				if (v === undefined || v === null || v === "") return v;
				if (df.fieldtype === "Date") return frappe.datetime.add_months(v, -12);
				if (/fiscal_year/.test(df.fieldname) || df.options === "Fiscal Year") return String(v).replace(/\d{4}/g, (y) => String(+y - 1));
				return v;
			};
			const allowed = new Set(["Date", "Link", "Select", "Data", "Int", "Check", "Float", "Currency"]);
			const fields = [];
			(this.qr.filters || []).forEach((f) => {
				const df = f.df || {};
				if (!allowed.has(df.fieldtype) || df.hidden) return;
				fields.push({ fieldname: df.fieldname, fieldtype: df.fieldtype, label: df.label, options: df.options, default: shift(df, current[df.fieldname]) });
			});
			fields.unshift({ fieldtype: "Data", fieldname: "__label", label: __("Name for this run"), default: __("B") });
			fields.splice(1, 0, { fieldtype: "HTML", options: `<p class="text-muted small">${__("The report runs again with these filters. Dates are moved one year back to start with; change anything.")}</p>` });
			const d = new frappe.ui.Dialog({
				title: __("Compare with Another Run"),
				fields,
				size: "large",
				primary_action_label: __("Compare"),
				primary_action: (values) => {
					const filters = Object.assign({}, current);
					fields.forEach((f) => {
						if (f.fieldname && f.fieldname !== "__label" && f.fieldtype !== "HTML") filters[f.fieldname] = values[f.fieldname];
					});
					d.hide();
					this.run_compare(filters, values.__label || __("B"));
				},
			});
			d.show();
		}

		run_compare(filters, label) {
			frappe.dom.freeze(__("Running the report again"));
			frappe
				.call({ method: "frappe.desk.query_report.run", args: { report_name: this.report_name, filters, are_default_filters: false, ignore_prepared_report: true } })
				.then((res) => {
					frappe.dom.unfreeze();
					const msg = res.message || {};
					if (!msg.result) return frappe.msgprint(__("The report did not return rows for these filters."));
					const cols = (msg.columns || []).map((c) => frappe.report_utils.prepare_field_from_column(c));
					let data = msg.result.map((row) => {
						if (!Array.isArray(row)) return Object.assign({}, row);
						const o = {};
						cols.forEach((c, i) => (o[c.fieldname] = row[i]));
						return o;
					});
					let b_total = null;
					if (msg.add_total_row && !this.qr.report_settings.tree && data.length) b_total = data.pop();
					this.link_tree(data);
					// the rows of run B are keyed on the report's own columns, as run A's are (not the linked ones)
					this.set_keys(data, this.report_columns);
					// number columns are matched by name; by their place only when both runs have the same
					// number columns, and a column of run B is never used twice
					const a_nums = this.report_columns.filter((c) => NUM.has(c.fieldtype) && c.fieldtype !== "Percent");
					const b_nums = cols.filter((c) => NUM.has(c.fieldtype) && c.fieldtype !== "Percent");
					const colmap = {};
					const used = new Set();
					a_nums.forEach((c) => {
						const same = b_nums.find((x) => x.fieldname === c.fieldname);
						if (same) {
							colmap[c.fieldname] = same.fieldname;
							used.add(same.fieldname);
						}
					});
					if (a_nums.length === b_nums.length) {
						a_nums.forEach((c, i) => {
							const by_place = b_nums[i];
							if (!colmap[c.fieldname] && !used.has(by_place.fieldname)) {
								colmap[c.fieldname] = by_place.fieldname;
								used.add(by_place.fieldname);
							}
						});
					}
					const by_key = new Map(data.map((r) => [r.__nxmk, r]));
					this.bmap = new Map();
					let matched = 0;
					this.rows.forEach((r) => {
						const br = by_key.get(r.__nxmk);
						if (!br) return;
						matched++;
						const o = {};
						Object.entries(colmap).forEach(([a, b]) => (o[a] = br[b]));
						this.bmap.set(r, o);
					});
					this.totals.forEach((t) => {
						if (!b_total) return;
						const o = {};
						Object.entries(colmap).forEach(([a, b]) => (o[a] = b_total[b]));
						this.bmap.set(t, o);
					});
					this.state.compare = { label, filters, colmap, matched };
					this.$wrap.find(".nxv-cmp-btn").attr("aria-pressed", "true");
					this.refresh(true);
					frappe.show_alert({ message: __("{0} of {1} rows matched in {2}", [matched, this.rows.length, label]), indicator: "green" }, 5);
				})
				.catch(() => frappe.dom.unfreeze());
		}

		// a row's name for people: its first text column that is not a date
		row_label(r) {
			const c =
				this.columns.find((x) => !NUM.has(x.fieldtype) && x.fieldtype !== "Date" && !(x.fieldtype === "Link" && x.options === "DocType") && clean(r[x.fieldname])) ||
				this.columns[0];
			return clean(r[c.fieldname]);
		}

		// ---------------------------------------------------------------- review marks
		filters_key() {
			const f = this.filters();
			const sorted = {};
			Object.keys(f)
				.sort()
				.forEach((k) => {
					sorted[k] = Array.isArray(f[k]) ? f[k].map(String).sort() : f[k];
				});
			return hash(JSON.stringify(sorted));
		}

		load_reviews() {
			const key = this.filters_key();
			this.reviews_key = key;
			frappe
				.call({ method: API + "get_reviews", args: { report: this.report_name, filters_key: key }, type: "GET" })
				.then((r) => {
					if (this.reviews_key !== key) return;
					this.set_reviews(r.message || []);
				})
				.catch(() => {});
		}

		set_reviews(list) {
			this.reviews = {};
			list.forEach((x) => (this.reviews[x.row_key + "|" + x.report_column] = x));
			this.render_body(true);
		}

		send_reviews(items) {
			const key = this.filters_key();
			return frappe
				.call({
					method: API + "set_reviews",
					args: { report: this.report_name, filters_key: key, items, filters: JSON.stringify(this.filters()) },
				})
				.then((r) => {
					if (this.reviews_key === key) this.set_reviews(r.message || []);
				});
		}

		open_review(td, r, c) {
			if (r.__nxgroup || r.__nxtotal || c.calc || c.twin) {
				return frappe.show_alert({ message: __("Only figures that come from the report can be reviewed"), indicator: "orange" });
			}
			const rv = this.review_of(r, c) || {};
			const name = this.row_label(r);
			const $p = this.$wrap.find(".nxv-review-pop");
			this.review_target = { r, c };
			$p.html(`<div class="nxv-pop-hd"><b title="${esc(name)}">${esc(name)}</b><span class="nxv-lbl">${esc(c.label)}</span></div>
				<div class="nxv-rv-val">${esc(format_number(to_number(this.val(r, c)) || 0, this.opts_for(c)))}</div>
				<div class="nxv-two nxv-rv-st">
					<button class="btn btn-default btn-xs ok" data-s="Reviewed" aria-pressed="${rv.status === "Reviewed"}">✓ ${__("Reviewed")}</button>
					<button class="btn btn-default btn-xs flag" data-s="Needs Support" aria-pressed="${rv.status === "Needs Support"}">! ${__("Needs Support")}</button>
				</div>
				<textarea class="form-control nxv-rv-note" rows="2" placeholder="${__("Note (optional)")}">${esc(rv.note || "")}</textarea>
				<div class="nxv-acts"><button class="btn btn-default btn-xs" data-ra="clear">${__("Clear")}</button><button class="btn btn-default btn-xs" data-ra="cancel">${__("Cancel")}</button><button class="btn btn-primary btn-xs" data-ra="save">${__("Save")}</button></div>
				${rv.modified_by || rv.owner ? `<p class="nxv-small">${__("Last set by {0}", [esc(frappe.user.full_name(rv.modified_by || rv.owner))])}</p>` : ""}`);
			$p.prop("hidden", false);
			this.place($p[0], td);
		}

		review_action(act) {
			const $p = this.$wrap.find(".nxv-review-pop");
			const t = this.review_target;
			if (!t) return;
			if (act === "cancel") return $p.prop("hidden", true);
			const on = $p.find('[data-s][aria-pressed="true"]').data("s");
			const note = act === "clear" ? "" : $p.find(".nxv-rv-note").val();
			const status = act === "clear" ? "" : on || (note ? "Needs Support" : "");
			$p.prop("hidden", true);
			this.send_reviews([{ row_key: t.r.__nxrh, column: t.c.fieldname, row_label: this.row_label(t.r), status, note }]);
		}

		mark_selection() {
			const items = this.sel_cells()
				.filter((k) => !k.r.__nxgroup && !k.r.__nxtotal && !k.c.calc && !k.c.twin)
				.map((k) => {
					const old = this.review_of(k.r, k.c) || {};
					return { row_key: k.r.__nxrh, column: k.c.fieldname, row_label: this.row_label(k.r), status: "Reviewed", note: old.note || "" };
				});
			if (!items.length) return;
			this.send_reviews(items).then(() => frappe.show_alert({ message: __("{0} cells marked reviewed", [items.length]), indicator: "green" }));
		}

		// ---------------------------------------------------------------- drill down, with a path
		filters() {
			if (this.run_filters) return this.run_filters;
			try {
				return this.qr.get_filter_values(false) || {};
			} catch (e) {
				return {};
			}
		}

		drill(r, c) {
			if (r.__nxgroup) return frappe.show_alert({ message: __("This subtotal is worked out in this view. Open the group to see its rows."), indicator: "blue" });
			if (c.calc) return frappe.show_alert({ message: __("This column is calculated in this view, so no document is behind it"), indicator: "blue" });
			if (r.bold || r.is_total_row || r.__nxtotal) return frappe.show_alert({ message: __("This total comes from the report itself"), indicator: "blue" });
			const vcol = this.columns.find((x) => x.fieldname === "voucher_no" || (x.fieldtype === "Dynamic Link" && /voucher/i.test(x.fieldname)));
			if (vcol && r[vcol.fieldname]) {
				const dt = vcol.fieldtype === "Dynamic Link" ? r[vcol.options] : r.voucher_type || vcol.options;
				if (dt) return this.start_drill(this.voucher_step(dt, r[vcol.fieldname]));
			}
			const acol = this.columns.find((x) => x.fieldtype === "Link" && x.options === "Account");
			const account = acol ? clean(r[acol.fieldname]) : "";
			if (account && !/^'/.test(String(r[acol.fieldname])) && c.fieldtype === "Currency") {
				const run = c.twin && this.state.compare ? this.state.compare.filters : null;
				return this.start_drill(this.gl_step(account, c.label, run, r));
			}
			const first = this.columns.find((x) => (x.fieldtype === "Link" && x.options) || (x.fieldtype === "Dynamic Link" && r[x.options]));
			if (first && r[first.fieldname]) {
				const dt = first.fieldtype === "Link" ? first.options : r[first.options];
				return window.open(frappe.utils.get_form_link(dt, r[first.fieldname]), "_blank");
			}
			frappe.show_alert({ message: __("This row has no document to open"), indicator: "orange" });
		}

		start_drill(step) {
			this.stack = [{ short: this.report_name }, step];
			this.draw_drill();
		}

		push_drill(step) {
			this.stack.push(step);
			this.draw_drill();
		}

		draw_drill() {
			const $d = this.$wrap.find(".nxv-drill");
			this.$wrap.find(".nxv-cust").removeClass("open");
			this.$wrap.find(".nxv-cust-btn").attr("aria-pressed", "false");
			$d.find(".nxv-path").html(
				this.stack.map((s, i) => (i === this.stack.length - 1 ? `<b>${esc(s.short)}</b>` : `<button data-k="${i}">${esc(s.short)}</button>`)).join("<span>›</span>")
			);
			$d.find(".nxv-drawer-sum").prop("hidden", true);
			$d.addClass("open");
			this.stack[this.stack.length - 1].draw($d);
		}

		// The period of a figure, as ERPNext's own statements drill: the row's from_date/year_start_date
		// first, then the report's dates.
		gl_filters(account, run, row) {
			const f = run || this.filters();
			const r = (!run && row) || {};
			const out = {
				company: f.company || frappe.defaults.get_user_default("Company"),
				from_date: r.from_date || r.year_start_date || f.from_date || f.period_start_date || frappe.datetime.year_start(),
				to_date: r.to_date || r.year_end_date || f.to_date || f.period_end_date || frappe.datetime.get_today(),
				account: [account],
				group_by: "Group by Voucher (Consolidated)",
			};
			["cost_center", "project", "finance_book", "presentation_currency", "include_default_book_entries"].forEach((k) => {
				if (f[k] !== undefined && f[k] !== null && f[k] !== "" && (!Array.isArray(f[k]) || f[k].length)) out[k] = f[k];
			});
			return out;
		}

		amount(v) {
			return format_number(to_number(v) || 0, Object.assign({}, this.opts_for({ fieldname: "__drawer", fkey: "__drawer", fieldtype: "Currency", label: "" }), { scale_n: 1 }));
		}

		gl_step(account, label, run, row) {
			const filters = this.gl_filters(account, run, row);
			const step = { short: "GL · " + account, lines: [] };
			step.draw = ($d) => {
				$d.find("h4").text(account);
				$d.find("header p").text(`${label} · ${__("General Ledger")} ${filters.from_date} → ${filters.to_date}`);
				$d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("Loading")}…</p>`);
				$d.find("footer").html(`<button class="btn btn-default btn-xs nxv-open-gl">${__("Open in General Ledger")}</button>`);
				$d.find(".nxv-open-gl").on("click", () => frappe.set_route("query-report", "General Ledger", filters));
				const failed = () => $d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("Could not load the General Ledger, or you may not open it.")}</p>`);
				frappe
					.call({ method: "frappe.desk.query_report.run", args: { report_name: "General Ledger", filters, ignore_prepared_report: true }, error: failed })
					.then((res) => {
						if (this.stack[this.stack.length - 1] !== step) return;
						if (!res || !res.message) return failed();
						const result = res.message.result || [];
						const lines = result.filter((x) => x.voucher_no);
						step.lines = lines;
						// the General Ledger's own summary rows come in order: opening, total, closing
						const ends = result.filter((x) => !x.voucher_no && x.account);
						const opening = ends.length ? ends[0] : null;
						const closing = ends.length > 1 ? ends[ends.length - 1] : null;
						if (opening || closing) {
							$d.find(".nxv-drawer-sum")
								.prop("hidden", false)
								.html(
									`<div><small>${__("Opening")}</small><b>${this.amount(opening ? opening.balance : 0)}</b></div><div><small>${__("Entries")}</small><b>${lines.length}</b></div><div><small>${__("Closing")}</small><b>${this.amount(closing ? closing.balance : 0)}</b></div>`
								);
						}
						const shown = lines.slice(0, 300);
						$d.find(".nxv-drawer-body").html(
							lines.length
								? `<table><thead><tr><th>${__("Date")}</th><th>${__("Voucher")}</th><th class="nxv-r">${__("Debit")}</th><th class="nxv-r">${__("Credit")}</th></tr></thead><tbody>${shown
										.map(
											(x, i) =>
												`<tr><td>${esc(frappe.datetime.str_to_user(x.posting_date))}</td><td><a class="nxv-step" data-vi="${i}">${esc(x.voucher_no)}</a><div class="nxv-muted">${esc(__(x.voucher_type))}</div></td><td class="nxv-r">${to_number(x.debit) ? this.amount(x.debit) : ""}</td><td class="nxv-r">${to_number(x.credit) ? this.amount(x.credit) : ""}</td></tr>`
										)
										.join("")}</tbody></table>${lines.length > shown.length ? `<p class="nxv-muted">${__("Showing {0} of {1}. Open the General Ledger for all.", [shown.length, lines.length])}</p>` : ""}`
								: `<p class="nxv-muted">${__("No entries in this period")}</p>`
						);
					})
					.catch(() => $d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("Could not load the General Ledger")}</p>`));
			};
			step.click = (el) => {
				const x = step.lines[+el.dataset.vi];
				if (x) this.push_drill(this.voucher_step(x.voucher_type, x.voucher_no));
			};
			return step;
		}

		voucher_step(doctype, name) {
			const step = { short: name, legs: [] };
			step.draw = ($d) => {
				$d.find("h4").text(`${__(doctype)} · ${name}`);
				$d.find("header p").text(__("Its General Ledger lines. Click an account to keep going."));
				$d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("Loading")}…</p>`);
				$d.find("footer").html(`<button class="btn btn-default btn-xs nxv-open-doc">${__("Open {0}", [__(doctype)])}</button>`);
				$d.find(".nxv-open-doc").on("click", () => {
					const win = window.open(frappe.utils.get_form_link(doctype, name), "_blank");
					if (!win) frappe.set_route("Form", doctype, name);
				});
				const failed = () => $d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("Could not load the document's lines, or you may not see them.")}</p>`);
				frappe
					.call({
						method: "frappe.client.get_list",
						args: {
							doctype: "GL Entry",
							filters: { voucher_type: doctype, voucher_no: name, is_cancelled: 0 },
							fields: ["account", "debit", "credit", "posting_date", "party_type", "party", "cost_center"],
							limit_page_length: 500,
							order_by: "debit desc",
						},
						error: failed,
					})
					.then((res) => {
						if (this.stack[this.stack.length - 1] !== step) return;
						if (!res) return failed();
						const legs = res.message;
						step.legs = legs || [];
						if (!step.legs.length) {
							$d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("This document has no General Ledger lines, or you cannot see them.")}</p>`);
							return;
						}
						const dr = step.legs.reduce((s, x) => s + (to_number(x.debit) || 0), 0);
						const cr = step.legs.reduce((s, x) => s + (to_number(x.credit) || 0), 0);
						$d.find(".nxv-drawer-body").html(
							`<table><thead><tr><th>${__("Account")}</th><th class="nxv-r">${__("Debit")}</th><th class="nxv-r">${__("Credit")}</th></tr></thead><tbody>${step.legs
								.map(
									(x, i) =>
										`<tr><td><a class="nxv-step" data-ai="${i}">${esc(x.account)}</a>${x.party ? `<div class="nxv-muted">${esc(x.party)}</div>` : ""}</td><td class="nxv-r">${to_number(x.debit) ? this.amount(x.debit) : ""}</td><td class="nxv-r">${to_number(x.credit) ? this.amount(x.credit) : ""}</td></tr>`
								)
								.join("")}<tr class="nxv-drawer-tot"><td>${__("Total")}</td><td class="nxv-r">${this.amount(dr)}</td><td class="nxv-r">${this.amount(cr)}</td></tr></tbody></table>`
						);
					})
					.catch(() => $d.find(".nxv-drawer-body").html(`<p class="nxv-muted">${__("Could not load the document's lines")}</p>`));
			};
			step.click = (el) => {
				const x = step.legs[+el.dataset.ai];
				if (x) this.push_drill(this.gl_step(x.account, __("This report's period"), null));
			};
			return step;
		}

		close_drawers() {
			this.$wrap.find(".nxv-drawer").removeClass("open");
			this.$wrap.find(".nxv-cust-btn").attr("aria-pressed", "false");
		}

		// ---------------------------------------------------------------- column filter
		open_filter(f, th) {
			const c = this.columns.find((x) => x.fieldname === f);
			if (!c) return;
			this.filter_field = f;
			const cur = this.state.col_filters[f];
			const $p = this.$wrap.find(".nxv-filter-pop");
			const label = this.prefs.labels[f] || c.label;
			if (NUM.has(c.fieldtype)) {
				$p.html(`<div class="nxv-pop-hd"><b>${esc(label)}</b></div>
					<div class="nxv-two"><select class="form-control input-xs nxv-fop">
						<option value=">">${__("Greater than")}</option><option value="<">${__("Less than")}</option>
						<option value="=">${__("Equal to")}</option><option value="nz">${__("Not zero")}</option></select>
					<input class="form-control input-xs nxv-fx" type="number" step="any" value="${cur && cur.t === "num" ? cur.x : ""}"></div>
					<div class="nxv-acts"><button class="btn btn-default btn-xs" data-fa="clear">${__("Clear")}</button><button class="btn btn-primary btn-xs" data-fa="apply">${__("Apply")}</button></div>`);
				if (cur) $p.find(".nxv-fop").val(cur.op);
			} else {
				const counts = new Map();
				this.rows.forEach((r) => {
					const k = String(this.val(r, c) ?? "");
					counts.set(k, (counts.get(k) || 0) + 1);
				});
				const vals = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 500);
				this.filter_cut = counts.size > vals.length;
				$p.html(`<div class="nxv-pop-hd"><b>${esc(label)}</b><span class="nxv-lbl">${__("{0} values", [counts.size])}</span></div>
					${counts.size > vals.length ? `<p class="nxv-small">${__("The {0} most common values are listed; unticking hides only those.", [vals.length])}</p>` : ""}
					<input class="form-control input-xs nxv-fsearch" type="search" placeholder="${__("Find a value")}">
					<div class="nxv-vals">${vals
						.map(
							([k, n]) =>
								`<label data-txt="${esc(k.toLowerCase())}"><input type="checkbox" data-v="${esc(k)}" ${!cur || cur.t === "num" || (cur.t === "out" ? !cur.vals.has(k) : cur.vals.has(k)) ? "checked" : ""}><span>${esc(clean(k) || __("(blank)"))}</span><em>${n}</em></label>`
						)
						.join("")}</div>
					<div class="nxv-acts"><button class="btn btn-default btn-xs" data-fa="all">${__("All")}</button><button class="btn btn-default btn-xs" data-fa="none">${__("None")}</button><span class="nxv-spacer"></span><button class="btn btn-default btn-xs" data-fa="clear">${__("Clear")}</button><button class="btn btn-primary btn-xs" data-fa="apply">${__("Apply")}</button></div>`);
				$p.find(".nxv-fsearch").on("input", (e) => {
					const q = e.target.value.toLowerCase();
					$p.find(".nxv-vals label").each((i, l) => {
						l.hidden = !l.dataset.txt.includes(q);
					});
				});
			}
			$p.prop("hidden", false);
			this.place($p[0], th);
		}

		apply_filter(act) {
			const $p = this.$wrap.find(".nxv-filter-pop");
			const f = this.filter_field;
			if (act === "all" || act === "none") {
				$p.find(".nxv-vals label:not([hidden]) input").prop("checked", act === "all");
				return;
			}
			if (act === "clear") delete this.state.col_filters[f];
			if (act === "apply") {
				if ($p.find(".nxv-fop").length) {
					const op = $p.find(".nxv-fop").val();
					// a number box always gives a dot decimal, whatever the site's number format
					const raw = parseFloat($p.find(".nxv-fx").val());
					const x = Number.isFinite(raw) ? raw : null;
					if (op === "nz") this.state.col_filters[f] = { t: "num", op, x: 0 };
					else if (x !== null) this.state.col_filters[f] = { t: "num", op, x };
					else delete this.state.col_filters[f];
				} else {
					const boxes = $p.find(".nxv-vals input").toArray();
					const on = boxes.filter((b) => b.checked).map((b) => b.dataset.v);
					const off = boxes.filter((b) => !b.checked).map((b) => b.dataset.v);
					if (!off.length) delete this.state.col_filters[f];
					else if (this.filter_cut) this.state.col_filters[f] = { t: "out", vals: new Set(off) };
					else this.state.col_filters[f] = { t: "in", vals: new Set(on) };
				}
			}
			$p.prop("hidden", true);
			this.refresh();
		}

		// popovers sit on the screen, next to the cell, and always fully in view
		place(pop, anchor) {
			const a = anchor.getBoundingClientRect();
			const w = pop.offsetWidth || 290;
			const h = Math.min(pop.offsetHeight || 300, window.innerHeight - 16);
			let left = Math.min(Math.max(8, a.left), window.innerWidth - w - 8);
			let top = a.bottom + 4;
			if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 4);
			pop.style.left = left + "px";
			pop.style.top = top + "px";
		}

		// ---------------------------------------------------------------- customize panel
		open_cust() {
			this.$wrap.find(".nxv-drill").removeClass("open");
			this.render_cust();
			this.$wrap.find(".nxv-cust").addClass("open");
			this.$wrap.find(".nxv-cust-btn").attr("aria-pressed", "true");
		}

		render_cust() {
			this.$wrap.find(".nxv-ctabs button").each((i, b) => b.setAttribute("aria-selected", String(b.dataset.t === this.cust_tab)));
			const pane = { format: "fmt_pane", rules: "rules_pane", calc: "calc_pane" }[this.cust_tab] || "fmt_pane";
			this.$wrap.find(".nxv-cust-body").html(this[pane]());
		}

		opt(pairs, val) {
			return pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
		}

		fmt_targets() {
			return this.columns
				.filter((c) => NUM.has(c.fieldtype))
				.map((c) => ({ f: c.fieldname, label: this.prefs.labels[c.fieldname] || c.label, c }))
				.concat((this.prefs.calcs || []).map((k) => ({ f: k.f, label: (this.prefs.labels[k.f] || k.label) + " " + __("(calculated)"), c: { fieldname: k.f, fkey: k.f, fieldtype: k.type, label: k.label } })));
		}

		fmt_pane() {
			const list = this.fmt_targets();
			if (this.fmt_scope !== "report" && !list.find((x) => x.f === this.fmt_scope)) this.fmt_scope = "report";
			const is_report = this.fmt_scope === "report";
			this.fcache = {};
			const target = is_report ? { fieldname: "__fmt_preview", fkey: "__fmt_preview", fieldtype: "Currency", label: "" } : list.find((x) => x.f === this.fmt_scope).c;
			const o = this.opts_for(target);
			const sel = (key, pairs) => `<select class="form-control input-xs" data-fo="${key}">${this.opt(pairs, o[key])}</select>`;
			const chk = (key, label) => `<label class="nxv-check"><input type="checkbox" data-fo="${key}" ${o[key] ? "checked" : ""}> ${label}</label>`;
			const samples = target.fieldtype === "Percent" ? [12.345, -3.2, 0] : target.fieldtype === "Int" ? [1234567, -420, 0] : [1234567.891, -98765.4, 0];
			return `
				<div class="nxv-cf"><label>${__("Apply to")}</label><select class="form-control input-xs nxv-fsc">${this.opt(
					[["report", __("Whole report (all amounts)")]].concat(list.map((x) => [x.f, __("Column") + ": " + x.label])),
					this.fmt_scope
				)}</select></div>
				<p class="nxv-muted">${is_report ? __("Starts from System Settings. A column setting wins over the report setting.") : __("Only this column. What you leave as it is follows the report setting.")}</p>
				<div class="nxv-cf">
					<label>${__("Number Format")}</label>${sel("pattern", [["#,###.##", "1,234,567.89"], ["#.###,##", "1.234.567,89"], ["# ###.##", "1 234 567.89"], ["#'###.##", "1'234'567.89"], ["#,##,###.##", "12,34,567.89"], ["####.##", "1234567.89"]])}
					<label>${__("Decimals")}</label>${sel("decimals", [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]])}
					<label>${__("Negative Numbers")}</label>${sel("neg", [["paren", "(1,234.00)"], ["minus", "-1,234.00"], ["trail", "1,234.00-"]])}
					<label>${__("Zero Shows As")}</label>${sel("zero", [["dash", "–"], ["zero", "0.00"], ["blank", __("Blank")]])}
					<label>${__("Scale")}</label>${
						is_report
							? `<select class="form-control input-xs" data-fo="units">${this.opt([[1, __("Full number")], [1000, __("Thousands (K)")], [1000000, __("Millions (M)")], [1000000000, __("Billions (B)")]], this.units)}</select>`
							: sel("scale", [["inherit", __("Same as report")], [1, __("Full number")], [1000, __("Thousands (K)")], [1000000, __("Millions (M)")], [1000000000, __("Billions (B)")]])
					}
					<label>${__("Text Before")}</label><input class="form-control input-xs" data-fo="prefix" value="${esc(o.prefix || "")}" placeholder="SAR ">
					<label>${__("Text After")}</label><input class="form-control input-xs" data-fo="suffix" value="${esc(o.suffix || "")}">
					<label>${__("Digits")}</label>${sel("digits", [["latin", "0123456789"], ["arabic", "٠١٢٣٤٥٦٧٨٩"]])}
					<label>${__("Align")}</label>${sel("align", [["right", __("Right")], ["center", __("Center")], ["left", __("Left")]])}
					${is_report ? `<label>${__("Dates")}</label><select class="form-control input-xs" data-fo="date">${this.opt(DATE_FORMATS, this.prefs.fmt.report.date || "")}</select>` : ""}
				</div>
				<div class="nxv-checks">${chk("neg_red", __("Negatives in red"))}${chk("plus", __("Show + on positives"))}${chk("bold", __("Bold"))}</div>
				<div class="nxv-prev">${samples.map((s) => `<div><span>${s}</span><b class="${s < 0 && o.neg_red ? "nxv-neg" : ""}">${esc(format_number(s, o) || __("(blank)"))}</b></div>`).join("")}</div>
				<div><button class="btn btn-default btn-xs" data-cact="fmt-reset">${is_report ? __("Reset the report setting") : __("Reset this column")}</button></div>`;
		}

		col_name(f) {
			if (f === "*") return __("Any number column");
			const c = this.columns.find((x) => x.fieldname === f);
			const k = (this.prefs.calcs || []).find((x) => x.f === f);
			return this.prefs.labels[f] || (c ? c.label : k ? k.label : f);
		}

		describe_rule(u) {
			const op = (OPS.find((o) => o[0] === u.op) || [, u.op])[1];
			const v = NO_VALUE.has(u.op) ? "" : " " + u.x + (u.op === "between" ? " " + __("and") + " " + u.x2 : "");
			const style = (STYLES.find((s) => s[0] === u.style) || [, u.style])[1];
			return `${this.col_name(u.f)} ${op}${v} → ${style}${u.scope === "row" ? ", " + __("whole row") : ""}`;
		}

		rules_pane() {
			const fields = [["*", __("Any number column")]].concat(
				this.columns.map((c) => [c.fieldname, this.prefs.labels[c.fieldname] || c.label]),
				(this.prefs.calcs || []).map((k) => [k.f, k.label])
			);
			const rules = this.prefs.rules || [];
			return `${
				rules.length
					? rules.map((u, i) => `<div class="nxv-rule"><span>${esc(this.describe_rule(u))}</span><button class="nxv-del" data-rdel="${i}" aria-label="${__("Remove rule")}">×</button></div>`).join("")
					: `<p class="nxv-muted">${__("No rules yet. Add one below or start from an example.")}</p>`
			}
				<div class="nxv-examples"><button class="nxv-chip" data-preset="neg">${__("Negatives: red background")}</button><button class="nxv-chip" data-preset="zero">${__("Zeros: grey")}</button><button class="nxv-chip" data-preset="big">${__("Over 1,000,000: bold")}</button></div>
				<h5>${__("New rule")}</h5>
				<div class="nxv-cf">
					<label>${__("Column")}</label><select class="form-control input-xs nxv-rf">${this.opt(fields, "*")}</select>
					<label>${__("Condition")}</label><select class="form-control input-xs nxv-rop">${this.opt(OPS, ">")}</select>
					<label>${__("Value")}</label><input class="form-control input-xs nxv-rx" placeholder="90">
					<label>${__("And (for between)")}</label><input class="form-control input-xs nxv-rx2">
					<label>${__("Style")}</label><select class="form-control input-xs nxv-rs">${this.opt(STYLES, "amberbg")}</select>
					<label>${__("Apply to")}</label><select class="form-control input-xs nxv-rsc">${this.opt([["cell", __("The cell")], ["row", __("The whole row")]], "cell")}</select>
				</div>
				<div><button class="btn btn-primary btn-xs" data-cact="rule-add">${__("Add rule")}</button></div>`;
		}

		calc_pane() {
			const nums = this.columns.filter((c) => NUM.has(c.fieldtype));
			const amts = nums.filter((c) => AMT.has(c.fieldtype));
			const example = amts.length > 1 ? `${field_ref(amts[1].fieldname)} / ${field_ref(amts[0].fieldname)} * 100` : nums.length ? `${field_ref(nums[0].fieldname)} * 2` : "";
			return `<p class="nxv-muted">${__("A calculated column is worked out in this view from the report's own columns. It shows in purple italic and is not stored in the books.")}</p>
				${(this.prefs.calcs || [])
					.map(
						(k, i) =>
							`<div class="nxv-rule"><span><b>${esc(this.prefs.labels[k.f] || k.label)}</b> = <code>${esc(k.expr)}</code> <span class="nxv-lbl">(${esc(__(k.type))})</span>${this.calc_fns[k.f] ? "" : ` <span class="nxv-err">${__("not valid for this report")}</span>`}</span><button class="nxv-del" data-cdel="${i}" aria-label="${__("Remove column")}">×</button></div>`
					)
					.join("")}
				<h5>${__("New column")}</h5>
				<div class="nxv-cf">
					<label>${__("Name")}</label><input class="form-control input-xs nxv-cl-label" placeholder="${__("Collected %")}">
					<label>${__("Formula")}</label><input class="form-control input-xs nxv-cl-expr nxv-mono" placeholder="${esc(example)}">
					<label>${__("Show as")}</label><select class="form-control input-xs nxv-cl-type">${this.opt([["Currency", __("Amount")], ["Float", __("Number")], ["Percent", __("Percent")], ["Int", __("Whole number")]], "Percent")}</select>
				</div>
				<div class="nxv-examples">${nums.map((c) => `<button class="nxv-chip" data-ins="${esc(field_ref(c.fieldname))}" title="${esc(field_ref(c.fieldname))}">${esc(this.prefs.labels[c.fieldname] || c.label)}</button>`).join("")}</div>
				<p class="nxv-err nxv-cl-err"></p>
				<div><button class="btn btn-primary btn-xs" data-cact="calc-add">${__("Add column")}</button></div>`;
		}

		after_cust() {
			this.fcache = {};
			this.save();
			this.render_controls();
			this.refresh(true);
			this.render_cust();
		}

		cust_change(el) {
			if (el.classList.contains("nxv-fsc")) {
				this.fmt_scope = el.value;
				return this.render_cust();
			}
			if (el.dataset.fo) {
				const k = el.dataset.fo;
				let v = el.type === "checkbox" ? el.checked : el.value;
				if (k === "units") {
					this.set_units(+v);
				} else if (k === "date") {
					this.prefs.fmt.report.date = v;
				} else {
					if (k === "decimals") v = +v;
					if (k === "scale") v = v === "inherit" ? "inherit" : +v;
					const t = this.fmt_scope === "report" ? this.prefs.fmt.report : (this.prefs.fmt.cols[this.fmt_scope] = this.prefs.fmt.cols[this.fmt_scope] || {});
					t[k] = v;
				}
				return this.after_cust();
			}
			if (el.dataset.colvis) {
				const hidden = new Set(this.prefs.hidden || []);
				el.checked ? hidden.delete(el.dataset.colvis) : hidden.add(el.dataset.colvis);
				this.prefs.hidden = [...hidden];
				return this.after_cust();
			}
			if (el.dataset.collabel) {
				const f = el.dataset.collabel;
				const v = el.value.trim();
				const orig = (this.columns.find((c) => c.fieldname === f) || (this.prefs.calcs || []).find((k) => k.f === f) || {}).label;
				if (!v || v === orig) delete this.prefs.labels[f];
				else this.prefs.labels[f] = v;
				return this.after_cust();
			}
			if (el.dataset.colw) {
				this.prefs.widths[el.dataset.colw] = Math.max(60, +el.value || 60);
				return this.after_cust();
			}
		}

		cust_click(b) {
			const $b = this.$wrap.find(".nxv-cust-body");
			const act = b.dataset.cact;
			if (act === "fmt-reset") {
				if (this.fmt_scope === "report") {
					this.prefs.fmt.report = {};
					this.set_units(1);
				} else delete this.prefs.fmt.cols[this.fmt_scope];
				return this.after_cust();
			}
			if (act === "cols-reset") {
				this.prefs.labels = {};
				this.prefs.widths = {};
				this.prefs.order = [];
				this.prefs.hidden = [];
				return this.after_cust();
			}
			if (b.dataset.rdel !== undefined) {
				this.prefs.rules.splice(+b.dataset.rdel, 1);
				return this.after_cust();
			}
			if (b.dataset.preset) {
				const p = {
					neg: { f: "*", op: "neg", style: "redbg", scope: "cell" },
					zero: { f: "*", op: "zero", style: "muted", scope: "cell" },
					big: { f: "*", op: ">", x: "1000000", style: "bold", scope: "cell" },
				}[b.dataset.preset];
				this.prefs.rules.push(Object.assign({ x: "", x2: "" }, p));
				return this.after_cust();
			}
			if (act === "rule-add") {
				const u = {
					f: $b.find(".nxv-rf").val(),
					op: $b.find(".nxv-rop").val(),
					x: String($b.find(".nxv-rx").val() || "").trim(),
					x2: String($b.find(".nxv-rx2").val() || "").trim(),
					style: $b.find(".nxv-rs").val(),
					scope: $b.find(".nxv-rsc").val(),
				};
				if (!NO_VALUE.has(u.op) && u.x === "") return frappe.show_alert({ message: __("Write a value for this condition"), indicator: "orange" });
				const numeric_op = [">", "<", "between"].includes(u.op);
				if (numeric_op && (parse_num(u.x) === null || (u.op === "between" && parse_num(u.x2) === null))) {
					return frappe.show_alert({ message: __("Write the value as a number"), indicator: "orange" });
				}
				this.prefs.rules.push(u);
				return this.after_cust();
			}
			if (b.dataset.cdel !== undefined) {
				const k = this.prefs.calcs.splice(+b.dataset.cdel, 1)[0];
				if (k) {
					this.prefs.rules = this.prefs.rules.filter((u) => u.f !== k.f);
					delete this.prefs.fmt.cols[k.f];
					delete this.prefs.labels[k.f];
				}
				this.recompile_calcs();
				return this.after_cust();
			}
			if (b.dataset.ins) {
				const inp = $b.find(".nxv-cl-expr")[0];
				const s = inp.selectionStart ?? inp.value.length;
				inp.value = inp.value.slice(0, s) + b.dataset.ins + " " + inp.value.slice(inp.selectionEnd ?? s);
				inp.focus();
				return;
			}
			if (act === "calc-add") {
				const label = String($b.find(".nxv-cl-label").val() || "").trim();
				const expr = String($b.find(".nxv-cl-expr").val() || "").trim();
				const type = $b.find(".nxv-cl-type").val();
				if (!label || !expr) return $b.find(".nxv-cl-err").text(__("Write a name and a formula"));
				try {
					compile(expr, this.number_fieldnames());
				} catch (e) {
					return $b.find(".nxv-cl-err").text(e.message);
				}
				this.prefs.calcs.push({ f: "nxcalc_" + Date.now().toString(36), label, expr, type });
				this.recompile_calcs();
				return this.after_cust();
			}
		}

		// ---------------------------------------------------------------- keyboard
		ensure_visible() {
			if (!this.cur) return;
			const head = this.grid.tHead.offsetHeight;
			const foot = this.grid.tFoot.offsetHeight;
			const top = this.cur.v * this.row_h;
			if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
			else if (head + top + this.row_h > this.scroller.scrollTop + this.scroller.clientHeight - foot)
				this.scroller.scrollTop = head + top + this.row_h - this.scroller.clientHeight + foot;
			this.render_body(false);
			const td = this.grid.querySelector(`tbody tr[data-v="${this.cur.v}"] td[data-c="${this.cur.c}"]`);
			if (!td) return;
			const first = this.fz_width || 0;
			if (this.fz && this.fz[this.cur.c]) return;
			else if (td.offsetLeft < this.scroller.scrollLeft + first) this.scroller.scrollLeft = td.offsetLeft - first;
			else if (td.offsetLeft + td.offsetWidth > this.scroller.scrollLeft + this.scroller.clientWidth)
				this.scroller.scrollLeft = td.offsetLeft + td.offsetWidth - this.scroller.clientWidth;
		}

		activate(v, ci, td) {
			const r = this.view[v];
			const c = this.cols[ci];
			if (!r || !c) return;
			if (r.__nxgroup) return this.toggle_group(r.__nxgkey);
			if (ci === 0 && this.is_tree && r.__nxkids) {
				r.__nxopen = !r.__nxopen;
				return this.refresh(true);
			}
			if (NUM.has(c.fieldtype)) return this.review_mode && td ? this.open_review(td, r, c) : this.drill(r, c);
			const a = td && td.querySelector("a[href]");
			if (a) a.click();
		}

		on_key(e) {
			if (!this.view.length || this.layout !== "table") return;
			const k = e.key;
			const mod = e.ctrlKey || e.metaKey;
			if (mod && k.toLowerCase() === "c") {
				e.preventDefault();
				return this.copy_cells();
			}
			if (mod && k.toLowerCase() === "a") {
				e.preventDefault();
				this.sel = { a: { v: 0, c: 0 }, b: { v: this.view.length - 1, c: this.cols.length - 1 } };
				return this.paint();
			}
			const page = Math.max(1, Math.floor(this.scroller.clientHeight / this.row_h) - 2);
			const moves = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageDown: [page, 0], PageUp: [-page, 0] };
			if (frappe.utils.is_rtl()) {
				moves.ArrowLeft = [0, 1];
				moves.ArrowRight = [0, -1];
			}
			if (!this.cur) this.cur = { v: 0, c: 0 };
			if (moves[k] || k === "Home" || k === "End") {
				e.preventDefault();
				const before = { ...this.cur };
				if (moves[k]) {
					this.cur.v = Math.max(0, Math.min(this.view.length - 1, this.cur.v + moves[k][0]));
					this.cur.c = Math.max(0, Math.min(this.cols.length - 1, this.cur.c + moves[k][1]));
				} else if (k === "Home") {
					this.cur.c = 0;
					if (mod) this.cur.v = 0;
				} else {
					this.cur.c = this.cols.length - 1;
					if (mod) this.cur.v = this.view.length - 1;
				}
				if (e.shiftKey) {
					if (!this.sel) this.sel = { a: before, b: { ...this.cur } };
					else this.sel.b = { ...this.cur };
				} else this.sel = null;
				this.ensure_visible();
				return this.paint();
			}
			if (k === "Enter") {
				e.preventDefault();
				const td = this.grid.querySelector(`tbody tr[data-v="${this.cur.v}"] td[data-c="${this.cur.c}"]`);
				this.activate(this.cur.v, this.cur.c, td);
			}
		}

		expand_all(open) {
			if (this.is_tree) return this.set_level(open ? 99 : 1);
			if (!this.state.group_by) return;
			this.state.group_open = new Set();
			if (open) this.view.filter((r) => r.__nxgroup).forEach((g) => this.state.group_open.add(g.__nxgkey));
			this.refresh(true);
		}

		toggle_group(k) {
			if (this.state.group_open.has(k)) this.state.group_open.delete(k);
			else this.state.group_open.add(k);
			this.refresh(true);
		}

		fill_more_menu() {
			const compare = { act: "compare", icon: "git-compare", label: __("Compare with another run"), check: 1, on: !!this.state.compare };
			const review = { act: "review", icon: "check-check", label: __("Review figures"), check: 1, on: !!this.review_mode };
			const frappe_view = { act: "frappe", icon: "sheet", label: __("Frappe View") };
			// a report the user saved as their own leads back to the report it was made from
			const doc = this.qr.report_doc;
			const from = doc && doc.report_type === "Custom Report" && doc.reference_report;
			const original = from ? { act: "original", val: from, icon: "undo-2", label: __("Open the original report ({0})", [__(from)]) } : null;
			let items;
			if (window.innerWidth > 640) {
				items = [compare, review, "-", { act: "saveas", icon: "copy-plus", label: __("Save as my own report") }, original, frappe_view];
			} else {
				const v = this.view_parts();
				const full = this.$wrap.hasClass("nxv-full");
				items = [
					{ act: "columns", icon: "columns-3", label: __("Columns") },
					{ act: "sort", icon: "arrow-down-up", label: __("Sort & Filter") },
					{ act: "format", icon: "palette", label: __("Format") },
					compare,
					review,
					"-",
					{ icon: "layout-list", label: __("Show as"), cur: this.layout === "cards" ? __("List") : __("Table"), sub: v.layout },
					{ icon: "rows-3", label: __("Rows"), cur: this.row_h === 28 ? __("Compact") : __("Comfortable"), sub: v.rows },
					v.units,
					v.main && { ...v.main, label: __("Main figure") },
					"-",
					{ act: "shown", icon: "clipboard", label: __("Copy the table") },
					{ act: "xlsx", icon: "file-spreadsheet", label: __("Export to Excel") },
					{ act: "pdf", icon: "file", label: __("PDF") },
					"-",
					{ act: "full", icon: full ? "minimize-2" : "maximize-2", label: full ? __("Exit Full Screen") : __("Full Screen") },
					original,
					frappe_view,
				];
			}
			this.$wrap.find(".nxv-more-menu").html(this.menu_html(items));
		}

		// every line of the View, Export and ⋯ menus ends here
		menu_action(a, val) {
			const w = this.$wrap;
			if (a === "layout") {
				this.prefs.layout = val;
				this.save();
				return this.set_layout(this.prefs.layout);
			}
			if (a === "density") {
				this.set_density(+val);
				this.save();
				return this.render_body(true);
			}
			if (a === "units") {
				this.set_units(+val);
				this.save();
				return this.refresh(true);
			}
			if (a === "freeze") {
				this.prefs.freeze = +val;
				this.save();
				return this.refresh(true);
			}
			if (a === "main") {
				this.prefs.main_col = val;
				this.save();
				if (this.layout === "cards") this.render_body(true);
				return;
			}
			const click = { columns: ".nxv-addcols-btn", sort: ".nxv-settings-btn", format: ".nxv-cust-btn", compare: ".nxv-cmp-btn", review: ".nxv-rev-btn", full: ".nxv-full-btn", frappe: ".nxv-frappe-btn" }[a];
			if (click) return w.find(click).trigger("click");
			if (a === "autofit") this.autofit();
			if (a === "saveas") this.save_as();
			if (a === "original" && val) frappe.set_route("query-report", val);
			if (a === "xlsx") this.export_file("xlsx");
			if (a === "csv") this.export_file("csv");
			if (a === "print") this.print_view(false);
			if (a === "pdf") this.print_view(true);
			if (a === "sel") this.copy_cells();
			if (a === "shown") this.copy_table(false);
			if (a === "raw") this.copy_table(true);
		}

		fit_menu($m) {
			const m = $m[0];
			if (m.hidden) return;
			m.style.insetInlineStart = "";
			m.style.insetInlineEnd = "";
			const box = this.$wrap[0].getBoundingClientRect();
			const r = m.getBoundingClientRect();
			if (r.left < box.left + 4) {
				m.style.insetInlineStart = frappe.utils.is_rtl() ? "auto" : "0";
				m.style.insetInlineEnd = frappe.utils.is_rtl() ? "0" : "auto";
			} else if (r.right > box.right - 4) {
				m.style.insetInlineStart = frappe.utils.is_rtl() ? "0" : "auto";
				m.style.insetInlineEnd = frappe.utils.is_rtl() ? "auto" : "0";
			}
		}

		toggle_full() {
			const on = !this.$wrap.hasClass("nxv-full");
			this.$wrap.toggleClass("nxv-full", on);
			$("body").toggleClass("nxv-noscroll", on);
			this.$wrap.find(".nxv-full-btn").attr("aria-pressed", String(on)).attr("title", on ? __("Exit Full Screen") : __("Full Screen")).html(icon(on ? "minimize-2" : "maximize-2", "sm"));
			this.redraw_chart();
			this.fit_height();
			this.render_body(true);
		}

		// The report's own filters, summary and chart live in two sections above the table, each one
		// opens and closes. They are Frappe's own elements, moved here and put back when the view
		// goes, so they keep working as before (and come along in full screen).
		adopt_head() {
			if ((this.moved || []).length) return this.sync_sections();
			const qr = this.qr;
			const places = [
				[qr.page && qr.page.page_form, "filters"],
				[qr.$summary, "chart"],
				[qr.$chart, "chart"],
			];
			this.moved = places
				.filter(([$el]) => $el && $el.length)
				.map(([$el, sec]) => {
					const $ph = $('<div class="nxv-ph" hidden></div>').insertBefore($el);
					$el.appendTo(this.$wrap.find(`.nxv-sec[data-sec="${sec}"] .nxv-sec-body`));
					return { $el, $ph };
				});
			this.sync_sections();
			this.redraw_chart();
		}

		release_head() {
			(this.moved || []).forEach(({ $el, $ph }) => {
				$el.insertAfter($ph);
				$ph.remove();
			});
			this.moved = [];
			this.redraw_chart();
		}

		// Frappe's chart takes its width when it is drawn: draw it again at the width it has now
		redraw_chart() {
			setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
		}

		// the report's own summary figures, as [label, value, color Frappe gave the value]
		summary_items() {
			const $s = this.qr.$summary;
			if (!$s || !$s.length || $s.css("display") === "none") return [];
			return $s
				.find(".summary-item")
				.toArray()
				.map((el) => {
					const label = $(el).find(".summary-label").text().trim();
					const $v = $(el).find(".summary-value");
					const value = $v.text().trim();
					const color = $v.length ? getComputedStyle($v[0]).color : "";
					return label && value ? [label, value, /^rgba?\([\d., ]+\)$/.test(color) ? color : ""] : null;
				})
				.filter(Boolean);
		}

		// a closed section shows what it holds as small labelled chips on its line
		chips_html(items, figures) {
			return items
				.map(([k, v, color]) =>
					v
						? `<span class="nxv-kv${figures ? " nxv-kv-fig" : ""}"><span class="nxv-kv-k">${esc(k)}</span><span class="nxv-kv-v"${color ? ` style="color:${color}"` : ""}>${esc(v)}</span></span>`
						: `<span class="nxv-kv nxv-kv-flag">${icon("check", "xs")}<span class="nxv-kv-k">${esc(k)}</span></span>`
				)
				.join("");
		}

		// the table reaches the bottom of the window: as tall as the room left under what is above it
		// on the page, never shorter than it was before (with the sections open the page scrolls to it)
		fit_height() {
			const els = [this.scroller, this.$wrap.find(".nxv-cards")[0]].filter(Boolean);
			const clear = () => els.forEach((x) => (x.style.height = ""));
			// full screen and phones size it in the stylesheet
			if (this.$wrap.hasClass("nxv-full") || this.$wrap.prop("hidden") || window.innerWidth <= 640) return clear();
			const el = this.layout === "cards" ? els[1] : els[0];
			if (!el || !el.offsetParent) return;
			const rect = el.getBoundingClientRect();
			const top = rect.top + window.scrollY;
			// what the page has under the table: the view's status line and frame, Frappe's footer line
			const main = this.qr.page && this.qr.page.main && this.qr.page.main[0];
			const end = main ? main.closest(".layout-main-section") || main : null;
			const below = end ? Math.max(0, end.getBoundingClientRect().bottom - rect.bottom) : 60;
			const h = Math.round(Math.max(400, window.innerHeight - 330, window.innerHeight - top - below - 4));
			if (Math.abs(rect.height - h) < 2) return;
			els.forEach((x) => (x.style.height = h + "px"));
			// while the view is still being built it has no rows yet: they are drawn when they come
			if (this.layout !== "cards" && this.view) this.render_body(true);
		}

		sync_sections() {
			const qr = this.qr;
			const shown = ($el) => !!($el && $el.length && $el.css("display") !== "none" && $el.children().length);
			const closed = this.prefs.closed || {};
			const has_filters = !!(qr.page && qr.page.page_form && this.$wrap.find(".nxv-sec[data-sec=filters] .page-form").length);
			const has_summary = shown(qr.$summary);
			const has_chart = shown(qr.$chart);
			const parts = {
				filters: [has_filters, __("Filters"), () => this.chips_html(this.filter_items(), false)],
				chart: [has_summary || has_chart, has_summary && has_chart ? __("Summary & Chart") : has_chart ? __("Chart") : __("Summary"), () => this.chips_html(this.summary_items(), true)],
			};
			Object.entries(parts).forEach(([sec, [on, title, sum]]) => {
				const $sec = this.$wrap.find(`.nxv-sec[data-sec="${sec}"]`);
				const open = !closed[sec];
				$sec.prop("hidden", !on).toggleClass("closed", !open);
				$sec.find(".nxv-sec-hd").attr("aria-expanded", String(open));
				$sec.find(".nxv-sec-t").text(title);
				$sec.find(".nxv-sec-sum").html(open ? "" : sum());
			});
			this.fit_height();
		}

		toggle_section(sec) {
			const closed = Object.assign({}, this.prefs.closed || {});
			closed[sec] = !closed[sec];
			this.prefs.closed = closed;
			this.save();
			this.sync_sections();
			if (sec === "chart" && !closed.chart) this.redraw_chart();
			this.render_body(true);
		}

		// ---------------------------------------------------------------- events
		bind() {
			const w = this.$wrap;
			const grid = this.grid;
			let selecting = false;
			let moved = false;
			let anchor = null;
			let resizing = null;
			let just_resized = false;
			let drag_f = null;
			const pos = (td) => ({ v: +td.parentElement.dataset.v, c: +td.dataset.c });

			grid.addEventListener("mousedown", (e) => {
				const rz = e.target.closest(".nxv-rz");
				if (rz) {
					e.preventDefault();
					e.stopPropagation();
					const ci = +rz.dataset.rz;
					resizing = { ci, x: e.clientX, w: this.cols[ci].width, col: grid.querySelectorAll("col")[ci] };
					return;
				}
				const td = e.target.closest("tbody td");
				if (!td || td.parentElement.classList.contains("nxv-sp") || e.target.closest("[data-tw], [data-g], a")) return;
				this.scroller.focus({ preventScroll: true });
				const p = pos(td);
				this.cur = p;
				if (!td.classList.contains("nxv-num")) {
					this.sel = null;
					return this.paint();
				}
				e.preventDefault();
				selecting = true;
				moved = false;
				anchor = td;
				this.sel = e.shiftKey && this.sel ? { a: this.sel.a, b: p } : { a: p, b: p };
				this.paint();
			});
			grid.addEventListener("mouseover", (e) => {
				if (!selecting || !this.sel) return;
				const td = e.target.closest("tbody td.nxv-num");
				if (!td) return;
				if (td !== anchor) moved = true;
				this.sel.b = pos(td);
				this.cur = this.sel.b;
				this.paint();
			});
			this.on_move = (e) => {
				if (!resizing) return;
				const width = Math.max(60, resizing.w + (frappe.utils.is_rtl() ? resizing.x - e.clientX : e.clientX - resizing.x));
				resizing.col.style.width = width + "px";
				this.cols[resizing.ci].width = width;
				grid.style.width = this.cols.reduce((s, c) => s + c.width, 0) + "px";
				if (this.fz && this.fz[resizing.ci]) {
					this.frozen_attrs();
					grid.querySelectorAll("th.nxv-fz, td.nxv-fz").forEach((cell) => {
						const a = this.fz[+(cell.dataset.c ?? cell.dataset.ci)];
						if (a) cell.style.insetInlineStart = a.off + "px";
					});
				}
			};
			this.on_up = (e) => {
				if (resizing) {
					const c = this.cols[resizing.ci];
					if (!c.delta) this.prefs.widths[c.twin || c.fieldname] = c.width;
					resizing = null;
					just_resized = true;
					setTimeout(() => (just_resized = false), 50);
					this.save();
					return;
				}
				if (!selecting) return;
				selecting = false;
				const td = e.target.closest && e.target.closest("tbody td.nxv-num");
				if (td && td === anchor && !moved && !e.shiftKey) {
					const p = pos(td);
					this.activate(p.v, p.c, td);
				}
			};
			document.addEventListener("mousemove", this.on_move);
			document.addEventListener("mouseup", this.on_up);

			grid.addEventListener("click", (e) => {
				const tw = e.target.closest("[data-tw]");
				if (tw) {
					const r = this.rows[+tw.dataset.tw];
					if (r.__nxkids && !this.state.query) {
						r.__nxopen = !r.__nxopen;
						this.refresh(true);
					}
					return;
				}
				const g = e.target.closest("[data-g]");
				if (g) return this.toggle_group(g.dataset.g);
				const fb = e.target.closest(".nxv-fbtn");
				if (fb) {
					e.stopPropagation();
					return this.open_filter(fb.dataset.f, fb.closest("th"));
				}
				const th = e.target.closest("th[data-ci]");
				if (th && !this.is_tree && !just_resized && !e.target.closest(".nxv-rz")) {
					const c = this.cols[+th.dataset.ci];
					const s = this.state.sorts[0];
					this.state.sorts = s && s.key === c.fieldname ? [{ key: c.fieldname, dir: -s.dir }] : [{ key: c.fieldname, dir: NUM.has(c.fieldtype) ? -1 : 1 }];
					this.refresh();
				}
			});
			grid.addEventListener("dblclick", (e) => {
				const tr = e.target.closest("tbody tr[data-v]");
				if (!tr || e.target.closest("td.nxv-num") || !this.is_tree || this.state.query) return;
				const r = this.view[+tr.dataset.v];
				if (r && r.__nxkids) {
					r.__nxopen = !r.__nxopen;
					this.refresh(true);
				}
			});

			// drag a header to move its column
			grid.addEventListener("dragstart", (e) => {
				const th = e.target.closest("th[draggable]");
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
				const th = e.target.closest("th[data-ci]");
				if (!th || !drag_f) return;
				e.preventDefault();
				grid.querySelectorAll("th.nxv-drop").forEach((x) => x.classList.remove("nxv-drop"));
				if (+th.dataset.ci > 0) th.classList.add("nxv-drop");
			});
			grid.addEventListener("drop", (e) => {
				const th = e.target.closest("th[data-ci]");
				if (!th || !drag_f) return;
				e.preventDefault();
				const target = this.cols[+th.dataset.ci];
				const target_f = target.twin || (target.delta ? null : target.fieldname);
				if (target_f && +th.dataset.ci > 0 && target_f !== drag_f && !target.calc) {
					const order = this.columns.slice(1).map((c) => c.fieldname);
					const current = (this.prefs.order || []).filter((f) => order.includes(f));
					order.forEach((f) => {
						if (!current.includes(f)) current.push(f);
					});
					const list = current.filter((f) => f !== drag_f);
					list.splice(list.indexOf(target_f), 0, drag_f);
					this.prefs.order = list;
					this.save();
					this.refresh(true);
				}
				drag_f = null;
			});
			grid.addEventListener("dragend", () => {
				drag_f = null;
				grid.querySelectorAll("th.nxv-drop").forEach((x) => x.classList.remove("nxv-drop"));
			});

			let ticking = false;
			this.scroller.addEventListener(
				"scroll",
				() => {
					this.$scroller.toggleClass("nxv-scrolled-x", this.scroller.scrollLeft !== 0);
					if (ticking) return;
					ticking = true;
					requestAnimationFrame(() => {
						ticking = false;
						this.render_body(false);
					});
				},
				{ passive: true }
			);
			this.scroller.addEventListener("keydown", (e) => this.on_key(e));

			// cards
			const $cards = w.find(".nxv-cards");
			$cards.on("click", (e) => {
				if (e.target.closest(".nxv-more")) {
					this.cards_shown += 40;
					return this.render_cards();
				}
				const g = e.target.closest("[data-g]");
				if (g) return this.toggle_group(g.dataset.g);
				const tw = e.target.closest("[data-tw]");
				if (tw) {
					const r = this.rows[+tw.dataset.tw];
					if (r && r.__nxkids && !this.state.query) {
						r.__nxopen = !r.__nxopen;
						this.refresh(true);
					}
					return;
				}
				const row = e.target.closest(".nxv-row[data-v]");
				if (!row) return;
				const v = +row.dataset.v;
				const r = v > -1 ? this.view[v] : this.foot()[0];
				if (r) this.open_sheet(r, v);
			});

			const $sheet = w.find(".nxv-sheet");
			$sheet.on("click", (e) => {
				if (e.target === $sheet[0] || e.target.closest(".nxv-sheet-close")) return $sheet.prop("hidden", true);
				const b = e.target.closest(".nxv-num[data-c]");
				if (!b || !this.sheet_row) return;
				const c = this.cols[+b.dataset.c];
				const { r, v } = this.sheet_row;
				if (this.review_mode && v > -1) {
					// the review box is placed on the figure first, then the sheet goes; the click must not
					// reach the page, where it would close the box at once
					e.stopPropagation();
					this.open_review(b, r, c);
					return $sheet.prop("hidden", true);
				}
				$sheet.prop("hidden", true);
				this.drill(r, c);
			});

			let qt;
			w.find(".nxv-search input").on("input", (e) => {
				clearTimeout(qt);
				qt = setTimeout(() => {
					this.state.query = e.target.value.trim().toLowerCase();
					this.refresh();
				}, 150);
			});
			w.find(".nxv-levels").on("click", "button", (e) => this.set_level(+e.currentTarget.dataset.l));
			w.find(".nxv-expand").on("click", "button", (e) => this.expand_all(e.currentTarget.dataset.x === "1"));
			w.find(".nxv-gb").on("change", (e) => {
				this.state.group_by = e.target.value;
				this.state.group_open = new Set();
				w.find(".nxv-expand").prop("hidden", !this.is_tree && !this.state.group_by);
				this.refresh();
			});
			w.find(".nxv-cmp-btn").on("click", () => this.open_compare());
			w.find(".nxv-rev-btn").on("click", (e) => {
				this.review_mode = !this.review_mode;
				e.currentTarget.setAttribute("aria-pressed", String(this.review_mode));
				w.toggleClass("nxv-reviewing", this.review_mode);
				this.status();
				this.render_vfilters();
			});
			const $views = w.find(".nxv-variant-menu");
			const $export = w.find(".nxv-export-menu");
			const menus = [$views, $export, w.find(".nxv-more-menu")];
			const $viewm = w.find(".nxv-view-menu");
			const $more = w.find(".nxv-more-menu");
			menus.push($viewm);
			const open_menu = ($m, fill) => {
				fill();
				menus.forEach(($o) => $o !== $m && $o.prop("hidden", true));
				$m.prop("hidden", !$m.prop("hidden"));
				this.fit_menu($m);
			};
			w.find(".nxv-export-btn").on("click", (e) => {
				e.stopPropagation();
				open_menu($export, () => this.fill_export_menu());
			});
			w.find(".nxv-view-btn").on("click", (e) => {
				e.stopPropagation();
				open_menu($viewm, () => this.fill_view_menu());
			});
			w.find(".nxv-more-btn").on("click", (e) => {
				e.stopPropagation();
				open_menu($more, () => this.fill_more_menu());
			});
			// one handler for the three classic menus: a line acts and closes the menu, a line with ▸ opens its side list
			[$export, $viewm, $more].forEach(($m) => {
				$m.on("click", (e) => {
					e.stopPropagation();
					const it = e.target.closest("[data-vm]");
					if (it) {
						$m.prop("hidden", true);
						return this.menu_action(it.dataset.vm, it.dataset.val);
					}
					const sub = e.target.closest(".nxv-has-sub");
					if (sub && !e.target.closest(".nxv-sub")) {
						$(sub).siblings(".nxv-has-sub").removeClass("open");
						this.fit_sub(sub);
						$(sub).toggleClass("open");
					}
				});
				$m.on("mouseenter", ".nxv-has-sub", (e) => {
					$(e.currentTarget).siblings(".nxv-has-sub").removeClass("open");
					this.fit_sub(e.currentTarget);
				});
			});
			const close_menus = (except) => menus.forEach(($m) => $m !== except && $m.prop("hidden", true));
			w.find(".nxv-variant-btn").on("click", (e) => {
				e.stopPropagation();
				this.fill_variant_menu();
				close_menus($views);
				$views.prop("hidden", !$views.prop("hidden"));
				this.fit_menu($views);
				if (!$views.prop("hidden")) $views.find(".nxv-var-search").trigger("focus");
			});
			$views.on("input", ".nxv-var-search", (e) => {
				this.variant_query = e.target.value;
				const pos = e.target.selectionStart;
				this.fill_variant_menu();
				const inp = $views.find(".nxv-var-search")[0];
				inp.focus();
				inp.setSelectionRange(pos, pos);
			});
			$views.on("click", "[data-var]", (e) => {
				const name = e.currentTarget.dataset.var;
				$views.prop("hidden", true);
				if (!name) return this.apply_view({}, null);
				const v = this.variants.find((x) => x.name === name);
				if (v) this.apply_view(this.parse_state(v), v);
			});
			$views.on("click", "[data-va]", (e) => {
				const a = e.currentTarget.dataset.va;
				$views.prop("hidden", true);
				if (a === "save") this.save_variant();
				if (a === "saveas") this.save_variant_as();
				if (a === "manage") this.manage_variants();
			});
			w.find(".nxv-settings-btn").on("click", () => this.open_settings("sort"));
			w.find(".nxv-addcols-btn").on("click", () => this.open_settings("columns"));

			grid.addEventListener("dblclick", (e) => {
				const rz = e.target.closest(".nxv-rz");
				if (rz) this.autofit(+rz.dataset.rz);
			});

			w.find(".nxv-cust-btn").on("click", () => (w.find(".nxv-cust").hasClass("open") ? this.close_drawers() : this.open_cust()));
			w.find(".nxv-ctabs").on("click", "button", (e) => {
				this.cust_tab = e.currentTarget.dataset.t;
				this.render_cust();
			});
			const $cb = w.find(".nxv-cust-body");
			$cb.on("change", "select, input", (e) => this.cust_change(e.target));
			$cb.on("click", "button", (e) => this.cust_click(e.currentTarget));
			w.find(".nxv-full-btn").on("click", () => this.toggle_full());
			w.find(".nxv-sec-hd").on("click", (e) => this.toggle_section(e.currentTarget.closest(".nxv-sec").dataset.sec));
			w.find(".nxv-frappe-btn").on("click", () => nexlify.report_view.use_frappe_view(this.qr, true));
			w.find(".nxv-close").on("click", () => this.close_drawers());
			w.find(".nxv-path").on("click", "button[data-k]", (e) => {
				const k = +e.currentTarget.dataset.k;
				if (k === 0) return this.close_drawers();
				this.stack.length = k + 1;
				this.draw_drill();
			});
			w.find(".nxv-drill .nxv-drawer-body").on("click", ".nxv-step", (e) => this.stack[this.stack.length - 1].click(e.currentTarget));
			w.find(".nxv-vfilters").on("click", "button", (e) => {
				const b = e.currentTarget;
				if (b.dataset.rmf) delete this.state.col_filters[b.dataset.rmf];
				if (b.dataset.rmcond !== undefined) this.state.conds.splice(+b.dataset.rmcond, 1);
				if (b.dataset.rmrev) return w.find(".nxv-rev-btn").trigger("click");
				if (b.dataset.rmg) {
					this.state.group_by = "";
					w.find(".nxv-gb").val("");
				}
				if (b.dataset.rmc) return this.open_compare();
				this.refresh();
			});
			const $status = w.find(".nxv-status");
			$status.on("click", ".nxv-chart-btn", () => {
				this.chart_on = !this.chart_on;
				this.status();
				this.draw_chart();
			});
			$status.on("click", ".nxv-tick-all", () => this.mark_selection());
			w.find(".nxv-chart").on("click", ".nxv-chart-close", () => {
				this.chart_on = false;
				this.status();
				this.draw_chart();
			});
			const $fp = w.find(".nxv-filter-pop");
			$fp.on("click", "[data-fa]", (e) => this.apply_filter(e.currentTarget.dataset.fa));
			const $rp = w.find(".nxv-review-pop");
			$rp.on("click", "[data-s]", (e) => {
				const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
				$rp.find("[data-s]").attr("aria-pressed", "false");
				e.currentTarget.setAttribute("aria-pressed", String(on));
			});
			$rp.on("click", "[data-ra]", (e) => this.review_action(e.currentTarget.dataset.ra));

			this.on_doc_click = (e) => {
				menus.forEach(($m) => {
					if ($m.length && !$m.prop("hidden") && !$m[0].contains(e.target)) $m.prop("hidden", true);
				});
				if (!$fp.prop("hidden") && !$fp[0].contains(e.target) && !e.target.closest(".nxv-fbtn")) $fp.prop("hidden", true);

				if (!$rp.prop("hidden") && !$rp[0].contains(e.target) && !e.target.closest("td.nxv-num, .nxv-sheet .nxv-num")) $rp.prop("hidden", true);
			};
			document.addEventListener("click", this.on_doc_click);
			this.on_resize = frappe.utils.debounce(() => this.fit_height(), 120);
			window.addEventListener("resize", this.on_resize);
			this.on_esc = (e) => {
				if (e.key !== "Escape" || this.$wrap.prop("hidden")) return;
				// Esc that closes one of Frappe's dialogs is that dialog's, not the view's
				if (document.querySelector(".modal.show")) return;
				if (!$sheet.prop("hidden")) return $sheet.prop("hidden", true);
				const open_menu = menus.find(($m) => $m.length && !$m.prop("hidden"));
				if (open_menu) return open_menu.prop("hidden", true);
				if (!$fp.prop("hidden")) return $fp.prop("hidden", true);
				if (!$rp.prop("hidden")) return $rp.prop("hidden", true);
				if (this.$wrap.find(".nxv-drawer.open").length) return this.close_drawers();
				if (this.$wrap.hasClass("nxv-full")) return this.toggle_full();
			};
			document.addEventListener("keydown", this.on_esc);
		}
	}

	// ------------------------------------------------------------------ on Frappe's report page, from the outside
	// Nothing of Frappe is changed. The view reads what the report page shows through its public
	// state (frappe.query_report: columns, data, filters) and notices a new run on the page itself:
	// Frappe redraws its own table (kept hidden) when the report runs, and shows a message instead
	// of rows while it runs or when there are none.

	// the view a report page shows now, or null when it shows Frappe's table
	nexlify.report_view.current = function (qr) {
		const v = qr && qr.__nxv;
		return v && v.report_name === qr.report_name && !v.$wrap.prop("hidden") ? v : null;
	};

	nexlify.report_view.use_frappe_view = function (qr, on) {
		const prefs = Object.assign({}, user_prefs(qr.report_name), { frappe_view: on ? 1 : 0 });
		save_prefs(qr.report_name, prefs);
		if (on) {
			frappe.show_alert({ message: __("This report now uses Frappe's table for you. Use the switch at the top to go back."), indicator: "blue" }, 6);
		}
		nexlify.report_view.update(qr, true);
		sync_header(qr);
		// Frappe's table was drawn while hidden: Frappe draws it again at its real size
		if (on && qr.datatable && qr.render_datatable) qr.render_datatable();
	};

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

	function wanted_for(qr) {
		return is_wanted(qr.report_name) && !uses_row_checkboxes(qr);
	}

	// Frappe does not load a query report's user settings by itself: read them once per report, before drawing
	const settings_loaded = new Set();
	nexlify.report_view.update = function (qr, force) {
		const name = qr.report_name;
		const c = config();
		const v = qr.__nxv;
		const $msg = qr.$message;
		const message_on = !!($msg && $msg.length && $msg.css("display") !== "none");
		sync_header(qr);
		// another report on the same page: the old one's rows never stay on screen while the new one loads
		if (v && v.report_name !== name && !v.$wrap.prop("hidden")) v.hide();
		// Frappe's "Loading..." screen: the same report runs again, so the view stays with its rows dimmed
		// and Frappe's screen keeps out of the way (the page does not jump); otherwise Frappe's screen shows
		const $ld = qr.$loading;
		if ($ld && $ld.length && $ld.css("display") !== "none") {
			const same = !!(v && v.report_name === name && !v.$wrap.prop("hidden"));
			$ld.toggleClass("nxv-hide", same);
			if (same) v.$wrap.addClass("nxv-loading");
			return;
		}
		if (message_on) {
			const text = $msg.text().trim();
			if (v && !text && v.report_name === name && !v.$wrap.prop("hidden")) {
				// the report runs again (a filter changed): the view stays with its filters, the old rows wait dimmed
				v.$wrap.addClass("nxv-loading");
			} else if (v) {
				// a message instead of rows: Frappe's page shows it, with the filters back in their place
				v.hide();
			}
			return;
		}
		if (v && v.report_name !== name) v.hide();
		if (!shows_rows(qr)) {
			if (v) v.hide();
			return;
		}
		if (!settings_loaded.has(name)) {
			if (c.enabled && !(c.excluded || []).includes(name)) qr.$report.addClass("nxv-hidden");
			frappe.model.user_settings
				.get(name)
				.then((saved) => {
					frappe.model.user_settings[name] = Object.assign({}, saved || {}, frappe.model.user_settings[name] || {});
				})
				.catch(() => {})
				.then(() => {
					settings_loaded.add(name);
					if (!wanted_for(qr)) {
						qr.$report.removeClass("nxv-hidden");
						if (qr.datatable && qr.render_datatable) qr.render_datatable();
						return;
					}
					nexlify.report_view.update(qr, true);
				})
				.catch((e) => fail(qr, e));
			return;
		}
		if (!wanted_for(qr)) {
			if (v) v.hide();
			return;
		}
		// Frappe has one report page for every report: a new report gets a new view
		if (!v || v.report_name !== qr.report_name || !document.body.contains(v.$wrap[0])) {
			if (v) v.destroy();
			qr.__nxv = null;
			remove_strays(qr);
			qr.__nxv = new ReportView(qr);
		}
		const view = qr.__nxv;
		// the same rows as last time: nothing to draw again
		if (!force && view.loaded_data === qr.data && view.loaded_cols === (qr.columns || []).length && !view.$wrap.prop("hidden")) {
			view.$wrap.removeClass("nxv-loading");
			return;
		}
		view.show();
		view.load();
		view.loaded_data = qr.data;
		view.loaded_cols = (qr.columns || []).length;
		// Frappe draws the summary and the chart of the run around the same time as its table
		setTimeout(() => qr.__nxv === view && view.sync_sections(), 300);
		sync_header(qr);
	};

	// Frappe's menu items that our own bar does better: hidden while the report shows in Nexlify View,
	// back in Frappe View. Only hidden, never removed or changed.
	const FRAPPE_COPIES = ["Print", "PDF", "Export", "Add Column", "Save"];

	// the page header: one switch between Nexlify View and Frappe View, next to Frappe's own buttons
	function sync_header(qr) {
		const page = qr && qr.page;
		if (!page || !page.page_actions || !page.page_actions.length) return;
		const c = config();
		const can = !!(c.enabled && !(c.excluded || []).includes(qr.report_name) && !uses_row_checkboxes(qr));
		let $sw = page.page_actions.find(".nxv-switch");
		if (!$sw.length && can) {
			$sw = $(`<div class="nxv-switch" role="group" aria-label="${__("Report view")}">
				<button type="button" data-nxsw="nexlify" title="${__("Nexlify View")}">Nexlify<span class="nxv-sw-x"> ${__("View")}</span></button>
				<button type="button" data-nxsw="frappe" title="${__("Frappe View")}">Frappe<span class="nxv-sw-x"> ${__("View")}</span></button>
			</div>`).prependTo(page.page_actions);
			$sw.on("click", "[data-nxsw]", (e) => {
				const q = frappe.query_report;
				const frappe_view = e.currentTarget.dataset.nxsw === "frappe";
				if (!q || !!user_prefs(q.report_name).frappe_view === frappe_view) return;
				nexlify.report_view.use_frappe_view(q, frappe_view);
			});
		}
		const nexlify_on = can && !user_prefs(qr.report_name).frappe_view;
		// Frappe's own items are hidden only while the view is really on screen: a report too big for it,
		// or one where the view failed, shows Frappe's table, and Frappe's items with it
		const view_shown = !!nexlify.report_view.current(qr);
		if ($sw.length) {
			$sw.prop("hidden", !can);
			$sw.find("[data-nxsw=nexlify]").attr("aria-pressed", String(nexlify_on));
			$sw.find("[data-nxsw=frappe]").attr("aria-pressed", String(!nexlify_on));
		}
		if (page.menu) {
			FRAPPE_COPIES.forEach((label) => {
				page.menu.find(`.menu-item-label[data-label="${encodeURIComponent(__(label))}"]`).closest("li").toggleClass("nxv-menu-hidden", view_shown);
			});
		}
	}

	// something broke: the report shows in Frappe's own table, and no half-built view stays on the page
	function fail(qr, e) {
		console.error("Nexlify Report View", e);
		nexlify.report_view.last_error = e && e.stack ? String(e.stack) : String(e);
		try {
			if (qr.__nxv) qr.__nxv.hide();
			remove_strays(qr);
			if (qr.$report) qr.$report.removeClass("nxv-hidden");
			if (qr.page && qr.page.main) qr.page.main.removeClass("nxv-on");
			sync_header(qr);
		} catch (e2) {
			console.error("Nexlify Report View", e2);
		}
	}

	// views on the page that are not the report's view now (one whose building failed half way)
	function remove_strays(qr) {
		if (!qr.page || !qr.page.main) return;
		const keep = qr.__nxv && qr.__nxv.$wrap[0];
		qr.page.main.find(".nxv").each((i, el) => {
			if (el !== keep) $(el).remove();
		});
	}

	const watched = new WeakSet();
	function watch(qr) {
		if (!qr || !qr.$report || !qr.$report.length || watched.has(qr)) return;
		watched.add(qr);
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
		// Frappe redraws its own table each time the report runs
		new MutationObserver(later).observe(qr.$report[0], { childList: true, subtree: true });
		// Frappe builds its ⋯ menu again on each load: the items the view replaces are hidden again
		if (qr.page && qr.page.menu && qr.page.menu.length) {
			let mt = null;
			new MutationObserver(() => {
				clearTimeout(mt);
				mt = setTimeout(() => sync_header(qr), 60);
			}).observe(qr.page.menu[0], { childList: true });
		}
		// ... shows its "Loading..." screen while a report loads ...
		if (qr.$loading && qr.$loading.length) {
			new MutationObserver(later).observe(qr.$loading[0], { attributes: true, attributeFilter: ["style"] });
		}
		// ... and shows a message while it runs, or instead of rows
		if (qr.$message && qr.$message.length) {
			new MutationObserver(later).observe(qr.$message[0], { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
		}
		later();
	}

	// the query report page Frappe has open now, once it is ready
	function on_route() {
		// early in a page's life Frappe may not know the route yet: no route is no report page
		const route = (frappe.get_route && frappe.get_route()) || [];
		const current = frappe.query_report;
		if (route[0] === "query-report" && current && current.__nxv && current.__nxv.report_name !== route[1]) current.__nxv.hide();
		if (route[0] !== "query-report") return;
		let tries = 0;
		const look = () => {
			const qr = frappe.query_report;
			if (qr && qr.report_name === route[1] && qr.$report && qr.$report.length) return watch(qr);
			if (++tries < 100) setTimeout(look, 100);
		};
		look();
	}

	if (config().enabled) {
		$(document).ready(() => {
			if (frappe.router && frappe.router.on) frappe.router.on("change", on_route);
			on_route();
		});
	}
})();
