import frappe

SETTINGS = "Nexlify Theme Settings"


def execute():
	"""Makes Ledger the site's default theme where the default is still the first one, Warm.

	A site that chose another default in Nexlify Theme Settings keeps it; users who picked a theme
	themselves keep theirs (the default is only for those who never picked)."""
	if frappe.db.get_single_value(SETTINGS, "default_theme") in (None, "", "warm"):
		frappe.db.set_single_value(SETTINGS, "default_theme", "ledger")
