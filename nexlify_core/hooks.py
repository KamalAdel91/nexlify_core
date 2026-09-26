app_name = "nexlify_core"
app_title = "Nexlify Core"
app_publisher = "Kamal Adel"
app_description = "Nexlify Core"
app_email = "Kamal.adel@outlook.com"
app_license = "mit"


doc_events = {
    "Number Card": {
        "before_save": "nexlify_core.dashboard_filter_injector.on_number_card_save"
    },
    "Dashboard Chart": {
        "before_save": "nexlify_core.dashboard_filter_injector.on_dashboard_chart_save"
    },
    "Nexlify Dashboard Filter": {
        "on_update": "nexlify_core.dashboard_filter_injector.on_dashboard_filter_config_save"
    }
}



extend_bootinfo = "nexlify_core.nexlify_core.utils.boot.extend_bootinfo"

after_migrate = "nexlify_core.dashboard_filter_injector.run_after_migrate"

# Include JS files in desk
app_include_js = ["/assets/nexlify_core/js/home_redirect.js", "/assets/nexlify_core/js/nexlify_dashboard_filter.js"]

# Fixtures for Nexlify Core settings (Workspace Sidebar, Dashboard Filter)

# ===== Nexlify Access: restrict to owner =====
has_permission = {
    "*": "nexlify_core.nexlify_core.visibility_permissions.has_visibility_permission"
}
permission_query_conditions = {
    "*": "nexlify_core.nexlify_core.visibility_permissions.visibility_query_conditions"
}

# --- Nexlify: floating Raven chat button (extends existing hooks, doesn't override) ---
_nx_js = globals().get("app_include_js") or []
app_include_js = (_nx_js if isinstance(_nx_js, list) else [_nx_js]) + ["/assets/nexlify_core/js/raven_float.js"]
_nx_boot = globals().get("extend_bootinfo") or []
extend_bootinfo = (_nx_boot if isinstance(_nx_boot, list) else [_nx_boot]) + ["nexlify_core.raven_float.extend_boot"]
