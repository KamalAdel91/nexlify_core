import frappe
from frappe.model.document import Document


class NexlifyCoreSettings(Document):
	def on_update(self):
		# boot info is cached per user, so clear it for the toggle to apply on refresh
		frappe.clear_cache()
