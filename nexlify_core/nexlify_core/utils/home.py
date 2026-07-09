import frappe

CACHE_KEY = "nexlify_home_page_rules"


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
		fields=["name", "route", "priority", "allow_desktop_access"],
		order_by="priority desc",
	)

	users_map = {}
	roles_list = []

	for r in rule_names:
		doc = frappe.get_cached_doc("Home Page Rule", r.name)
		config = {"route": r.route, "allow_desktop_access": bool(r.allow_desktop_access)}

		for row in doc.users:
			users_map.setdefault(row.user, config)

		for row in doc.roles:
			roles_list.append((row.role, config))

	return {"users": users_map, "roles": roles_list}


def get_home_page_config():
	"""Returns dict {route, allow_desktop_access} or None"""
	user = frappe.session.user
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
