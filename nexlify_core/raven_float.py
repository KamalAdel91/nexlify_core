import frappe


def extend_boot(bootinfo):
	try:
		s = frappe.get_cached_doc("Nexlify Core Settings")
		enabled = s.enable_raven_chat_button
		bootinfo.nx_raven_sound_type = s.get("notification_sound_type") or "Raven Default"
		bootinfo.nx_raven_sound = s.get("notification_sound") or ""
		vol = s.get("notification_volume")
		bootinfo.nx_raven_volume = 50 if vol is None else max(0, min(100, int(vol)))
	except Exception:
		enabled = 0
	bootinfo.nx_raven_float = bool(enabled) and "raven" in frappe.get_installed_apps()
