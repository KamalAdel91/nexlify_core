// Link fields as buttons (Nexlify Core Settings > Link Fields, off until ticked), the way Frappe's dimension
// filters (Project, Client...) work: the field is a button that shows its value, and a click on it opens a panel
// with a search box on top and the choices under it, the field's value marked. A click on a row picks it and
// closes the panel; a click outside or Esc closes it and keeps the value. One value, as before.
// The rows are Frappe's own: the same search (the field's filters and queries), then the filter note,
// "Create a new ..." and "Advanced Search". Autocomplete fields (a fixed list, as Party Type in General Ledger) work
// the same way, their rows being their own list. Table MultiSelect and MultiSelect keep their own behaviour, and so
// does an Autocomplete that asks the server for its list while it is typed in.
(() => {
	const FIELDTYPES = ["Link", "Dynamic Link"];
	const Link = frappe.ui.form.ControlLink;
	const Autocomplete = frappe.ui.form.ControlAutocomplete;
	if (!Link) return;

	const is_on = () => Boolean(frappe.boot && frappe.boot.nexlify_link_list_on_click);
	const esc = (text) => frappe.utils.escape_html(text == null ? "" : String(text));
	let open_panel = null;

	class LinkPanel {
		constructor(control) {
			this.control = control;
			this.rows = [];
			this.highlighted = -1;
			this.$wrapper = $(`
				<div class="multiselect-list dropdown nxl-link-panel">
					<ul class="dropdown-menu show">
						<li class="dropdown-input-wrapper">
							<input type="text" class="form-control input-xs" placeholder="${__("Search")}">
						</li>
						<div class="selectable-items"></div>
						<div class="nxl-link-actions"></div>
						<li class="nxl-link-clear-row">
							<button class="btn btn-primary btn-xs nxl-link-clear">${__("Clear")}</button>
						</li>
					</ul>
				</div>`).appendTo(document.body);
			this.$search = this.$wrapper.find("input");
			this.bind();
		}

		bind() {
			// clicks in the panel keep the search box's focus
			this.$wrapper.on("mousedown", ".selectable-item, .nxl-link-action, .nxl-link-clear", (e) => e.preventDefault());
			// the field's value goes, as erasing the text did before: a filter is removed, a field emptied
			this.$wrapper.on("click", ".nxl-link-clear", () => {
				const control = this.control;
				this.close();
				clear_value(control);
			});
			this.$wrapper.find(".nxl-link-clear-row").toggle(Boolean(this.control.get_value()));
			this.$wrapper.on("click", ".selectable-item", (e) => this.pick(Number(e.currentTarget.dataset.index)));
			this.$wrapper.on("click", ".nxl-link-action", (e) => this.run_action(Number(e.currentTarget.dataset.index)));
			this.$search.on("input", frappe.utils.debounce(() => this.load(), 300));
			this.$search.on("keydown", (e) => this.on_key(e));
			this.on_outside = (e) => {
				if (!this.$wrapper[0].contains(e.target) && !this.control.$input[0].contains(e.target)) this.close();
			};
			document.addEventListener("mousedown", this.on_outside, true);
		}

		open() {
			if (open_panel && open_panel !== this) open_panel.close();
			open_panel = this;
			// the panel sits on the page, not in the field: a table cell or a filter bar would cut it off
			this.on_move = () => {
				if (this.move_frame) return;
				this.move_frame = requestAnimationFrame(() => {
					this.move_frame = null;
					this.place();
				});
			};
			window.addEventListener("scroll", this.on_move, true);
			window.addEventListener("resize", this.on_move);
			this.place();
			this.load();
			this.$search.trigger("focus");
		}

		close() {
			document.removeEventListener("mousedown", this.on_outside, true);
			window.removeEventListener("scroll", this.on_move, true);
			window.removeEventListener("resize", this.on_move);
			if (this.move_frame) cancelAnimationFrame(this.move_frame);
			this.$wrapper.remove();
			if (open_panel === this) open_panel = null;
			this.control.nxl_panel = null;
			this.control.nxl_closed_at = Date.now();
		}

		// under the field, as wide as it (at least 300px); above it when there is no room under it; inside the screen
		place() {
			const input = this.control.$input[0];
			if (!document.body.contains(input) || !input.offsetParent) return this.close();
			const box = input.getBoundingClientRect();
			const wrapper = this.$wrapper[0];
			const screen_width = document.documentElement.clientWidth;
			const screen_height = window.innerHeight;
			const width = Math.min(Math.max(box.width, 300), screen_width - 16);
			wrapper.style.width = `${width}px`;
			const height = wrapper.offsetHeight;
			let top = box.bottom + 4;
			if (top + height > screen_height - 8 && box.top - height - 4 > 8) top = box.top - height - 4;
			const left = Math.max(8, Math.min(box.left, screen_width - width - 8));
			wrapper.style.top = `${top}px`;
			wrapper.style.left = `${left}px`;
		}

		// Frappe's own search for the field, with what is typed in the panel
		load() {
			const control = this.control;
			const txt = this.$search.val() || "";
			if (control.nxl_kind === "autocomplete") return this.load_list(txt);
			const args = control.get_search_args(txt);
			if (!args) return;
			const filters = args.filters;
			const doctype = args.doctype;
			const ask = (this.asked = {});
			frappe.call({
				method: "frappe.desk.search.search_link",
				type: "POST",
				no_spinner: true,
				args,
				callback: async (r) => {
					if (ask !== this.asked || open_panel !== this) return;
					const rows = control.merge_duplicates(r.message || []);
					const note = control.df.filter_description
						? control.df.filter_description
						: filters
						? await control.get_filter_description(filters)
						: null;
					if (ask !== this.asked || open_panel !== this) return;
					this.render(this.with_value_first(rows, txt), note, this.actions(doctype));
				},
			});
		}

		// an Autocomplete's own list, matched on what is typed as Frappe matches it (label, description, value)
		load_list(txt) {
			const needle = txt.toLowerCase();
			const rows = (this.control.get_data() || [])
				.map((item) => (typeof item === "object" ? item : { value: item, label: item }))
				.filter((row) => {
					const hay = `${row.label || ""} ${row.description || ""} ${row.value || ""}`.toLowerCase();
					return !needle || hay.includes(needle);
				});
			this.render(this.with_value_first(rows, txt), null, []);
		}

		// the field's value first and marked, as the dimension filters show theirs
		with_value_first(rows, txt) {
			const value = this.control.get_value();
			if (!value || txt) return rows;
			const others = rows.filter((row) => row.value !== value);
			const own = rows.find((row) => row.value === value) || {
				value,
				label: this.control.get_label_value ? this.control.get_label_value() : value,
			};
			return [own, ...others];
		}

		// "Create a new ...", the app's own link options, "Advanced Search": as in Frappe's list
		actions(doctype) {
			const control = this.control;
			const list = [];
			if (control.df.only_select) return list;
			if (frappe.model.can_create(doctype)) {
				list.push({ icon: "plus", label: __("Create a new {0}", [__(control.get_options())]), action: control.new_doc });
			}
			const custom = Link.link_options && Link.link_options(control);
			(custom || []).forEach((item) => list.push({ html: item.html, label: item.label, action: item.action }));
			if (window.locals && locals["DocType"]) {
				list.push({ icon: "search", label: __("Advanced Search"), action: control.open_advanced_search });
			}
			return list;
		}

		render(rows, note, actions) {
			const control = this.control;
			const value = control.get_value();
			this.rows = rows;
			this.action_list = actions;
			this.highlighted = -1;
			let html = rows
				.map((row, index) => {
					const text = row.label || row.value;
					const label = control.get_translated
						? control.get_translated(text)
						: control.translate_values
						? __(text)
						: text;
					const show_description =
						row.description &&
						(control.is_title_link ? control.is_title_link() || row.description !== row.value : true);
					const description = show_description
						? `<div class="small">${esc(__(frappe.utils.html2text(row.description)))}</div>`
						: "";
					const selected = row.value === value ? "selected" : "";
					return `<li class="selectable-item ${selected}" data-index="${index}">
						<div><strong>${esc(label)}</strong>${description}</div>
						<div class="multiselect-check">${frappe.utils.icon("check", "xs")}</div>
					</li>`;
				})
				.join("");
			if (!html) html = `<li class="text-muted">${__("No values to show")}</li>`;
			this.$wrapper.find(".selectable-items").html(html);

			let foot = note ? `<li class="nxl-link-note text-muted small">${note}</li>` : "";
			foot += actions
				.map((item, index) => {
					const body = item.html || `${frappe.utils.icon(item.icon, "sm")} <span>${esc(item.label)}</span>`;
					return `<li class="nxl-link-action" data-index="${index}">${body}</li>`;
				})
				.join("");
			this.$wrapper.find(".nxl-link-actions").html(foot);
			this.place();
		}

		pick(index) {
			const row = this.rows[index];
			if (!row) return;
			const control = this.control;
			this.close();
			control.set_value(row.value, row.label);
		}

		run_action(index) {
			const item = this.action_list[index];
			if (!item) return;
			const control = this.control;
			this.close();
			item.action.apply(control);
		}

		on_key(e) {
			const $items = this.$wrapper.find(".selectable-item");
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : -1;
				this.highlighted = Math.max(0, Math.min($items.length - 1, this.highlighted + step));
				$items.removeClass("highlighted");
				const item = $items.eq(this.highlighted).addClass("highlighted")[0];
				item && item.scrollIntoView({ block: "nearest" });
			} else if (e.key === "Enter") {
				e.preventDefault();
				this.pick(this.highlighted > -1 ? this.highlighted : 0);
			} else if (e.key === "Escape" || e.key === "Tab") {
				if (e.key === "Escape") e.stopPropagation();
				this.close();
			}
		}
	}

	function clear_value(control) {
		if (control.get_value()) control.set_value("");
	}

	function toggle_panel(control) {
		if (control.nxl_panel) return control.nxl_panel.close();
		control.nxl_panel = new LinkPanel(control);
		control.nxl_panel.open();
	}

	const make_input = Link.prototype.make_input;
	Link.prototype.make_input = function (...args) {
		make_input.apply(this, args);
		if (!is_on() || !FIELDTYPES.includes(this.df.fieldtype)) return;
		// Frappe's own list stays shut
		this.on_input = () => {};
		make_button(this);
	};

	if (Autocomplete) {
		const make_autocomplete_input = Autocomplete.prototype.make_input;
		Autocomplete.prototype.make_input = function (...args) {
			make_autocomplete_input.apply(this, args);
			if (!is_on() || this.df.fieldtype !== "Autocomplete") return;
			if (this.get_query || this.df.get_query) return;
			this.nxl_kind = "autocomplete";
			// Frappe's own list stays shut: it never reaches enough typed characters to open
			this.awesomplete.minChars = Infinity;
			make_button(this);
		};
	}

	// the field is a button: no typing in it, no caret, a pointer; a click or a key opens the panel
	function make_button(control) {
		// Link keeps its input area as jQuery; Autocomplete has only the element
		if (!control.$input_area) control.$input_area = $(control.input_area);
		control.$input.attr("readonly", true).addClass("nxl-link-button");
		control.$input_area.addClass("nxl-link-area");
		control.$input.on("mousedown", (e) => {
			e.preventDefault();
			toggle_panel(control);
		});
		// in a child table the first click turns the row into inputs and focuses this one: the panel opens then
		control.$input.on("focus", () => {
			const in_table = control.$input.closest(".grid-row").length > 0;
			const just_closed = Date.now() - (control.nxl_closed_at || 0) < 400;
			if (in_table && !control.nxl_panel && !just_closed) toggle_panel(control);
		});
		// reached with Tab: the panel opens, as the dimension filters do
		control.$input.on("keydown", (e) => {
			if (["Backspace", "Delete"].includes(e.key)) {
				e.preventDefault();
				clear_value(control);
			} else if (["Enter", " ", "ArrowDown"].includes(e.key) && !control.nxl_panel) {
				e.preventDefault();
				toggle_panel(control);
			}
		});
		add_clear_x(control);
	}

	// an x in the field while the mouse is on it and it has a value: a click on it empties the field. Forms keep
	// Frappe's own buttons (x and open), with the x shown and emptying at once; filters, which have none, get one.
	function add_clear_x(control) {
		const $frappe_clear = control.$input_area.find(".link-btn .btn-clear");
		if ($frappe_clear.length) {
			control.is_clear_button_enabled = () => true;
			// Frappe empties the text first, so the value is set without asking the text
			$frappe_clear.on("click", () => control.set_value(""));
			return;
		}
		const $x = $(`<a class="nxl-link-x" title="${__("Clear")}">${frappe.utils.icon("x", "xs")}</a>`)
			.hide()
			.appendTo(control.$input.parent());
		control.$input_area.on("mouseenter", () => $x.toggle(Boolean(control.$input.val())));
		control.$input_area.on("mouseleave", () => $x.hide());
		$x.on("mousedown", (e) => e.preventDefault());
		$x.on("click", (e) => {
			e.stopPropagation();
			$x.hide();
			if (control.nxl_panel) control.nxl_panel.close();
			clear_value(control);
		});
	}

	$("<style>")
		.text(
			`.nxl-link-area { position: relative; }
			.nxl-link-button { cursor: pointer !important; caret-color: transparent; user-select: none; }
			.nxl-link-button::selection { background: transparent; }
			.nxl-link-x { position: absolute; top: 3px; bottom: 3px; right: 4px; z-index: 3; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; border-radius: var(--border-radius-sm, 6px); cursor: pointer; color: var(--text-muted); background-color: var(--control-bg); box-shadow: -8px 0 6px -2px var(--control-bg); }
			.nxl-link-x:hover { color: var(--error-color); }
			.nxl-link-panel { position: fixed; top: 0; left: 0; z-index: 1060; }
			.nxl-link-panel .dropdown-menu { position: static; display: block; margin: 0; width: 100%; min-width: 0; }
			.nxl-link-panel .nxl-link-note { cursor: default; white-space: normal; }
			.nxl-link-panel .nxl-link-action { cursor: pointer; display: flex; align-items: center; justify-content: flex-start; gap: 6px; white-space: normal; }
			.nxl-link-panel .nxl-link-action .icon { margin: 0 !important; flex: none; }
			.nxl-link-panel .nxl-link-action:hover { background-color: var(--fg-hover-color); }
			.nxl-link-panel .nxl-link-clear-row { display: flex; justify-content: flex-end; }
			.nxl-link-panel .nxl-link-actions:not(:empty) { border-top: 1px solid var(--border-color); }`
		)
		.appendTo(document.head);
})();
