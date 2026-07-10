import frappe


@frappe.whitelist()
def get_dash_filter_config():
	if not frappe.db.exists("Nexlify Dashboard Filter", "Nexlify Dashboard Filter"):
		return []
	doc = frappe.get_single("Nexlify Dashboard Filter")
	return [row.as_dict() for row in doc.filters]


def get_valid_filter_keys():
	if not frappe.db.exists("Nexlify Dashboard Filter", "Nexlify Dashboard Filter"):
		return set()
	doc = frappe.get_single("Nexlify Dashboard Filter")
	return {row.filter_key for row in doc.filters}


@frappe.whitelist()
def set_dash_filter(key=None, value=None):
	if not key:
		return

	# Only allow keys that are actually configured as dashboard filters,
	# to prevent arbitrary key/value storage under the nxdash_ namespace.
	if key not in get_valid_filter_keys():
		frappe.throw(f"'{key}' is not a configured dashboard filter", frappe.PermissionError)

	frappe.defaults.set_user_default(f"nxdash_{key}", value or "")


@frappe.whitelist()
def get_dash_filters():
	d = frappe.defaults.get_defaults()
	return {k[7:]: v for k, v in d.items() if k.startswith("nxdash_")}
