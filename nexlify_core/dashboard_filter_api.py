import frappe
from nexlify_core.dashboard_filter_injector import is_dashboard_filters_enabled


@frappe.whitelist()
def get_dash_filter_config():
    if not is_dashboard_filters_enabled():
        return []
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


@frappe.whitelist()
def sync_manual_chart_filters(dashboard_name, target_fieldname, value=None):
    """Report/Custom charts show their own manual filter dialog, which pulls
    its initial values from the current user's saved per-chart Dashboard
    Settings (falling back to the report's own static defaults if nothing is
    saved). That dialog has no awareness of our dashboard filter bar, so
    without this it can show a stale/default company while the chart itself
    correctly uses our injected filter - confusing even though the data
    shown is correct. This keeps the dialog itself in sync: whenever our
    filter changes, we write the same value directly into that saved config
    for every Report/Custom chart on the dashboard, so opening the manual
    filter dialog always shows what's actually applied."""
    if not frappe.db.exists("Dashboard", dashboard_name):
        return

    dashboard = frappe.get_doc("Dashboard", dashboard_name)
    chart_names = [c.chart for c in dashboard.charts]
    if not chart_names:
        return

    report_or_custom = frappe.get_all(
        "Dashboard Chart",
        filters={"name": ["in", chart_names], "chart_type": ["in", ["Report", "Custom"]]},
        pluck="name",
    )
    if not report_or_custom:
        return

    if frappe.db.exists("Dashboard Settings", frappe.session.user):
        doc = frappe.get_doc("Dashboard Settings", frappe.session.user)
    else:
        doc = frappe.new_doc("Dashboard Settings")
        doc.name = frappe.session.user
        doc.user = frappe.session.user

    config = frappe.parse_json(doc.chart_config or "{}")
    if not isinstance(config, dict):
        config = {}

    for chart_name in report_or_custom:
        entry = config.get(chart_name) or {}
        filters = entry.get("filters") or {}
        if not isinstance(filters, dict):
            # Non-tree/list-based filters aren't used by Report/Custom charts
            # in practice, but guard against an unexpected shape anyway.
            filters = {}
        if value:
            filters[target_fieldname] = value
        else:
            filters.pop(target_fieldname, None)
        entry["filters"] = filters
        config[chart_name] = entry

    doc.chart_config = frappe.as_json(config)
    doc.save(ignore_permissions=True)
