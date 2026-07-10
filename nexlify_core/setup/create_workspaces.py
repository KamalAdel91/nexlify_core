import frappe
import json

MODULE = "Nexlify Core"


def make_workspace(title, parent=None):
	if frappe.db.exists("Workspace", title):
		print(f"Already exists: {title}")
		return

	doc = {
		"doctype": "Workspace",
		"name": title,
		"label": title,
		"title": title,
		"public": 1,
		"module": MODULE,
		"icon": "application",
		"content": json.dumps([
			{"id": "h1", "type": "header", "data": {"text": f"<span class='h4'>{title}</span>", "col": 12}}
		]),
	}
	if parent:
		doc["parent_page"] = parent

	frappe.get_doc(doc).insert(ignore_permissions=True)
	print(f"Created: {title}")


def run():
	make_workspace("Nexlify Core")
	make_workspace("Home Redirect", parent="Nexlify Core")
	make_workspace("Dashboard Filters", parent="Nexlify Core")
	frappe.db.commit()
	print("Done")
