import frappe
from nexlify_core.nexlify_core.themes import boot_settings as theme_boot_settings
from nexlify_core.nexlify_core.utils.home import get_home_page_config


def extend_bootinfo(bootinfo):
	config = get_home_page_config()
	bootinfo["nexlify_home_route"] = config["route"] if config else None
	bootinfo["nexlify_allow_desktop_access"] = config["allow_desktop_access"] if config else False
	# the themes' and the reports' settings are read so that the desk always opens: until the
	# settings exist (a deploy whose migrate has not run yet) both stay on, as they are by default
	try:
		bootinfo["nexlify_themes"] = theme_boot_settings()
	except frappe.DoesNotExistError:
		bootinfo["nexlify_themes"] = {"enabled": 1, "default": "warm", "dock_labels": 1}
	try:
		# settings never saved have no value: the reports stay on
		reports = frappe.get_cached_doc("Nexlify Reports Settings").get("enabled")
	except frappe.DoesNotExistError:
		reports = None
	bootinfo["nexlify_reports_enabled"] = 1 if reports is None else int(reports)
