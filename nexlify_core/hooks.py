app_name = "nexlify_core"
app_title = "Nexlify Core"
app_publisher = "Kamal Adel"
app_description = "Nexlify Core"
app_email = "Kamal.adel@outlook.com"
app_license = "mit"

# ---------------------------------------------------------------------------
# Desk assets
# ---------------------------------------------------------------------------

app_include_js = [
	# Home Page Rule: keeps users without desktop access off the desk root
	"/assets/nexlify_core/js/nexlify_home_guard.js",
	# Dashboard filter bar
	"/assets/nexlify_core/js/nexlify_dashboard_filter.js",
	# Floating Raven chat button
	"/assets/nexlify_core/js/raven_float.js",
	# Active Company: company pill/switcher, locks Company on forms and reports
	"/assets/nexlify_core/js/nexlify_active_company.js",
]

doctype_js = {
}

extend_bootinfo = [
	"nexlify_core.nexlify_core.utils.boot.extend_bootinfo",
	"nexlify_core.raven_float.extend_boot",
	"nexlify_core.nexlify_core.active_company.extend_bootinfo",
]

# ---------------------------------------------------------------------------
# Home Page Rule: server-side landing and desktop guard
# ---------------------------------------------------------------------------

# Sets where the login response sends the user
on_session_creation = [
	"nexlify_core.nexlify_core.utils.home.on_session_creation",
	# runs second: sends the login to the company picker, then on to the home route
	"nexlify_core.nexlify_core.active_company.on_session_creation",
]

# Redirects /desk (and /app, /apps) for users whose rule denies desktop access
before_request = [
	# runs first: no company in the session means the picker, before any home redirect
	"nexlify_core.nexlify_core.active_company.before_request",
	"nexlify_core.nexlify_core.utils.home.before_request",
]

# ---------------------------------------------------------------------------
# Document events
# ---------------------------------------------------------------------------

doc_events = {
	"Number Card": {
		"before_save": "nexlify_core.dashboard_filter_injector.on_number_card_save",
	},
	"Dashboard Chart": {
		"before_save": "nexlify_core.dashboard_filter_injector.on_dashboard_chart_save",
	},
	"Nexlify Dashboard Filter": {
		"on_update": "nexlify_core.dashboard_filter_injector.on_dashboard_filter_config_save",
	},
}

after_migrate = "nexlify_core.dashboard_filter_injector.run_after_migrate"

# ---------------------------------------------------------------------------
# Restrict To Owner (merged from nexlify_access)
# ---------------------------------------------------------------------------

# Frappe calls every method listed under "*": a False from any of them denies,
# and query conditions are joined with AND.
has_permission = {
	"*": [
		"nexlify_core.nexlify_core.visibility_permissions.has_visibility_permission",
		"nexlify_core.nexlify_core.active_company.has_permission",
	],
}

permission_query_conditions = {
	"*": [
		"nexlify_core.nexlify_core.visibility_permissions.visibility_query_conditions",
		"nexlify_core.nexlify_core.active_company.query_conditions",
	],
}

# Active Company: force the Company filter of query reports to the session's company
override_whitelisted_methods = {
	"frappe.desk.query_report.run": "nexlify_core.nexlify_core.active_company.run_report",
	"frappe.desk.query_report.export_query": "nexlify_core.nexlify_core.active_company.export_report",
}
