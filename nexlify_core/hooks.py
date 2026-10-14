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
]

doctype_js = {
}

extend_bootinfo = [
	"nexlify_core.nexlify_core.utils.boot.extend_bootinfo",
	"nexlify_core.raven_float.extend_boot",
]

# ---------------------------------------------------------------------------
# Home Page Rule: server-side landing and desktop guard
# ---------------------------------------------------------------------------

# Sets where the login response sends the user
on_session_creation = ["nexlify_core.nexlify_core.utils.home.on_session_creation"]

# Redirects /desk (and /app, /apps) for users whose rule denies desktop access
before_request = ["nexlify_core.nexlify_core.utils.home.before_request"]

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

has_permission = {
	"*": "nexlify_core.nexlify_core.visibility_permissions.has_visibility_permission",
}

permission_query_conditions = {
	"*": "nexlify_core.nexlify_core.visibility_permissions.visibility_query_conditions",
}
