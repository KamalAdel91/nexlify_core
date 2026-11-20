"""Keep Each Line in the Ledger, in Frappe's report export: the document line columns Add Column made.

Frappe's Export sends the columns Add Column made (custom_columns) back to the server, which fills them
in frappe.desk.query_report.get_data_for_custom_report: it reads a field of a linked document by name,
so it cannot read a document's line. A line column carries `nexlify_line` (the line's field); for the
time of this export only, the line columns are filled here and every other column the way Frappe does.
A row that adds up several ledger rows stays empty, as on the screen.
"""

from contextlib import contextmanager

import frappe
from frappe.desk import query_report
from frappe.utils import flt

from nexlify_core.overrides.line_columns import MAX_NAMES, NUMBERS, line_values

LINE = "nexlify_line"


@frappe.whitelist()
def export_report():
	"""frappe.desk.query_report.export_query, through the Active Company's own override."""
	from nexlify_core.nexlify_core.active_company import export_report as export

	form = frappe.local.form_dict
	columns = frappe.parse_json(form.get("custom_columns") or "[]") or []
	if not any(isinstance(c, dict) and c.get(LINE) for c in columns):
		return export()
	# the lines are read in this request, not in a background job
	form["export_in_background"] = 0
	with lines_filled():
		return export()


@contextmanager
def lines_filled():
	frappe_fill = query_report.get_data_for_custom_report

	def fill(columns, result):
		found = frappe_fill([c for c in columns if not c.get(LINE)], result)
		for c in columns:
			if c.get(LINE):
				found[(c.get("doctype"), c.get("fieldname"))] = column_values(c, result)
		return found

	query_report.get_data_for_custom_report = fill
	try:
		yield
	finally:
		query_report.get_data_for_custom_report = frappe_fill


def column_values(column, result) -> dict:
	"""{ledger row name: its line's value}, empty for a report row that adds up several ledger rows."""
	link = column.get("link_field") or {}
	key = link.get("fieldname") if isinstance(link, dict) else link
	rows = [r for r in result if isinstance(r, dict) and r.get(key)]
	names = list(dict.fromkeys(r[key] for r in rows))
	if not names:
		return {}
	doctype = column.get("doctype")
	numbers = {f.fieldname for f in frappe.get_meta(doctype).fields if f.fieldtype in NUMBERS}
	compare = sorted({f for r in rows[:50] for f in r if f in numbers})
	values, amounts = {}, {}
	for i in range(0, len(names), MAX_NAMES):
		got = line_values(doctype, names[i : i + MAX_NAMES], column[LINE], compare)
		values.update(got["values"])
		amounts.update(got["amounts"])
	out = {}
	for r in rows:
		own = amounts.get(r[key]) or {}
		several = any(f in r and abs(flt(r.get(f)) - flt(v)) > 0.005 for f, v in own.items())
		out[r[key]] = None if several else values.get(r[key])
	return out
