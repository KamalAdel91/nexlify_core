import frappe
from frappe.model.document import Document


class HomePageRule(Document):
	def validate(self):
		if not self.users and not self.roles:
			frappe.throw("You must specify at least one User or one Role for this rule.")
		if not self.route:
			frappe.throw("Route is required.")

		self.check_conflicts()

	def check_conflicts(self):
		"""Prevent the same user or role being assigned in more than one enabled rule."""
		other_rules = frappe.get_all(
			"Home Page Rule",
			filters={"enabled": 1, "name": ["!=", self.name or ""]},
			pluck="name",
		)
		if not other_rules:
			return

		my_users = {row.user for row in self.users}
		my_roles = {row.role for row in self.roles}

		for other_name in other_rules:
			other = frappe.get_cached_doc("Home Page Rule", other_name)
			other_users = {row.user for row in other.users}
			other_roles = {row.role for row in other.roles}

			clash_users = my_users & other_users
			clash_roles = my_roles & other_roles

			if clash_users:
				frappe.throw(
					f"User(s) {', '.join(clash_users)} already have a Home Page Rule: {other_name}"
				)
			if clash_roles:
				frappe.throw(
					f"Role(s) {', '.join(clash_roles)} already have a Home Page Rule: {other_name}"
				)

	def on_update(self):
		clear_home_page_cache()

	def on_trash(self):
		clear_home_page_cache()


def clear_home_page_cache(doc=None, method=None):
	frappe.cache().delete_value("nexlify_home_page_rules")
