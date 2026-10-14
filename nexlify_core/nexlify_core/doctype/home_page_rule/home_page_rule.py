import frappe
from frappe import _
from frappe.model.document import Document

from nexlify_core.nexlify_core.utils.home import clear_home_page_cache, normalize_route


class HomePageRule(Document):
	def validate(self):
		if not self.users and not self.roles:
			frappe.throw(_("You must specify at least one User or one Role for this rule."))
		if not (self.route or "").strip():
			frappe.throw(_("Route is required."))
		route = normalize_route(self.route)
		if not route:
			frappe.throw(_("Route can't be the desk home itself (/desk). Pick the page users should land on."))
		self.route = route
		self.check_conflicts()

	def check_conflicts(self):
		"""Prevent the same user or role being assigned in more than one enabled rule.

		Queries the child tables directly instead of loading each other rule as a full
		document, so this stays fast even with a large number of rules.
		"""
		my_users = {row.user for row in self.users}
		my_roles = {row.role for row in self.roles}

		if not my_users and not my_roles:
			return

		other_rule_filter = {"enabled": 1}
		if self.name:
			other_rule_filter["name"] = ["!=", self.name]

		enabled_rule_names = frappe.get_all("Home Page Rule", filters=other_rule_filter, pluck="name")
		if not enabled_rule_names:
			return

		if my_users:
			clashes = frappe.get_all(
				"Home Page Rule User",
				filters={"parent": ["in", enabled_rule_names], "user": ["in", list(my_users)]},
				fields=["user", "parent"],
			)
			if clashes:
				c = clashes[0]
				frappe.throw(_("User {0} already has a Home Page Rule: {1}").format(c.user, c.parent))

		if my_roles:
			clashes = frappe.get_all(
				"Home Page Rule Role",
				filters={"parent": ["in", enabled_rule_names], "role": ["in", list(my_roles)]},
				fields=["role", "parent"],
			)
			if clashes:
				c = clashes[0]
				frappe.throw(_("Role {0} already has a Home Page Rule: {1}").format(c.role, c.parent))

	def on_update(self):
		clear_home_page_cache()

	def on_trash(self):
		clear_home_page_cache()
