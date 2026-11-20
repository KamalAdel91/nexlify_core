"""Added columns in Frappe's report export: the document line columns of Add Column, and the columns the
Nexlify Report View adds.

Frappe's Export sends the added columns (custom_columns) back to the server, which fills them in
frappe.desk.query_report.get_data_for_custom_report: it reads the field named like the column from the
linked document. A column of ours carries `nexlify_added` ({field, line, dynamic}) instead: a field of the
document line (Keep Each Line in the Ledger), or a field of a linked document under a column name of the
view's own. For the time of this export only, those columns are filled here and every other column the
way Frappe does. A row that adds up several ledger rows has no one line and stays empty, as on the screen.
"""

from contextlib import contextmanager

import frappe
from frappe.desk import query_report
from frappe.utils import flt

from nexlify_core.overrides.line_columns import MAX_NAMES, NUMBERS, line_values

MARK = "nexlify_added"


@frappe.whitelist()
def export_report():
	"""frappe.desk.query_report.export_query, through the Active Company's own override."""
	from nexlify_core.nexlify_core.active_company import export_report as export

	form = frappe.local.form_dict
	columns = frappe.parse_json(form.get("custom_columns") or "[]") or []
	if not any(isinstance(c, dict) and c.get(MARK) for c in columns):
		return export()
	# the columns are read in this request, not in a background job
	form["export_in_background"] = 0
	with columns_filled():
		return export()


@contextmanager
def columns_filled():
	frappe_fill = query_report.get_data_for_custom_report

	def fill(columns, result):
		found = frappe_fill([c for c in columns if not c.get(MARK)], result)
		for c in columns:
			if c.get(MARK):
				found[(c.get("doctype"), c.get("fieldname"))] = column_values(c, result)
		return found

	query_report.get_data_for_custom_report = fill
	try:
		yield
	finally:
		query_report.get_data_for_custom_report = frappe_fill


def column_values(column, result) -> dict:
	"""{the row's link value: the column's value}, read as the user."""
	mark = column[MARK] if isinstance(column[MARK], dict) else {}
	link = column.get("link_field") or {}
	key = link.get("fieldname") if isinstance(link, dict) else link
	doctype = column.get("doctype")
	rows = [r for r in result if isinstance(r, dict) and r.get(key)]
	if mark.get("dynamic"):
		rows = [r for r in rows if r.get(mark["dynamic"]) == doctype]
	names = list(dict.fromkeys(r[key] for r in rows))
	if not names or not mark.get("field"):
		return {}
	if not mark.get("line"):
		return query_report.get_data_for_custom_field(doctype, mark["field"], names)
	return line_column_values(doctype, mark["field"], key, rows, names)


def line_column_values(doctype, field, key, rows, names) -> dict:
	"""The line's value for each ledger row, empty for a report row that adds up several ledger rows."""
	numbers = {f.fieldname for f in frappe.get_meta(doctype).fields if f.fieldtype in NUMBERS}
	compare = sorted({f for r in rows[:50] for f in r if f in numbers})
	values, amounts = {}, {}
	for i in range(0, len(names), MAX_NAMES):
		got = line_values(doctype, names[i : i + MAX_NAMES], field, compare)
		values.update(got["values"])
		amounts.update(got["amounts"])
	out = {}
	for r in rows:
		own = amounts.get(r[key]) or {}
		several = any(f in r and abs(flt(r.get(f)) - flt(v)) > 0.005 for f, v in own.items())
		out[r[key]] = None if several else values.get(r[key])
	return out
