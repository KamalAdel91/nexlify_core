import frappe
from nexlify_core.nexlify_core.utils.home import get_home_page


def extend_bootinfo(bootinfo):
	bootinfo["nexlify_home_route"] = get_home_page()
