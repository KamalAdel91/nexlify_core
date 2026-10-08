import frappe
from frappe import _
from frappe.model.document import Document

from nexlify_core.transition_rules import clear_cache


class TransitionRule(Document):
	def validate(self):
		meta = frappe.get_meta(self.reference_doctype)
		stage = meta.get_field(self.stage_field)
		if not stage:
			frappe.throw(_("{0} has no field {1}").format(_(self.reference_doctype), self.stage_field))
		self.validate_stage_values(stage)

		for row in self.required_fields:
			df = meta.get_field(row.fieldname)
			if not df:
				frappe.throw(_("Row {0}: {1} has no field {2}").format(row.idx, _(self.reference_doctype), row.fieldname))
			row.label = df.label
			if row.condition:
				try:
					compile(row.condition, "<condition>", "eval")
				except SyntaxError as e:
					frappe.throw(_("Row {0}: the condition is not a valid Python expression ({1})").format(row.idx, e.msg))

		self.title = f"{_(self.reference_doctype)}: {self.from_value or _('Any')} → {self.to_value}"

	def validate_stage_values(self, stage):
		"""Catch typos: a value the stage field can't hold would make the rule never fire."""
		for value in (self.from_value, self.to_value):
			if not value:
				continue
			if stage.fieldtype == "Select":
				options = [o.strip() for o in (stage.options or "").split("\n") if o.strip()]
				if options and value not in options:
					frappe.throw(
						_("{0} is not an option of {1}. Options: {2}").format(
							frappe.bold(value), _(stage.label), ", ".join(options)
						)
					)
			elif stage.fieldtype == "Link" and not frappe.db.exists(stage.options, value):
				frappe.throw(_("{0} {1} does not exist").format(_(stage.options), frappe.bold(value)))

	def on_update(self):
		clear_cache()

	def on_trash(self):
		clear_cache()
