"""Keeps a "Kanban & Rules" section in the nexlify_core sidebar. Safe to run again."""

import frappe

SECTION = "Kanban & Rules"
LINKS = [("Transition Rule", "git-branch"), ("Kanban Board", "kanban")]


def run():
	doctype, name = find_sidebar()
	if not name:
		print("nexlify_core sidebar not found; Kanban & Rules section skipped")
		return
	doc = frappe.get_doc(doctype, name)
	if not any(i.type == "Section Break" and i.label == SECTION for i in doc.items):
		doc.append("items", {"type": "Section Break", "label": SECTION, "collapsible": 1, "indent": 1})
	linked = {i.link_to for i in doc.items if i.type == "Link"}
	for target, icon in LINKS:
		if target not in linked:
			doc.append(
				"items",
				{"type": "Link", "label": target, "link_type": "DocType", "link_to": target, "icon": icon, "child": 1},
			)
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.db.commit()
	print(f"{doctype} {name}: {SECTION} ready")


def find_sidebar():
	# v16.51+ navigation is "Sidebar"; before that it is "Workspace Sidebar"
	for doctype in ("Sidebar", "Workspace Sidebar"):
		if not frappe.db.table_exists(doctype):
			continue
		for f in ({"app": "nexlify_core"}, {"module": "Nexlify Core"}, {"title": ["like", "%Nexlify Core%"]}):
			if doctype == "Workspace Sidebar" and "module" in f:
				continue
			name = frappe.db.get_value(doctype, f, "name")
			if name:
				return doctype, name
	return None, None
