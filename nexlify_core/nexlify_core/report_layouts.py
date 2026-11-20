"""Nexlify Report View: saved layouts, and how a report's columns link to other tables.

A layout belongs to the user who made it. A public layout can be read by every user who
may open its report; a shared one by the roles, users and user groups it names (they must
be able to open the report too). Only its owner changes it. Every check runs as the user,
on Frappe's own report rules.
"""

import json

import frappe
from frappe import _
from frappe.desk.desk_views import DeskViews

LAYOUT = "Nexlify Report Layout"
MAX_LAYOUT_STATE = 200_000


def check_report(report: str) -> None:
	"""Frappe's own check for running a report: report roles, the report permission
	on its DocType, and the report not being disabled."""
	if not isinstance(report, str) or not report:
		frappe.throw(_("Report is missing"), frappe.ValidationError)
	from frappe.desk.query_report import get_report_doc

	get_report_doc(report)


def allowed_reports(user: str | None = None) -> set[str]:
	"""The reports the user may open, by the same rules as check_report (Frappe's get_report_doc):
	the report's roles, the report permission on its DocType, and the report not disabled."""
	user = user or frappe.session.user
	names = DeskViews.get_allowed_report_names(cache=True, user=user)
	allowed = set()
	for name in names:
		info = frappe.get_cached_value("Report", name, ["ref_doctype", "disabled"], as_dict=True)
		if not info or info.disabled:
			continue
		if info.ref_doctype and not frappe.has_permission(info.ref_doctype, "report", user=user):
			continue
		allowed.add(name)
	return allowed


def report_in(field: str, names: set[str]) -> str:
	if not names:
		return "1=0"
	return f"{field} in ({', '.join(frappe.db.escape(n) for n in sorted(names))})"


def stored(doc, fieldname: str):
	"""The value saved in the database, never the one a request sends: a permission is decided on it."""
	if doc.get("name") and not doc.is_new():
		value = frappe.db.get_value(doc.doctype, doc.name, fieldname)
		if value is not None:
			return value
	return doc.get(fieldname)


def is_system_manager(user: str) -> bool:
	return user == "Administrator" or "System Manager" in frappe.get_roles(user)


SHARED = {
	"role": ("Nexlify Report Layout Role", "shared_roles"),
	"user": ("Nexlify Report Layout User", "shared_users"),
	"group": ("Nexlify Report Layout User Group", "shared_user_groups"),
}


def shared_sql(layout: str, user: str) -> str:
	"""The layout is shared with the user: by one of the user's roles, by name, or by a user group the user is in."""
	esc = frappe.db.escape
	roles = ", ".join(esc(r) for r in frappe.get_roles(user)) or "''"
	part = lambda key, cond: (  # noqa: E731
		f"exists (select 1 from `tab{SHARED[key][0]}` s where s.`parent` = {layout} "
		f"and s.`parenttype` = {esc(LAYOUT)} and s.`parentfield` = {esc(SHARED[key][1])} and {cond})"
	)
	groups = f"s.`user_group` in (select m.`parent` from `tabUser Group Member` m where m.`user` = {esc(user)})"
	return " or ".join([part("role", f"s.`role` in ({roles})"), part("user", f"s.`user` = {esc(user)}"), part("group", groups)])


def layout_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	if doctype not in (None, LAYOUT):
		return ""
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""
	name = f"`tab{LAYOUT}`.`name`"
	readable = f"(`tab{LAYOUT}`.`owner` = {frappe.db.escape(user)} or `tab{LAYOUT}`.`is_public` = 1 or {shared_sql(name, user)})"
	return f"({readable} and {report_in(f'`tab{LAYOUT}`.`report`', allowed_reports(user))})"


def shared_with(layout: str, user: str) -> bool:
	"""The layout, as saved in the database, is shared with the user."""
	if not layout:
		return False
	return bool(frappe.db.sql(f"select 1 from dual where {shared_sql(frappe.db.escape(layout), user)}"))


def layout_has_permission(doc, ptype: str | None = None, user: str | None = None, debug: bool = False) -> bool:
	if doc.doctype != LAYOUT:
		return True
	user = user or frappe.session.user
	if is_system_manager(user):
		return True
	# the owner and the report saved in the database decide, not the ones a request sends
	owner = stored(doc, "owner")
	report = stored(doc, "report")
	if report and report not in allowed_reports(user):
		return False
	if not owner or owner == user:
		return True
	# the others may only read it: when it is public, or shared with them
	if ptype != "read":
		return False
	return bool(stored(doc, "is_public")) or (not doc.is_new() and shared_with(doc.name, user))


def validate_layout_state(state) -> None:
	text = state if isinstance(state, str) else json.dumps(state or {})
	if len(text) > MAX_LAYOUT_STATE:
		frappe.throw(_("This layout is too large to save"), frappe.ValidationError)
	try:
		value = json.loads(text) if text else {}
	except ValueError:
		frappe.throw(_("This layout is not valid"), frappe.ValidationError)
	if not isinstance(value, dict):
		frappe.throw(_("This layout is not valid"), frappe.ValidationError)


# ---------------------------------------------------------------------------
# How a report's columns link to other tables: from the DocTypes' definitions,
# never from the rows a report shows
# ---------------------------------------------------------------------------
MAX_GUESS_COLUMNS = 60
MAX_TARGETS = 40
NEVER_LINKS = {"DocType", "Currency", "Report", "Page", "File", "User Permission"}


def readable_doctype(doctype: str) -> bool:
	if not isinstance(doctype, str) or doctype in NEVER_LINKS or not frappe.db.exists("DocType", doctype):
		return False
	meta = frappe.get_meta(doctype)
	if meta.istable or meta.issingle or meta.is_virtual:
		return False
	return bool(frappe.has_permission(doctype, "read"))


def table_fields(doctype: str) -> dict:
	"""The fields of a DocType and of its child tables, by fieldname (the parent's field wins)."""
	out = {}
	if not doctype or not frappe.db.exists("DocType", doctype):
		return out
	meta = frappe.get_meta(doctype)
	for df in meta.fields:
		out.setdefault(df.fieldname, (doctype, df))
	for table in meta.get_table_fields():
		for df in frappe.get_meta(table.options).fields:
			out.setdefault(df.fieldname, (table.options, df))
	return out


def dynamic_targets(table: str, type_df) -> list[str]:
	"""The DocTypes a Dynamic Link can point to, from its type field: the records of the table the
	type field links to (Party Type), the options of a Select, or else every type stored in that
	column of the table (all its rows, not the report's)."""
	if type_df.fieldtype == "Link" and type_df.options and type_df.options != "DocType":
		names = frappe.get_all(type_df.options, pluck="name", limit_page_length=MAX_TARGETS * 2)
	elif type_df.fieldtype == "Select":
		names = [x.strip() for x in (type_df.options or "").split("\n") if x.strip()]
	else:
		names = frappe.get_all(table, fields=[type_df.fieldname], distinct=True, pluck=type_df.fieldname, limit_page_length=MAX_TARGETS * 2)
	return [dt for dt in dict.fromkeys(names) if readable_doctype(dt)][:MAX_TARGETS]


@frappe.whitelist()
def guess_links(report: str, columns: str | list, dynamic: str | list | None = None) -> dict:
	"""How the report's columns link to other tables, read from the definition of the report's DocType
	(and its child tables): a column whose field there is a Link links to that DocType, one whose field
	is a Dynamic Link links to every DocType its type field allows.
	columns: fieldnames the report did not mark; dynamic: [fieldname, type fieldname] the report marked."""
	check_report(report)
	columns = frappe.parse_json(columns) or []
	dynamic = frappe.parse_json(dynamic) or []
	if not isinstance(columns, list) or not isinstance(dynamic, list):
		frappe.throw(_("Columns are not valid"), frappe.ValidationError)
	ref = frappe.get_cached_value("Report", report, "ref_doctype")
	fields = table_fields(ref)
	result = {}

	def targets_of(type_fieldname: str) -> list[str]:
		found = fields.get(type_fieldname)
		return dynamic_targets(found[0], found[1]) if found else []

	for fieldname in columns[:MAX_GUESS_COLUMNS]:
		if not isinstance(fieldname, str) or fieldname not in fields:
			continue
		table, df = fields[fieldname]
		if df.fieldtype == "Link" and df.options and readable_doctype(df.options):
			result[fieldname] = {"link": df.options}
		elif df.fieldtype == "Dynamic Link" and df.options:
			result[fieldname] = {"dynamic": df.options, "targets": targets_of(df.options)}
	for pair in dynamic[:MAX_GUESS_COLUMNS]:
		if not (isinstance(pair, list) and len(pair) == 2 and all(isinstance(x, str) for x in pair)):
			continue
		fieldname, type_fieldname = pair
		targets = targets_of(type_fieldname)
		if targets:
			result[fieldname] = {"dynamic": type_fieldname, "targets": targets}
	return result
