import frappe

REPORTS = "Nexlify Reports Settings"
# the list of reports that kept Frappe's table, and two switches of a build that never shipped
OLD_FIELDS = ("report_view_excluded", "report_layouts", "classic_look")
OLD_DOCTYPES = ("Nexlify Report Review", "Nexlify Report View Excluded Report")


def execute():
	"""Nexlify Report View keeps its table, Layout and Group By only.

	The switch to Frappe's view, the review marks and the list of reports that kept Frappe's table
	are gone: their DocTypes and saved values go with them. Use Nexlify Report View for All Reports
	keeps its value, and saved layouts (Nexlify Report Layout) stay."""
	frappe.db.sql("delete from tabSingles where doctype = %s and field in %s", (REPORTS, OLD_FIELDS))
	for doctype in OLD_DOCTYPES:
		if frappe.db.exists("DocType", doctype):
			frappe.delete_doc("DocType", doctype, force=True, ignore_missing=True)
	frappe.clear_cache(doctype=REPORTS)
