import frappe

MODULE = "Nexlify Core"
# children first, then the parent workspace
NAMES = ("Home Redirect", "Dashboard Filters", "Nexlify Core")


def execute():
	"""Removes the empty Nexlify Core workspaces and the desktop icons Frappe created for them."""
	for name in NAMES:
		if frappe.db.get_value("Workspace", name, "module") == MODULE:
			frappe.delete_doc("Workspace", name, force=True, ignore_permissions=True)
		icon = frappe.db.get_value("Desktop Icon", name, ["standard", "link_to"], as_dict=True)
		if icon and not icon.standard and icon.link_to == name:
			frappe.delete_doc("Desktop Icon", name, force=True, ignore_permissions=True)
		if frappe.db.exists("Workspace Sidebar", name) and not frappe.db.get_value("Workspace Sidebar", name, "standard"):
			frappe.delete_doc("Workspace Sidebar", name, force=True, ignore_permissions=True)

	from frappe.desk.doctype.desktop_icon.desktop_icon import clear_desktop_icons_cache
	clear_desktop_icons_cache()
