import frappe
from frappe import _
from frappe.model.document import Document


class NexlifyReportLayout(Document):
	def validate(self):
		from nexlify_core.nexlify_core.report_layouts import check_report, validate_layout_state

		check_report(self.report)
		validate_layout_state(self.state)
		# a layout stays its maker's: no save can hand it to another user
		before = None if self.is_new() else self.get_doc_before_save()
		if before and before.owner != self.owner:
			frappe.throw(_("The owner of a layout cannot be changed"), frappe.PermissionError)
		taken = frappe.db.exists(
			"Nexlify Report Layout",
			{
				"report": self.report,
				"layout_name": self.layout_name,
				"owner": self.owner or frappe.session.user,
				"name": ["!=", self.name],
			},
		)
		if taken:
			frappe.throw(_("You already have a layout named {0} for this report").format(self.layout_name))
