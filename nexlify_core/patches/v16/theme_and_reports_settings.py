import frappe

THEMES = "Nexlify Theme Settings"
REPORTS = "Nexlify Reports Settings"
CORE = "Nexlify Core Settings"
# what an earlier build kept in Nexlify Core Settings, before each feature had its own settings
CORE_FIELDS = ("enable_themes", "default_theme", "enable_reports")


def execute():
	"""Fills Nexlify Theme Settings and Nexlify Reports Settings, keeping what the site had.

	Nexlify Reports Settings used to belong to the nexlify_reports app; where that app is still
	installed its DocType now moves to Nexlify Core, and its row in tabSingles (the Enabled switch)
	is kept as it is. Values are read straight from tabSingles, so this works whatever is installed."""
	core = dict(
		frappe.db.sql(
			"select field, value from tabSingles where doctype = %s and field in %s", (CORE, CORE_FIELDS)
		)
	)

	if not single_values(THEMES):
		frappe.db.set_single_value(
			THEMES,
			{
				"enabled": as_check(core.get("enable_themes")),
				"default_theme": core.get("default_theme") or "warm",
				"dock_labels": 1,
			},
		)
	if not single_values(REPORTS):
		frappe.db.set_single_value(REPORTS, "enabled", as_check(core.get("enable_reports")))

	frappe.db.sql("delete from tabSingles where doctype = %s and field in %s", (CORE, CORE_FIELDS))


def single_values(doctype):
	return frappe.db.sql("select field from tabSingles where doctype = %s", doctype)


def as_check(value):
	"""A saved switch as 0 or 1; never saved is on."""
	return 1 if value in (None, "") else int(value)
