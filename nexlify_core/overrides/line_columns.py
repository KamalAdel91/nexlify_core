"""Keep Each Line in the Ledger, in reports: columns from the document line a ledger row was made from.

A ledger row (GL Entry, Stock Ledger Entry, ...) names its document (voucher_type, voucher_no) and the
line of that document (voucher_detail_no). The line sits in one of the document's child tables; which
one comes from the DocTypes' definitions. A column of the line's field fills from whichever table the
row's line is in: Item Code of a sales invoice line, of a delivery note line and of a stock entry line
is one column. Every read runs as the user (frappe.get_list): the ledger rows, then each document's lines.

Offered only while Accounts Settings > Keep Each Line in the Ledger is ticked, in Frappe's own Add Column
of every report (nexlify_line_columns.bundle.js) and in the Nexlify Report View's columns.
"""

import frappe
from frappe import _
from frappe.model import no_value_fields

from nexlify_core.overrides.ledger_lines import keep_lines

LEDGER_FIELDS = ("voucher_type", "voucher_no", "voucher_detail_no")
MAX_TYPES = 60
MAX_NAMES = 2000
NUMBERS = ("Currency", "Float", "Int", "Percent")
SKIP_TYPES = set(no_value_fields) | {"Table", "Table MultiSelect", "Attach", "Attach Image", "Signature", "Password"}


def is_ledger(doctype: str) -> bool:
	"""A table whose rows name a document and its line, and that the user may read."""
	if not isinstance(doctype, str) or not frappe.db.exists("DocType", doctype):
		return False
	meta = frappe.get_meta(doctype)
	if meta.istable or meta.issingle or not all(meta.has_field(f) for f in LEDGER_FIELDS):
		return False
	return bool(frappe.has_permission(doctype, "read"))


@frappe.whitelist()
def line_fields(doctype: str) -> list[dict]:
	"""The fields of the lines of every document type the ledger table holds, one entry per fieldname;
	none while the setting is unticked."""
	if not keep_lines():
		return []
	check_ledger(doctype)
	fields = {}
	for voucher_type in voucher_types(doctype):
		for table in line_tables(voucher_type):
			for df in frappe.get_meta(table).fields:
				if df.fieldtype in SKIP_TYPES or df.hidden or not df.label:
					continue
				fields.setdefault(df.fieldname, {"field": df.fieldname, "label": df.label, "fieldtype": df.fieldtype, "options": df.options})
	return sorted(fields.values(), key=lambda f: _(f["label"]))


@frappe.whitelist()
def line_choices(doctypes: str | list) -> dict:
	"""{ledger table: its lines' fields} for the tables named that are ledgers (Frappe's Add Column asks
	with every document type its report links to); nothing while the setting is unticked."""
	if not keep_lines():
		return {}
	doctypes = frappe.parse_json(doctypes) or []
	if not isinstance(doctypes, list):
		frappe.throw(_("Document types are not valid"), frappe.ValidationError)
	return {dt: line_fields(dt) for dt in dict.fromkeys(doctypes[:MAX_TYPES]) if isinstance(dt, str) and is_ledger(dt)}


@frappe.whitelist()
def line_values(doctype: str, names: str | list, field: str, compare: str | list | None = None) -> dict:
	"""For each ledger row named: the value of `field` on the document line it was made from, and the
	row's own stored `compare` amounts (a report row that adds up several ledger rows shows other ones)."""
	if not keep_lines():
		return {"values": {}, "amounts": {}}
	check_ledger(doctype)
	names = frappe.parse_json(names) or []
	compare = frappe.parse_json(compare) or []
	if not isinstance(names, list) or not isinstance(compare, list) or len(names) > MAX_NAMES:
		frappe.throw(_("Rows are not valid"), frappe.ValidationError)
	meta = frappe.get_meta(doctype)
	compare = [f for f in compare if isinstance(f, str) and (meta.get_field(f) or frappe._dict()).fieldtype in NUMBERS]
	rows = frappe.get_list(
		doctype,
		filters={"name": ("in", [n for n in names if isinstance(n, str)])},
		fields=["name", "voucher_type", "voucher_detail_no", *compare],
		limit_page_length=0,
	)
	found = read_lines(rows, field)
	return {
		"values": {r.name: found.get((r.voucher_type, r.voucher_detail_no)) for r in rows},
		"amounts": {r.name: {f: r.get(f) for f in compare} for r in rows},
	}


def check_ledger(doctype: str) -> None:
	if not is_ledger(doctype):
		frappe.throw(_("{0} does not name document lines").format(_(doctype)), frappe.PermissionError)


def voucher_types(doctype: str) -> list[str]:
	"""The document types stored in the ledger table that the user may read."""
	stored = frappe.get_list(doctype, fields=["voucher_type"], distinct=True, pluck="voucher_type", limit=MAX_TYPES * 2)
	return [t for t in dict.fromkeys(stored) if t and frappe.db.exists("DocType", t) and frappe.has_permission(t, "read")][:MAX_TYPES]


def line_tables(voucher_type: str) -> list[str]:
	return [df.options for df in frappe.get_meta(voucher_type).get_table_fields() if df.options]


def read_lines(rows, field: str) -> dict:
	"""{(document type, line): the line's value of `field`}, read through each document as the user."""
	lines = {}
	for r in rows:
		if r.voucher_type and r.voucher_detail_no:
			lines.setdefault(r.voucher_type, set()).add(r.voucher_detail_no)
	found = {}
	for voucher_type, names in lines.items():
		if not frappe.db.exists("DocType", voucher_type) or not frappe.has_permission(voucher_type, "read"):
			continue
		for table in frappe.get_meta(voucher_type).get_table_fields():
			if not frappe.get_meta(table.options).has_field(field):
				continue
			for got in frappe.get_list(
				voucher_type,
				filters=[[table.options, "name", "in", list(names)]],
				fields=[f"{table.fieldname}.name as line", f"{table.fieldname}.{field} as value"],
				limit_page_length=0,
			):
				found[(voucher_type, got.line)] = got.value
	return found
