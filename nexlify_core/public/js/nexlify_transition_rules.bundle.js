// Transition Rules in the desk. The server checks every save
// (nexlify_core.transition_rules.validate); the desk asks for the missing fields first:
// the form marks them required, and a Kanban drag or a List bulk edit opens a popup
// with only the fields that move still needs.
const API = "nexlify_core.transition_rules.";
const BULK = "frappe.desk.doctype.bulk_update.bulk_update.submit_cancel_or_update_docs";
const FORM_ONLY = new Set(["Table", "Dynamic Link"]); // Table MultiSelect (Lost Reasons…) fits in the popup
const infos = {}; // doctype -> { at, promise }, refreshed after a minute
const board_fields = {};
const pending = new Map(); // "doctype::name" -> { to, values }, read by the Kanban provider
const decisions = new WeakMap(); // move.cardIds -> one decision per drag

function stage_info(doctype) {
	const hit = infos[doctype];
	if (!hit || Date.now() - hit.at > 60000) {
		const promise = frappe.xcall(API + "get_stage_fields", { doctype }).catch(() => ({}));
		infos[doctype] = { at: Date.now(), promise };
	}
	return infos[doctype].promise;
}

async function has_rules(doctype, field) {
	return ((await stage_info(doctype)).stage_fields || []).includes(field);
}

// ---------- the popup (Kanban + List) ----------

// Asks for what `names` need before `field` becomes `to`. Resolves to
// { name: { fieldname: value } }, "form" (open the full form) or null (cancelled).
async function ask_for_move(doctype, names, field, to, allow_form = true) {
	let check = await frappe.xcall(API + "check_move", { doctype, names, field, to });
	const needed = () => new Set(Object.values(check.docs || {}).flat());
	if (!needed().size) return {};

	const single = names.length === 1;
	// read-only fields are set by the server too (ERPNext's Lost Reasons are read-only);
	// only a fetched field has to come from the form
	const form_only = (f) => FORM_ONLY.has(check.fields[f].fieldtype) || check.fields[f].fetch_from;
	if (check.candidates.some(form_only)) {
		if (single && allow_form) return "form";
		frappe.msgprint(__("Some required fields can only be filled in the form. Move these one at a time."));
		return null;
	}
	// a Table MultiSelect in a dialog needs its child DocType loaded
	await Promise.all(
		check.candidates
			.filter((f) => check.fields[f].fieldtype === "Table MultiSelect")
			.map((f) => frappe.model.with_doctype(check.fields[f].options))
	);

	return new Promise((resolve) => {
		let done = false;
		const finish = (v) => {
			if (done) return;
			done = true;
			resolve(v);
		};
		const show_needed = () => {
			const need = needed();
			for (const f of check.candidates) {
				dialog.set_df_property(f, "hidden", need.has(f) ? 0 : 1);
				dialog.set_df_property(f, "reqd", need.has(f) ? 1 : 0);
			}
		};
		// conditions can read what was just typed, so dependent fields appear or hide
		const recheck = async () => {
			const values = dialog.get_values(true) || {};
			const r = await frappe.xcall(API + "check_move", { doctype, names, field, to, values });
			check = { ...check, docs: r.docs };
			show_needed();
			return values;
		};

		const dialog = new frappe.ui.Dialog({
			title: single
				? __("Move {0} to {1}", [check.titles[names[0]] || names[0], __(to)])
				: __("Move {0} records to {1}", [names.length, __(to)]),
			fields: check.candidates.map((f) => {
				const { label, fieldtype, options, description } = check.fields[f];
				return { fieldname: f, label, fieldtype, options, description, onchange: recheck };
			}),
			primary_action_label: __("Save & Move"),
			async primary_action() {
				const values = await recheck();
				if (!dialog.get_values()) return; // a field that just became required is empty
				const out = {};
				for (const name of names) {
					out[name] = Object.fromEntries((check.docs[name] || []).map((f) => [f, values[f]]));
				}
				finish(out);
				dialog.hide();
			},
			secondary_action_label: single && allow_form ? __("Open Form") : null,
			secondary_action:
				single && allow_form
					? () => {
							finish("form");
							dialog.hide();
					  }
					: null,
			onhide: () => finish(null),
		});
		show_needed();
		dialog.show();
		if (!single) dialog.set_message(__("Values go only to records where the field is empty."));
	});
}

// "Open Form": the real form with the new stage set, so every Client Script runs.
function open_form(doctype, name, field, to) {
	const back = frappe.get_route();
	frappe.route_hooks.after_load = (frm) => {
		if (frm.doctype !== doctype || frm.docname !== name) return;
		frm.set_value(field, to);
		frappe.route_hooks.after_save = (f) => {
			if (f.doctype === doctype && f.docname === name) frappe.set_route(back);
		};
	};
	frappe.set_route("Form", doctype, name);
}

// ---------- Kanban v2 ----------

const _init_doctype = frappe.model.init_doctype;
frappe.model.init_doctype = function (meta) {
	const out = _init_doctype.apply(this, arguments);
	try {
		attach_kanban(meta);
	} catch (e) {
		console.error(e);
	}
	return out;
};
Object.values(window.locals?.DocType || {}).forEach(attach_kanban);
frappe.router?.on?.("change", () => {
	const r = frappe.get_route();
	if (r[0] === "List") attach_kanban(window.locals?.DocType?.[r[1]]);
});

function attach_kanban(meta) {
	if (!meta || meta.istable || meta.issingle || !frappe.kanban_v2?.extend_settings) return;
	if (frappe.kanban_v2.settings[meta.name]?.__nx_rules) return;
	frappe.kanban_v2.extend_settings(meta.name, (base) => {
		const prev = base.callbacks.onBeforeCardMove;
		const onBeforeCardMove = async (move) => {
			if (prev && (await prev(move)) === false) return false;
			const ids = move.cardIds || [move.cardId];
			if (!decisions.has(ids)) {
				const decision = before_move(meta.name, ids, move.toColumn).catch((e) => {
					console.error(e);
					return false;
				});
				decisions.set(ids, decision);
			}
			return decisions.get(ids);
		};
		return { ...base, __nx_rules: true, callbacks: { ...base.callbacks, onBeforeCardMove } };
	});
}

// resolves false to cancel the drag
async function before_move(doctype, ids, to) {
	ids.forEach((id) => pending.delete(`${doctype}::${id}`));
	const field = await board_field();
	if (!field || !(await has_rules(doctype, field))) return;
	const answer = await ask_for_move(doctype, ids, field, to);
	if (answer === "form") open_form(doctype, ids[0], field, to);
	if (!answer || answer === "form") return false;
	for (const [id, values] of Object.entries(answer)) {
		if (Object.keys(values).length) pending.set(`${doctype}::${id}`, { to, values });
	}
	patch_provider();
}

function board_field() {
	const board = frappe.get_route()[3];
	if (board && !board_fields[board]) {
		const args = { doctype: "Kanban Board", filters: board, fieldname: "field_name" };
		board_fields[board] = frappe.xcall("frappe.client.get_value", args).then((r) => r?.field_name);
	}
	return board_fields[board] || null;
}

// the popup values are saved in the same request as the move: one save per document
function patch_provider() {
	const P = frappe.kanban_v2?.FrappeDataProvider?.prototype;
	if (!P || P.__nx_rules) return;
	P.__nx_rules = true;
	const { moveCard, moveCards } = P;

	P.moveCard = async function (input) {
		const { doctype, field_name } = this.config;
		const values = take(doctype, input.cardId, input.toColumn);
		if (!values) return moveCard.apply(this, arguments);
		const r = await frappe.xcall(API + "move", {
			doctype,
			names: [input.cardId],
			field: field_name,
			to: input.toColumn,
			values: { [input.cardId]: values },
		});
		return r.saved[input.cardId];
	};

	P.moveCards = async function (ids, to) {
		const { doctype, field_name } = this.config;
		const values = {};
		for (const id of ids) {
			const v = take(doctype, id, to);
			if (v) values[id] = v;
		}
		if (!Object.keys(values).length) return moveCards.apply(this, arguments);
		const r = await frappe.xcall(API + "move", { doctype, names: ids, field: field_name, to, values });
		if (r.failed.length) show_failed(r.failed);
		return { failed: r.failed.map((f) => f.name), saved: r.saved };
	};
}

function take(doctype, id, to) {
	const key = `${doctype}::${id}`;
	const p = pending.get(key);
	pending.delete(key);
	return p && p.to === to ? p.values : null;
}

function show_failed(failed) {
	const esc = frappe.utils.escape_html;
	frappe.msgprint({
		title: __("Not moved"),
		indicator: "orange",
		message: failed.map((f) => `<b>${esc(f.name)}</b>: ${esc(f.error)}`).join("<br>"),
	});
}

// ---------- List view: bulk Edit of a stage field ----------

const _call = frappe.call;
frappe.call = function (opts) {
	const args = opts && typeof opts === "object" && opts.method === BULK ? opts.args : null;
	const data = args && args.action === "update" && typeof args.data === "object" ? args.data : null;
	const keys = data ? Object.keys(data) : [];
	if (keys.length !== 1 || keys[0] === "child_table_updates") return _call.apply(this, arguments);
	return bulk_edit(opts, keys[0], data[keys[0]]);
};

function bulk_edit(opts, field, to) {
	const { doctype, docnames } = opts.args;
	const d = $.Deferred();
	const pass = () => _call(opts).then(d.resolve, d.reject);
	const reopen = () => window.cur_dialog?.enable_primary_action?.(); // the Bulk Edit dialog
	(async () => {
		if (to == null || to === "" || !(await has_rules(doctype, field))) return pass();
		const answer = await ask_for_move(doctype, docnames, field, to, false);
		if (answer === null) return reopen();
		if (!Object.values(answer).some((v) => Object.keys(v).length)) return pass();
		const r = await frappe.xcall(API + "move", { doctype, names: docnames, field, to, values: answer }, "POST", {
			freeze: true,
		});
		// Bulk Edit lists these as "Cannot update …", so each carries its reason
		d.resolve({ message: r.failed.map((f) => `${f.name}: ${f.error}`) });
	})().catch(reopen);
	return d.promise();
}

// ---------- Form: mark the fields the current move needs ----------

const hooked = new Set();
$(document).on("form-refresh", (e, frm) => form_rules(frm));

async function form_rules(frm) {
	if (!frm?.doctype || frm.meta?.istable || frm.meta?.issingle) return;
	const info = await stage_info(frm.doctype);
	if (!info.stage_fields?.length) return;
	if (!hooked.has(frm.doctype)) {
		hooked.add(frm.doctype);
		const handlers = {};
		for (const f of [...info.stage_fields, ...(info.watch || [])]) handlers[f] = mark_required;
		frappe.ui.form.on(frm.doctype, handlers);
	}
	mark_required(frm);
}

async function mark_required(frm) {
	const need = await frappe.xcall(API + "required_in_form", { doc: frm.doc });
	const meta_reqd = (f) => frappe.get_meta(frm.doctype).fields.find((df) => df.fieldname === f)?.reqd;
	for (const f of frm.__nx_reqd || []) {
		if (!need.includes(f) && !meta_reqd(f)) frm.toggle_reqd(f, false);
	}
	need.forEach((f) => frm.toggle_reqd(f, true));
	frm.__nx_reqd = need;
}
