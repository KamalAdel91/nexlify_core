"""Active Company: the user picks one company per session and the site behaves
as if it belonged to that company only.

The choice lives in the session itself (frappe.session.data), not in a user
default, so two browsers of the same user can work in two companies without
stepping on each other. Frappe persists session data to the Sessions table, so
it survives a cache clear.

Enforcement is on the server:

- permission_query_conditions: every list, link search, count, report builder
  and dashboard query on a doctype with a Company link gets `company = <active>`.
- has_permission: opening, printing, saving or creating a record of another
  company is denied, even from a direct URL or the API.
- query reports: the `company` filter is forced to the active company before
  the report runs (override_whitelisted_methods in hooks.py).

Group companies: when Allow Group Companies is on and the user picks a group,
the session's scope is the group plus every company under it. The User
Permissions of ERPNext still apply on top (our conditions are ANDed with them).

Nothing applies when the feature is off in Active Company Settings, for
Administrator, for exempt roles, for website users, or while migrating.
"""

from urllib.parse import quote

import frappe
from frappe import _
from frappe.desk import query_report
from werkzeug.exceptions import HTTPException
from werkzeug.utils import redirect

SETTINGS = "Active Company Settings"
SESSION_KEY = "nx_active_company"
PICKER_PATH = "/select-company"
DESK_PREFIXES = ("/desk", "/app", "/apps")
ALWAYS_EXEMPT = {"Administrator", "Guest"}


# ---------- settings ----------


def get_settings():
	"""Settings as plain sets, read once per request (permission hooks run a lot)."""
	cached = getattr(frappe.local, "nx_active_company_settings", None)
	if cached is not None:
		return cached

	try:
		doc = frappe.get_cached_doc(SETTINGS)
		cached = frappe._dict(
			enabled=bool(doc.enabled),
			auto_select_single_company=bool(doc.auto_select_single_company),
			allow_group_companies=bool(doc.get("allow_group_companies")),
			exempt_roles={row.role for row in doc.exempt_roles},
			excluded_doctypes={row.document_type for row in doc.excluded_doctypes},
		)
	except Exception:
		# DocType not migrated yet: behave as disabled instead of breaking every query
		cached = frappe._dict(
			enabled=False,
			auto_select_single_company=False,
			allow_group_companies=False,
			exempt_roles=set(),
			excluded_doctypes=set(),
		)

	frappe.local.nx_active_company_settings = cached
	return cached


# ---------- who it applies to ----------


def _session():
	return getattr(frappe.local, "session", None) or {}


def _session_data():
	return _session().get("data") or {}


def applies_to(user=None):
	"""True when isolation should apply to `user` in the current session."""
	if frappe.flags.in_migrate or frappe.flags.in_install or frappe.flags.in_patch:
		return False

	session_user = _session().get("user")
	user = user or session_user
	# Permission checks made on behalf of someone else (sharing, notifications,
	# assignment) must not be filtered by *this* session's company.
	if not user or user != session_user or user in ALWAYS_EXEMPT:
		return False

	settings = get_settings()
	if not settings.enabled:
		return False

	if _session_data().get("user_type") != "System User":
		return False

	if settings.exempt_roles and settings.exempt_roles & set(frappe.get_roles(user)):
		return False

	return True


def get_active_company(user=None):
	"""The company this session is locked to, or None when nothing applies."""
	if not applies_to(user):
		return None
	return _session_data().get(SESSION_KEY) or None


def is_group_company(company):
	return bool(company and frappe.get_cached_value("Company", company, "is_group"))


def get_scope(company):
	"""The companies a session locked to `company` may see: itself, plus every
	company under it when it is a group and groups are allowed."""
	if not company:
		return []
	if not (get_settings().allow_group_companies and is_group_company(company)):
		return [company]

	cache = getattr(frappe.local, "nx_active_company_scope", None)
	if cache is None:
		cache = frappe.local.nx_active_company_scope = {}
	if company not in cache:
		from frappe.utils.nestedset import get_descendants_of

		cache[company] = [company, *get_descendants_of("Company", company, ignore_permissions=True)]
	return cache[company]


def get_active_scope(user=None):
	return get_scope(get_active_company(user))


def get_company_field(doctype):
	"""The doctype's `company` Link-to-Company field, if isolation can use it."""
	if doctype in get_settings().excluded_doctypes:
		return None
	meta = frappe.get_meta(doctype)
	if meta.istable or meta.issingle or getattr(meta, "is_virtual", 0):
		return None
	df = meta.get_field("company")
	if df and df.fieldtype == "Link" and df.options == "Company":
		return df
	return None


# ---------- permission hooks ----------


def query_conditions(user=None, doctype=None):
	if not doctype:
		return ""
	scope = get_active_scope(user)
	if not scope or not get_company_field(doctype):
		return ""

	# Rows with no company stay visible: they are shared, not another company's.
	values = ", ".join(frappe.db.escape(c) for c in scope)
	return f"ifnull(`tab{doctype}`.`company`, '') in ('', {values})"


def has_permission(doc, ptype=None, user=None, debug=False):
	# Must return True explicitly: Frappe treats None as a denial.
	scope = get_active_scope(user)
	if not scope or not get_company_field(doc.doctype):
		return True

	value = doc.get("company")
	return not value or value in scope


# ---------- companies the user may pick ----------


def get_allowed_companies(user=None):
	"""Companies from the user's User Permissions on Company, or all of them
	when there are none. Active Company never widens what the user could see."""
	user = user or frappe.session.user
	restricted = frappe.permissions.get_user_permissions(user).get("Company") or []
	filters = {"name": ["in", [p.get("doc") for p in restricted]]} if restricted else {}

	return frappe.get_all(
		"Company",
		filters=filters,
		fields=["name", "company_name", "abbr", "country", "default_currency", "is_group", "parent_company", "lft"],
		order_by="lft asc, company_name asc",
	)


def _store(company):
	data = _session_data()
	data[SESSION_KEY] = company
	session_obj = getattr(frappe.local, "session_obj", None)
	if session_obj:
		session_obj.update(force=True)


@frappe.whitelist()
def get_picker_state():
	return {
		"active": _session_data().get(SESSION_KEY),
		"companies": get_allowed_companies() if applies_to() else [],
	}


@frappe.whitelist(methods=["POST"])
def set_active_company(company):
	if not applies_to():
		frappe.throw(_("Active Company is not enabled for you."), frappe.PermissionError)

	allowed = {c.name for c in get_allowed_companies()}
	if company not in allowed:
		frappe.throw(_("You don't have access to company {0}.").format(company), frappe.PermissionError)

	_store(company)
	# Server-side defaults (new documents, get_query filters) follow the choice too.
	frappe.defaults.set_user_default("company", company)
	return company


def safe_redirect_target(target):
	"""Only same-site paths, never the picker itself."""
	target = (target or "").strip()
	if not target.startswith("/") or target.startswith("//") or target.startswith(PICKER_PATH):
		return "/desk"
	return target


# ---------- login and page loads ----------


def _auto_select_single():
	if not get_settings().auto_select_single_company:
		return False
	companies = get_allowed_companies()
	if len(companies) == 1:
		_store(companies[0].name)
		frappe.defaults.set_user_default("company", companies[0].name)
		return True
	return False


def on_session_creation(login_manager=None):
	"""Runs after the Home Page Rule hook: send the login to the picker first,
	carrying the Home Page Rule's route (or /desk) as the place to go after."""
	if not applies_to() or _session_data().get(SESSION_KEY):
		return
	if _auto_select_single():
		return

	after = frappe.local.flags.home_page or "/desk"
	frappe.local.flags.home_page = f"{PICKER_PATH}?redirect-to={quote(after)}"


class _Redirect(HTTPException):
	"""Same pattern as utils/home.py: Frappe returns e.get_response() as is."""


def _is_desk_page(path):
	return any(path == p or path.startswith(p + "/") for p in DESK_PREFIXES)


def before_request():
	"""A desk page load without a valid company goes to the picker. Registered
	before the Home Page Rule's before_request so the company comes first."""
	request = getattr(frappe.local, "request", None)
	if not request or request.method not in ("GET", "HEAD") or not _is_desk_page(request.path):
		return
	if not applies_to():
		return

	active = _session_data().get(SESSION_KEY)
	if active and active in {c.name for c in get_allowed_companies()}:
		return

	# Stored company no longer allowed (permission removed): pick again.
	if active:
		_store(None)
	if _auto_select_single():
		return

	target = request.full_path.rstrip("?")
	raise _Redirect(response=redirect(f"{PICKER_PATH}?redirect-to={quote(target)}", code=302))


def extend_bootinfo(bootinfo):
	company = get_active_company()
	scope = get_scope(company)
	bootinfo["nexlify_active_company"] = {
		"applies": bool(company),
		"company": company,
		"scope": scope,
		"is_group": len(scope) > 1,
		"abbr": frappe.get_cached_value("Company", company, "abbr") if company else None,
		"excluded_doctypes": sorted(get_settings().excluded_doctypes),
	}
	if company:
		# bootinfo is cached per user, but extend_bootinfo runs on every load,
		# so this per-session override is safe.
		defaults = (bootinfo.get("user") or {}).get("defaults")
		if isinstance(defaults, dict):
			defaults["company"] = company


# ---------- query reports ----------


def _force_company_filter(report_name, filters):
	company = get_active_company()
	if not company or not report_name:
		return filters
	scope = get_scope(company)

	parsed = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	if not isinstance(parsed, dict):
		return filters

	ref_doctype = frappe.get_cached_value("Report", report_name, "ref_doctype")
	if "company" in parsed or (ref_doctype and get_company_field(ref_doctype)):
		# A group session may report on any company in its scope; anything else
		# (or nothing) falls back to the session's company.
		if len(scope) == 1 or parsed.get("company") not in scope:
			parsed["company"] = company

	return frappe.as_json(parsed) if isinstance(filters, str) else parsed


@frappe.whitelist()
def run_report(
	report_name: str,
	filters: str | dict | None = None,
	user: str | None = None,
	ignore_prepared_report: bool = False,
	custom_columns: str | list | None = None,
	is_tree: bool = False,
	parent_field: str | None = None,
	are_default_filters: bool = True,
	js_filters: str | list | None = None,
):
	return query_report.run(
		report_name=report_name,
		filters=_force_company_filter(report_name, filters),
		ignore_prepared_report=ignore_prepared_report,
		custom_columns=custom_columns,
		is_tree=is_tree,
		parent_field=parent_field,
		are_default_filters=are_default_filters,
		js_filters=js_filters,
	)


@frappe.whitelist()
def export_report():
	form_dict = frappe.local.form_dict
	if form_dict.get("report_name"):
		form_dict["filters"] = _force_company_filter(form_dict.report_name, form_dict.get("filters"))
	return query_report.export_query()
