import frappe
from frappe.model.document import Document


class HomePageRule(Document):
	def validate(self):
		if not self.users and not self.roles:
			frappe.throw("You must specify at least one User or one Role for this rule.")

	def on_update(self):
		clear_home_page_cache()

	def on_trash(self):
		clear_home_page_cache()


def clear_home_page_cache(doc=None, method=None):
	frappe.cache().delete_value("nexlify_home_page_rules")
