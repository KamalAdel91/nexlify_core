import frappe


def extend_boot(bootinfo):
	try:
		enabled = frappe.db.get_single_value("Nexlify Core Settings", "enable_raven_chat_button")
	except Exception:
		enabled = 0
	bootinfo.nx_raven_float = bool(enabled) and "raven" in frappe.get_installed_apps()
