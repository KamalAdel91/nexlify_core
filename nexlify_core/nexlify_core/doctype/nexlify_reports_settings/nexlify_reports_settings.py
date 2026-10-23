import frappe
from frappe.model.document import Document


class NexlifyReportsSettings(Document):
	def on_update(self):
		# boot info is cached per user, so clear it for the change to apply on refresh
		frappe.clear_cache()
