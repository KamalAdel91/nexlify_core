import frappe

FIELD_NAME = "custom_restrict_to_owner"


def _get_authoritative_value(doc):
	"""Reads the field straight from the database rather than trusting
	doc.get(FIELD_NAME) - a user without permlevel access to this field
	never receives its real value from the server in the first place, so
	their browser echoes back a blank/zero value on save. Checking against
	the DB value directly closes that gap."""
	if doc.is_new():
		return doc.get(FIELD_NAME)
	return frappe.db.get_value(doc.doctype, doc.name, FIELD_NAME)


def has_visibility_permission(doc, ptype="read", user=None):
	if not user:
		user = frappe.session.user

	if not frappe.get_meta(doc.doctype).has_field(FIELD_NAME):
		return True

	if not _get_authoritative_value(doc):
		return True

	if "System Manager" in frappe.get_roles(user):
		return True

	return doc.owner == user


def visibility_query_conditions(user, doctype=None):
	if not user:
		user = frappe.session.user

	if not frappe.get_meta(doctype).has_field(FIELD_NAME):
		return ""

	if "System Manager" in frappe.get_roles(user):
		return ""

	user_escaped = frappe.db.escape(user)

	return f"""
		ifnull(`tab{doctype}`.{FIELD_NAME}, 0) = 0
		or `tab{doctype}`.owner = {user_escaped}
	"""
