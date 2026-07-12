import frappe
import json


def is_dashboard_filters_enabled():
    """Single source of truth for whether the whole dashboard filter system
    is active. Checked before any filter injection - if disabled, this app
    behaves as if it never touched Number Cards / Dashboard Charts at all."""
    if not frappe.db.exists("Nexlify Dashboard Filter", "Nexlify Dashboard Filter"):
        return True
    value = frappe.db.get_single_value("Nexlify Dashboard Filter", "enable_dashboard_filters")
    return bool(value) if value is not None else True

# Custom-type Dashboard Charts where we've verified the underlying source
# function accepts a "company" key in its filters dict. Custom charts can't
# be handled generically since each one runs its own Python function, so
# any newly discovered one needs to be added here after checking its source.
KNOWN_CUSTOM_CHART_SOURCES = {
    "Warehouse wise Stock Value",
}


def get_target_field(doctype, fieldname):
    if not doctype:
        return None
    return frappe.get_meta(doctype).get_field(fieldname)


def is_tree_link_field(doctype, fieldname):
    """True if the field is a Link to a tree doctype (e.g. company -> Company),
    meaning hierarchy expansion (parent matches its children too) applies."""
    field = get_target_field(doctype, fieldname)
    if not field or field.fieldtype != "Link" or not field.options:
        return False
    return bool(frappe.get_meta(field.options).is_tree)


def build_expr(filter_key, is_tree):
    if is_tree:
        # Value is pre-expanded client-side into an array under a separate
        # '__expanded' key (see nexlify_dashboard_filter.js): the selected
        # value plus its descendants, or every record when no value is set.
        return f"window.nexlify_dash_filters && window.nexlify_dash_filters['{filter_key}__expanded']"
    # Non-tree fields: fall back to '%' (matches everything) when no value is
    # set, so an empty filter means "no filter applied" rather than "no data".
    return (
        f"(window.nexlify_dash_filters && window.nexlify_dash_filters['{filter_key}']) "
        f"? window.nexlify_dash_filters['{filter_key}'] : '%'"
    )


def simple_expr(filter_key):
    # Used for Report/Custom charts, which only ever accept a single value
    # (no hierarchy expansion, no '%' wildcard support).
    return f"window.nexlify_dash_filters && window.nexlify_dash_filters['{filter_key}']"


def replace_list_filter(existing, target_fieldname, doctype, filter_key):
    cleaned = [f for f in existing if not (len(f) > 1 and f[1] == target_fieldname)]
    tree = is_tree_link_field(doctype, target_fieldname)
    operator = "in" if tree else "like"
    cleaned.append([doctype, target_fieldname, operator, build_expr(filter_key, tree)])
    return cleaned


def get_active_filter_rows():
    if not frappe.db.exists("Nexlify Dashboard Filter", "Nexlify Dashboard Filter"):
        return []
    doc = frappe.get_single("Nexlify Dashboard Filter")
    return list(doc.filters)


def compute_number_card_filters(doc, rows=None):
    """Pure computation - mutates doc.dynamic_filters_json in memory only.
    Returns True if a change was made, False otherwise. Does not write to the DB."""
    rows = rows if rows is not None else get_active_filter_rows()
    if not doc.document_type:
        return False

    changed = False
    existing = json.loads(doc.dynamic_filters_json or "[]")
    for row in rows:
        if not get_target_field(doc.document_type, row.target_fieldname):
            continue
        existing = replace_list_filter(existing, row.target_fieldname, doc.document_type, row.filter_key)
        changed = True

    if changed:
        new_json = json.dumps(existing)
        if new_json != (doc.dynamic_filters_json or "[]"):
            doc.dynamic_filters_json = new_json
        else:
            changed = False
    return changed


def compute_dashboard_chart_filters(doc, rows=None):
    """Pure computation - mutates doc.dynamic_filters_json in memory only.
    Returns True if a change was made, False otherwise. Does not write to the DB."""
    rows = rows if rows is not None else get_active_filter_rows()

    if doc.chart_type == "Report":
        existing = frappe.parse_json(doc.dynamic_filters_json or "{}")
        if not isinstance(existing, dict):
            return False
        changed = False
        for row in rows:
            existing[row.target_fieldname] = simple_expr(row.filter_key)
            changed = True
        if changed:
            doc.dynamic_filters_json = json.dumps(existing)
        return changed

    if doc.chart_type == "Custom":
        if doc.source not in KNOWN_CUSTOM_CHART_SOURCES:
            frappe.log_error(
                title="nexlify_core: unrecognized Custom chart source",
                message=(
                    f"Dashboard Chart '{doc.name}' uses Custom source '{doc.source}', "
                    f"which is not in KNOWN_CUSTOM_CHART_SOURCES. Dashboard filters will "
                    f"not be applied to this chart until its source is verified and added."
                ),
            )
            return False
        existing = frappe.parse_json(doc.dynamic_filters_json or "{}")
        if not isinstance(existing, dict):
            existing = {}
        changed = False
        for row in rows:
            existing[row.target_fieldname] = simple_expr(row.filter_key)
            changed = True
        if changed:
            doc.dynamic_filters_json = json.dumps(existing)
        return changed

    # Count / Sum / Group By - list-based dynamic_filters_json
    if not doc.document_type:
        return False

    changed = False
    existing = json.loads(doc.dynamic_filters_json or "[]")
    for row in rows:
        if not get_target_field(doc.document_type, row.target_fieldname):
            continue
        existing = replace_list_filter(existing, row.target_fieldname, doc.document_type, row.filter_key)
        changed = True

    if changed:
        new_json = json.dumps(existing)
        if new_json != (doc.dynamic_filters_json or "[]"):
            doc.dynamic_filters_json = new_json
        else:
            changed = False
    return changed


def inject_number_card(doc, rows=None):
    """Used by the manual sweep script (setup/inject_dashboard_filters.py). The doc
    here is not being saved through doc.save(), so we persist the change explicitly."""
    changed = compute_number_card_filters(doc, rows=rows)
    if changed:
        frappe.db.set_value("Number Card", doc.name, "dynamic_filters_json", doc.dynamic_filters_json, update_modified=False)
    return changed


def inject_dashboard_chart(doc, rows=None):
    """Used by the manual sweep script (setup/inject_dashboard_filters.py). The doc
    here is not being saved through doc.save(), so we persist the change explicitly."""
    changed = compute_dashboard_chart_filters(doc, rows=rows)
    if changed:
        frappe.db.set_value("Dashboard Chart", doc.name, "dynamic_filters_json", doc.dynamic_filters_json, update_modified=False)
    return changed


def on_number_card_save(doc, method=None):
    """doc_events hook (before_save) - mutates the doc in memory before Frappe
    writes it, so no extra DB write is needed."""
    if not is_dashboard_filters_enabled():
        return
    try:
        compute_number_card_filters(doc)
    except Exception:
        frappe.log_error(title="nexlify_core: failed to auto-inject dashboard filter on Number Card")


def on_dashboard_chart_save(doc, method=None):
    """doc_events hook (before_save) - mutates the doc in memory before Frappe
    writes it, so no extra DB write is needed."""
    if not is_dashboard_filters_enabled():
        return
    try:
        compute_dashboard_chart_filters(doc)
    except Exception:
        frappe.log_error(title="nexlify_core: failed to auto-inject dashboard filter on Dashboard Chart")


def strip_nexlify_filters_list(existing):
    """Removes any filter row whose value expression references our
    window.nexlify_dash_filters global, leaving everything else untouched."""
    return [f for f in existing if not (len(f) > 3 and "nexlify_dash_filters" in str(f[3]))]


def strip_nexlify_filters_dict(existing):
    """Same idea as strip_nexlify_filters_list, but for the dict-shaped
    dynamic_filters_json used by Report/Custom charts."""
    return {k: v for k, v in existing.items() if "nexlify_dash_filters" not in str(v)}


def remove_number_card_filters(doc):
    """Pure computation - strips any of our injected filters from
    doc.dynamic_filters_json in memory only. Returns True if changed."""
    existing = json.loads(doc.dynamic_filters_json or "[]")
    cleaned = strip_nexlify_filters_list(existing)
    if cleaned == existing:
        return False
    doc.dynamic_filters_json = json.dumps(cleaned)
    return True


def remove_dashboard_chart_filters(doc):
    """Pure computation - strips any of our injected filters from
    doc.dynamic_filters_json in memory only. Returns True if changed."""
    if doc.chart_type in ("Report", "Custom"):
        existing = frappe.parse_json(doc.dynamic_filters_json or "{}")
        if not isinstance(existing, dict):
            return False
        cleaned = strip_nexlify_filters_dict(existing)
        if cleaned == existing:
            return False
        doc.dynamic_filters_json = json.dumps(cleaned)
        return True

    existing = json.loads(doc.dynamic_filters_json or "[]")
    cleaned = strip_nexlify_filters_list(existing)
    if cleaned == existing:
        return False
    doc.dynamic_filters_json = json.dumps(cleaned)
    return True


def remove_all_filters():
    """Sweeps every Number Card / Dashboard Chart in the system and strips
    out any filter we previously injected, restoring them to their original
    state as if this app had never touched them. Used when the dashboard
    filter system is turned off via the Enable Dashboard Filter Bar checkbox."""
    for card in frappe.get_all("Number Card", pluck="name"):
        doc = frappe.get_doc("Number Card", card)
        if remove_number_card_filters(doc):
            frappe.db.set_value("Number Card", card, "dynamic_filters_json", doc.dynamic_filters_json, update_modified=False)

    for chart in frappe.get_all("Dashboard Chart", pluck="name"):
        doc = frappe.get_doc("Dashboard Chart", chart)
        if remove_dashboard_chart_filters(doc):
            frappe.db.set_value("Dashboard Chart", chart, "dynamic_filters_json", doc.dynamic_filters_json, update_modified=False)

    frappe.db.commit()


def on_dashboard_filter_config_save(doc, method=None):
    """doc_events hook on Nexlify Dashboard Filter itself. If the filter
    system was just turned off, strips our injected filters from every
    chart/card so the dashboards return to their original, untouched state.
    If it was just turned on (or filters config changed), re-runs the normal
    injection sweep."""
    try:
        if not bool(doc.get("enable_dashboard_filters")):
            remove_all_filters()
        else:
            from nexlify_core.setup.inject_dashboard_filters import run
            run()
    except Exception:
        frappe.log_error(title="nexlify_core: failed to sync dashboard filter state on save")


def run_after_migrate():
    """Runs automatically after every `bench migrate` (including Frappe Cloud
    deploys). Sweeps all existing Number Cards / Dashboard Charts and injects
    the configured dashboard filters, so a fresh install or a redeploy never
    needs a manual script run. Safe to run even if no filters are configured
    yet (e.g. a brand new site) - it just does nothing in that case."""
    if not is_dashboard_filters_enabled():
        return
    try:
        from nexlify_core.setup.inject_dashboard_filters import run
        run()
    except Exception:
        frappe.log_error(title="nexlify_core: after_migrate filter sweep failed")
