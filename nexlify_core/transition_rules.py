"""Transition Rules: the fields a document needs before its stage field moves to a value.

The rule is checked on every save (doc_events "*" validate), so Kanban drags, List bulk
edits, the API, Data Import and scripts all obey it. The desk asks the same functions
which fields to show in its popup, so the popup and the server never disagree.
"""

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, strip_html

CACHE_KEY = "nexlify_transition_rules"


class TransitionRuleError(frappe.ValidationError):
	pass


def clear_cache():
	frappe.cache.delete_value(CACHE_KEY)


def get_rules(doctype):
	"""Enabled rules of a DocType, cached until a rule changes."""
	return (frappe.cache.get_value(CACHE_KEY, generator=_load_rules) or {}).get(doctype, [])


def _load_rules():
	if not frappe.db.table_exists("Transition Rule"):
		return {}
	rows = frappe.get_all(
		"Transition Rule Field",
		filters={"parenttype": "Transition Rule"},
		fields=["parent", "fieldname", "condition"],
		order_by="idx asc",
	)
	fields = {}
	for row in rows:
		fields.setdefault(row.parent, []).append(
			frappe._dict(fieldname=row.fieldname, condition=(row.condition or "").strip())
		)
	out = {}
	for rule in frappe.get_all(
		"Transition Rule",
		filters={"enabled": 1},
		fields=["name", "reference_doctype", "stage_field", "from_value", "to_value", "message", "bypass_role", "open_form"],
	):
		rule.fields = fields.get(rule.name, [])
		out.setdefault(rule.reference_doctype, []).append(rule)
	return out


def applicable_rules(rules, field, old, new):
	"""Rules that fire when `field` changes from `old` to `new` (old is None for a new document)."""
	out, roles = [], None
	for rule in rules:
		if rule.stage_field != field or cstr(new) != cstr(rule.to_value) or cstr(old) == cstr(new):
			continue
		if rule.from_value and cstr(old) != cstr(rule.from_value):
			continue
		if rule.bypass_role:
			roles = roles or set(frappe.get_roles())
			if rule.bypass_role in roles:
				continue
		out.append(rule)
	return out


def is_empty(value, df=None):
	if df and df.fieldtype in ("Check", "Int", "Float", "Currency", "Percent"):
		return not flt(value)
	if isinstance(value, list | tuple):
		return not value
	text = cstr(value)
	return not strip_html(text).strip() and "<img" not in text


def condition_met(condition, data):
	if not condition:
		return True
	try:
		return bool(frappe.safe_eval(condition, None, {"doc": data}))
	except Exception:
		return False


def missing_fields(doc, rules, data, meta):
	"""Fields `doc` lacks for `rules`; conditions read `data` (the doc after the move)."""
	out = []
	for rule in rules:
		for f in rule.fields:
			if f.fieldname in out or not is_empty(doc.get(f.fieldname), meta.get_field(f.fieldname)):
				continue
			if condition_met(f.condition, data):
				out.append(f.fieldname)
	return out


def validate(doc, method=None):
	"""doc_events "*" validate: block a move that lacks the rule's fields."""
	if (
		frappe.flags.in_install
		or frappe.flags.in_migrate
		or frappe.flags.in_patch
		or frappe.flags.ignore_transition_rules
		or doc.flags.ignore_transition_rules
	):
		return
	rules = get_rules(doc.doctype)
	if not rules:
		return
	before = doc.get_doc_before_save()
	data = None
	for field in {r.stage_field for r in rules}:
		active = applicable_rules(rules, field, before.get(field) if before else None, doc.get(field))
		if not active:
			continue
		data = data or frappe._dict(doc.as_dict())
		missing = missing_fields(doc, active, data, doc.meta)
		if not missing:
			continue
		stage = _(cstr(doc.get(field)))
		labels = ", ".join(frappe.bold(_(doc.meta.get_label(f))) for f in missing)
		message = next((r.message for r in active if r.message), "")
		frappe.throw(
			(f"{message}<br><br>" if message else "")
			+ _("Fill {0} before moving to {1}.").format(labels, frappe.bold(stage)),
			TransitionRuleError,
			title=_("Required for {0}").format(stage),
		)


# ---------- what the desk asks ----------


@frappe.whitelist()
def get_stage_fields(doctype: str):
	"""Fields that have rules, and the fields their conditions read (so the form can re-check)."""
	if not frappe.has_permission(doctype, "read"):
		return {}
	rules = get_rules(doctype)
	watch = set()
	for rule in rules:
		for f in rule.fields:
			watch.update(re.findall(r"\bdoc\.(\w+)", f.condition))
			watch.update(re.findall(r"""\bdoc\.get\(\s*["'](\w+)["']""", f.condition))
	return {"stage_fields": sorted({r.stage_field for r in rules}), "watch": sorted(watch - {"get"})}


@frappe.whitelist()
def check_move(doctype: str, names, field: str, to: str, values=None):
	"""For the Kanban and List popup: which fields each document needs before `field` can be `to`.
	`values` are what the user typed so far; conditions see them, so dependent fields appear."""
	names = frappe.parse_json(names) or []
	values = frappe.parse_json(values) or {}
	rules = [r for r in get_rules(doctype) if r.stage_field == field]
	if not rules:
		return {"docs": {}, "open_form": False}
	meta = frappe.get_meta(doctype)
	docs, titles, candidates = {}, {}, []
	open_form = False
	for name in names:
		doc = frappe.get_doc(doctype, name)
		doc.check_permission("read")
		active = applicable_rules(rules, field, doc.get(field), to)
		docs[name] = []
		if not active:
			continue
		open_form = open_form or any(cint(r.get("open_form")) for r in active)
		data = frappe._dict(doc.as_dict())
		for key, value in values.items():
			if meta.get_field(key) and is_empty(data.get(key), meta.get_field(key)):
				data[key] = value
		data[field] = to
		docs[name] = missing_fields(doc, active, data, meta)
		titles[name] = doc.get_title()
		for rule in active:
			for f in rule.fields:
				if f.fieldname not in candidates and is_empty(doc.get(f.fieldname), meta.get_field(f.fieldname)):
					candidates.append(f.fieldname)
	return {
		"open_form": open_form,
		"docs": docs,
		"titles": titles,
		"candidates": candidates,
		"fields": {f: _field_info(meta, f) for f in candidates},
	}


def _field_info(meta, fieldname):
	df = meta.get_field(fieldname)
	if not df:
		return {"fieldname": fieldname, "label": fieldname, "fieldtype": "Data"}
	return {
		"fieldname": df.fieldname,
		"label": _(df.label),
		"fieldtype": df.fieldtype,
		"options": df.options,
		"description": _(df.description) if df.description else None,
		"read_only": cint(df.read_only),
		"fetch_from": df.fetch_from,
	}


@frappe.whitelist(methods=["POST"])
def move(doctype: str, names, field: str, to: str, values=None):
	"""Move documents to `to`, each saved once together with its popup values.
	One document: errors are raised. Several: failures are returned with their reason."""
	names = frappe.parse_json(names) or []
	values = frappe.parse_json(values) or {}
	meta = frappe.get_meta(doctype)
	if not meta.get_field(field):
		frappe.throw(_("{0} has no field {1}").format(_(doctype), field))
	saved, failed = {}, []
	for name in names:
		extra = {k: v for k, v in (values.get(name) or {}).items() if meta.get_field(k)}
		log_size = len(frappe.local.message_log)
		frappe.db.savepoint("nx_move")
		try:
			doc = frappe.get_doc(doctype, name)
			doc.update(extra)
			doc.set(field, to)
			doc.save()
			saved[name] = doc.get(field)
		except Exception as e:
			if len(names) == 1:
				raise
			frappe.db.rollback(save_point="nx_move")
			del frappe.local.message_log[log_size:]
			failed.append({"name": name, "error": strip_html(cstr(e)).strip() or _("Could not save")})
	return {"saved": saved, "failed": failed}


@frappe.whitelist()
def required_in_form(doc):
	"""For the open form: fields the rules require now, given the move from the saved stage."""
	data = frappe._dict(frappe.parse_json(doc) or {})
	doctype = data.get("doctype")
	if not doctype or not frappe.has_permission(doctype, "read"):
		return []
	rules = get_rules(doctype)
	if not rules:
		return []
	stage_fields = list({r.stage_field for r in rules})
	saved = {}
	if data.get("name") and not data.get("__islocal"):
		if not frappe.has_permission(doctype, "read", data.name):
			return []
		saved = frappe.db.get_value(doctype, data.name, stage_fields, as_dict=True) or {}
	out = []
	for field in stage_fields:
		for rule in applicable_rules(rules, field, saved.get(field), data.get(field)):
			for f in rule.fields:
				if f.fieldname not in out and condition_met(f.condition, data):
					out.append(f.fieldname)
	return out
