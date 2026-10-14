"""Home Page Rule: where a user lands after login, and whether they may open the desk root.

Everything that decides the landing runs on the server, before the desk loads:

- on_session_creation sets frappe.local.flags.home_page, which Frappe's own
  get_home_page() returns first, so the login response sends the user straight
  to the rule's route.
- before_request redirects /desk (and /app, /apps, which Frappe forwards to
  /desk) for users whose rule has Allow Desktop Access off.

Moves inside the desk that never reach the server (the logo, the Home link)
are handled by public/js/nexlify_home_guard.js, which asks the router whether
it is at the desk root instead of keeping its own list of routes.
"""

import frappe
from werkzeug.exceptions import HTTPException
from werkzeug.utils import redirect

CACHE_KEY = "nexlify_home_page_rules"

# Paths that open the desktop. /app and /apps are forwarded to /desk by Frappe;
# catching them here saves the extra hop.
DESK_ROOT_PATHS = {"/desk", "/desk/", "/app", "/app/", "/apps", "/apps/"}

# Always allowed onto the desk root, so a rule on a broad role can't lock out
# the account needed to fix it.
EXEMPT_USERS = {"Administrator"}


# ---------- rules ----------


def get_home_page_rules():
	rules = frappe.cache.get_value(CACHE_KEY)
	if rules is None:
		rules = _build_rules_cache()
		frappe.cache.set_value(CACHE_KEY, rules)
	return rules


def _build_rules_cache():
	rule_names = frappe.get_all(
		"Home Page Rule",
		filters={"enabled": 1},
		fields=["name", "route", "priority", "allow_desktop_access"],
		order_by="priority desc",
	)

	users_map = {}
	roles_list = []

	for r in rule_names:
		route = normalize_route(r.route)
		if not route:
			continue
		doc = frappe.get_cached_doc("Home Page Rule", r.name)
		config = {"route": route, "allow_desktop_access": bool(r.allow_desktop_access)}

		for row in doc.users:
			users_map.setdefault(row.user, config)

		for row in doc.roles:
			roles_list.append((row.role, config))

	return {"users": users_map, "roles": roles_list}


def normalize_route(route):
	"""Turn whatever was typed in Route into an absolute path.

	"sales-invoice", "app/sales-invoice", "/app/sales-invoice" and
	"desk/sales-invoice" all become "/desk/sales-invoice". A path that starts
	with "/" and is not /app keeps its own prefix, so a website page or
	another SPA ("/alsa-projects", "/helpdesk") also works.
	Returns None for an empty route or one that points at the desk root.
	"""
	route = (route or "").strip()
	if not route:
		return None

	if route.startswith("/"):
		path = route.rstrip("/")
		if path == "/app" or path.startswith("/app/"):
			path = "/desk" + path[len("/app") :]
	else:
		bare = route.strip("/")
		for prefix in ("app/", "desk/"):
			if bare.startswith(prefix):
				bare = bare[len(prefix) :]
		if bare in ("app", "desk"):
			bare = ""
		path = "/desk/" + bare if bare else "/desk"

	if not path or path.rstrip("/") in ("/desk", "/app", "/apps"):
		return None
	return path


def get_home_page_config(user=None):
	"""Returns dict {route, allow_desktop_access} or None"""
	user = user or frappe.session.user
	if user == "Guest":
		return None

	rules = get_home_page_rules()

	user_config = rules["users"].get(user)
	if user_config:
		return user_config

	user_roles = set(frappe.get_roles(user))
	for role, config in rules["roles"]:
		if role in user_roles:
			return config

	return None


def get_home_page():
	config = get_home_page_config()
	return config["route"] if config else None


def clear_home_page_cache():
	frappe.cache.delete_value(CACHE_KEY)


# ---------- hooks ----------


def _is_system_user():
	return (frappe.session.data or {}).get("user_type") == "System User"


def on_session_creation(login_manager=None):
	"""Login: point the response's home_page at the rule's route.

	Runs inside make_session, before set_user_info builds the response, and
	get_home_page() returns frappe.local.flags.home_page ahead of everything
	else. A ?redirect-to= on the login URL still wins, as it does in Frappe.
	"""
	if frappe.session.user == "Guest" or not _is_system_user():
		return

	route = get_home_page()
	if route:
		frappe.local.flags.home_page = route


class _Redirect(HTTPException):
	"""An HTTPException carrying a ready response; Frappe's application()
	returns e.get_response() for these without treating them as errors."""


def before_request():
	"""Keep users whose rule has Allow Desktop Access off away from the desk root."""
	request = getattr(frappe.local, "request", None)
	if not request or request.method not in ("GET", "HEAD"):
		return
	if request.path not in DESK_ROOT_PATHS:
		return

	user = frappe.session.user
	if user == "Guest" or user in EXEMPT_USERS or not _is_system_user():
		return

	config = get_home_page_config(user)
	if not config or config["allow_desktop_access"]:
		return

	target = config["route"]
	if target.rstrip("/") == request.path.rstrip("/"):
		return

	raise _Redirect(response=redirect(target, code=302))
