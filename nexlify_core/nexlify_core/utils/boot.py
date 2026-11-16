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
		bootinfo["nexlify_themes"] = {"enabled": 1, "default": "ledger", "dock_labels": 1}
	try:
		reports_settings = frappe.get_cached_doc("Nexlify Reports Settings")
	except frappe.DoesNotExistError:
		reports_settings = None
	# settings never saved have no value: the reports stay on
	reports = reports_settings.get("enabled") if reports_settings else None
	bootinfo["nexlify_reports_enabled"] = 1 if reports is None else int(reports)
	# Nexlify Report View: off until it is ticked, with the reports that keep Frappe's table
	bootinfo["nexlify_report_view"] = {
		"enabled": int(reports_settings.get("use_report_view") or 0) if reports_settings else 0,
		"excluded": [row.report for row in reports_settings.get("report_view_excluded") or []] if reports_settings else [],
	}
	# Search Box in Page Header: off until it is ticked
	try:
		bootinfo["nexlify_page_search"] = int(frappe.get_cached_doc("Nexlify Core Settings").get("show_page_search") or 0)
	except frappe.DoesNotExistError:
		bootinfo["nexlify_page_search"] = 0
	# Link Fields > Link Fields Work as Buttons: off until it is ticked
	try:
		settings = frappe.get_cached_doc("Nexlify Core Settings")
		bootinfo["nexlify_link_list_on_click"] = int(settings.get("link_list_on_click") or 0)
	except frappe.DoesNotExistError:
		bootinfo["nexlify_link_list_on_click"] = 0
