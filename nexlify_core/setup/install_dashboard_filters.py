import frappe
import json

MODULE = "Nexlify Core"


def create_child_doctype():
	if frappe.db.exists("DocType", "Nexlify Dashboard Filter Item"):
		return
	frappe.get_doc({
		"doctype": "DocType", "name": "Nexlify Dashboard Filter Item",
		"module": MODULE, "istable": 1, "editable_grid": 1,
		"fields": [
			{"fieldname": "label", "label": "Label", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "filter_key", "label": "Filter Key", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "field_type", "label": "Field Type", "fieldtype": "Select",
			 "options": "Link\nSelect\nDate\nData", "default": "Link", "reqd": 1, "in_list_view": 1},
			{"fieldname": "link_doctype", "label": "Link DocType", "fieldtype": "Link",
			 "options": "DocType", "depends_on": "eval:doc.field_type=='Link'"},
			{"fieldname": "select_options", "label": "Select Options", "fieldtype": "Small Text",
			 "depends_on": "eval:doc.field_type=='Select'"},
			{"fieldname": "target_fieldname", "label": "Target Fieldname", "fieldtype": "Data", "reqd": 1,
			 "in_list_view": 1, "description": "Fieldname on the target doctype to filter on (e.g. company)"},
			{"fieldname": "dashboard", "label": "Dashboard (leave empty for all dashboards)", "fieldtype": "Link", "options": "Dashboard"},
		],
	}).insert(ignore_permissions=True)
	print("Created: Nexlify Dashboard Filter Item")


def create_parent_doctype():
	if frappe.db.exists("DocType", "Nexlify Dashboard Filter"):
		return
	frappe.get_doc({
		"doctype": "DocType", "name": "Nexlify Dashboard Filter",
		"module": MODULE, "issingle": 1,
		"fields": [{"fieldname": "filters", "label": "Filters", "fieldtype": "Table",
					"options": "Nexlify Dashboard Filter Item"}],
		"permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}],
	}).insert(ignore_permissions=True)
	print("Created: Nexlify Dashboard Filter")


def run():
	create_child_doctype()
	create_parent_doctype()
	frappe.db.commit()
	print("Done")
