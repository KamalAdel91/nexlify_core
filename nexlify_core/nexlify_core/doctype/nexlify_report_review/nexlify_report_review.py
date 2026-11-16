import frappe
from frappe.model.document import Document


class NexlifyReportReview(Document):
	pass


def on_doctype_update():
	frappe.db.add_unique(
		"Nexlify Report Review",
		["report", "filters_key", "row_key", "report_column"],
		constraint_name="unique_report_review",
	)
