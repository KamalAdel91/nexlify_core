"""The Nexlify themes: a look for the desk, chosen by each user from Frappe's Switch Theme.

A theme is a *business* theme (a bookkeeping app's desk: dark sidebar, white pages, one accent), a
*style* (the desk re-colored: paper, cards, buttons, the Kanban) or a *scene* (an accent, a sky and
a drawing over Frappe's own surfaces), each in a light and a dark version. The
user's choice is kept as their default `nexlify_theme`, so it follows them to every device. A user
with no choice gets the site's default (Nexlify Theme Settings > Default Theme, else `DEFAULT`);
"none" is Frappe as it is, chosen on purpose. The same settings turn the themes off for the whole
site. The themes themselves are in public/js/nexlify_themes.bundle.js and
public/css/nexlify_themes.bundle.css.
"""

import re

import frappe
from frappe import _

BUSINESS = ("ledger", "slate", "indigo", "teal", "ember", "custom")
STYLES = ("warm", "rose", "ocean", "prism")
SCENES = ("sakura", "candy", "lavender", "nile", "sahel", "desert", "ramadan", "forest", "aurora", "night")
NONE = "none"
DEFAULT = "warm"
THEMES = BUSINESS + STYLES + SCENES + (NONE,)


def boot_settings():
	"""What the desk needs to know before it draws: are the themes on, and the site's default."""
	settings = frappe.get_cached_doc("Nexlify Theme Settings")
	# settings never saved have no value: the themes stay on
	enabled = settings.get("enabled")
	default = settings.get("default_theme") or DEFAULT
	dock_labels = settings.get("dock_labels")
	return {
		"enabled": 1 if enabled is None else int(enabled),
		"default": default if default in THEMES else DEFAULT,
		"dock_labels": 1 if dock_labels is None else int(dock_labels),
	}


@frappe.whitelist()
def set_theme(theme: str | None = None):
	"""Keep `theme` as the user's Nexlify theme; empty or "none" is Frappe as it is."""
	theme = theme or NONE
	if theme not in THEMES:
		frappe.throw(_("There is no Nexlify theme called {0}.").format(theme))
	frappe.defaults.set_user_default("nexlify_theme", theme)
	return theme


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


@frappe.whitelist()
def set_theme_colors(accent: str, sidebar: str):
	"""Keep the user's own accent and sidebar colors, for the Custom business theme."""
	for color in (accent, sidebar):
		if not HEX_COLOR.match(color or ""):
			frappe.throw(_("{0} is not a color like #1a2b3c.").format(color))
	frappe.defaults.set_user_default("nexlify_accent", accent.lower())
	frappe.defaults.set_user_default("nexlify_sidebar", sidebar.lower())
	return {"accent": accent.lower(), "sidebar": sidebar.lower()}


PANES = ("dark", "light")


@frappe.whitelist()
def set_theme_pane(pane: str):
	"""Keep the user's sidebar pane for the business themes: the theme's dark one, or a light one."""
	if pane not in PANES:
		frappe.throw(_("The pane is dark or light, not {0}.").format(pane))
	frappe.defaults.set_user_default("nexlify_pane", pane)
	return pane
