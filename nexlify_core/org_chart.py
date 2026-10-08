import frappe
from frappe import _

ALLOWED_ROLES = {"HR Manager", "HR User", "Employee", "System Manager", "Administrator"}


@frappe.whitelist()
def get_companies():
    """Company options for the HRMS Organizational Chart page, 'All Companies' first.
    Uses get_list so Company User Permissions are respected."""
    if frappe.session.user == "Guest" or not ALLOWED_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("You do not have permission to view the Organizational Chart"), frappe.PermissionError)

    companies = frappe.get_list("Company", pluck="name", order_by="name")
    return ["All Companies", *companies]
