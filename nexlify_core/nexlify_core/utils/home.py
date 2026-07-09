import frappe

CACHE_KEY = "nexlify_home_page_rules"

# Paths that mean "user just landed on the desk with no specific route"
BARE_DESK_PATHS = {"/app", "/app/", "/desk", "/desk/"}


def get_home_page_rules():
	rules = frappe.cache().get_value(CACHE_KEY)
	if rules is None:
		rules = _build_rules_cache()
		frappe.cache().set_value(CACHE_KEY, rules)
	return rules


def _build_rules_cache():
	rule_names = frappe.get_all(
		"Home Page Rule",
		filters={"enabled": 1},
		fields=["name", "route", "priority"],
		order_by="priority desc",
	)

	users_map = {}
	roles_list = []

	for r in rule_names:
		doc = frappe.get_cached_doc("Home Page Rule", r.name)
		for row in doc.users:
			users_map.setdefault(row.user, r.route)
		for row in doc.roles:
			roles_list.append((row.role, r.route))

	return {"users": users_map, "roles": roles_list}


def get_home_page():
	user = frappe.session.user
	if user == "Guest":
		return None

	rules = get_home_page_rules()

	user_route = rules["users"].get(user)
	if user_route:
		return user_route

	user_roles = set(frappe.get_roles(user))
	for role, route in rules["roles"]:
		if role in user_roles:
			return route

	return None


def on_session_creation(login_manager):
	"""Redirect to the configured home page right after a successful login."""
	route = get_home_page()
	if not route:
		return

	target = "/" + route.lstrip("/")
	frappe.local.response["type"] = "redirect"
	frappe.local.response["location"] = target
