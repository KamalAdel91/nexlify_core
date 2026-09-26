import frappe
from frappe import _
from frappe.model.document import Document
from frappe.permissions import add_permission

FIELD_NAME = "custom_restrict_to_owner"


class VisibilityFieldSetup(Document):
	pass


def _grant_permlevel_access(doctype, role, permlevel=1):
	"""Safely grants read+write on a permlevel to a role, without wiping out
	any existing permissions on the doctype (uses Frappe's own setup_custom_perms
	under the hood via add_permission). Handles the fact that add_permission()
	silently skips the second call if the (parent, role, permlevel) row already
	exists - so we explicitly force both read and write on that row after."""
	add_permission(doctype, role, permlevel=permlevel, ptype="read")

	name = frappe.db.get_value(
		"Custom DocPerm",
		{"parent": doctype, "role": role, "permlevel": permlevel},
		"name",
	)
	frappe.db.set_value("Custom DocPerm", name, {"read": 1, "write": 1})


@frappe.whitelist()
def apply_visibility_field(name):
	"""Creates the custom_restrict_to_owner checkbox field on the target doctype
	and grants permlevel-1 read/write to the chosen Role (or an auto-generated
	Role tied to the chosen User). Safe to call only once per setup record."""
	doc = frappe.get_doc("Visibility Field Setup", name)

	if not ("System Manager" in frappe.get_roles(frappe.session.user)):
		frappe.throw(_("Only a System Manager can apply a Visibility Field Setup."))

	if doc.field_created:
		frappe.throw(_("This setup has already been applied."))

	if frappe.db.exists("Custom Field", {"dt": doc.target_doctype, "fieldname": FIELD_NAME}):
		frappe.throw(_("A Restrict-to-Owner field already exists on {0}.").format(doc.target_doctype))

	if doc.grant_access_to == "User":
		role_name = f"Access - {doc.target_doctype} Visibility"
		if not frappe.db.exists("Role", role_name):
			frappe.get_doc({"doctype": "Role", "role_name": role_name}).insert(ignore_permissions=True)

		user_doc = frappe.get_doc("User", doc.user)
		if not any(r.role == role_name for r in user_doc.roles):
			user_doc.append("roles", {"role": role_name})
			user_doc.save(ignore_permissions=True)

		target_role = role_name
		doc.auto_generated_role = role_name
	else:
		target_role = doc.role

	frappe.get_doc({
		"doctype": "Custom Field",
		"dt": doc.target_doctype,
		"fieldname": FIELD_NAME,
		"label": "Restrict To Owner",
		"fieldtype": "Check",
		"permlevel": 1,
	}).insert(ignore_permissions=True)

	_grant_permlevel_access(doc.target_doctype, target_role, permlevel=1)

	doc.field_created = 1
	doc.save(ignore_permissions=True)
	frappe.clear_cache(doctype=doc.target_doctype)

	return doc.field_created
