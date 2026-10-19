import frappe
from frappe import _

from nexlify_core.nexlify_core.active_company import (
	PICKER_PATH,
	SESSION_KEY,
	applies_to,
	get_allowed_companies,
	get_settings,
	safe_redirect_target,
)

no_cache = 1


def get_context(context):
	redirect_to = safe_redirect_target(frappe.form_dict.get("redirect-to"))

	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = f"/login?redirect-to={PICKER_PATH}"
		raise frappe.Redirect

	# Feature off or user exempt: nothing to pick, carry on.
	if not applies_to():
		frappe.local.flags.redirect_location = redirect_to
		raise frappe.Redirect

	context.no_header = 1
	context.no_breadcrumbs = 1
	context.title = _("Choose company")
	companies = get_allowed_companies()
	# Indent each company under its parent, when the parent is in the list too.
	by_name = {c.name: c for c in companies}
	allow_groups = get_settings().allow_group_companies
	for c in companies:
		depth, parent = 0, c.parent_company
		while parent in by_name and depth < 6:
			depth += 1
			parent = by_name[parent].parent_company
		c.depth = depth
		c.group_scope = bool(allow_groups and c.is_group)
	context.companies = companies
	context.active = (frappe.session.data or {}).get(SESSION_KEY)
	context.redirect_to = redirect_to
	context.user = frappe.session.user
	context.csrf = frappe.sessions.get_csrf_token()
	return context
