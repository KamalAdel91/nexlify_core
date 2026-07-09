import frappe
from nexlify_core.nexlify_core.utils.home import get_home_page_config


def extend_bootinfo(bootinfo):
	config = get_home_page_config()
	bootinfo["nexlify_home_route"] = config["route"] if config else None
	bootinfo["nexlify_allow_desktop_access"] = config["allow_desktop_access"] if config else False
