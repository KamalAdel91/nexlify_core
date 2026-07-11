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


@frappe.whitelist()
def get_expanded_filter_values(filter_key, value=None):
    """For tree-type filters (e.g. Company), returns the list of record names
    that should match: the selected value plus all of its descendants, or
    every record in the linked doctype when no value is selected (so an
    empty filter behaves as "show everything" instead of "show nothing").
    For non-tree filters, just echoes the raw value back unchanged."""
    config = get_dash_filter_config()
    row = next((r for r in config if r.get("filter_key") == filter_key), None)
    if not row or row.get("field_type") != "Link" or not row.get("link_doctype"):
        return value

    link_doctype = row["link_doctype"]
    if not frappe.get_meta(link_doctype).is_tree:
        return value

    if not value:
        return frappe.get_all(link_doctype, pluck="name")

    from frappe.utils.nestedset import get_descendants_of
    descendants = get_descendants_of(link_doctype, value, ignore_permissions=True)
    return [value] + list(descendants)
